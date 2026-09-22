import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const STRIPE_BASE_URL = 'https://api.stripe.com/v1';

interface StripeErrorResponse {
  error?: { message?: string };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // Plain fetch against Stripe's REST API, no SDK — same style as
  // PaystackProvider, which does the same for Paystack.
  private async stripeRequest<T>(
    path: string,
    body: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(`${STRIPE_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get<string>('STRIPE_SECRET_KEY')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    });
    const data = (await response.json()) as T & StripeErrorResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        data.error?.message ?? 'Stripe request failed',
      );
    }
    return data;
  }

  async createCheckoutSession(organizationId: string, userId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const customerId =
      organization.stripeCustomerId ??
      (await this.ensureStripeCustomer(organization));

    const returnBase = `${this.publicOrgSettingsUrl(organizationId)}`;
    const session = await this.stripeRequest<{ url: string }>(
      '/checkout/sessions',
      {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': this.config.get<string>(
          'STRIPE_AGENCY_PRICE_ID',
        )!,
        'line_items[0][quantity]': '1',
        success_url: `${returnBase}&billing=success`,
        cancel_url: `${returnBase}&billing=cancelled`,
        'metadata[organizationId]': organizationId,
        'subscription_data[metadata][organizationId]': organizationId,
      },
    );

    await this.audit.record({
      userId,
      action: 'ORGANIZATION_AGENCY_PLAN_CHECKOUT_INITIATED',
      payload: { organizationId },
    });

    return { url: session.url };
  }

  async createPortalSession(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    if (!organization.stripeCustomerId) {
      throw new NotFoundException(
        'This organization has no billing account yet',
      );
    }

    const session = await this.stripeRequest<{ url: string }>(
      '/billing_portal/sessions',
      {
        customer: organization.stripeCustomerId,
        return_url: this.publicOrgSettingsUrl(organizationId),
      },
    );

    return { url: session.url };
  }

  async getStatus(organizationId: string) {
    const [organization, clientCount] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { agencyPlanExpiresAt: true, stripeCustomerId: true },
      }),
      this.prisma.agencyClientLink.count({
        where: { agencyOrganizationId: organizationId },
      }),
    ]);
    const hasActivePlan =
      organization.agencyPlanExpiresAt !== null &&
      organization.agencyPlanExpiresAt > new Date();

    return {
      agencyPlanExpiresAt: organization.agencyPlanExpiresAt,
      hasActivePlan,
      clientCount,
      freeClientAvailable: clientCount === 0,
      hasBillingAccount: organization.stripeCustomerId !== null,
    };
  }

  private async ensureStripeCustomer(organization: {
    id: string;
    name: string;
  }) {
    const customer = await this.stripeRequest<{ id: string }>('/customers', {
      name: organization.name,
      'metadata[organizationId]': organization.id,
    });
    await this.prisma.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  private publicOrgSettingsUrl(organizationId: string) {
    const base = this.config
      .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
      .replace(/\/$/, '');
    return `${base}/app/organizations/${organizationId}?tab=settings`;
  }
}
