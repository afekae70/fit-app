/**
 * Environment configuration, validated once at process start.
 *
 * Failing fast here with a clear message is the point: a missing `SUPABASE_URL`
 * should not surface three requests later as a cryptic 401 on every route. It should stop
 * the process before it ever binds a port.
 *
 * `loadEnv` takes a source object rather than reading `process.env` directly, so tests can
 * pass a synthetic environment instead of mutating the real one.
 */

import { z } from 'zod';

const AI_PROVIDERS = ['claude', 'openai', 'gemini'] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Supabase
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    // Database — pooled connection for the running service. Migrations/seeds use the
    // direct connection separately (see src/db/seed/run.ts), not this variable.
    DATABASE_URL: z.string().min(1),

    // AI coach
    AI_PROVIDER: z.enum(AI_PROVIDERS).default('claude'),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().default('gpt-4o'),
    GOOGLE_API_KEY: z.string().min(1).optional(),
    /*
     * Pinned, and it will need moving again one day.
     *
     * `gemini-2.5-flash` was the default until Google retired it for new keys: "This model is
     * no longer available to new users. Please update your code to use models/gemini-3.6-flash."
     * That arrives as a 404, which is also what a misspelled model name gives, so it reads as
     * the name being wrong rather than the model being gone.
     *
     * A `-latest` alias would dodge the retirement and take a different risk: the coach emits
     * structured tool calls, and a model swapped underneath it can change how it fills them
     * with no deploy and no warning. A pinned version fails loudly on a day of its choosing;
     * an alias fails quietly on a day of Google's.
     */
    GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  })
  .superRefine((env, ctx) => {
    // The selected provider's key is required; the other provider's key is not, so both
    // adapters can be compiled and tested without both API keys present.
    if (env.AI_PROVIDER === 'claude' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=claude',
      });
    }
    if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai',
      });
    }
    if (env.AI_PROVIDER === 'gemini' && !env.GOOGLE_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_API_KEY'],
        message: 'GOOGLE_API_KEY is required when AI_PROVIDER=gemini',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}
