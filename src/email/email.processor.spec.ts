import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import type { SendEmailJob } from './email.service';

function makeJob(data: SendEmailJob): Job<SendEmailJob> {
  return { data } as Job<SendEmailJob>;
}

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('EmailProcessor.process', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('logs instead of sending when RESEND_API_KEY is unset', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const processor = new EmailProcessor(makeConfig({}));

    await processor.process(
      makeJob({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the Resend API when RESEND_API_KEY is set', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy;
    const processor = new EmailProcessor(
      makeConfig({
        RESEND_API_KEY: 'key_123',
        RESEND_FROM_EMAIL: 'from@example.com',
      }),
    );

    await processor.process(
      makeJob({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer key_123' }),
      }),
    );
  });

  it('throws (so BullMQ retries) when Resend responds with a non-OK status', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: jest.fn().mockResolvedValue({ message: 'rate limited' }),
    });
    global.fetch = fetchSpy;
    const processor = new EmailProcessor(
      makeConfig({ RESEND_API_KEY: 'key_123' }),
    );

    await expect(
      processor.process(
        makeJob({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' }),
      ),
    ).rejects.toThrow(/rate limited/i);
  });
});
