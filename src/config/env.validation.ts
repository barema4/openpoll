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

  // Paystack is retired as an active charge/payout rail (every country is
  // PawaPay now) — PaystackProvider is kept wired up only to verify/refund
  // transactions that were already processed through it before the Kenya
  // cutover. Optional so dev/test/CI never need real Paystack credentials;
  // only that historical-lookup path would actually fail without one.
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  // Country scope for the bank list / account resolution / subaccount
  // creation endpoints (Paystack's bank directory is per-country).
  PAYSTACK_COUNTRY: z.string().default('kenya'),

  // Where the hosted frontend (the "pool" Vue app) lives — used to construct
  // shareable /pay/:token links and as the Paystack callback_url target
  // (.../receipt) so a payer's browser has somewhere real to land after paying.
  PUBLIC_CHECKOUT_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Allowed CORS origin(s) for the frontend, comma-separated.
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  // Charged additively on top of what a payer intends to give (e.g. they
  // mean to give 1000, are charged 1000 + this % — the org is still
  // credited exactly 1000). Default 0 so test/CI amount assertions never
  // need to account for a fee unless a test explicitly opts in.
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).default(0),

  // Optional — EmailService logs instead of sending when this is unset, so
  // dev/test/CI never need a real Resend account to boot.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('OpenPool <onboarding@resend.dev>'),

  // Uganda mobile money (MTN/Airtel), via PawaPay. Optional/defaulted so
  // .env.test and CI never need real PawaPay credentials — only Uganda-country
  // orgs ever exercise this provider.
  PAWAPAY_API_TOKEN: z.string().optional(),
  PAWAPAY_BASE_URL: z
    .string()
    .url()
    .default('https://api.sandbox.pawapay.io/v2'),
  // PawaPay's current ECDSA P-256 public key (PEM), for verifying webhook
  // signatures. Copy the current key from the PawaPay dashboard/docs — see
  // the TODO in pawapay.provider.ts about upgrading to live fetch-by-keyid.
  PAWAPAY_PUBLIC_KEY: z.string().optional(),

  // Gates GET /reconciliation — there is no multi-admin/role system in this
  // app, so the sole operator is identified by email rather than a new role.
  // Optional so .env.test/CI never need it; unset means the route denies
  // everyone (fail closed, not open).
  PLATFORM_OPERATOR_EMAIL: z.string().email().optional(),
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
