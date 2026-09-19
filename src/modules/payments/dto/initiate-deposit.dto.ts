import {
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

export class InitiateDepositDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  // Kenya: 'card' | 'mobile_money' (Paystack channel picker). Uganda: which
  // mobile money network to charge (PawaPay, required — see phoneNumber
  // below). Validated as required-for-Uganda in PaymentsService, same as
  // InitiateCheckoutDto, since the requirement depends on the org's country.
  @IsOptional()
  @IsIn([...PAYMENT_METHODS, ...MOBILE_MONEY_PROVIDERS])
  paymentMethod?: PaymentMethod | MobileMoneyProvider;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
