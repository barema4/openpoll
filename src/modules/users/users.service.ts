import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PayoutsService } from '../payouts/payouts.service';
import { OrganizationCountry } from '../../../generated/prisma/enums';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { SetMobileMoneyPayoutDto } from '../payouts/dto/set-mobile-money-payout.dto';
import { maskPhone } from '../payouts/mask-phone.util';

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
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly audit: AuditService,
  ) {}

  async findOne(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: SELECT,
    });
    return maskPhone(user);
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
    return maskPhone(updated);
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

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: details,
      select: SELECT,
    });
    return maskPhone(updated);
  }

  // Uganda/PawaPay only — no bank-style resolve/subaccount step to call out
  // to, so this is pure local validation + storage, mirroring
  // OrganizationsService.setMobileMoneyPayout.
  async setMobileMoneyPayout(userId: string, dto: SetMobileMoneyPayoutDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { country: true },
    });
    if (user.country !== OrganizationCountry.UGANDA) {
      throw new ForbiddenException(
        'Mobile money payouts are only available when your account country is Uganda',
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

    return maskPhone(updated);
  }
}
