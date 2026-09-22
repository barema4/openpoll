import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { SUPPORTED_COUNTRIES } from '../../../config/supported-countries';

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

  // ISO-3166-1 alpha-2 code — determines which personal org this
  // reuses/creates (see SUPPORTED_COUNTRIES) — a user can end up with one
  // personal org per country they've quick-collected for. Defaults to
  // Kenya if omitted.
  @IsOptional()
  @IsIn(Object.keys(SUPPORTED_COUNTRIES))
  country?: string;
}
