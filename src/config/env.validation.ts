import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z
    .string()
    .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  PAYSTACK_SECRET_KEY: z.string().min(1, 'PAYSTACK_SECRET_KEY is required'),
  PAYSTACK_WEBHOOK_SECRET: z
    .string()
    .min(1, 'PAYSTACK_WEBHOOK_SECRET is required'),
  // Country scope for the bank list / account resolution / subaccount
  // creation endpoints (Paystack's bank directory is per-country).
  PAYSTACK_COUNTRY: z.string().default('kenya'),

  // Where the hosted frontend (the "pool" Vue app) lives — used to construct
  // shareable /pay/:token links and as the Paystack callback_url target
  // (.../receipt) so a payer's browser has somewhere real to land after paying.
  PUBLIC_CHECKOUT_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Allowed CORS origin(s) for the frontend, comma-separated.
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
