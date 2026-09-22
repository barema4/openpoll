import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaystackProvider } from '../payments/providers/paystack.provider';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import {
  DisbursementStatus,
  PaymentRail,
  TransactionStatus,
  WithdrawalStatus,
} from '../../../generated/prisma/enums';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackProvider,
    private readonly pawapay: PawaPayProvider,
  ) {}

  async check() {
    const [kenya, uganda] = await Promise.all([
      this.checkKenya(),
      this.checkUganda(),
    ]);
    return { kenya, uganda };
  }

  // Inherently approximate: exact only once every Kenya event/personal-invoice
  // issuer has a payout subaccount configured. An org/user without one yet
  // has their *entire* charge — not just the fee — land in this same main
  // account, which shows up here as unexplained extra balance rather than a
  // routing bug. Report both numbers rather than a hard pass/fail.
  private async checkKenya() {
    const [liveBalances, feesAgg] = await Promise.all([
      this.paystack.getBalance(),
      this.prisma.transaction.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          event: { organization: { country: 'KE' } },
        },
        _sum: { platformFeeAmount: true },
      }),
    ]);

    return {
      liveBalances,
      expectedPlatformFees: Number(feesAgg._sum.platformFeeAmount ?? 0),
      caveat:
        'Approximate: exact only once every Kenya org/user has a payout subaccount configured. ' +
        'An unconfigured payout destination routes its entire charge (not just the fee) into this ' +
        'same main account, which appears here as unexplained extra balance rather than a bug.',
    };
  }

  // Exact, no known confound: 100% of every UGX charge (base + fee) lands in
  // one shared PawaPay balance by construction, and withdrawals/vendor
  // disbursements are the only outflows — so liveBalance should equal what's
  // still owed to orgs plus whatever platform fees have accumulated (fees
  // are never withdrawn).
  private async checkUganda() {
    const [liveBalances, receivedAgg, withdrawnAgg, disbursedAgg, feesAgg] =
      await Promise.all([
        this.pawapay.getBalance('UGA'),
        this.prisma.transaction.aggregate({
          where: {
            status: TransactionStatus.SUCCESS,
            paymentRail: { not: PaymentRail.MANUAL },
            event: { organization: { country: 'UG' } },
          },
          _sum: { amountSettled: true },
        }),
        this.prisma.withdrawal.aggregate({
          where: {
            organization: { country: 'UG' },
            status: {
              in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.COMPLETED],
            },
          },
          _sum: { amount: true },
        }),
        this.prisma.disbursement.aggregate({
          where: {
            event: { organization: { country: 'UG' } },
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
        this.prisma.transaction.aggregate({
          where: {
            status: TransactionStatus.SUCCESS,
            event: { organization: { country: 'UG' } },
          },
          _sum: { platformFeeAmount: true },
        }),
      ]);

    const totalOwedToOrgs =
      Number(receivedAgg._sum.amountSettled ?? 0) -
      Number(withdrawnAgg._sum.amount ?? 0) -
      Number(disbursedAgg._sum.amount ?? 0);
    const totalPlatformFees = Number(feesAgg._sum.platformFeeAmount ?? 0);
    const expectedTotal = totalOwedToOrgs + totalPlatformFees;
    const liveBalance =
      liveBalances.find((b) => b.currency === 'UGX')?.balance ?? 0;

    return {
      liveBalances,
      totalOwedToOrgs,
      totalPlatformFees,
      expectedTotal,
      drift: liveBalance - expectedTotal,
    };
  }
}
