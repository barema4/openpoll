import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { InitiateCheckoutDto } from './dto/initiate-checkout.dto';

// Unauthenticated — the hosted checkout portal calls this on behalf of the
// contributor to start a Paystack charge for a given invoice/permanent link.
@ApiTags('payments')
@Controller('payments/checkout')
export class CheckoutController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':token')
  initialize(@Param('token') token: string, @Body() dto: InitiateCheckoutDto) {
    return this.paymentsService.initializeCheckout(token, dto);
  }
}
