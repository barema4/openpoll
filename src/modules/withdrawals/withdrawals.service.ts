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
import { Prisma } from '../../../generated/prisma/client';
import {
  DisbursementStatus,
  OrganizationCountry,
  PaymentRail,
  TransactionStatus,
  WithdrawalStatus,
} from '../../../generated/prisma/enums';
import type { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { isTransactionConflictError } from '../../common/prisma-conflict.util';

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pawapay: PawaPayProvider,
  ) {}

  // Total collected (SUCCESS transactions across every event this org owns)
  // minus what's already in flight or paid out — the same "pool minus
  // what's spoken for" shape as budget allocation's remaining balance.
  // Excludes paymentRail: MANUAL — those entries record money received
  // outside the app (cash, a direct mobile money transfer) and were never
  // actually deposited into the platform's PawaPay balance, so they must
  // never be withdrawable even though they do count toward the event's
  // collected total for budget-allocation purposes.
  // Also subtracts vendor payouts (Disbursement) already sent or in flight —
  // that money left (or is leaving) the platform's real balance the same as
  // a Withdrawal does, so it must not remain double-countable as still
  // withdrawable at the org level. PENDING is included alongside QUEUED/
  // SUCCESS since it's the brief pre-gateway-call state, not a rejection.
  // Accepts an optional transaction client so requestWithdrawal() can read
  // the balance and reserve a Withdrawal row against it inside the same
  // Serializable transaction (see reserveWithdrawal below).
  async getBalance(
    organizationId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const [receivedAgg, withdrawnAgg, disbursedAgg] = await Promise.all([
      client.transaction.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          paymentRail: { not: PaymentRail.MANUAL },
          event: { organizationId },
        },
        _sum: { amountSettled: true },
      }),
      client.withdrawal.aggregate({
        where: {
          organizationId,
          status: {
            in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.COMPLETED],
          },
        },
        _sum: { amount: true },
      }),
      client.disbursement.aggregate({
        where: {
          event: { organizationId },
          status: {
            in: [
              DisbursementStatus.PENDING,
              DisbursementStatus.QUEUED,
              DisbursementStatus.SUCCESS,
            ],
          },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalReceived = Number(receivedAgg._sum.amountSettled ?? 0);
    const totalWithdrawn = Number(withdrawnAgg._sum.amount ?? 0);
    const totalDisbursed = Number(disbursedAgg._sum.amount ?? 0);
    return totalReceived - totalWithdrawn - totalDisbursed;
  }

  async listForOrganization(organizationId: string) {
    const [balance, withdrawals] = await Promise.all([
      this.getBalance(organizationId),
      this.prisma.withdrawal.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { balance, withdrawals };
  }

  async requestWithdrawal(
    userId: string,
    organizationId: string,
    dto: CreateWithdrawalDto,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        country: true,
        payoutMobileProvider: true,
        payoutMobileNumber: true,
      },
    });
    if (organization.country !== OrganizationCountry.UGANDA) {
      throw new BadRequestException(
        'Withdrawals are only available for Uganda organizations',
      );
    }
    if (
      !organization.payoutMobileProvider ||
      !organization.payoutMobileNumber
    ) {
      throw new BadRequestException(
        'Set up a mobile money payout number before withdrawing',
      );
    }

    const withdrawal = await this.reserveWithdrawal(
      organizationId,
      userId,
      dto.amount,
    );

    const payoutId = randomUUID();
    const result = await this.pawapay.initiatePayout({
      payoutId,
      amount: dto.amount,
      currency: 'UGX',
      phoneNumber: organization.payoutMobileNumber,
      provider: organization.payoutMobileProvider as MobileMoneyProvider,
    });

    const updated = await this.prisma.withdrawal.update({
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
      action: 'WITHDRAWAL_REQUESTED',
      payload: {
        organizationId,
        withdrawalId: withdrawal.id,
        amount: dto.amount,
      },
    });

    return updated;
  }

  // Checks the balance and creates the Withdrawal row inside one
  // Serializable transaction. Without this, two concurrent withdrawal
  // requests for the same organization could both read the same balance,
  // both pass the check, and both trigger a real PawaPay payout — draining
  // more than the organization actually has. Postgres aborts one of the two
  // with a serialization failure instead, surfaced here as a 409.
  private async reserveWithdrawal(
    organizationId: string,
    userId: string,
    amount: number,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const balance = await this.getBalance(organizationId, tx);
          if (amount > balance) {
            throw new BadRequestException(
              `Withdrawal amount exceeds the available balance (${balance})`,
            );
          }

          return tx.withdrawal.create({
            data: { organizationId, amount, requestedByUserId: userId },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (isTransactionConflictError(err)) {
        throw new ConflictException(
          'A withdrawal is already being processed for this organization — try again in a moment',
        );
      }
      throw err;
    }
  }
}
