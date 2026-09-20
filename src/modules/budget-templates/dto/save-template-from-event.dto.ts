import { IsString, IsUUID, MinLength } from 'class-validator';

export class SaveTemplateFromEventDto {
  // Which org the resulting template is saved under — lets an agency
  // member explicitly choose to share it with every client (their own
  // agency org) or keep it private to just this one.
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  eventId!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
