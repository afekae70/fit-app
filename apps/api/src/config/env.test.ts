import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from './env.js';

const baseValidEnv = {
  SUPABASE_URL: 'https://abcxyz.supabase.co',
  DATABASE_URL: 'postgresql://user:pass@localhost:6543/postgres',
  AI_PROVIDER: 'claude',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-5');
  });

  it('coerces PORT from a string, as it always is in process.env', () => {
    const env = loadEnv({ ...baseValidEnv, PORT: '4321' });
    expect(env.PORT).toBe(4321);
  });

  it('throws a typed error listing every missing field, not just the first', () => {
    let caught: unknown;
    try {
      loadEnv({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const error = caught as EnvValidationError;
    // Multiple required fields are missing from {} — the message should surface all of
    // them, not stop at the first, so a developer fixes the .env file in one pass.
    expect(error.issues.length).toBeGreaterThan(1);
    expect(error.message).toContain('SUPABASE_URL');
    expect(error.message).toContain('DATABASE_URL');
  });

  it('rejects a malformed SUPABASE_URL', () => {
    expect(() => loadEnv({ ...baseValidEnv, SUPABASE_URL: 'not-a-url' })).toThrow(
      EnvValidationError,
    );
  });

  it('requires ANTHROPIC_API_KEY only when AI_PROVIDER=claude', () => {
    const { ANTHROPIC_API_KEY: _drop, ...withoutClaudeKey } = baseValidEnv;
    expect(() => loadEnv(withoutClaudeKey)).toThrow(EnvValidationError);

    // Switching provider to openai (with its own key) no longer needs the Claude key.
    const asOpenAi = loadEnv({
      ...withoutClaudeKey,
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(asOpenAi.AI_PROVIDER).toBe('openai');
  });

  it('requires OPENAI_API_KEY only when AI_PROVIDER=openai', () => {
    expect(() =>
      loadEnv({ ...baseValidEnv, AI_PROVIDER: 'openai', OPENAI_API_KEY: undefined }),
    ).toThrow(EnvValidationError);
  });

  it('requires GOOGLE_API_KEY only when AI_PROVIDER=gemini', () => {
    // The failure this guards is specific: without it, selecting gemini boots a service that
    // accepts requests and then fails every coach call at runtime with an auth error, rather
    // than refusing to start with a message naming the missing variable.
    expect(() =>
      loadEnv({ ...baseValidEnv, AI_PROVIDER: 'gemini', GOOGLE_API_KEY: undefined }),
    ).toThrow(EnvValidationError);

    const asGemini = loadEnv({
      ...baseValidEnv,
      AI_PROVIDER: 'gemini',
      GOOGLE_API_KEY: 'AIza-test',
    });
    expect(asGemini.AI_PROVIDER).toBe('gemini');
    // Defaulted rather than required, so setting the key alone is enough to switch providers.
    expect(asGemini.GEMINI_MODEL).toBe('gemini-3.6-flash');
  });

  it('does not require the non-selected provider key to be present', () => {
    // Both adapters must compile and be constructible without both keys set — this is
    // what lets `AI_PROVIDER` be a one-line switch in practice.
    const env = loadEnv(baseValidEnv);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects an unknown AI_PROVIDER value rather than silently defaulting', () => {
    expect(() => loadEnv({ ...baseValidEnv, AI_PROVIDER: 'gemini' })).toThrow(
      EnvValidationError,
    );
  });
});
