import { BadRequestException } from '@nestjs/common';
import { BudgetTemplatesService } from './budget-templates.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BudgetCategoriesService } from '../budget-categories/budget-categories.service';

describe('BudgetTemplatesService.create', () => {
  it('creates the template with its items, in order', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'template-1' });
    const prisma = {
      budgetTemplate: { create },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await service.create({
      organizationId: 'org-1',
      name: 'Wedding',
      items: [
        { name: 'Venue', percentage: 0.5 },
        { name: 'Photography', fixedAmount: 20000 },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          name: 'Wedding',
          items: {
            create: [
              {
                name: 'Venue',
                percentage: 0.5,
                fixedAmount: undefined,
                sortOrder: 0,
              },
              {
                name: 'Photography',
                percentage: undefined,
                fixedAmount: 20000,
                sortOrder: 1,
              },
            ],
          },
        }) as unknown,
      }),
    );
  });

  it('rejects an item that sets neither percentage nor fixedAmount', async () => {
    const prisma = {
      budgetTemplate: { create: jest.fn() },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await expect(
      service.create({
        organizationId: 'org-1',
        name: 'Wedding',
        items: [{ name: 'Venue' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an item that sets both percentage and fixedAmount', async () => {
    const prisma = {
      budgetTemplate: { create: jest.fn() },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await expect(
      service.create({
        organizationId: 'org-1',
        name: 'Wedding',
        items: [{ name: 'Venue', percentage: 0.5, fixedAmount: 100 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BudgetTemplatesService.createFromEvent', () => {
  it('saves percentage-of-goal items when the event has a targetGoal', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'template-1' });
    const prisma = {
      event: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          targetGoal: '1000',
          budgetCategories: [
            { name: 'Venue', estimatedCost: '500' },
            { name: 'Catering', estimatedCost: '250' },
          ],
        }),
      },
      budgetTemplate: { create },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await service.createFromEvent({
      organizationId: 'org-1',
      eventId: 'event-1',
      name: 'From my event',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                name: 'Venue',
                percentage: 0.5,
              }) as unknown,
              expect.objectContaining({
                name: 'Catering',
                percentage: 0.25,
              }) as unknown,
            ],
          },
        }) as unknown,
      }),
    );
  });

  it('saves fixed-amount items when the event has no targetGoal', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'template-1' });
    const prisma = {
      event: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          targetGoal: null,
          budgetCategories: [{ name: 'Venue', estimatedCost: '500' }],
        }),
      },
      budgetTemplate: { create },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await service.createFromEvent({
      organizationId: 'org-1',
      eventId: 'event-1',
      name: 'From my event',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                name: 'Venue',
                fixedAmount: 500,
              }) as unknown,
            ],
          },
        }) as unknown,
      }),
    );
  });

  it("rejects when the event doesn't belong to the requested organization (directly or via agency)", async () => {
    const prisma = {
      event: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          organizationId: 'org-2',
          targetGoal: null,
          budgetCategories: [{ name: 'Venue', estimatedCost: '500' }],
        }),
      },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await expect(
      service.createFromEvent({
        organizationId: 'org-1',
        eventId: 'event-1',
        name: 'From my event',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the event has no budget categories to save', async () => {
    const prisma = {
      event: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          targetGoal: null,
          budgetCategories: [],
        }),
      },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await expect(
      service.createFromEvent({
        organizationId: 'org-1',
        eventId: 'event-1',
        name: 'From my event',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BudgetTemplatesService.listForOrganization', () => {
  it('includes templates owned by the agency managing this org', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      budgetTemplate: { findMany },
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
    } as unknown as PrismaService;
    const budgetCategories = {} as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await service.listForOrganization('client-org-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: { in: ['client-org-1', 'agency-org-1'] } },
      }),
    );
  });
});

describe('BudgetTemplatesService.apply', () => {
  it('creates a budget category per item, computing estimatedCost from percentage or fixedAmount', async () => {
    const findUniqueOrThrowTemplate = jest.fn().mockResolvedValue({
      id: 'template-1',
      organizationId: 'org-1',
      items: [
        { name: 'Venue', percentage: '0.5', fixedAmount: null },
        { name: 'Photography', percentage: null, fixedAmount: '20000' },
      ],
    });
    const findUniqueOrThrowEvent = jest.fn().mockResolvedValue({
      organizationId: 'org-1',
      targetGoal: '1000',
    });
    const createCategory = jest
      .fn()
      .mockResolvedValueOnce({ id: 'cat-1' })
      .mockResolvedValueOnce({ id: 'cat-2' });
    const prisma = {
      budgetTemplate: { findUniqueOrThrow: findUniqueOrThrowTemplate },
      event: { findUniqueOrThrow: findUniqueOrThrowEvent },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const budgetCategories = {
      create: createCategory,
    } as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    const result = await service.apply('user-1', 'template-1', {
      eventId: 'event-1',
    });

    expect(createCategory).toHaveBeenNthCalledWith(1, 'user-1', {
      eventId: 'event-1',
      name: 'Venue',
      estimatedCost: 500,
    });
    expect(createCategory).toHaveBeenNthCalledWith(2, 'user-1', {
      eventId: 'event-1',
      name: 'Photography',
      estimatedCost: 20000,
    });
    expect(result).toEqual([{ id: 'cat-1' }, { id: 'cat-2' }]);
  });

  it("rejects when the template isn't available to the event's organization", async () => {
    const prisma = {
      budgetTemplate: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'template-1',
          organizationId: 'org-2',
          items: [],
        }),
      },
      event: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ organizationId: 'org-1', targetGoal: null }),
      },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const budgetCategories = {
      create: jest.fn(),
    } as unknown as BudgetCategoriesService;
    const service = new BudgetTemplatesService(prisma, budgetCategories);

    await expect(
      service.apply('user-1', 'template-1', { eventId: 'event-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
