import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import { SUPPORTED_COUNTRIES } from '../../config/supported-countries';
import {
  DisbursementStatus,
  PaymentRail,
  TransactionStatus,
  WithdrawalStatus,
} from '../../../generated/prisma/enums';

// Every country code currently mapped to PawaPay — checked independently,
// one shared per-country wallet balance each.
const PAWAPAY_COUNTRY_CODES = Object.entries(SUPPORTED_COUNTRIES)
  .filter(([, country]) => country.provider === 'PAWAPAY')
  .map(([code]) => code);

// PawaPay identifies a country's wallet by its ISO 3166-1 alpha-3 code
// (confirmed against docs.pawapay.io/v2/docs/providers), not the alpha-2
// code SUPPORTED_COUNTRIES itself is keyed by.
const PAWAPAY_ALPHA3: Record<string, string> = {
  KE: 'KEN',
  UG: 'UGA',
  GH: 'GHA',
  TZ: 'TZA',
  RW: 'RWA',
  ZM: 'ZMB',
  MW: 'MWI',
  NG: 'NGA',
  CM: 'CMR',
  CI: 'CIV',
  SN: 'SEN',
  BJ: 'BEN',
  BF: 'BFA',
  CG: 'COG',
  CD: 'COD',
  GA: 'GAB',
  SL: 'SLE',
  LS: 'LSO',
  MZ: 'MOZ',
  ET: 'ETH',
};

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pawapay: PawaPayProvider,
  ) {}

  async check() {
    const pawapay = await Promise.all(
      PAWAPAY_COUNTRY_CODES.map((code) => this.checkPawaPayCountry(code)),
    );
    return { pawapay };
  }

  // Exact, no known confound: 100% of every charge (base + fee) in a
  // PawaPay-backed country lands in that country's own shared wallet by
  // construction, and withdrawals/vendor disbursements/platform-fee
  // withdrawals are the only outflows — so liveBalance should equal what's
  // still owed to orgs plus whatever platform fees haven't been withdrawn
  // yet (see PlatformPayoutsService, the platform's own withdrawal path).
  private async checkPawaPayCountry(countryCode: string) {
    const { label, currency } = SUPPORTED_COUNTRIES[countryCode];
    const alpha3 = PAWAPAY_ALPHA3[countryCode] ?? countryCode;

    const [
      liveBalances,
      receivedAgg,
      withdrawnAgg,
      disbursedAgg,
      feesAgg,
      platformWithdrawnAgg,
    ] = await Promise.all([
      this.pawapay.getBalance(alpha3),
      this.prisma.transaction.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          paymentRail: { not: PaymentRail.MANUAL },
          event: { organization: { country: countryCode } },
        },
        _sum: { amountSettled: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: {
          organization: { country: countryCode },
          status: {
            in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.COMPLETED],
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.disbursement.aggregate({
        where: {
          event: { organization: { country: countryCode } },
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
          event: { organization: { country: countryCode } },
        },
        _sum: { platformFeeAmount: true },
      }),
      this.prisma.platformWithdrawal.aggregate({
        where: {
          countryCode,
          status: {
            in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.COMPLETED],
          },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalOwedToOrgs =
      Number(receivedAgg._sum.amountSettled ?? 0) -
      Number(withdrawnAgg._sum.amount ?? 0) -
      Number(disbursedAgg._sum.amount ?? 0);
    const totalPlatformFees = Number(feesAgg._sum.platformFeeAmount ?? 0);
    const totalPlatformFeesWithdrawn = Number(
      platformWithdrawnAgg._sum.amount ?? 0,
    );
    const platformFeesAvailable =
      totalPlatformFees - totalPlatformFeesWithdrawn;
    const expectedTotal = totalOwedToOrgs + platformFeesAvailable;
    const liveBalance =
      liveBalances.find((b) => b.currency === currency)?.balance ?? 0;

    return {
      countryCode,
      label,
      currency,
      liveBalances,
      totalOwedToOrgs,
      totalPlatformFees,
      totalPlatformFeesWithdrawn,
      platformFeesAvailable,
      expectedTotal,
      drift: liveBalance - expectedTotal,
    };
  }
}
