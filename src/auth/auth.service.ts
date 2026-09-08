import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { OrganizationInvitationStatus } from '../../generated/prisma/enums';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { JwtPayload } from './types/authenticated-user.type';

const BCRYPT_SALT_ROUNDS = 12;
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends TokenPair {
  user: { id: string; email: string; name: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });

    await this.audit.record({ userId: user.id, action: 'USER_REGISTERED' });

    if (dto.inviteToken) {
      await this.tryAcceptInvitation(dto.inviteToken, dto.email, user.id);
    }

    return this.issueTokens(user);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const message =
      'If an account exists for that email, a password reset link has been sent.';

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      // Enumeration-safe: identical response whether or not the account exists.
      return { message };
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
      },
    });

    const baseUrl = this.config
      .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
      .replace(/\/$/, '');
    await this.email.send({
      to: user.email,
      subject: 'Reset your OpenPool password',
      html: `<p>Someone requested a password reset for this account. If this was you, click
        below to choose a new password (this link expires in 1 hour):</p>
        <p><a href="${baseUrl}/reset-password?token=${rawToken}">Reset password</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>`,
    });

    await this.audit.record({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
    });

    return { message };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = hashToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      userId: resetToken.userId,
      action: 'PASSWORD_RESET_COMPLETED',
    });

    return { message: 'Password reset successfully.' };
  }

  // Resolves an organization-invitation token captured at registration time.
  // Deliberately never throws — a bad, stale, or mismatched invite token must
  // never block account creation.
  private async tryAcceptInvitation(
    rawToken: string,
    email: string,
    userId: string,
  ): Promise<void> {
    try {
      const invitation = await this.prisma.organizationInvitation.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      if (
        !invitation ||
        invitation.status !== OrganizationInvitationStatus.PENDING ||
        invitation.expiresAt < new Date() ||
        invitation.email.toLowerCase() !== email.toLowerCase()
      ) {
        return;
      }

      await this.prisma.$transaction([
        this.prisma.organizationMembership.create({
          data: {
            userId,
            organizationId: invitation.organizationId,
            role: invitation.role,
          },
        }),
        this.prisma.organizationInvitation.update({
          where: { id: invitation.id },
          data: { status: OrganizationInvitationStatus.ACCEPTED },
        }),
      ]);

      await this.audit.record({
        userId,
        action: 'ORGANIZATION_INVITATION_ACCEPTED',
        payload: {
          organizationId: invitation.organizationId,
          role: invitation.role,
        },
      });
    } catch {
      // Never block registration on a bad invite token.
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.audit.record({ userId: user.id, action: 'USER_LOGIN' });

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.issueTokens(user);
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: user.id, email: user.email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as StringValue,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as StringValue,
      }),
    ]);

    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
      refreshToken,
    };
  }
}
