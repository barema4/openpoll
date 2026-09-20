import { IsUUID } from 'class-validator';

export class ApplyTemplateDto {
  @IsUUID()
  eventId!: string;
}
