import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isMobileMoneyProviderForCountry } from '../payments/providers/payment-provider.interface';
import {
  DisbursementStatus,
  VendorPayoutMethod,
} from '../../../generated/prisma/enums';
import { resolveOwnerOrganizationIds } from '../../common/agency-link.util';
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
  // Lets a caller tell an org's own vendor apart from one inherited via an
  // agency link (see listForOrganization below) — id/name match the org you
  // asked for when it's directly owned, or the managing agency's when not.
  organization: { select: { id: true, name: true } },
} as const;

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  // Bank-account vendor payouts were retired alongside Paystack itself — no
  // country's provider can resolve/pay one any more (see
  // DisbursementsService.reserveDisbursement's isPawaPayMobileMoney gate).
  // The fields/enum member still exist to correctly display vendors created
  // before that cutover; new ones can only ever be mobile money.
  async create(dto: CreateVendorDto) {
    if (dto.payoutMethod === VendorPayoutMethod.BANK_ACCOUNT) {
      throw new BadRequestException(
        'Bank-account vendor payouts are no longer supported — use a mobile money payout instead',
      );
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: dto.organizationId },
      select: { country: true },
    });
    if (
      !isMobileMoneyProviderForCountry(organization.country, dto.mobileProvider)
    ) {
      throw new BadRequestException(
        `${dto.mobileProvider} is not a mobile money network available in this organization's country`,
      );
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

  // Also includes vendors owned by whichever agency manages this org (see
  // AgencyClientLink) — an agency's own vendor roster is reusable across
  // every client it manages, not re-entered per client.
  async listForOrganization(organizationId: string) {
    const organizationIds = await resolveOwnerOrganizationIds(
      this.prisma,
      organizationId,
    );

    return this.prisma.vendor.findMany({
      where: { organizationId: { in: organizationIds } },
      orderBy: { createdAt: 'desc' },
      select: SAFE_SELECT,
    });
  }

  // Blocks deleting a vendor with a payout still in flight — Disbursement's
  // vendorId is onDelete: SetNull, so deleting mid-payout would silently
  // orphan that row's FK reference while PawaPay is still processing it.
  // A historical (SUCCESS/FAILED) disbursement doesn't block deletion — its
  // recipientName/amount/date are already permanently snapshotted on the
  // row, so losing the FK link there is cosmetic, not a loss of audit data.
  async remove(vendorId: string) {
    const inFlight = await this.prisma.disbursement.count({
      where: {
        vendorId,
        status: {
          in: [DisbursementStatus.PENDING, DisbursementStatus.QUEUED],
        },
      },
    });
    if (inFlight > 0) {
      throw new BadRequestException(
        'This vendor has a payout still in progress — wait for it to complete before deleting',
      );
    }

    return this.prisma.vendor.delete({
      where: { id: vendorId },
      select: SAFE_SELECT,
    });
  }
}
