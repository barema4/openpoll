import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

// Public self-service pledge: a contributor commits to an amount for an
// event without paying immediately. Internally this is just a single-use
// Invoice with a fixed target — see InvoicesService.createPledge().
export class CreatePledgeDto {
  @IsString()
  @MinLength(1)
  contributorName!: string;

  @IsString()
  @MinLength(1)
  contributorPhone!: string;

  @IsNumber()
  @IsPositive()
  amountPledged!: number;

  @IsOptional()
  @IsString()
  categoryTag?: string;
}
