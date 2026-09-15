import { AuditService } from './audit.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('AuditService.findForOrganization', () => {
  function makeService(findMany: jest.Mock, count: jest.Mock) {
    const prisma = {
      auditLog: { findMany, count },
    } as unknown as PrismaService;
    return new AuditService(prisma);
  }

  it('queries entries scoped by event.organizationId OR payload organizationId, newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = makeService(findMany, count);

    await service.findForOrganization('org-1', {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { event: { organizationId: 'org-1' } },
            {
              payloadSnapshot: {
                path: ['organizationId'],
                equals: 'org-1',
              },
            },
          ],
        },
        orderBy: { timestamp: 'desc' },
      }),
    );
  });

  it('paginates with the default page/pageSize and returns the envelope shape', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'log-1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const service = makeService(findMany, count);

    const result = await service.findForOrganization('org-1', {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
    expect(result).toEqual({
      data: [{ id: 'log-1' }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  });

  it('computes skip from page and pageSize', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = makeService(findMany, count);

    await service.findForOrganization('org-1', { page: 3, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });
});
