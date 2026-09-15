import { IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListBudgetCategoriesQueryDto extends PaginationQueryDto {
  @IsUUID()
  eventId!: string;
}
