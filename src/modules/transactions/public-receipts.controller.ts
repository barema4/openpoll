import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

// Unauthenticated — this is where a payer's browser lands via the Paystack
// callback_url after paying (Paystack appends ?reference=...&trxref=...),
// and also a general "view your receipt" link keyed by the same reference.
@Controller('public/receipts')
export class PublicReceiptsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  getReceipt(@Query('reference') reference: string) {
    if (!reference) {
      throw new BadRequestException('A reference query parameter is required');
    }
    return this.transactionsService.getReceipt(reference);
  }
}
