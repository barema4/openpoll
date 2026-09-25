import { BadRequestException } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorPayoutMethod } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';

describe('VendorsService.create', () => {
  it('rejects bank-account vendor creation now that Paystack is retired', async () => {
    const create = jest.fn();
    const prisma = { vendor: { create } } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    await expect(
      service.create({
        organizationId: 'org-1',
        name: 'Acme Catering',
        payoutMethod: VendorPayoutMethod.BANK_ACCOUNT,
        bankCode: '011',
        bankName: 'Equity Bank',
        accountNumber: '0123456789',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('saves a mobile money vendor without any resolve step', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'vendor-1' });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ country: 'UG' });
    const prisma = {
      vendor: { create },
      organization: { findUniqueOrThrow },
    } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    await service.create({
      organizationId: 'org-1',
      name: 'Jane the DJ',
      payoutMethod: VendorPayoutMethod.MOBILE_MONEY,
      mobileProvider: 'MTN_MOMO_UGA',
      mobileNumber: '256771234567',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          name: 'Jane the DJ',
          payoutMethod: VendorPayoutMethod.MOBILE_MONEY,
          payoutMobileProvider: 'MTN_MOMO_UGA',
          payoutMobileNumber: '256771234567',
          payoutMobileNumberLast4: '4567',
        }) as unknown,
      }),
    );
  });

  it('never selects raw account/phone numbers back from the database', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'vendor-1' });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ country: 'UG' });
    const prisma = {
      vendor: { create },
      organization: { findUniqueOrThrow },
    } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    await service.create({
      organizationId: 'org-1',
      name: 'Jane the DJ',
      payoutMethod: VendorPayoutMethod.MOBILE_MONEY,
      mobileProvider: 'MTN_MOMO_UGA',
      mobileNumber: '256771234567',
    });

    const select = (
      create.mock.calls[0][0] as { select: Record<string, boolean> }
    ).select;
    expect(select.payoutAccountNumber).toBeUndefined();
    expect(select.payoutMobileNumber).toBeUndefined();
  });
});

describe('VendorsService.listForOrganization', () => {
  it('lists vendors for the organization, newest first, without raw account/phone fields', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'vendor-1' }]);
    const findUniqueAgencyLink = jest.fn().mockResolvedValue(null);
    const prisma = {
      vendor: { findMany },
      agencyClientLink: { findUnique: findUniqueAgencyLink },
    } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    const result = await service.listForOrganization('org-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: { in: ['org-1'] } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const select = (
      findMany.mock.calls[0][0] as { select: Record<string, boolean> }
    ).select;
    expect(select.payoutAccountNumber).toBeUndefined();
    expect(select.payoutMobileNumber).toBeUndefined();
    expect(result).toEqual([{ id: 'vendor-1' }]);
  });

  it('also includes vendors owned by the agency managing this org', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const findUniqueAgencyLink = jest
      .fn()
      .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' });
    const prisma = {
      vendor: { findMany },
      agencyClientLink: { findUnique: findUniqueAgencyLink },
    } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    await service.listForOrganization('client-org-1');

    expect(findUniqueAgencyLink).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientOrganizationId: 'client-org-1' },
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: { in: ['client-org-1', 'agency-org-1'] } },
      }),
    );
  });
});

describe('VendorsService.remove', () => {
  it('deletes the vendor when it has no in-flight disbursement', async () => {
    const deleteFn = jest.fn().mockResolvedValue({ id: 'vendor-1' });
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      vendor: { delete: deleteFn },
      disbursement: { count },
    } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    const result = await service.remove('vendor-1');

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: 'vendor-1',
          status: { in: ['PENDING', 'QUEUED'] },
        }),
      }),
    );
    expect(deleteFn).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'vendor-1' } }),
    );
    expect(result).toEqual({ id: 'vendor-1' });
  });

  it('rejects deletion while a payout to this vendor is still in flight', async () => {
    const deleteFn = jest.fn();
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      vendor: { delete: deleteFn },
      disbursement: { count },
    } as unknown as PrismaService;
    const service = new VendorsService(prisma);

    await expect(service.remove('vendor-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
