import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

// Public self-service pledge: a contributor commits to contribute to an
// event without paying immediately. Internally this is just a single-use
// Invoice — see InvoicesService.createPledge(). amountPledged is optional: a
// pledger who hasn't decided how much yet gets an open-amount link and picks
// the amount later when they actually pay.
export class CreatePledgeDto {
  @IsString()
  @MinLength(1)
  contributorName!: string;

  @IsString()
  @MinLength(1)
  contributorPhone!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amountPledged?: number;

  @IsOptional()
  @IsString()
  categoryTag?: string;
}
