/**
 * The weekly review, end to end against a real database and a stand-in for the phone's network.
 *
 * `streamCoachChat` talks through `XMLHttpRequest`, which does not exist under vitest. A small
 * fake of it stands in here, so that what is tested is the real path — the request that would
 * be sent, the events read back, what is kept — and not a mock of our own function.
 */

import { coachChatRequestSchema } from '@fit/shared/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getCoachBrief,
  getLatestWeeklyReview,
  saveCoachBrief,
  saveWeeklyReview,
} from '../db/coachBriefs.js';
import type { SqlExecutor } from '../db/executor.js';
import { recordBodyMetric } from '../db/metrics.js';
import { createTestExecutor } from '../db/testUtils.js';
import { coachFailureKey } from './failure.js';
import {
  nextReviewOn,
  requestWeeklyReview,
  REVIEW_EVERY_DAYS,
  tidyReview,
} from './weeklyReview.js';

const USER = 'user-1';
const NOW = new Date(2026, 9, 12, 12, 0, 0);
const TODAY = '2026-10-12';

let db: SqlExecutor & { close: () => void };
let counter = 0;
const newId = () => `id-${++counter}`;

/** What the fake server will answer the next request with. */
let answer: { status: number; body: string } | 'offline';
const sent: { url: string; headers: Record<string, string>; body: string }[] = [];

class FakeRequest {
  responseText = '';
  status = 0;
  timeout = 0;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private url = '';
  private headers: Record<string, string> = {};

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: string) {
    sent.push({ url: this.url, headers: this.headers, body });
    const reply = answer;
    queueMicrotask(() => {
      if (reply === 'offline') {
        this.onerror?.();
        return;
      }
      this.status = reply.status;
      this.responseText = reply.body;
      this.onprogress?.();
      this.onload?.();
    });
  }
  abort() {}
}

const stream = (...events: [string, unknown][]) => ({
  status: 200,
  body: events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join(''),
});

const REVIEW = stream(
  ['delta', { text: 'מה הלך טוב\nהתמדת בארבעה אימונים.\n\n' }],
  ['delta', { text: 'מה נתקע\nלחיצת החזה לא זזה.\n\nמה לשנות\nהורד חזרות והעלה משקל.' }],
  ['done', {}],
);

const original = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

beforeEach(async () => {
  db = createTestExecutor();
  counter = 0;
  sent.length = 0;
  answer = REVIEW;
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeRequest;
  // One weigh-in: enough for the coach to have something to go on.
  await recordBodyMetric(db, USER, newId, { weightKg: 82, source: 'manual' });
});
afterEach(() => {
  db.close();
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = original;
});

const ask = (today = NOW) =>
  requestWeeklyReview({
    db,
    userId: USER,
    newId,
    locale: 'he',
    baseUrl: 'https://project.supabase.co/functions/v1/fn/',
    accessToken: 'user-token',
    today,
  });

describe('asking for a weekly review', () => {
  it('asks the coach, keeps the answer, and hands it back', async () => {
    const outcome = await ask();
    expect(outcome).toEqual({
      ok: true,
      review: {
        writtenOn: TODAY,
        text: 'מה הלך טוב\nהתמדת בארבעה אימונים.\n\nמה נתקע\nלחיצת החזה לא זזה.\n\nמה לשנות\nהורד חזרות והעלה משקל.',
      },
    });
    expect(await getLatestWeeklyReview(db, USER)).toEqual(outcome.ok && outcome.review);
  });

  it('sends a request the server accepts, as the signed-in person, to the coach’s address', async () => {
    await ask();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://project.supabase.co/functions/v1/fn/coach/chat');
    expect(sent[0]!.headers.Authorization).toBe('Bearer user-token');

    // The server's own check of the body, not a comparison to a literal.
    const request = coachChatRequestSchema.parse(JSON.parse(sent[0]!.body));
    expect(request.context.locale).toBe('he');
    expect(request.context.weightTrend.measurementCount).toBe(1);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.content).toMatch(/weekly review/i);
    // Told not to produce a plan: a review is something to read.
    expect(request.messages[0]!.content).toMatch(/do not call a tool/i);
  });

  it('does not ask twice in a week, and says so without spending a request', async () => {
    await ask();
    const again = await ask(new Date(2026, 9, 15, 12, 0, 0));
    expect(again).toMatchObject({ ok: false, code: 'too_soon' });
    expect(sent).toHaveLength(1);
    expect(coachFailureKey('too_soon')).toBe('coach.weekly.tooSoon');
  });

  it('can be asked for again once a week has passed', async () => {
    await ask();
    const next = await ask(new Date(2026, 9, 19, 12, 0, 0));
    expect(next.ok).toBe(true);
    expect((await getLatestWeeklyReview(db, USER))?.writtenOn).toBe('2026-10-19');
    expect(sent).toHaveLength(2);
  });

  it('asks nobody when there is nothing logged to review', async () => {
    const empty = createTestExecutor();
    const outcome = await requestWeeklyReview({
      db: empty,
      userId: USER,
      newId,
      locale: 'he',
      baseUrl: 'https://example.invalid',
      accessToken: 'token',
      today: NOW,
    });
    empty.close();
    expect(outcome).toMatchObject({ ok: false, code: 'insufficient_context' });
    expect(sent).toEqual([]);
  });

  it.each([
    [
      'the daily limit',
      { status: 429, body: JSON.stringify({ error: 'daily_limit', message: 'x' }) },
      'daily_limit',
    ],
    [
      'a busy model',
      { status: 503, body: JSON.stringify({ error: 'ai_busy', message: 'x' }) },
      'ai_busy',
    ],
    ['no network', 'offline' as const, 'offline'],
    [
      'a refusal',
      stream(['delta', { text: 'I can' }], ['refusal', { category: 'SAFETY' }]),
      'refused',
    ],
    [
      'a failure part-way',
      stream(['delta', { text: 'מה הלך' }], ['error', { message: 'x', code: 'server_error' }]),
      'server_error',
    ],
    ['an answer with nothing in it', stream(['done', {}]), 'server_error'],
  ])(
    'keeps nothing after %s, and names it in a word the screen can say',
    async (_label, reply, code) => {
      answer = reply;
      const outcome = await ask();
      expect(outcome).toMatchObject({ ok: false, code });
      expect(coachFailureKey(code)).not.toBeNull();
      // Half a review reads as a whole one. Nothing is kept, so it can be asked for again.
      expect(await getLatestWeeklyReview(db, USER)).toBeNull();
    },
  );

  it('ignores a plan the model proposed anyway', async () => {
    answer = stream(
      ['delta', { text: 'סיכום.' }],
      ['plan_proposal', { plan: { planName: 'x', days: [] } }],
      ['done', {}],
    );
    expect(await ask()).toMatchObject({ ok: true, review: { text: 'סיכום.' } });
  });
});

describe('when the next review may be asked for', () => {
  it('is now, for someone who has never had one', () => {
    expect(nextReviewOn(null, TODAY)).toBeNull();
  });

  it('is seven days after the last, whatever day of the week that was', () => {
    expect(REVIEW_EVERY_DAYS).toBe(7);
    const latest = { writtenOn: '2026-10-08', text: 'x' };
    expect(nextReviewOn(latest, '2026-10-08')).toBe('2026-10-15');
    expect(nextReviewOn(latest, '2026-10-14')).toBe('2026-10-15');
    expect(nextReviewOn(latest, '2026-10-15')).toBeNull();
    expect(nextReviewOn(latest, '2026-11-01')).toBeNull();
  });

  it('counts across the end of a month', () => {
    expect(nextReviewOn({ writtenOn: '2026-10-28', text: 'x' }, '2026-10-30')).toBe('2026-11-04');
  });
});

describe('where reviews are kept', () => {
  const stamp = () => '2026-10-12T09:00:00.000Z';

  it('shows the most recent of several', async () => {
    await saveWeeklyReview(db, USER, newId, '2026-09-28', 'ישן', stamp);
    await saveWeeklyReview(db, USER, newId, '2026-10-05', 'חדש', stamp);
    expect(await getLatestWeeklyReview(db, USER)).toEqual({ writtenOn: '2026-10-05', text: 'חדש' });
  });

  it('is not mistaken for the daily note, nor the daily note for it', async () => {
    await saveCoachBrief(db, USER, newId, TODAY, 'הערה יומית', stamp);
    expect(await getLatestWeeklyReview(db, USER)).toBeNull();

    await saveWeeklyReview(db, USER, newId, TODAY, 'סיכום שבועי', stamp);
    expect((await getCoachBrief(db, USER, TODAY))?.text).toBe('הערה יומית');
    expect((await getLatestWeeklyReview(db, USER))?.text).toBe('סיכום שבועי');
  });

  it('is each person’s own', async () => {
    await saveWeeklyReview(db, 'someone-else', newId, TODAY, 'שלהם', stamp);
    expect(await getLatestWeeklyReview(db, USER)).toBeNull();
  });
});

describe('tidying what the model wrote', () => {
  it('takes out heading marks, emphasis marks and bullets', () => {
    expect(tidyReview('## מה הלך טוב\n**התמדת** בארבעה אימונים.\n- נקודה\n* עוד נקודה')).toBe(
      'מה הלך טוב\nהתמדת בארבעה אימונים.\nנקודה\nעוד נקודה',
    );
    expect(tidyReview('__What went well__\nFour sessions.')).toBe('What went well\nFour sessions.');
  });

  it('leaves alone a mark that is not markup', () => {
    expect(tidyReview('3*10 בסקוואט, 2 * 8 בלחיצה')).toBe('3*10 בסקוואט, 2 * 8 בלחיצה');
    expect(tidyReview('משקל: 82 ק״ג (#1 השבוע)')).toBe('משקל: 82 ק״ג (#1 השבוע)');
    expect(tidyReview('ירידה של -0.4 ק״ג')).toBe('ירידה של -0.4 ק״ג');
  });

  it('brings runs of blank lines down to one, and trims the ends', () => {
    expect(tidyReview('\n\nא\n\n\n\nב  \n\n')).toBe('א\n\nב');
  });

  it('is nothing for nothing', () => {
    expect(tidyReview('  \n \n')).toBe('');
  });
});
