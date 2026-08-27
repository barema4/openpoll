import { IsString, MinLength } from 'class-validator';

export class ResolveAccountDto {
  @IsString()
  @MinLength(1)
  bankCode!: string;

  @IsString()
  @MinLength(1)
  accountNumber!: string;
}
