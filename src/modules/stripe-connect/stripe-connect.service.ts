import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StripeConnectOwnerType } from './stripe-account-event.type';

const STRIPE_BASE_URL = 'https://api.stripe.com/v1';

interface StripeErrorResponse {
  error?: { message?: string };
}

interface StripeAccount {
  id: string;
}

interface StripeAccountLink {
  url: string;
}

// Stripe Express connected accounts — this org/user's own payout
// destination for STRIPE-provider countries (see SUPPORTED_COUNTRIES), the
// third payout mechanism alongside Paystack subaccounts and PawaPay
// mobile-money numbers. Plain fetch, no SDK, matching every other Stripe
// integration in this codebase.
@Injectable()
export class StripeConnectService {
  constructor(private readonly config: ConfigService) {}

  private async request<T>(
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

  // Idempotent: returns the existing account id untouched if one was
  // already created for this owner — an owner gets at most one connected
  // account across every onboarding attempt (retried, abandoned, or not).
  async ensureAccount(params: {
    existingAccountId: string | null;
    ownerType: StripeConnectOwnerType;
    ownerId: string;
    email?: string;
  }): Promise<string> {
    if (params.existingAccountId) return params.existingAccountId;

    // 'transfers' only — this account receives platform-initiated Transfers
    // (see Disbursements in a later phase), it never processes its own
    // direct charges the way a card_payments-capable account would.
    const account = await this.request<StripeAccount>('/accounts', {
      type: 'express',
      ...(params.email ? { email: params.email } : {}),
      'capabilities[transfers][requested]': 'true',
      'metadata[ownerType]': params.ownerType,
      'metadata[ownerId]': params.ownerId,
    });
    return account.id;
  }

  async createOnboardingLink(
    accountId: string,
    returnUrl: string,
  ): Promise<string> {
    const link = await this.request<StripeAccountLink>('/account_links', {
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: returnUrl,
    });
    return link.url;
  }
}
