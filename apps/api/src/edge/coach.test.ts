/**
 * The coach half of the Supabase function, run for real against stand-ins for the three
 * services it calls: Supabase auth, the `coach_turns` table, and Gemini.
 *
 * As with the scan, it cannot be run against the real ones from here — the key never leaves
 * the Supabase dashboard. What can be proved is what is this file's own decision: who is
 * refused and in what order, that nothing is asked of the model before the turn is counted,
 * that a model which is out hands on to the next, and that the stream going back is the one
 * the phone already knows how to read.
 */

import {
  aiWorkoutPlanSchema,
  coachChatRequestSchema,
  PROPOSE_NUTRITION_MENU_TOOL,
  PROPOSE_WORKOUT_PLAN_TOOL,
} from '@fit/shared/schemas';
import { describe, expect, it } from 'vitest';

import { COACH_PERSONA } from '../ai/context.js';
import {
  MAX_COACH_BODY,
  answerFrom,
  eventsOf,
  geminiRequest,
  handleCoach,
  type GeminiChunk,
} from './coach.js';
import { route } from './main.js';
import { DEFAULT_MODELS, type EdgeDeps } from './shared.js';

const CONTEXT = {
  locale: 'he',
  profile: {
    ageYears: 31,
    sex: 'male',
    heightCm: 178,
    weightKg: 82,
    activityLevel: 'moderate',
    goal: 'cut',
  },
  targets: {
    bmi: 25.9,
    bmrKcal: 1790,
    tdeeKcal: 2770,
    calorieTarget: 2270,
    proteinG: 164,
    carbsG: 230,
    fatG: 76,
  },
  weightTrend: { currentKg: 82, kgPerWeek: -0.4, isReliable: true, measurementCount: 12 },
  exercises: [
    {
      exerciseKey: 'Barbell Bench Press',
      sessionCount: 9,
      latestE1rmKg: 104,
      bestE1rmKg: 106,
      e1rmDeltaKg: -1,
      volumeSlopePerSession: 40,
      sessionsSinceBest: 2,
      isStalling: false,
    },
  ],
  adherence: [],
  availableEquipment: [],
  planName: null,
};

const ASK = { context: CONTEXT, messages: [{ role: 'user', content: 'מה לשפר בלחיצת חזה?' }] };

/** A streamed Gemini answer: one server-sent event per chunk. */
const sse = (chunks: GeminiChunk[]) => ({
  status: 200,
  body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''),
  type: 'text/event-stream',
});

const said = (text: string, finishReason?: string): GeminiChunk => ({
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
});

const HELLO = sse([said('שלום. '), said('נתחיל מהטכניקה.', 'STOP')]);

interface Scripted {
  status: number;
  body?: string;
  type?: string;
}

interface World {
  user?: string | null;
  /** The caller's date of birth on their profile; null for none. Default: an adult. */
  birthDate?: string | null;
  count?: { status: number; body?: unknown };
  /** By `<model>:<method>`, or just `<model>` for both methods. Unlisted answer 404. */
  models?: Record<string, Scripted | 'throw'>;
  env?: Record<string, string | undefined>;
}

function world(setup: World = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    GEMINI_API_KEY: 'gemini-key',
    ...setup.env,
  };

  const fakeFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const json = (status: number, body: unknown = {}) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));

    if (url.endsWith('/auth/v1/user')) {
      const user = setup.user === undefined ? 'user-1' : setup.user;
      return user === null ? json(401, { msg: 'invalid' }) : json(200, { id: user });
    }
    if (url.includes('/rest/v1/profiles?')) {
      // An adult unless the test says otherwise; null is a profile with no date of birth.
      const birthDate = setup.birthDate === undefined ? '1990-05-01' : setup.birthDate;
      return json(200, [{ birth_date: birthDate }]);
    }
    if (url.endsWith('/rest/v1/coach_turns')) {
      const count = setup.count ?? { status: 201 };
      return json(count.status, count.body);
    }
    const asked = /models\/([^:]+):(streamGenerateContent|generateContent)/.exec(url);
    if (asked) {
      const scripts = setup.models ?? { [DEFAULT_MODELS[0]!]: HELLO };
      const scripted = scripts[`${asked[1]}:${asked[2]}`] ?? scripts[asked[1]!];
      if (scripted === 'throw') return Promise.reject(new Error('network'));
      if (!scripted) return json(404, { error: { status: 'NOT_FOUND' } });
      return Promise.resolve(
        new Response(scripted.body ?? '{}', {
          status: scripted.status,
          headers: { 'Content-Type': scripted.type ?? 'application/json' },
        }),
      );
    }
    return json(500);
  }) as typeof fetch;

  const logged: string[] = [];
  const deps: EdgeDeps = {
    fetch: fakeFetch,
    env: (name) => env[name],
    log: (line) => logged.push(line),
  };
  return { deps, calls, logged };
}

const request = (
  body: unknown = ASK,
  { token = 'user-token', method = 'POST' }: { token?: string | null; method?: string } = {},
) => {
  const init: RequestInit = {
    method,
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  };
  if (method === 'POST') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://project.supabase.co/functions/v1/smooth-processor/coach/chat', init);
};

/** The events of a streamed reply, as the phone would see them. */
async function eventsFrom(response: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      return {
        event: lines.find((line) => line.startsWith('event: '))!.slice(7),
        data: JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6)) as unknown,
      };
    });
}

const refusal = async (response: Response) =>
  (await response.json()) as { error: string; message: string; code?: string };

const modelCalls = <Call extends { url: string }>(calls: Call[]): Call[] =>
  calls.filter((call) => call.url.includes('generativelanguage.googleapis.com'));

const modelOf = (call: { url: string }) => /models\/([^:]+):([A-Za-z]+)/.exec(call.url)!;

describe('asking the coach', () => {
  it('streams the answer back as the events the phone already reads', async () => {
    const { deps } = world();
    const response = await handleCoach(request(), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await eventsFrom(response)).toEqual([
      { event: 'delta', data: { text: 'שלום. ' } },
      { event: 'delta', data: { text: 'נתחיל מהטכניקה.' } },
      { event: 'done', data: {} },
    ]);
  });

  it('sends the model the persona, the athlete, the conversation and the two tools', async () => {
    const { deps, calls } = world();
    await handleCoach(
      request({
        context: CONTEXT,
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'answer' },
          { role: 'user', content: 'second' },
        ],
      }),
      deps,
    );

    const call = modelCalls(calls)[0]!;
    // The key in a header, never in the URL.
    expect(call.url).not.toContain('gemini-key');
    expect(new Headers(call.init?.headers).get('x-goog-api-key')).toBe('gemini-key');
    expect(call.url).toContain(':streamGenerateContent?alt=sse');

    const sent = JSON.parse(call.init?.body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
      tools: { functionDeclarations: { name: string; parametersJsonSchema: unknown }[] }[];
    };
    const system = sent.systemInstruction.parts[0]!.text;
    expect(system.startsWith(COACH_PERSONA)).toBe(true);
    // The athlete's own numbers, after the persona.
    expect(system.slice(COACH_PERSONA.length)).toContain('Barbell Bench Press');
    // Gemini's word for the coach's own turns is `model`.
    expect(sent.contents.map((turn) => [turn.role, turn.parts[0]!.text])).toEqual([
      ['user', 'first'],
      ['model', 'answer'],
      ['user', 'second'],
    ]);
    expect(sent.tools[0]!.functionDeclarations.map((tool) => tool.name)).toEqual([
      PROPOSE_WORKOUT_PLAN_TOOL.name,
      PROPOSE_NUTRITION_MENU_TOOL.name,
    ]);
  });

  it('answers an app from before there was a food log, and tells the model nothing about one', async () => {
    const { deps, calls } = world();
    const response = await handleCoach(request(ASK), deps);
    expect(response.status).toBe(200);
    const sent = JSON.parse(modelCalls(calls)[0]!.init?.body as string) as {
      systemInstruction: { parts: { text: string }[] };
    };
    expect(sent.systemInstruction.parts[0]!.text.slice(COACH_PERSONA.length)).not.toContain(
      'Food log',
    );
  });

  it('passes the food log on to the model when the app sends one', async () => {
    const { deps, calls } = world();
    const withLog = {
      ...ASK,
      context: {
        ...CONTEXT,
        intake: {
          days: [
            {
              date: '2026-10-12',
              calories: 2140,
              proteinG: 120,
              carbsG: 210,
              fatG: 61,
              macrosPartial: false,
              entryCount: 5,
            },
          ],
          today: [{ name: 'ביצה קשה', calories: 155 }],
          water: [{ date: '2026-10-12', ml: 1750 }],
        },
      },
    };
    await (await handleCoach(request(withLog), deps)).text();
    const sent = JSON.parse(modelCalls(calls)[0]!.init?.body as string) as {
      systemInstruction: { parts: { text: string }[] };
    };
    const told = sent.systemInstruction.parts[0]!.text;
    expect(told).toContain('- 2026-10-12: 2,140 kcal');
    expect(told).toContain('- ביצה קשה: 155 kcal');
    expect(told).toContain('- 2026-10-12: 1750 ml');
  });

  it('refuses a request whose food log is malformed, without asking anyone', async () => {
    const { deps, calls } = world();
    const response = await handleCoach(
      request({ ...ASK, context: { ...CONTEXT, intake: { days: [{ date: 'yesterday' }] } } }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('strips schema keywords Gemini does not accept from the tools', () => {
    // Parsed first, as the handler does: the schema is what fills in the parts of a request
    // that an older build of the app does not send.
    const body = JSON.stringify(geminiRequest(coachChatRequestSchema.parse(ASK)));
    for (const keyword of ['minLength', 'maxLength', 'exclusiveMinimum', '$schema']) {
      expect(body, keyword).not.toContain(`"${keyword}"`);
    }
  });
});

describe('who is refused, before anything is spent', () => {
  it('refuses a request with no token', async () => {
    const { deps, calls } = world();
    const response = await handleCoach(request(ASK, { token: null }), deps);
    expect(response.status).toBe(401);
    expect((await refusal(response)).error).toBe('sign_in_required');
    expect(calls).toEqual([]);
  });

  it('refuses the anon key, which is a valid token and not a person', async () => {
    const { deps, calls } = world({ user: null });
    const response = await handleCoach(request(ASK, { token: 'anon-key' }), deps);
    expect(response.status).toBe(401);
    expect((await refusal(response)).error).toBe('sign_in_required');
    expect(modelCalls(calls)).toEqual([]);
    expect(calls.some((call) => call.url.endsWith('/rest/v1/coach_turns'))).toBe(false);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['no messages', { context: CONTEXT, messages: [] }],
    ['no context', { messages: ASK.messages }],
    [
      'a role the coach does not have',
      { context: CONTEXT, messages: [{ role: 'system', content: 'x' }] },
    ],
    [
      'a message past the length bound',
      { context: CONTEXT, messages: [{ role: 'user', content: 'x'.repeat(8001) }] },
    ],
    [
      'a digest with an impossible number',
      {
        context: { ...CONTEXT, profile: { ...CONTEXT.profile, heightCm: 9000 } },
        messages: ASK.messages,
      },
    ],
  ])('refuses %s without asking anyone', async (_label, body) => {
    const { deps, calls } = world();
    const response = await handleCoach(request(body), deps);
    expect(response.status).toBe(400);
    expect((await refusal(response)).error).toBe('invalid_request');
    expect(calls).toEqual([]);
  });

  it('says which fields were wrong, for whoever is debugging the phone', async () => {
    const { deps } = world();
    const response = await handleCoach(request({ context: CONTEXT, messages: [] }), deps);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((issue) => issue.path)).toContain('messages');
  });

  it('refuses a request past the size bound by its length, before parsing it', async () => {
    const { deps, calls } = world();
    const response = await handleCoach(request('x'.repeat(MAX_COACH_BODY + 1)), deps);
    expect(response.status).toBe(413);
    expect((await refusal(response)).error).toBe('request_too_large');
    expect(calls).toEqual([]);
  });

  it('refuses to advise about nobody: an empty digest never reaches the model', async () => {
    const empty = {
      ...CONTEXT,
      targets: { ...CONTEXT.targets, tdeeKcal: null },
      weightTrend: { currentKg: null, kgPerWeek: null, isReliable: false, measurementCount: 0 },
      exercises: [],
    };
    const { deps, calls } = world();
    const response = await handleCoach(request({ context: empty, messages: ASK.messages }), deps);
    expect(response.status).toBe(422);
    expect((await refusal(response)).error).toBe('insufficient_context');
    expect(calls).toEqual([]);
  });

  it('refuses anything but a POST', async () => {
    const { deps, calls } = world();
    const response = await handleCoach(request(ASK, { method: 'GET' }), deps);
    expect((await refusal(response)).error).toBe('invalid_request');
    expect(calls).toEqual([]);
  });

  it('says so when there is no key, and asks nobody', async () => {
    const { deps, calls } = world({ env: { GEMINI_API_KEY: undefined } });
    const response = await handleCoach(request(), deps);
    expect(response.status).toBe(503);
    expect((await refusal(response)).error).toBe('not_set_up');
    expect(calls).toEqual([]);
  });

  it('always says something a person can read, beside the code', async () => {
    const { deps } = world({ env: { GEMINI_API_KEY: undefined } });
    expect((await refusal(await handleCoach(request(), deps))).message).toMatch(/[a-z]{4,}/);
  });
});

describe('the daily limit', () => {
  it('counts the turn as the caller, before the model is asked', async () => {
    const { deps, calls } = world();
    await (await handleCoach(request(), deps)).text();

    const order = calls.map((call) =>
      call.url.endsWith('/auth/v1/user')
        ? 'auth'
        : call.url.includes('/rest/v1/profiles?')
          ? 'age'
          : call.url.endsWith('/rest/v1/coach_turns')
            ? 'count'
            : 'model',
    );
    expect(order).toEqual(['auth', 'age', 'count', 'model']);

    const count = calls.find((call) => call.url.endsWith('/rest/v1/coach_turns'))!;
    expect(new Headers(count.init?.headers).get('Authorization')).toBe('Bearer user-token');
    expect(count.init?.body).toBe('{}');
  });

  it('stops at the limit without asking the model', async () => {
    const { deps, calls } = world({
      count: { status: 400, body: { code: 'P0001', message: 'coach_limit' } },
    });
    const response = await handleCoach(request(), deps);
    expect(response.status).toBe(429);
    expect((await refusal(response)).error).toBe('daily_limit');
    expect(modelCalls(calls)).toEqual([]);
  });

  it('is not tripped by the scan’s limit word, which belongs to another table', async () => {
    const { deps } = world({
      count: { status: 400, body: { code: 'P0001', message: 'scan_limit' } },
    });
    expect((await refusal(await handleCoach(request(), deps))).error).toBe('server_error');
  });

  it('refuses to answer at all when the table is missing, rather than answer without a limit', async () => {
    const { deps, calls } = world({
      count: { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } },
    });
    const response = await handleCoach(request(), deps);
    expect((await refusal(response)).error).toBe('not_set_up');
    expect(modelCalls(calls)).toEqual([]);
  });
});

describe('which model answers', () => {
  it('moves on to the next model when one is out of free quota', async () => {
    const { deps, calls } = world({
      models: { [DEFAULT_MODELS[0]!]: { status: 429 }, [DEFAULT_MODELS[1]!]: HELLO },
    });
    const response = await handleCoach(request(), deps);
    expect(response.status).toBe(200);
    expect((await eventsFrom(response)).at(-1)?.event).toBe('done');
    expect(modelCalls(calls).map((call) => modelOf(call)[1])).toEqual([
      DEFAULT_MODELS[0],
      DEFAULT_MODELS[1],
    ]);
  });

  it('moves on from a model that is down and one that hangs up', async () => {
    const { deps } = world({
      models: {
        [DEFAULT_MODELS[0]!]: { status: 503 },
        [DEFAULT_MODELS[1]!]: 'throw',
        [DEFAULT_MODELS[2]!]: HELLO,
      },
    });
    expect((await handleCoach(request(), deps)).status).toBe(200);
  });

  it('falls back to the plain method on a model whose streaming is not on offer', async () => {
    // Google answers 404 for a method a model does not expose exactly as for a missing model.
    const whole = {
      status: 200,
      body: JSON.stringify(said('תשובה שלמה.', 'STOP')),
    };
    const { deps, calls } = world({
      models: { [`${DEFAULT_MODELS[0]}:generateContent`]: whole },
    });
    const response = await handleCoach(request(), deps);
    expect(await eventsFrom(response)).toEqual([
      { event: 'delta', data: { text: 'תשובה שלמה.' } },
      { event: 'done', data: {} },
    ]);
    expect(modelCalls(calls).map((call) => modelOf(call).slice(1, 3))).toEqual([
      [DEFAULT_MODELS[0], 'streamGenerateContent'],
      [DEFAULT_MODELS[0], 'generateContent'],
    ]);
  });

  it('moves on from a model Google no longer serves by either method', async () => {
    const { deps, calls } = world({ models: { [DEFAULT_MODELS[1]!]: HELLO } });
    expect((await handleCoach(request(), deps)).status).toBe(200);
    expect(modelCalls(calls).map((call) => modelOf(call)[1])).toEqual([
      DEFAULT_MODELS[0],
      DEFAULT_MODELS[0],
      DEFAULT_MODELS[1],
    ]);
  });

  it('says the coach is busy when every model is out, as a status and not a stream', async () => {
    const { deps } = world({
      models: Object.fromEntries(DEFAULT_MODELS.map((model) => [model, { status: 429 }])),
    });
    const response = await handleCoach(request(), deps);
    expect(response.status).toBe(503);
    expect((await refusal(response)).error).toBe('ai_busy');
  });

  it('does not try another model when this one refused the request itself', async () => {
    const { deps, calls } = world({
      models: {
        [DEFAULT_MODELS[0]!]: {
          status: 400,
          body: JSON.stringify({
            error: { status: 'INVALID_ARGUMENT', message: 'quotes the request back' },
          }),
        },
        [DEFAULT_MODELS[1]!]: HELLO,
      },
    });
    const response = await handleCoach(request(), deps);
    const body = await refusal(response);
    expect(body.error).toBe('server_error');
    // The status and Google's own enumeration — never its sentence, which can quote the request.
    expect(body.code).toBe('400 INVALID_ARGUMENT');
    expect(JSON.stringify(body)).not.toContain('quotes the request back');
    expect(modelCalls(calls)).toHaveLength(1);
  });

  it('uses the models named in the secret instead, in that order', async () => {
    const { deps, calls } = world({
      env: { GEMINI_MODELS: 'gemini-x, gemini-y' },
      models: { 'gemini-x': { status: 429 }, 'gemini-y': HELLO },
    });
    expect((await handleCoach(request(), deps)).status).toBe(200);
    expect(modelCalls(calls).map((call) => modelOf(call)[1])).toEqual(['gemini-x', 'gemini-y']);
  });
});

describe('what the model says, as events', () => {
  const collect = async (chunks: GeminiChunk[]) => {
    const events = [];
    for await (const event of answerFrom(
      (async function* source() {
        yield* chunks;
      })(),
    )) {
      events.push(event);
    }
    return events;
  };

  it('leaves out the model’s shown reasoning and empty text', async () => {
    const events = await collect([
      {
        candidates: [{ content: { parts: [{ thought: true, text: 'thinking…' }, { text: '' }] } }],
      },
      said('the answer', 'STOP'),
    ]);
    expect(events).toEqual([
      { event: 'delta', data: { text: 'the answer' } },
      { event: 'done', data: {} },
    ]);
  });

  it('passes on a workout plan the model proposed, once it has been validated', async () => {
    const plan = {
      planName: 'Upper / Lower',
      rationale: 'Two days, each lift twice a week.',
      days: [
        {
          name: 'Upper',
          exercises: [
            {
              exerciseKey: 'Barbell Bench Press',
              targetSets: 4,
              targetRepsMin: 6,
              targetRepsMax: 8,
              notes: null,
            },
          ],
        },
      ],
    };
    // The fixture has to be one the real schema accepts, or this proves nothing.
    expect(aiWorkoutPlanSchema.safeParse(plan).success).toBe(true);

    const events = await collect([
      said('הנה תוכנית: '),
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: PROPOSE_WORKOUT_PLAN_TOOL.name, args: plan } }],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ]);
    expect(events.map((event) => event.event)).toEqual(['delta', 'plan_proposal', 'done']);
    expect(events[1]!.data).toEqual({ plan: aiWorkoutPlanSchema.parse(plan) });
  });

  it('does not pass on a plan the app’s own schema refuses', async () => {
    // Well-formed in every way but one: the exercise is not in the app's catalogue.
    const bad = {
      planName: 'x',
      rationale: 'y',
      days: [
        {
          name: 'A',
          exercises: [
            {
              exerciseKey: 'Not An Exercise',
              targetSets: 3,
              targetRepsMin: 8,
              targetRepsMax: 12,
              notes: null,
            },
          ],
        },
      ],
    };
    await expect(
      collect([
        {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: PROPOSE_WORKOUT_PLAN_TOOL.name, args: bad } }],
              },
            },
          ],
        },
      ]),
    ).rejects.toThrow();
  });

  it('reports a refusal that arrives after some of the answer, as a refusal', async () => {
    const events = await collect([said('I can tell you that '), said('', 'SAFETY')]);
    expect(events).toEqual([
      { event: 'delta', data: { text: 'I can tell you that ' } },
      { event: 'refusal', data: { category: 'SAFETY' } },
    ]);
  });

  it('reports a blocked prompt, which has no candidate at all, as a refusal', async () => {
    expect(await collect([{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }])).toEqual([
      { event: 'refusal', data: { category: 'PROHIBITED_CONTENT' } },
    ]);
  });

  it('does not call a truncated answer a refusal', async () => {
    const events = await collect([said('long answer', 'MAX_TOKENS')]);
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
  });

  it('ends a turn whose proposal was bad with an error event, not a broken connection', async () => {
    const bad = sse([
      said('הנה תוכנית: '),
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: PROPOSE_WORKOUT_PLAN_TOOL.name, args: { name: '' } } },
              ],
            },
          },
        ],
      },
    ]);
    const { deps } = world({ models: { [DEFAULT_MODELS[0]!]: bad } });
    const events = await eventsFrom(await handleCoach(request(), deps));
    expect(events.map((event) => event.event)).toEqual(['delta', 'error']);
    // A word the phone can say in its own language, like every other failure.
    expect(events[1]!.data).toEqual({ message: 'The coach is unavailable.', code: 'server_error' });
  });
});

describe('what is written to the log', () => {
  it('says nothing about a turn that simply worked', async () => {
    const { deps, logged } = world();
    await (await handleCoach(request(), deps)).text();
    expect(logged).toEqual([]);
  });

  it('names each model that did not answer and why, in Google\u2019s words and not the person\u2019s', async () => {
    const { deps, logged } = world({
      models: {
        [DEFAULT_MODELS[0]!]: {
          status: 429,
          body: JSON.stringify({
            error: {
              status: 'RESOURCE_EXHAUSTED',
              message: 'Quota exceeded for: מה לשפר בלחיצת חזה?',
            },
          }),
        },
        [DEFAULT_MODELS[1]!]: 'throw',
        [DEFAULT_MODELS[2]!]: HELLO,
      },
    });
    await (await handleCoach(request(), deps)).text();
    expect(logged).toEqual([
      `[coach] ${DEFAULT_MODELS[0]} (streaming): 429 RESOURCE_EXHAUSTED`,
      `[coach] ${DEFAULT_MODELS[1]}: no answer`,
    ]);
  });

  it('records an answer that failed part-way by the kind of failure only', async () => {
    const bad = sse([
      said('הנה תוכנית: '),
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: PROPOSE_WORKOUT_PLAN_TOOL.name,
                    args: { planName: 'סודי' },
                  },
                },
              ],
            },
          },
        ],
      },
    ]);
    const { deps, logged } = world({ models: { [DEFAULT_MODELS[0]!]: bad } });
    await (await handleCoach(request(), deps)).text();
    expect(logged).toEqual(['[coach] answer failed: ZodError']);
  });
});

describe('reading a stream of events', () => {
  const streamOf = (pieces: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    });

  const read = async (pieces: string[]) => {
    const chunks = [];
    for await (const chunk of eventsOf(streamOf(pieces))) chunks.push(chunk);
    return chunks;
  };

  it('reads each event, however the network cut it up', async () => {
    const one = `data: ${JSON.stringify(said('שלום'))}\n\n`;
    const two = `data: ${JSON.stringify(said('עולם', 'STOP'))}\n\n`;
    const whole = one + two;
    // Split mid-event, and mid-character: Hebrew letters are two bytes each.
    const bytes = new TextEncoder().encode(whole);
    const cut = [bytes.slice(0, 31), bytes.slice(31, 77), bytes.slice(77)];
    const chunks = [];
    for await (const chunk of eventsOf(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of cut) controller.enqueue(piece);
          controller.close();
        },
      }),
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([said('שלום'), said('עולם', 'STOP')]);
    expect(await read([whole])).toEqual(chunks);
  });

  it('accepts Windows line endings and a last event with no blank line after it', async () => {
    const chunks = await read([
      `data: ${JSON.stringify(said('a'))}\r\n\r\n`,
      `data: ${JSON.stringify(said('b'))}`,
    ]);
    expect(chunks).toEqual([said('a'), said('b')]);
  });

  it('skips what is not an event', async () => {
    expect(
      await read([
        ': keep-alive\n\n',
        'data: not json\n\n',
        `data: ${JSON.stringify(said('ok'))}\n\n`,
      ]),
    ).toEqual([said('ok')]);
  });
});

describe('one function, two jobs', () => {
  it('sends the coach’s path to the coach', async () => {
    const { deps } = world();
    const response = await route(request(), deps);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('sends everything else to the meal scan, as before', async () => {
    const { deps } = world();
    const response = await route(
      new Request('https://project.supabase.co/functions/v1/smooth-processor', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token' },
        body: JSON.stringify({ image: 'x' }),
      }),
      deps,
    );
    // The scan's own word for a bad request; the coach's is `invalid_request`.
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('is not fooled by a trailing slash', async () => {
    const { deps } = world({ env: { GEMINI_API_KEY: undefined } });
    const response = await route(
      new Request('https://project.supabase.co/functions/v1/smooth-processor/coach/chat/', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token' },
        body: JSON.stringify(ASK),
      }),
      deps,
    );
    expect(((await response.json()) as { message?: string }).message).toContain('coach');
  });
});

describe('the age the AI is for', () => {
  it('answers an adult', async () => {
    const { deps } = world({ birthDate: '2000-01-01' });
    expect((await handleCoach(request(), deps)).status).toBe(200);
  });

  it('refuses someone under 18, before a turn is counted or the model asked', async () => {
    const { deps, calls } = world({ birthDate: '2010-06-15' });
    const response = await handleCoach(request(), deps);
    expect(response.status).toBe(403);
    expect((await refusal(response)).error).toBe('age_restricted');
    expect(calls.some((call) => call.url.endsWith('/rest/v1/coach_turns'))).toBe(false);
    expect(modelCalls(calls)).toEqual([]);
  });

  it('refuses an account with no date of birth, since its age cannot be checked', async () => {
    const { deps, calls } = world({ birthDate: null });
    const response = await handleCoach(request(), deps);
    expect(response.status).toBe(403);
    expect((await refusal(response)).error).toBe('age_unknown');
    expect(modelCalls(calls)).toEqual([]);
  });

  it('asks for the caller’s own row, with the caller’s own token', async () => {
    const { deps, calls } = world();
    await (await handleCoach(request(), deps)).text();
    const age = calls.find((call) => call.url.includes('/rest/v1/profiles?'))!;
    expect(age.url).toContain('select=birth_date');
    expect(age.url).toContain('id=eq.user-1');
    expect(new Headers(age.init?.headers).get('Authorization')).toBe('Bearer user-token');
  });
});
