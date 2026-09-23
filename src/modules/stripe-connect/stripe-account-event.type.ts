export type StripeConnectOwnerType = 'ORGANIZATION' | 'USER';

export interface StripeAccountEvent {
  id: string;
  type: 'account.updated';
  data: {
    object: {
      id: string;
      details_submitted: boolean;
      charges_enabled: boolean;
      payouts_enabled: boolean;
      metadata?: {
        ownerType?: StripeConnectOwnerType;
        ownerId?: string;
      };
    };
  };
}
