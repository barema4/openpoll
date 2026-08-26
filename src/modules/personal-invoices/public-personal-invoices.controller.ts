import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PersonalInvoicesService } from './personal-invoices.service';
import { InitiatePersonalInvoiceCheckoutDto } from './dto/initiate-personal-invoice-checkout.dto';

// Unauthenticated — the hosted one-time payment page a recipient opens from
// the email/WhatsApp link the issuer sent them.
@ApiTags('public')
@Controller('public/personal-invoices')
export class PublicPersonalInvoicesController {
  constructor(
    private readonly personalInvoicesService: PersonalInvoicesService,
  ) {}

  @Get(':token')
  findByToken(@Param('token') token: string) {
    return this.personalInvoicesService.findByToken(token);
  }

  @Post(':token/checkout')
  initializeCheckout(
    @Param('token') token: string,
    @Body() dto: InitiatePersonalInvoiceCheckoutDto,
  ) {
    return this.personalInvoicesService.initializeCheckout(token, dto);
  }
}
