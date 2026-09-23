import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import { PaystackProvider } from '../payments/providers/paystack.provider';
import type { MobileMoneyProvider } from '../payments/providers/payment-provider.interface';
import { Prisma } from '../../../generated/prisma/client';
import {
  BudgetApprovalStatus,
  DisbursementStatus,
  DisbursementTransferType,
  PaymentRail,
  TransactionStatus,
  VendorPayoutMethod,
} from '../../../generated/prisma/enums';
import {
  DEFAULT_COUNTRY_CODE,
  getSupportedCountry,
} from '../../config/supported-countries';
import type { ListDisbursementsQueryDto } from './dto/list-disbursements-query.dto';
import { paginate } from '../../common/pagination.util';
import { isTransactionConflictError } from '../../common/prisma-conflict.util';

// Fields safe to return to the client — never the raw recipient account/
// phone number (a snapshot of the vendor's payout destination at the time
// of payment), matching Vendor's own masking convention.
const SAFE_SELECT = {
  id: true,
  eventId: true,
  budgetCategoryId: true,
  vendorId: true,
  transferType: true,
  recipientName: true,
  status: true,
  failureReason: true,
  amount: true,
  initiatedBy: true,
  approvedBy: true,
  createdAt: true,
} as const;

@Injectable()
export class DisbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pawapay: PawaPayProvider,
    private readonly paystack: PaystackProvider,
  ) {}

  // Pays the full remaining allocated balance for a budget category to its
  // assigned vendor — no partial-amount support in v1 (matches this
  // codebase's existing full-only precedent for refunds). Mechanism is
  // whichever the vendor itself is set up for (PawaPay mobile money or
  // Paystack bank transfer) — see reserveDisbursement's validation.
  async pay(userId: string, budgetCategoryId: string) {
    const { disbursement, vendor, currency } = await this.reserveDisbursement(
      userId,
      budgetCategoryId,
    );

    const transferId = randomUUID();
    const result =
      vendor.payoutMethod === VendorPayoutMethod.MOBILE_MONEY
        ? await this.pawapay.initiatePayout({
            payoutId: transferId,
            amount: Number(disbursement.amount),
            currency,
            phoneNumber: vendor.payoutMobileNumber!,
            provider: vendor.payoutMobileProvider as MobileMoneyProvider,
          })
        : await this.paystack.payBankAccountVendor({
            transferId,
            amount: Number(disbursement.amount),
            currency,
            accountName: vendor.payoutAccountName!,
            accountNumber: vendor.payoutAccountNumber!,
            bankCode: vendor.payoutBankCode!,
          });

    const updated = await this.prisma.disbursement.update({
      where: { id: disbursement.id },
      data: result.accepted
        ? {
            status: DisbursementStatus.QUEUED,
            gatewayTransferRef: transferId,
          }
        : {
            status: DisbursementStatus.FAILED,
            failureReason: result.failureMessage ?? 'Payout rejected',
          },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      userId,
      eventId: disbursement.eventId,
      action: 'VENDOR_PAYOUT_INITIATED',
      payload: {
        disbursementId: disbursement.id,
        budgetCategoryId,
        vendorId: vendor.id,
        amount: Number(disbursement.amount),
      },
    });

    return updated;
  }

  // Verifies eligibility and atomically reserves the remaining balance by
  // creating the Disbursement row, all inside one Serializable transaction.
  // Without this, two concurrent Pay requests (a double-click, two open
  // tabs) could both read the same "remaining" figure, both pass the check,
  // and both go on to trigger a real PawaPay transfer — double-paying the
  // vendor. Postgres aborts one of the two with a serialization failure
  // instead, which we surface as a 409 asking the caller to retry.
  private async reserveDisbursement(userId: string, budgetCategoryId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const category = await tx.budgetCategory.findUniqueOrThrow({
            where: { id: budgetCategoryId },
            include: {
              vendor: true,
              event: { include: { organization: true, budgetApproval: true } },
            },
          });

          if (
            category.event.budgetApproval?.status !==
            BudgetApprovalStatus.FUNDED
          ) {
            throw new BadRequestException(
              "This event's budget must be approved and funded before paying a vendor",
            );
          }
          if (!category.vendor) {
            throw new BadRequestException(
              'Assign a vendor to this category before paying it',
            );
          }

          const disbursedAgg = await tx.disbursement.aggregate({
            where: {
              budgetCategoryId,
              status: {
                in: [
                  DisbursementStatus.PENDING,
                  DisbursementStatus.QUEUED,
                  DisbursementStatus.SUCCESS,
                ],
              },
            },
            _sum: { amount: true },
          });
          const alreadyPaid = Number(disbursedAgg._sum.amount ?? 0);
          const remaining = Number(category.allocatedFunds) - alreadyPaid;
          if (remaining <= 0) {
            throw new BadRequestException(
              'This category has already been fully paid',
            );
          }

          // category.allocatedFunds is a static running total — it's never
          // adjusted if a transaction that funded this allocation is later
          // refunded or lost in a dispute. Re-verify against the event's
          // real, current pool (the same non-manual/SUCCESS-only figure
          // BudgetCategoriesService.allocate() computes) before sending any
          // real money, so a stale allocation can never pay out more than
          // the event actually still holds.
          const [eventReceivedAgg, eventDisbursedAgg] = await Promise.all([
            tx.transaction.aggregate({
              where: {
                eventId: category.eventId,
                status: TransactionStatus.SUCCESS,
                paymentRail: { not: PaymentRail.MANUAL },
              },
              _sum: { amountSettled: true },
            }),
            tx.disbursement.aggregate({
              where: {
                eventId: category.eventId,
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
          const eventRealRemaining =
            Number(eventReceivedAgg._sum.amountSettled ?? 0) -
            Number(eventDisbursedAgg._sum.amount ?? 0);
          if (remaining > eventRealRemaining) {
            throw new BadRequestException(
              `This category's allocated funds exceed what the event actually still holds — ` +
                `likely because a contribution behind it was refunded. Only ${eventRealRemaining} ` +
                'is really available to pay out.',
            );
          }

          const organization = category.event.organization;
          const { provider, currency } = getSupportedCountry(
            organization?.country ?? DEFAULT_COUNTRY_CODE,
          );
          const isPawaPayMobileMoney =
            provider === 'PAWAPAY' &&
            category.vendor.payoutMethod === VendorPayoutMethod.MOBILE_MONEY &&
            !!category.vendor.payoutMobileProvider &&
            !!category.vendor.payoutMobileNumber;
          const isPaystackBankAccount =
            provider === 'PAYSTACK' &&
            category.vendor.payoutMethod === VendorPayoutMethod.BANK_ACCOUNT &&
            !!category.vendor.payoutBankCode &&
            !!category.vendor.payoutAccountNumber;

          if (!isPawaPayMobileMoney && !isPaystackBankAccount) {
            throw new BadRequestException(
              provider === 'STRIPE'
                ? 'Vendor payouts are not available yet for organizations on the Stripe rail — the vendor would need their own Stripe Connect account'
                : "Vendor payouts are not available yet for this organization's country/payout method combination",
            );
          }

          const disbursement = await tx.disbursement.create({
            data: {
              eventId: category.eventId,
              budgetCategoryId,
              vendorId: category.vendor.id,
              transferType: DisbursementTransferType.VENDOR_PAYOUT,
              recipientName: category.vendor.name,
              recipientBankCode: category.vendor.payoutBankCode,
              recipientAccountNumber: category.vendor.payoutAccountNumber,
              recipientMobileProvider: category.vendor.payoutMobileProvider,
              recipientMobileNumber: category.vendor.payoutMobileNumber,
              amount: remaining,
              initiatedBy: userId,
            },
          });

          return { disbursement, vendor: category.vendor, currency };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (isTransactionConflictError(err)) {
        throw new ConflictException(
          'This category is already being paid — try again in a moment',
        );
      }
      throw err;
    }
  }

  async listForEvent(query: ListDisbursementsQueryDto) {
    const { eventId, page = 1, pageSize = 10 } = query;
    const where = { eventId };
    const [data, total] = await Promise.all([
      this.prisma.disbursement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SAFE_SELECT,
      }),
      this.prisma.disbursement.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
  }
}
