import { Inject, Injectable } from '@nestjs/common';
import { getSupportedCountry } from '../../../config/supported-countries';
import {
  PAWAPAY_PROVIDER,
  PAYSTACK_PROVIDER,
  type PaymentProvider,
} from './payment-provider.interface';

// Resolves which payment provider handles a charge/verification, based on
// SUPPORTED_COUNTRIES (src/config/supported-countries.ts) rather than a
// hardcoded switch — every charge-side call site (checkout, webhook
// processing) goes through this instead of injecting a single provider, and
// adding a new country here needs no change to this class.
@Injectable()
export class PaymentProviderRegistry {
  constructor(
    @Inject(PAYSTACK_PROVIDER) private readonly paystack: PaymentProvider,
    @Inject(PAWAPAY_PROVIDER) private readonly pawapay: PaymentProvider,
  ) {}

  forCountry(countryCode: string): PaymentProvider {
    switch (getSupportedCountry(countryCode).provider) {
      case 'PAWAPAY':
        return this.pawapay;
      case 'PAYSTACK':
      default:
        return this.paystack;
    }
  }
}
