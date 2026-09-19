import { IsUUID, ValidateIf } from 'class-validator';

export class AssignVendorDto {
  // Required field, but nullable — always send it explicitly (null clears
  // the current vendor). Format validation only runs when a real value is
  // present.
  @ValidateIf((o: AssignVendorDto) => o.vendorId !== null)
  @IsUUID()
  vendorId!: string | null;
}
