export interface StripeSubscriptionEvent {
  id: string;
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted';
  data: {
    object: {
      id: string;
      status: string;
      current_period_end: number;
      metadata?: { organizationId?: string };
    };
  };
}
