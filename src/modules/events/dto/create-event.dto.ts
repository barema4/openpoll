import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

// Phase 1 requires every event to belong to an organization for RBAC purposes,
// even though Event.organizationId is nullable at the schema level (reserved
// for a future fully-standalone/personal-event flow).
export class CreateEventDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  targetGoal?: number;

  @IsOptional()
  @IsBoolean()
  isPermanent?: boolean;

  @IsOptional()
  @IsString()
  gatewayWalletId?: string;
}
