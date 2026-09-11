import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { OrganizationCountry } from '../../../../generated/prisma/enums';

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

  // Determines which personal org this reuses/creates (Kenya/Paystack vs
  // Uganda/PawaPay) — a user can end up with one personal org per country
  // they've quick-collected for. Defaults to Kenya if omitted.
  @IsOptional()
  @IsEnum(OrganizationCountry)
  country?: OrganizationCountry;
}
