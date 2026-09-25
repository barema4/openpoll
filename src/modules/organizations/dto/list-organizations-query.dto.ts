import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListOrganizationsQueryDto extends PaginationQueryDto {
  // Matches organization name.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  // Archived orgs are excluded by default.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}
