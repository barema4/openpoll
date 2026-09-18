import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PAYSTACK_PROVIDER,
  type BankPayoutProvider,
} from '../payments/providers/payment-provider.interface';
import { VendorPayoutMethod } from '../../../generated/prisma/enums';
import type { CreateVendorDto } from './dto/create-vendor.dto';

// Fields safe to return to the client — never the raw payoutAccountNumber/
// payoutMobileNumber (kept server-side only, needed later by
// DisbursementsService to actually place a payout), matching the masking
// convention already used for Organization's own payout fields.
const SAFE_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  payoutMethod: true,
  payoutBankName: true,
  payoutAccountName: true,
  payoutAccountLast4: true,
  payoutMobileProvider: true,
  payoutMobileNumberLast4: true,
  createdAt: true,
} as const;

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYSTACK_PROVIDER) private readonly paystack: BankPayoutProvider,
  ) {}

  // Verify-then-persist for a bank account — same order as
  // PayoutsService.onboard(), but no subaccount is created: a vendor is an
  // outbound-transfer destination, not a charge-routing target, so there's
  // nothing to route incoming charges to.
  async create(dto: CreateVendorDto) {
    if (dto.payoutMethod === VendorPayoutMethod.BANK_ACCOUNT) {
      const resolved = await this.paystack.resolveAccountNumber(
        dto.accountNumber!,
        dto.bankCode!,
      );
      return this.prisma.vendor.create({
        data: {
          organizationId: dto.organizationId,
          name: dto.name,
          payoutMethod: VendorPayoutMethod.BANK_ACCOUNT,
          payoutBankCode: dto.bankCode,
          payoutBankName: dto.bankName,
          payoutAccountNumber: dto.accountNumber,
          payoutAccountName: resolved.accountName,
          payoutAccountLast4: dto.accountNumber!.slice(-4),
        },
        select: SAFE_SELECT,
      });
    }

    return this.prisma.vendor.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
        payoutMethod: VendorPayoutMethod.MOBILE_MONEY,
        payoutMobileProvider: dto.mobileProvider,
        payoutMobileNumber: dto.mobileNumber,
        payoutMobileNumberLast4: dto.mobileNumber!.slice(-4),
      },
      select: SAFE_SELECT,
    });
  }

  listForOrganization(organizationId: string) {
    return this.prisma.vendor.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: SAFE_SELECT,
    });
  }

  async remove(vendorId: string) {
    return this.prisma.vendor.delete({
      where: { id: vendorId },
      select: SAFE_SELECT,
    });
  }
}
