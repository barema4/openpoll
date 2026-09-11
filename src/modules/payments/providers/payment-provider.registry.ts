import { Inject, Injectable } from '@nestjs/common';
import { OrganizationCountry } from '../../../../generated/prisma/enums';
import {
  PAWAPAY_PROVIDER,
  PAYSTACK_PROVIDER,
  type PaymentProvider,
} from './payment-provider.interface';

// Resolves which payment provider handles a charge/verification, based on
// the organization's country — Kenya orgs charge through Paystack, Uganda
// orgs through PawaPay. Every charge-side call site (checkout, webhook
// processing) goes through this instead of injecting a single provider.
@Injectable()
export class PaymentProviderRegistry {
  constructor(
    @Inject(PAYSTACK_PROVIDER) private readonly paystack: PaymentProvider,
    @Inject(PAWAPAY_PROVIDER) private readonly pawapay: PaymentProvider,
  ) {}

  forCountry(country: OrganizationCountry): PaymentProvider {
    switch (country) {
      case OrganizationCountry.UGANDA:
        return this.pawapay;
      case OrganizationCountry.KENYA:
      default:
        return this.paystack;
    }
  }
}
