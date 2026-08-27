import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

// Backs "Quick collection" — no organizationId, because there isn't
// necessarily one yet. See EventsService.createQuick().
export class CreateQuickEventDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  targetGoal?: number;
}
