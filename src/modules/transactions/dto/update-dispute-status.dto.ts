import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DisputeStatus } from '../../../../generated/prisma/enums';

// Manual override for staff — normally a Dispute's status only moves via
// Paystack's own dispute webhooks (DisputeWebhookProcessor); this lets staff
// correct it directly for cases the webhook flow doesn't cover (e.g. a
// resolution reached with the payer's bank outside the app).
export class UpdateDisputeStatusDto {
  @IsEnum(DisputeStatus)
  status!: DisputeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}
