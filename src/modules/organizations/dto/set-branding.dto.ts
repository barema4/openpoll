import { IsOptional, IsUrl } from 'class-validator';

export class SetBrandingDto {
  // Omit (or null) to clear the logo and fall back to the platform's own
  // badge on public checkout pages.
  @IsOptional()
  @IsUrl()
  logoUrl?: string | null;
}
