import { EventsService } from './events.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { OrganizationsService } from '../organizations/organizations.service';

const audit = { record: jest.fn() } as unknown as AuditService;
const payouts = {} as unknown as PayoutsService;

describe('EventsService.create', () => {
  it('auto-generates a permanent, open-amount default link and attaches its token', async () => {
    const eventCreate = jest
      .fn()
      .mockResolvedValue({ id: 'event-1', title: 'Fundraiser' });
    const prisma = {
      event: { create: eventCreate },
    } as unknown as PrismaService;
    const invoiceCreate = jest
      .fn()
      .mockResolvedValue({ id: 'inv-1', secureToken: 'tok-abc123' });
    const invoices = { create: invoiceCreate } as unknown as InvoicesService;
    const organizations = {} as unknown as OrganizationsService;
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    const result = await service.create('user-1', {
      organizationId: 'org-1',
      title: 'Fundraiser',
    });

    expect(invoiceCreate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ eventId: 'event-1', isPermanent: true }),
    );
    expect(result.defaultLinkToken).toBe('tok-abc123');
  });
});

describe('EventsService.createQuick', () => {
  it('reuses the caller personal org and creates a permanent event under it', async () => {
    const eventCreate = jest
      .fn()
      .mockResolvedValue({ id: 'event-1', title: 'Quick Fund' });
    const prisma = {
      event: { create: eventCreate },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Jane Doe' }),
      },
    } as unknown as PrismaService;
    const invoices = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', secureToken: 'tok-xyz' }),
    } as unknown as InvoicesService;
    const getOrCreatePersonalOrg = jest
      .fn()
      .mockResolvedValue({ id: 'personal-org-1' });
    const organizations = {
      getOrCreatePersonalOrg,
    } as unknown as OrganizationsService;
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    await service.createQuick('user-1', { title: 'Quick Fund' });

    expect(getOrCreatePersonalOrg).toHaveBeenCalledWith('user-1', 'Jane Doe');
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'personal-org-1',
          isPermanent: true,
        }),
      }),
    );
  });
});
