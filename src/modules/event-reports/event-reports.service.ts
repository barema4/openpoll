import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DisbursementStatus,
  PaymentRail,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import { toCsv } from '../../common/csv.util';

// Money already sent or in flight — same set DisbursementsService.pay()
// itself treats as "already paid" against a category's allocation.
const OUTSTANDING_DISBURSEMENT_STATUSES: DisbursementStatus[] = [
  DisbursementStatus.PENDING,
  DisbursementStatus.QUEUED,
  DisbursementStatus.SUCCESS,
];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'event'
  );
}

@Injectable()
export class EventReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async generateCloseoutCsv(eventId: string) {
    const [event, receivedAgg, allocatableAgg, categories, disbursements] =
      await Promise.all([
        this.prisma.event.findUniqueOrThrow({
          where: { id: eventId },
          select: { title: true },
        }),
        this.prisma.transaction.aggregate({
          where: { eventId, status: TransactionStatus.SUCCESS },
          _sum: { amountSettled: true },
        }),
        this.prisma.transaction.aggregate({
          where: {
            eventId,
            status: TransactionStatus.SUCCESS,
            paymentRail: { not: PaymentRail.MANUAL },
          },
          _sum: { amountSettled: true },
        }),
        this.prisma.budgetCategory.findMany({
          where: { eventId },
          orderBy: { createdAt: 'asc' },
          include: { vendor: { select: { name: true } } },
        }),
        this.prisma.disbursement.findMany({
          where: { eventId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    const totalReceived = Number(receivedAgg._sum.amountSettled ?? 0);
    const totalAllocatable = Number(allocatableAgg._sum.amountSettled ?? 0);
    const totalAllocated = categories.reduce(
      (sum, category) => sum + Number(category.allocatedFunds),
      0,
    );

    const paidByCategoryId = new Map<string, number>();
    for (const disbursement of disbursements) {
      if (!disbursement.budgetCategoryId) continue;
      if (!OUTSTANDING_DISBURSEMENT_STATUSES.includes(disbursement.status)) {
        continue;
      }
      paidByCategoryId.set(
        disbursement.budgetCategoryId,
        (paidByCategoryId.get(disbursement.budgetCategoryId) ?? 0) +
          Number(disbursement.amount),
      );
    }

    const rows: (string | number)[][] = [
      ['Close-out report', event.title],
      ['Generated', new Date().toISOString()],
      [],
      [
        'Total received (all contributions incl. manual/off-app)',
        totalReceived,
      ],
      ['Total allocatable (real gateway-settled money)', totalAllocatable],
      ['Total allocated to budget categories', totalAllocated],
      [],
      ['Budget categories'],
      ['Name', 'Estimated cost', 'Allocated', 'Paid out', 'Vendor'],
      ...categories.map((category) => [
        category.name,
        category.estimatedCost.toString(),
        category.allocatedFunds.toString(),
        paidByCategoryId.get(category.id) ?? 0,
        category.vendor?.name ?? '',
      ]),
      [],
      ['Vendor disbursements'],
      ['Recipient', 'Amount', 'Status', 'Date', 'Failure reason'],
      ...disbursements.map((disbursement) => [
        disbursement.recipientName,
        disbursement.amount.toString(),
        disbursement.status,
        disbursement.createdAt.toISOString(),
        disbursement.failureReason ?? '',
      ]),
    ];

    return {
      filename: `closeout-${slugify(event.title)}-${eventId.slice(0, 8)}.csv`,
      csv: toCsv(rows),
    };
  }
}
