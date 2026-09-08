import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PayoutsService } from '../payouts/payouts.service';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_SALT_ROUNDS = 12;

const SELECT = {
  id: true,
  email: true,
  name: true,
  payoutBankName: true,
  payoutAccountName: true,
  payoutAccountLast4: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly audit: AuditService,
  ) {}

  findOne(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: SELECT,
    });
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

    return this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, email: dto.email },
      select: SELECT,
    });
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
      select: { name: true },
    });

    const details = await this.payouts.onboard({
      businessName: user.name,
      bankCode: dto.bankCode,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber,
    });

    return this.prisma.user.update({
      where: { id: userId },
      data: details,
      select: SELECT,
    });
  }
}
