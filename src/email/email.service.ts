import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE } from './email.constants';

export interface SendEmailJob {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue) {}

  // Enqueues rather than sends inline — a Resend hiccup must never slow down
  // (or fail) the request that triggered it (registration, password reset,
  // invite). EmailProcessor does the actual send with retries/backoff, the
  // same pattern used for payment webhooks (see WebhookProcessor).
  async send(params: SendEmailJob): Promise<void> {
    await this.emailQueue.add('send-email', params, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });
  }
}
