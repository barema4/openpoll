import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  targetGoal?: number;

  @IsOptional()
  @IsString()
  gatewayWalletId?: string;
}
