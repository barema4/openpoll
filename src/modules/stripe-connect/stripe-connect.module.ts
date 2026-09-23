import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StripeConnectService } from './stripe-connect.service';
import { StripeConnectWebhookController } from './stripe-connect-webhook.controller';
import { StripeConnectWebhookProcessor } from './stripe-connect-webhook.processor';
import { STRIPE_CONNECT_WEBHOOK_QUEUE } from './stripe-connect.constants';

@Module({
  imports: [BullModule.registerQueue({ name: STRIPE_CONNECT_WEBHOOK_QUEUE })],
  controllers: [StripeConnectWebhookController],
  providers: [StripeConnectService, StripeConnectWebhookProcessor],
  exports: [StripeConnectService],
})
export class StripeConnectModule {}
