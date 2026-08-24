import { Controller, Get, Param } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

// Unauthenticated — backs the hosted checkout portal where a contributor
// opens a single-use invoice or permanent link by its secure token.
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get(':token')
  findByToken(@Param('token') token: string) {
    return this.invoicesService.findByToken(token);
  }
}
