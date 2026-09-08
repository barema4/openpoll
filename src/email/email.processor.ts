import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { EMAIL_QUEUE } from './email.constants';
import type { SendEmailJob } from './email.service';

const RESEND_API_URL = 'https://api.resend.com/emails';

interface ResendResponse {
  message?: string;
}

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  async process(job: Job<SendEmailJob>): Promise<void> {
    const params = job.data;
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.log(
        `[email:noop] to=${params.to} subject="${params.subject}"\n${params.html}`,
      );
      return;
    }

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get<string>('RESEND_FROM_EMAIL'),
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ResendResponse;
      // Throw so BullMQ retries with backoff — unlike the old inline-send
      // behavior, a failure here no longer risks blocking or breaking the
      // request that triggered the email.
      throw new Error(
        `Resend send failed (${response.status}): ${body.message ?? response.statusText}`,
      );
    }
  }
}
