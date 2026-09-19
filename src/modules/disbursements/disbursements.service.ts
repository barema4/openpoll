import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import type { MobileMoneyProvider } from '../payments/providers/payment-provider.interface';
import {
  BudgetApprovalStatus,
  DisbursementStatus,
  DisbursementTransferType,
  OrganizationCountry,
  VendorPayoutMethod,
} from '../../../generated/prisma/enums';
import type { ListDisbursementsQueryDto } from './dto/list-disbursements-query.dto';
import { paginate } from '../../common/pagination.util';

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
  ) {}

  // Pays the full remaining allocated balance for a budget category to its
  // assigned vendor — no partial-amount support in v1 (matches this
  // codebase's existing full-only precedent for refunds). Uganda/mobile-
  // money only in this phase; Kenya bank transfers need the (not yet built)
  // Paystack Transfer integration.
  async pay(userId: string, budgetCategoryId: string) {
    const category = await this.prisma.budgetCategory.findUniqueOrThrow({
      where: { id: budgetCategoryId },
      include: {
        vendor: true,
        event: { include: { organization: true, budgetApproval: true } },
      },
    });

    if (category.event.budgetApproval?.status !== BudgetApprovalStatus.FUNDED) {
      throw new BadRequestException(
        "This event's budget must be approved and funded before paying a vendor",
      );
    }
    if (!category.vendor) {
      throw new BadRequestException(
        'Assign a vendor to this category before paying it',
      );
    }

    const disbursedAgg = await this.prisma.disbursement.aggregate({
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

    const organization = category.event.organization;
    const isUgandaMobileMoney =
      organization?.country === OrganizationCountry.UGANDA &&
      category.vendor.payoutMethod === VendorPayoutMethod.MOBILE_MONEY &&
      !!category.vendor.payoutMobileProvider &&
      !!category.vendor.payoutMobileNumber;

    if (!isUgandaMobileMoney) {
      throw new BadRequestException(
        'Vendor payouts for Kenya are not available yet',
      );
    }

    const disbursement = await this.prisma.disbursement.create({
      data: {
        eventId: category.eventId,
        budgetCategoryId,
        vendorId: category.vendor.id,
        transferType: DisbursementTransferType.VENDOR_PAYOUT,
        recipientName: category.vendor.name,
        recipientMobileProvider: category.vendor.payoutMobileProvider,
        recipientMobileNumber: category.vendor.payoutMobileNumber,
        amount: remaining,
        initiatedBy: userId,
      },
    });

    const payoutId = randomUUID();
    const result = await this.pawapay.initiatePayout({
      payoutId,
      amount: remaining,
      currency: 'UGX',
      phoneNumber: category.vendor.payoutMobileNumber!,
      provider: category.vendor.payoutMobileProvider as MobileMoneyProvider,
    });

    const updated = await this.prisma.disbursement.update({
      where: { id: disbursement.id },
      data: result.accepted
        ? { status: DisbursementStatus.QUEUED, gatewayTransferRef: payoutId }
        : {
            status: DisbursementStatus.FAILED,
            failureReason: result.failureMessage ?? 'Payout rejected',
          },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      userId,
      eventId: category.eventId,
      action: 'VENDOR_PAYOUT_INITIATED',
      payload: {
        disbursementId: disbursement.id,
        budgetCategoryId,
        vendorId: category.vendor.id,
        amount: remaining,
      },
    });

    return updated;
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
