import { IsIn, IsString, Matches } from 'class-validator';
import {
  MOBILE_MONEY_PROVIDERS,
  type MobileMoneyProvider,
} from '../../payments/providers/payment-provider.interface';

export class SetMobileMoneyPayoutDto {
  @IsIn(MOBILE_MONEY_PROVIDERS)
  provider!: MobileMoneyProvider;

  // MSISDN, digits only, no leading '+' or '0' — country code included (e.g.
  // 256771234567). PawaPay has no name-resolution step for mobile money the
  // way Paystack does for bank accounts, so there's nothing to confirm this
  // against beyond the format itself.
  @IsString()
  @Matches(/^\d{9,15}$/, {
    message:
      'Phone number must be digits only, including the country code (e.g. 256771234567)',
  })
  phoneNumber!: string;
}
