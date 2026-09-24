import { IsBoolean } from 'class-validator';

export class SetAgencyPlanDto {
  @IsBoolean()
  hasAgencyPlan!: boolean;
}
