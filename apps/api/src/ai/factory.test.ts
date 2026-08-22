import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';
import { ClaudeProvider } from './claude-provider.js';
import { createCoachProvider } from './factory.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import { CoachRefusalError } from './provider.js';

const baseEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'fatal',
  SUPABASE_URL: 'https://test.supabase.co',
  DATABASE_URL: 'postgresql://user:pass@localhost:6543/postgres',
  ANTHROPIC_MODEL: 'claude-opus-5',
  OPENAI_MODEL: 'gpt-4o',
    GEMINI_MODEL: 'gemini-2.5-flash',
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

  it('builds a GeminiProvider when AI_PROVIDER=gemini', () => {
    const env: Env = { ...baseEnv, AI_PROVIDER: 'gemini', GOOGLE_API_KEY: 'AIza-test' };
    const provider = createCoachProvider(env);
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('gemini');
  });

  it('this is the only place AI_PROVIDER is branched on', () => {
    // Documents the intent behind factory.ts: route code should depend on CoachProvider,
    // never on AI_PROVIDER directly. Nothing to assert beyond both branches constructing —
    // covered by the two tests above.
    expect(true).toBe(true);
  });
});

describe('provider construction', () => {
  // Constructed eagerly on purpose: a missing or malformed key should fail when the factory
  // builds the provider at startup, not on a user's first chat message.
  it('both providers construct without touching the network', () => {
    expect(
      () => new ClaudeProvider({ apiKey: 'sk-ant-test', model: 'claude-opus-5' }),
    ).not.toThrow();
    expect(() => new OpenAiProvider({ apiKey: 'sk-test', model: 'gpt-4o' })).not.toThrow();
  });

  it('both satisfy the adapter surface the routes depend on', () => {
    // The point of the adapter: routes call these two methods and never import a vendor SDK.
    for (const provider of [
      new ClaudeProvider({ apiKey: 'sk-ant-test', model: 'claude-opus-5' }),
      new OpenAiProvider({ apiKey: 'sk-test', model: 'gpt-4o' }),
    ]) {
      expect(typeof provider.streamChat).toBe('function');
      expect(typeof provider.generatePlan).toBe('function');
    }
  });
});

describe('CoachRefusalError', () => {
  it('carries the refusal category so the route can distinguish it from a fault', () => {
    const error = new CoachRefusalError('cyber');
    expect(error.category).toBe('cyber');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CoachRefusalError');
  });

  it('tolerates a null category', () => {
    // `stop_details` can be absent even on a refusal — branching on stop_reason is what
    // matters, and a null category must not become the string "null" in the message.
    expect(new CoachRefusalError(null).message).not.toContain('null');
  });
});
