import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SUPPORTED_COUNTRIES } from '../../config/supported-countries';
import { MOBILE_MONEY_PROVIDERS_BY_COUNTRY } from '../payments/providers/payment-provider.interface';

// Unauthenticated — backs the country dropdown on org-creation/quick-collection
// forms, sourced from SUPPORTED_COUNTRIES (src/config/supported-countries.ts)
// so the frontend and backend never drift on which countries are supported.
// `provider` also lets the frontend pick the right payout onboarding card
// (Paystack bank form, historical only, vs PawaPay mobile money form)
// without duplicating the country->provider mapping client-side. Similarly,
// `mobileMoneyOperators` lets a PawaPay-backed country's onboarding card
// render the right network options (MTN/Airtel/M-Pesa/etc.) without
// duplicating MOBILE_MONEY_PROVIDERS_BY_COUNTRY client-side either.
@ApiTags('public')
@Controller('public/supported-countries')
export class PublicSupportedCountriesController {
  @Get()
  list() {
    return Object.entries(SUPPORTED_COUNTRIES).map(([code, country]) => ({
      code,
      label: country.label,
      provider: country.provider,
      mobileMoneyOperators:
        MOBILE_MONEY_PROVIDERS_BY_COUNTRY[
          code as keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY
        ] ?? [],
    }));
  }
}
