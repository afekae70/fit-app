import { describe, expect, it } from 'vitest';

import { en } from '../i18n/locales/en.js';
import { he } from '../i18n/locales/he.js';
import { COACH_FAILURES, coachFailureKey } from './failure.js';
import { readRefusal } from './stream.js';

const stringAt = (bundle: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      bundle,
    );

describe('saying why the coach did not answer', () => {
  it('has a sentence in both languages for every failure it names', () => {
    // These keys are looked up at runtime, so the check that every `t('…')` literal exists
    // (`i18n/keys.test.ts`) cannot see them. A missing one would put the key itself on screen.
    for (const key of Object.values(COACH_FAILURES)) {
      expect(stringAt(he, key), `he: ${key}`).toEqual(expect.any(String));
      expect(stringAt(en, key), `en: ${key}`).toEqual(expect.any(String));
    }
  });

  it('knows every refusal the function can make', () => {
    // The words `apps/api/src/edge/coach.ts` answers with. Listed rather than imported: the
    // app does not depend on the server's code, only on its vocabulary.
    for (const word of [
      'sign_in_required',
      'invalid_request',
      'request_too_large',
      'insufficient_context',
      'daily_limit',
      'ai_busy',
      'not_set_up',
      'server_error',
    ]) {
      expect(coachFailureKey(word), word).not.toBeNull();
    }
  });

  it('tells the person what they can do about the ones they can do something about', () => {
    expect(coachFailureKey('daily_limit')).toBe('coach.failed.dailyLimit');
    expect(coachFailureKey('ai_busy')).toBe('coach.failed.busy');
    expect(coachFailureKey('insufficient_context')).toBe('coach.failed.needsData');
    expect(coachFailureKey('offline')).toBe('coach.failed.offline');
  });

  it('has nothing to say for a word it was never taught, or for none', () => {
    expect(coachFailureKey('Too Many Requests')).toBeNull();
    expect(coachFailureKey(undefined)).toBeNull();
    // Not a failure, however much it looks like a property of the table.
    expect(coachFailureKey('toString')).toBeNull();
    expect(coachFailureKey('constructor')).toBeNull();
  });
});

describe('reading a refusal', () => {
  it('takes the word and the sentence from the function’s answer', () => {
    expect(
      readRefusal(429, JSON.stringify({ error: 'daily_limit', message: 'You have reached…' })),
    ).toEqual({ message: 'You have reached…', code: 'daily_limit' });
  });

  it('reads a token the gateway turned away as needing to sign in', () => {
    // Supabase answers this itself, before the function runs, in its own shape.
    expect(readRefusal(401, JSON.stringify({ code: 401, message: 'Invalid JWT' }))).toEqual({
      message: 'Invalid JWT',
      code: 'sign_in_required',
    });
  });

  it('keeps the server’s own word over the guess from the status', () => {
    expect(readRefusal(401, JSON.stringify({ error: 'something_else' })).code).toBe(
      'something_else',
    );
  });

  it('falls back to the status when the body is not what was expected', () => {
    for (const body of ['<html>Bad gateway</html>', '', 'null', '[]', '"text"']) {
      expect(readRefusal(502, body), body).toEqual({
        message: 'Request failed (502)',
        code: undefined,
      });
    }
  });

  it('does not take a word that is not a string', () => {
    expect(readRefusal(500, JSON.stringify({ error: { nested: true }, message: 7 }))).toEqual({
      message: 'Request failed (500)',
      code: undefined,
    });
  });
});
