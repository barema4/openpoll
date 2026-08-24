import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(transactionId: string) {
    return this.prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { allocations: true },
    });
  }

  listForEvent(eventId: string) {
    return this.prisma.transaction.findMany({
      where: { eventId },
      orderBy: { timestamp: 'desc' },
    });
  }
}
