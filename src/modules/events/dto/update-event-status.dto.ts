import { IsEnum } from 'class-validator';
import { EventStatus } from '../../../../generated/prisma/enums';

export class UpdateEventStatusDto {
  @IsEnum(EventStatus)
  status!: EventStatus;
}
