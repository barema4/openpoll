import { IsBoolean } from 'class-validator';

export class SetArchivedDto {
  @IsBoolean()
  archived!: boolean;
}
