import { AuditService } from './audit.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('AuditService.findForOrganization', () => {
  it('queries entries scoped by event.organizationId OR payload organizationId, newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { auditLog: { findMany } } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.findForOrganization('org-1');

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
});
