import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @IsUUID()
  eventId!: string;

  // Matches provider reference, manual-entry note, or the linked invoice's
  // contributor name — the three things a real "find this payment" search
  // would actually use.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsEnum(PaymentRail)
  paymentRail?: PaymentRail;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
