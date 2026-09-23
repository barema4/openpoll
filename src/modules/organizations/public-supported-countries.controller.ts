import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SUPPORTED_COUNTRIES } from '../../config/supported-countries';

// Unauthenticated — backs the country dropdown on org-creation/quick-collection
// forms, sourced from SUPPORTED_COUNTRIES (src/config/supported-countries.ts)
// so the frontend and backend never drift on which countries are supported.
// `provider` also lets the frontend pick the right payout onboarding card
// (Paystack bank form / PawaPay mobile money form / Stripe Connect button)
// without duplicating the country->provider mapping client-side.
@ApiTags('public')
@Controller('public/supported-countries')
export class PublicSupportedCountriesController {
  @Get()
  list() {
    return Object.entries(SUPPORTED_COUNTRIES).map(([code, country]) => ({
      code,
      label: country.label,
      provider: country.provider,
    }));
  }
}
