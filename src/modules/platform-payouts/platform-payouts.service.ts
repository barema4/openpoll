import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import type { MobileMoneyProvider } from '../payments/providers/payment-provider.interface';
import { isMobileMoneyProviderForCountry } from '../payments/providers/payment-provider.interface';
import { Prisma } from '../../../generated/prisma/client';
import {
  TransactionStatus,
  WithdrawalStatus,
} from '../../../generated/prisma/enums';
import {
  SUPPORTED_COUNTRIES,
  getSupportedCountry,
} from '../../config/supported-countries';
import { maskPhone } from '../payouts/mask-phone.util';
import { isTransactionConflictError } from '../../common/prisma-conflict.util';
import type { SetMobileMoneyPayoutDto } from '../payouts/dto/set-mobile-money-payout.dto';

@Injectable()
export class PlatformPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pawapay: PawaPayProvider,
  ) {}

  // Accumulated platform fee revenue for one PawaPay country, minus whatever
  // has already been withdrawn (or is mid-flight) — same "pool minus what's
  // spoken for" shape as WithdrawalsService.getBalance(), just scoped to
  // platformFeeAmount across the whole country's transactions instead of one
  // organization's amountSettled. Mirrors ReconciliationService's
  // totalPlatformFees aggregate exactly, so the two numbers never disagree.
  async getBalance(
    countryCode: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const [feesAgg, withdrawnAgg] = await Promise.all([
      client.transaction.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          event: { organization: { country: countryCode } },
        },
        _sum: { platformFeeAmount: true },
      }),
      client.platformWithdrawal.aggregate({
        where: {
          countryCode,
          status: {
            in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.COMPLETED],
          },
        },
        _sum: { amount: true },
      }),
    ]);

    return (
      Number(feesAgg._sum.platformFeeAmount ?? 0) -
      Number(withdrawnAgg._sum.amount ?? 0)
    );
  }

  async listBalances() {
    const countries = Object.entries(SUPPORTED_COUNTRIES).filter(
      ([, country]) => country.provider === 'PAWAPAY',
    );
    const destinations = await this.prisma.platformPayoutDestination.findMany();
    const destinationByCountry = new Map(
      destinations.map((d) => [d.countryCode, maskPhone(d)]),
    );

    return Promise.all(
      countries.map(async ([code, country]) => ({
        countryCode: code,
        label: country.label,
        currency: country.currency,
        balance: await this.getBalance(code),
        destination: destinationByCountry.get(code) ?? null,
      })),
    );
  }

  async setDestination(
    userId: string,
    countryCode: string,
    dto: SetMobileMoneyPayoutDto,
  ) {
    if (!SUPPORTED_COUNTRIES[countryCode]) {
      throw new BadRequestException(`Unsupported country code: ${countryCode}`);
    }
    if (!isMobileMoneyProviderForCountry(countryCode, dto.provider)) {
      throw new BadRequestException(
        `${String(dto.provider)} is not a mobile money network available in this country`,
      );
    }

    const destination = await this.prisma.platformPayoutDestination.upsert({
      where: { countryCode },
      create: {
        countryCode,
        payoutMobileProvider: dto.provider,
        payoutMobileNumber: dto.phoneNumber,
      },
      update: {
        payoutMobileProvider: dto.provider,
        payoutMobileNumber: dto.phoneNumber,
      },
    });

    await this.audit.record({
      userId,
      action: 'PLATFORM_PAYOUT_DESTINATION_SET',
      payload: { countryCode, provider: dto.provider },
    });

    return maskPhone(destination);
  }

  listWithdrawals(countryCode?: string) {
    return this.prisma.platformWithdrawal.findMany({
      where: countryCode ? { countryCode } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestWithdrawal(userId: string, countryCode: string, amount: number) {
    if (!SUPPORTED_COUNTRIES[countryCode]) {
      throw new BadRequestException(`Unsupported country code: ${countryCode}`);
    }
    const destination = await this.prisma.platformPayoutDestination.findUnique({
      where: { countryCode },
    });
    if (!destination) {
      throw new BadRequestException(
        'Set up a payout destination for this country before withdrawing',
      );
    }

    const withdrawal = await this.reserveWithdrawal(
      countryCode,
      userId,
      amount,
    );

    const payoutId = randomUUID();
    const result = await this.pawapay.initiatePayout({
      payoutId,
      amount,
      currency: getSupportedCountry(countryCode).currency,
      phoneNumber: destination.payoutMobileNumber,
      provider: destination.payoutMobileProvider as MobileMoneyProvider,
    });

    const updated = await this.prisma.platformWithdrawal.update({
      where: { id: withdrawal.id },
      data: result.accepted
        ? { status: WithdrawalStatus.PROCESSING, providerReference: payoutId }
        : {
            status: WithdrawalStatus.FAILED,
            failureReason: result.failureMessage ?? 'Payout rejected',
          },
    });

    await this.audit.record({
      userId,
      action: 'PLATFORM_WITHDRAWAL_REQUESTED',
      payload: { countryCode, withdrawalId: withdrawal.id, amount },
    });

    return updated;
  }

  // Same double-spend protection as WithdrawalsService.reserveWithdrawal —
  // checks the balance and creates the row inside one Serializable
  // transaction so two concurrent withdrawal requests for the same country
  // can't both pass the balance check and both fire a real PawaPay payout.
  private async reserveWithdrawal(
    countryCode: string,
    userId: string,
    amount: number,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const balance = await this.getBalance(countryCode, tx);
          if (amount > balance) {
            throw new BadRequestException(
              `Withdrawal amount exceeds the available platform fee balance (${balance})`,
            );
          }

          return tx.platformWithdrawal.create({
            data: { countryCode, amount, requestedByUserId: userId },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (isTransactionConflictError(err)) {
        throw new ConflictException(
          'A platform withdrawal is already being processed for this country — try again in a moment',
        );
      }
      throw err;
    }
  }

  // Called from PawaPayWebhookController's payout-callback dispatcher, the
  // same way TransactionsService.completeRefund and
  // PawaPayWebhookController.completeWithdrawal complete their own flows.
  async completeWithdrawal(
    withdrawal: { id: string; countryCode: string; status: WithdrawalStatus },
    succeeded: boolean,
    failureMessage?: string,
  ) {
    const nextStatus = succeeded
      ? WithdrawalStatus.COMPLETED
      : WithdrawalStatus.FAILED;
    if (withdrawal.status === nextStatus) return; // Already processed — redelivered callback.

    await this.prisma.platformWithdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: nextStatus,
        completedAt:
          nextStatus === WithdrawalStatus.COMPLETED ? new Date() : undefined,
        failureReason: failureMessage,
      },
    });

    await this.audit.record({
      action:
        nextStatus === WithdrawalStatus.COMPLETED
          ? 'PLATFORM_WITHDRAWAL_COMPLETED'
          : 'PLATFORM_WITHDRAWAL_FAILED',
      payload: {
        withdrawalId: withdrawal.id,
        countryCode: withdrawal.countryCode,
      },
    });
  }

  findWithdrawalByReference(providerReference: string) {
    return this.prisma.platformWithdrawal.findUnique({
      where: { providerReference },
    });
  }
}
