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
  PaymentGateway,
  TransactionStatus,
} from '../../../../generated/prisma/enums';

// Platform-wide equivalent of ListTransactionsQueryDto — no eventId, since
// this searches across every organization's events at once. Used only by
// the /admin/transactions route (staff support lookups), not by organizers.
export class AdminListTransactionsQueryDto extends PaginationQueryDto {
  // Matches provider reference, event title, or organization name.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsEnum(PaymentGateway)
  gateway?: PaymentGateway;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
