import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { OrgRole } from '../../../generated/prisma/enums';

function pickId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Resolves the organization an incoming request is scoped to (via route params,
 * body, or query) and checks the caller has one of the @Roles(...) required for
 * the handler. No-op if the handler has no @Roles metadata.
 */
@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const organizationId = await this.resolveOrganizationId(request);
    if (!organizationId) {
      throw new ForbiddenException(
        'Unable to resolve organization scope for this request',
      );
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });

    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        'Insufficient organization role for this action',
      );
    }

    return true;
  }

  private async resolveOrganizationId(
    request: Request,
  ): Promise<string | null> {
    const params = request.params as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = request.query as Record<string, unknown>;

    const organizationId = pickId(
      params.organizationId,
      body.organizationId,
      query.organizationId,
    );
    if (organizationId) return organizationId;

    const budgetCategoryId = pickId(
      params.budgetCategoryId,
      body.budgetCategoryId,
      query.budgetCategoryId,
    );
    if (budgetCategoryId) {
      const category = await this.prisma.budgetCategory.findUnique({
        where: { id: budgetCategoryId },
        select: { event: { select: { organizationId: true } } },
      });
      return category?.event.organizationId ?? null;
    }

    const invoiceId = pickId(params.invoiceId, body.invoiceId, query.invoiceId);
    if (invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { event: { select: { organizationId: true } } },
      });
      return invoice?.event.organizationId ?? null;
    }

    const transactionId = pickId(
      params.transactionId,
      body.transactionId,
      query.transactionId,
    );
    if (transactionId) {
      const transaction = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { event: { select: { organizationId: true } } },
      });
      return transaction?.event.organizationId ?? null;
    }

    const eventId = pickId(params.eventId, body.eventId, query.eventId);
    if (eventId) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { organizationId: true },
      });
      return event?.organizationId ?? null;
    }

    return null;
  }
}
