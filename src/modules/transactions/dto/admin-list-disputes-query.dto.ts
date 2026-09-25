import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DisputeStatus } from '../../../../generated/prisma/enums';

export class AdminListDisputesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}
