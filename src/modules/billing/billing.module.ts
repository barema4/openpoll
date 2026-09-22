import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookProcessor } from './stripe-webhook.processor';
import { STRIPE_WEBHOOK_QUEUE } from './billing.constants';

@Module({
  imports: [BullModule.registerQueue({ name: STRIPE_WEBHOOK_QUEUE })],
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, StripeWebhookProcessor],
})
export class BillingModule {}
