import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayoutsService } from '../payouts/payouts.service';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';

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
  ) {}

  findOne(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: SELECT,
    });
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
