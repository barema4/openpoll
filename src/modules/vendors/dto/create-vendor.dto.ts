import {
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { VendorPayoutMethod } from '../../../../generated/prisma/enums';
import {
  MOBILE_MONEY_PROVIDERS,
  type MobileMoneyProvider,
} from '../../payments/providers/payment-provider.interface';

export class CreateVendorDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(Object.values(VendorPayoutMethod))
  payoutMethod!: VendorPayoutMethod;

  // Required when payoutMethod is BANK_ACCOUNT — verified via Paystack's
  // bank-resolve API before the vendor is saved (VendorsService.create),
  // same verify-then-persist order PayoutsService.onboard() already uses
  // for an org's own payout account.
  @ValidateIf((o: CreateVendorDto) => o.payoutMethod === 'BANK_ACCOUNT')
  @IsString()
  @MinLength(1)
  bankCode?: string;

  @ValidateIf((o: CreateVendorDto) => o.payoutMethod === 'BANK_ACCOUNT')
  @IsString()
  @MinLength(1)
  bankName?: string;

  @ValidateIf((o: CreateVendorDto) => o.payoutMethod === 'BANK_ACCOUNT')
  @IsString()
  @MinLength(1)
  accountNumber?: string;

  // Required when payoutMethod is MOBILE_MONEY — no resolve/verify step
  // exists for PawaPay, matching set-mobile-money-payout.dto.ts's own
  // precedent/comment: format-validated only.
  @ValidateIf((o: CreateVendorDto) => o.payoutMethod === 'MOBILE_MONEY')
  @IsIn(MOBILE_MONEY_PROVIDERS)
  mobileProvider?: MobileMoneyProvider;

  @ValidateIf((o: CreateVendorDto) => o.payoutMethod === 'MOBILE_MONEY')
  @IsString()
  @Matches(/^\d{9,15}$/, {
    message:
      'Phone number must be digits only, including the country code (e.g. 256771234567)',
  })
  mobileNumber?: string;
}
