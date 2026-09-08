import { EmailService } from './email.service';
import type { Queue } from 'bullmq';

describe('EmailService.send', () => {
  it('enqueues the email with retry/backoff options instead of sending inline', async () => {
    const add = jest.fn().mockResolvedValue({});
    const queue = { add } as unknown as Queue;
    const service = new EmailService(queue);

    await service.send({
      to: 'jane@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });

    expect(add).toHaveBeenCalledWith(
      'send-email',
      { to: 'jane@example.com', subject: 'Hello', html: '<p>Hi</p>' },
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
  });
});
