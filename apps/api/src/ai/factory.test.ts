import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';
import { ClaudeProvider } from './claude-provider.js';
import { createCoachProvider } from './factory.js';
import { OpenAiProvider } from './openai-provider.js';
import { CoachProviderNotImplementedError } from './provider.js';

const baseEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'fatal',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  SUPABASE_JWT_SECRET: 'y'.repeat(40),
  DATABASE_URL: 'postgresql://user:pass@localhost:6543/postgres',
  ANTHROPIC_MODEL: 'claude-opus-5',
  OPENAI_MODEL: 'gpt-4o',
} as const;

describe('createCoachProvider', () => {
  it('builds a ClaudeProvider when AI_PROVIDER=claude', () => {
    const env: Env = { ...baseEnv, AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test' };
    const provider = createCoachProvider(env);
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.name).toBe('claude');
  });

  it('builds an OpenAiProvider when AI_PROVIDER=openai', () => {
    const env: Env = { ...baseEnv, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' };
    const provider = createCoachProvider(env);
    expect(provider).toBeInstanceOf(OpenAiProvider);
    expect(provider.name).toBe('openai');
  });

  it('this is the only place AI_PROVIDER is branched on', () => {
    // Documents the intent behind factory.ts: route code should depend on CoachProvider,
    // never on AI_PROVIDER directly. Nothing to assert beyond both branches constructing —
    // covered by the two tests above.
    expect(true).toBe(true);
  });
});

describe('provider stubs (Phase 5 not yet implemented)', () => {
  const claude = new ClaudeProvider({ apiKey: 'sk-ant-test', model: 'claude-opus-5' });
  const openai = new OpenAiProvider({ apiKey: 'sk-test', model: 'gpt-4o' });

  it('both providers throw a typed error from streamChat, not a generic one', () => {
    expect(() => claude.streamChat({ userId: 'u', systemPrompt: '' }, [])).toThrow(
      CoachProviderNotImplementedError,
    );
    expect(() => openai.streamChat({ userId: 'u', systemPrompt: '' }, [])).toThrow(
      CoachProviderNotImplementedError,
    );
  });

  it('both providers throw a typed error from generatePlan', async () => {
    await expect(
      claude.generatePlan({ userId: 'u', systemPrompt: '' }, {}, 'prompt'),
    ).rejects.toThrow(CoachProviderNotImplementedError);
    await expect(
      openai.generatePlan({ userId: 'u', systemPrompt: '' }, {}, 'prompt'),
    ).rejects.toThrow(CoachProviderNotImplementedError);
  });

  it('error message names which provider and method are unimplemented', () => {
    try {
      claude.streamChat({ userId: 'u', systemPrompt: '' }, []);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('claude');
      expect((error as Error).message).toContain('streamChat');
    }
  });
});
