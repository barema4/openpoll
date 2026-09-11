import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import {
  MOBILE_MONEY_PROVIDERS,
  PAYMENT_METHODS,
  type MobileMoneyProvider,
  type PaymentMethod,
} from '../providers/payment-provider.interface';

export class InitiateCheckoutDto {
  @IsEmail()
  email!: string;

  // Required when the invoice/permanent link has no fixed amountRequested.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  // Optional payer-supplied identity, saved onto the invoice if it isn't
  // already set (e.g. an open link, or a pledge being paid off).
  @IsOptional()
  @IsString()
  contributorName?: string;

  @IsOptional()
  @IsString()
  contributorPhone?: string;

  // Which channel the payer picked on our own pay page — Kenya: card vs
  // M-Pesa/mobile money (Paystack, hosted checkout skips its own picker).
  // Uganda: which mobile money network to charge (PawaPay, required — see
  // phoneNumber below, there is no hosted page to enter it on).
  @IsOptional()
  @IsIn([...PAYMENT_METHODS, ...MOBILE_MONEY_PROVIDERS])
  paymentMethod?: PaymentMethod | MobileMoneyProvider;

  // Required for a Uganda/PawaPay charge — there is no redirect/hosted page,
  // so the number to push the payment prompt to must come from this request.
  // Validated as required (for Uganda events specifically) in PaymentsService,
  // not here, since the requirement depends on the invoice's organization.
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
