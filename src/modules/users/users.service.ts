import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PayoutsService } from '../payouts/payouts.service';
import type { PlatformRole } from '../../../generated/prisma/enums';
import { getSupportedCountry } from '../../config/supported-countries';
import { isMobileMoneyProviderForCountry } from '../payments/providers/payment-provider.interface';
import { resolveEffectivePlatformRole } from '../../common/guards/resolve-effective-platform-role.util';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { SetMobileMoneyPayoutDto } from '../payouts/dto/set-mobile-money-payout.dto';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import { maskPhone } from '../payouts/mask-phone.util';
import { paginate } from '../../common/pagination.util';
import type { Prisma } from '../../../generated/prisma/client';

const BCRYPT_SALT_ROUNDS = 12;

const SELECT = {
  id: true,
  email: true,
  name: true,
  country: true,
  payoutBankName: true,
  payoutAccountName: true,
  payoutAccountLast4: true,
  payoutMobileProvider: true,
  payoutMobileNumber: true,
  platformRole: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // Reflects the operator-email fallback (see resolve-effective-platform-role.ts)
  // so the frontend's "Admin" nav link stays accurate even for the bootstrap
  // owner, whose DB row may have no platformRole set at all.
  private toProfile<
    T extends {
      email: string;
      platformRole: PlatformRole | null;
      payoutMobileNumber: string | null;
    },
  >(user: T) {
    return {
      ...maskPhone(user),
      platformRole: resolveEffectivePlatformRole(user, this.config),
    };
  }

  async findOne(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: SELECT,
    });
    return this.toProfile(user);
  }

  // Platform-wide search by email/name for staff support lookups (see
  // AdminUsersController) — not something a regular user can call. Includes
  // each user's org memberships, since "which orgs is this account part of"
  // is exactly what a support lookup needs.
  async listAllForAdmin(query: ListUsersQueryDto = {}) {
    const { page = 1, pageSize = 10, search } = query;
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...SELECT,
          memberships: {
            select: {
              role: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(
      rows.map((row) => this.toProfile(row)),
      total,
      page,
      pageSize,
    );
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
    }

    if (dto.country) {
      const current = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          country: true,
          gatewayWalletId: true,
          payoutMobileProvider: true,
        },
      });
      const hasPayoutSet = !!(
        current.gatewayWalletId || current.payoutMobileProvider
      );
      if (hasPayoutSet && dto.country !== current.country) {
        throw new ForbiddenException(
          'Cannot change country once a payout method is set up',
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, email: dto.email, country: dto.country },
      select: SELECT,
    });
    return this.toProfile(updated);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.audit.record({ userId, action: 'PASSWORD_CHANGED' });

    return { message: 'Password changed successfully.' };
  }

  async setPayout(userId: string, dto: SetPayoutDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, country: true },
    });
    if (getSupportedCountry(user.country).provider !== 'PAYSTACK') {
      throw new ForbiddenException(
        'Bank-account payouts are only available for accounts on the Paystack payout rail',
      );
    }

    const details = await this.payouts.onboard({
      businessName: user.name,
      bankCode: dto.bankCode,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber,
    });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: details,
      select: SELECT,
    });
    return this.toProfile(updated);
  }

  // Uganda/PawaPay only — no bank-style resolve/subaccount step to call out
  // to, so this is pure local validation + storage, mirroring
  // OrganizationsService.setMobileMoneyPayout.
  async setMobileMoneyPayout(userId: string, dto: SetMobileMoneyPayoutDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { country: true },
    });
    if (getSupportedCountry(user.country).provider !== 'PAWAPAY') {
      throw new ForbiddenException(
        'Mobile money payouts are only available for accounts on the PawaPay payout rail',
      );
    }
    if (!isMobileMoneyProviderForCountry(user.country, dto.provider)) {
      throw new ForbiddenException(
        `${String(dto.provider)} is not a mobile money network available in this account's country`,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        payoutMobileProvider: dto.provider,
        payoutMobileNumber: dto.phoneNumber,
      },
      select: SELECT,
    });

    await this.audit.record({
      userId,
      action: 'USER_MOBILE_MONEY_PAYOUT_SET',
      payload: { provider: dto.provider },
    });

    return this.toProfile(updated);
  }
}
