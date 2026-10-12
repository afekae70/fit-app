/**
 * The `scan-food` function, run for real against stand-ins for the three services it calls:
 * Supabase auth, the `food_scans` table, and Gemini.
 *
 * It cannot be run against the real ones from here — that needs the key, which never leaves
 * the Supabase dashboard. What can be proved without it is everything that is this file's own
 * decision: who is refused and in what order, that nothing is asked of the model before the
 * scan is counted, and that whatever the model says, what goes back to the phone is a result
 * the phone's schema accepts or one of the named errors.
 */

import { FoodScanErrorSchema, FoodScanResultSchema, FOOD_SCAN_LIMITS } from '@fit/shared/schemas';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODELS,
  MAX_IMAGE_BASE64,
  handle,
  promptFor,
  readEstimate,
  type ScanDeps,
} from './scan-food.js';

const PHOTO = 'A'.repeat(400);

interface World {
  /** The auth server's answer for the token: a user id, or null for "not a session". */
  user?: string | null;
  /** What inserting the scan row returns. */
  count?: { status: number; body?: unknown };
  /** What each model answers, by model id. Unlisted models answer 404. */
  models?: Record<string, { status: number; body?: unknown } | 'throw'>;
  env?: Record<string, string | undefined>;
}

/** A Gemini reply carrying `payload` as its JSON text. */
const reply = (payload: unknown, extraParts: unknown[] = []) => ({
  status: 200,
  body: {
    candidates: [{ content: { parts: [...extraParts, { text: JSON.stringify(payload) }] } }],
  },
});

const MEAL = {
  is_food: true,
  confidence: 'medium',
  items: [
    { name: 'אורז לבן', grams: 180, calories: 234, protein_g: 4.3, carbs_g: 51.2, fat_g: 0.5 },
    { name: 'חזה עוף', grams: 150, calories: 248, protein_g: 46.5, carbs_g: 0, fat_g: 5.4 },
  ],
};

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
    const answer = (status: number, body: unknown = {}) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));

    if (url.endsWith('/auth/v1/user')) {
      const user = setup.user === undefined ? 'user-1' : setup.user;
      return user === null ? answer(401, { msg: 'invalid' }) : answer(200, { id: user });
    }
    if (url.endsWith('/rest/v1/food_scans')) {
      const count = setup.count ?? { status: 201 };
      return answer(count.status, count.body);
    }
    const model = /models\/([^:]+):generateContent/.exec(url)?.[1];
    if (model) {
      const scripted = (setup.models ?? { [DEFAULT_MODELS[0]!]: reply(MEAL) })[model];
      if (scripted === 'throw') return Promise.reject(new Error('network'));
      return scripted ? answer(scripted.status, scripted.body) : answer(404);
    }
    return answer(500);
  }) as typeof fetch;

  const deps: ScanDeps = { fetch: fakeFetch, env: (name) => env[name] };
  return { deps, calls };
}

const request = (
  body: unknown = { image: PHOTO, mimeType: 'image/jpeg', language: 'he' },
  { token = 'user-token', method = 'POST' }: { token?: string | null; method?: string } = {},
) => {
  const init: RequestInit = {
    method,
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  };
  if (method === 'POST') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://project.supabase.co/functions/v1/scan-food', init);
};

const errorOf = async (response: Response) =>
  FoodScanErrorSchema.parse(await response.json()).error;

const modelCalls = <Call extends { url: string }>(calls: Call[]): Call[] =>
  calls.filter((call) => call.url.includes(':generateContent'));

describe('scanning a meal', () => {
  it('answers with the foods, in the shape the phone validates', async () => {
    const { deps } = world();
    const response = await handle(request(), deps);

    expect(response.status).toBe(200);
    const result = FoodScanResultSchema.parse(await response.json());
    expect(result).toEqual({
      confidence: 'medium',
      items: [
        { name: 'אורז לבן', grams: 180, calories: 234, proteinG: 4.3, carbsG: 51.2, fatG: 0.5 },
        { name: 'חזה עוף', grams: 150, calories: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4 },
      ],
    });
  });

  it('sends the photo and the key to the model, the key in a header and never in the URL', async () => {
    const { deps, calls } = world();
    await handle(request(), deps);

    const call = modelCalls(calls)[0]!;
    expect(call.url).not.toContain('gemini-key');
    expect(new Headers(call.init?.headers).get('x-goog-api-key')).toBe('gemini-key');

    const sent = JSON.parse(call.init?.body as string) as {
      contents: { parts: { inline_data?: { mime_type: string; data: string }; text?: string }[] }[];
      generationConfig: { responseMimeType: string };
    };
    expect(sent.contents[0]!.parts[0]!.inline_data).toEqual({
      mime_type: 'image/jpeg',
      data: PHOTO,
    });
    expect(sent.contents[0]!.parts[1]!.text).toBe(promptFor('he'));
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
  });

  it('asks for names in the language of the person scanning', async () => {
    expect(promptFor('he')).toContain('Hebrew');
    expect(promptFor('en')).toContain('English');
    // Anything that is not English is Hebrew, the app's first language.
    const { deps, calls } = world();
    await handle(request({ image: PHOTO, mimeType: 'image/jpeg', language: 'fr' }), deps);
    const sent = JSON.parse(modelCalls(calls)[0]!.init?.body as string) as {
      contents: { parts: { text?: string }[] }[];
    };
    expect(sent.contents[0]!.parts[1]!.text).toBe(promptFor('he'));
  });

  it('says a photo of something else holds no food, which is not an error', async () => {
    const { deps } = world({
      models: { [DEFAULT_MODELS[0]!]: reply({ is_food: false, confidence: 'high', items: [] }) },
    });
    const response = await handle(request(), deps);
    expect(response.status).toBe(200);
    expect(FoodScanResultSchema.parse(await response.json())).toEqual({
      items: [],
      confidence: 'high',
    });
  });

  it('is never cached', async () => {
    const { deps } = world();
    expect((await handle(request(), deps)).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('who is refused, before anything is spent', () => {
  it('refuses a request with no token', async () => {
    const { deps, calls } = world();
    const response = await handle(request(undefined, { token: null }), deps);
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toBe('sign_in_required');
    expect(calls).toEqual([]);
  });

  it('refuses the anon key, which is a valid token and not a person', async () => {
    // The anon key is public — it ships in the app. The auth server answers for it without a
    // user, and that is what has to be refused.
    const { deps, calls } = world({ user: null });
    const response = await handle(request(undefined, { token: 'anon-key' }), deps);
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toBe('sign_in_required');
    expect(modelCalls(calls)).toEqual([]);
    expect(calls.some((call) => call.url.endsWith('/rest/v1/food_scans'))).toBe(false);
  });

  it('asks the auth server with the caller’s own token', async () => {
    const { deps, calls } = world();
    await handle(request(), deps);
    const auth = calls.find((call) => call.url.endsWith('/auth/v1/user'))!;
    expect(new Headers(auth.init?.headers).get('Authorization')).toBe('Bearer user-token');
    expect(new Headers(auth.init?.headers).get('apikey')).toBe('anon-key');
  });

  it('refuses anything but a POST', async () => {
    const { deps, calls } = world();
    const response = await handle(request(undefined, { method: 'GET' }), deps);
    expect(await errorOf(response)).toBe('bad_request');
    expect(calls).toEqual([]);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['no image', { mimeType: 'image/jpeg' }],
    ['an image that is not base64', { image: '<svg>'.repeat(40), mimeType: 'image/jpeg' }],
    ['an image too small to be a photo', { image: 'AAAA', mimeType: 'image/jpeg' }],
    ['a type that is not a photo', { image: PHOTO, mimeType: 'application/pdf' }],
    ['no type', { image: PHOTO }],
    ['a body that is not an object', '"just a string"'],
  ])('refuses %s without asking anyone', async (_label, body) => {
    const { deps, calls } = world();
    const response = await handle(request(body), deps);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('bad_request');
    expect(calls).toEqual([]);
  });

  it('refuses a photo past the size bound, by its length and before parsing it', async () => {
    const { deps, calls } = world();
    const response = await handle(
      request({ image: 'A'.repeat(MAX_IMAGE_BASE64 + 5000), mimeType: 'image/jpeg' }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toBe('image_too_large');
    expect(calls).toEqual([]);
  });
});

describe('the daily limit', () => {
  it('counts the scan as the caller, before the model is asked', async () => {
    const { deps, calls } = world();
    await handle(request(), deps);

    const order = calls.map((call) =>
      call.url.endsWith('/auth/v1/user')
        ? 'auth'
        : call.url.endsWith('/rest/v1/food_scans')
          ? 'count'
          : 'model',
    );
    expect(order).toEqual(['auth', 'count', 'model']);

    const count = calls.find((call) => call.url.endsWith('/rest/v1/food_scans'))!;
    expect(count.init?.method).toBe('POST');
    // The caller's token, not a service key: the row is theirs under row level security.
    expect(new Headers(count.init?.headers).get('Authorization')).toBe('Bearer user-token');
    // And no owner or time in the body — the table's trigger sets both.
    expect(count.init?.body).toBe('{}');
  });

  it('stops at the limit without asking the model', async () => {
    const { deps, calls } = world({
      count: { status: 400, body: { code: 'P0001', message: 'scan_limit' } },
    });
    const response = await handle(request(), deps);
    expect(response.status).toBe(429);
    expect(await errorOf(response)).toBe('daily_limit');
    expect(modelCalls(calls)).toEqual([]);
  });

  it('refuses to scan at all when the table is missing, rather than scan without a limit', async () => {
    for (const count of [
      { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } },
      { status: 400, body: { code: '42P01', message: 'relation does not exist' } },
    ]) {
      const { deps, calls } = world({ count });
      const response = await handle(request(), deps);
      expect(await errorOf(response)).toBe('not_set_up');
      expect(modelCalls(calls)).toEqual([]);
    }
  });

  it('does not scan when the count could not be written for any other reason', async () => {
    const { deps, calls } = world({ count: { status: 500, body: {} } });
    const response = await handle(request(), deps);
    expect(await errorOf(response)).toBe('server_error');
    expect(modelCalls(calls)).toEqual([]);
  });
});

describe('when it is not set up', () => {
  it('says so when there is no key, and asks nobody', async () => {
    const { deps, calls } = world({ env: { GEMINI_API_KEY: undefined } });
    const response = await handle(request(), deps);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('not_set_up');
    expect(calls).toEqual([]);
  });
});

describe('which model answers', () => {
  it('moves on to the next model when one is out of free quota', async () => {
    const { deps, calls } = world({
      models: { [DEFAULT_MODELS[0]!]: { status: 429 }, [DEFAULT_MODELS[1]!]: reply(MEAL) },
    });
    const response = await handle(request(), deps);
    expect(response.status).toBe(200);
    expect(modelCalls(calls).map((call) => /models\/([^:]+):/.exec(call.url)![1])).toEqual([
      DEFAULT_MODELS[0],
      DEFAULT_MODELS[1],
    ]);
  });

  it('moves on from a model Google no longer serves, one that is down, and one that hangs up', async () => {
    const { deps } = world({
      models: {
        [DEFAULT_MODELS[0]!]: { status: 404 },
        [DEFAULT_MODELS[1]!]: 'throw',
        [DEFAULT_MODELS[2]!]: reply(MEAL),
      },
    });
    expect((await handle(request(), deps)).status).toBe(200);

    const down = world({
      models: { [DEFAULT_MODELS[0]!]: { status: 503 }, [DEFAULT_MODELS[1]!]: reply(MEAL) },
    });
    expect((await handle(request(), down.deps)).status).toBe(200);
  });

  it('says the model is busy when every one of them is out', async () => {
    const { deps } = world({
      models: Object.fromEntries(DEFAULT_MODELS.map((model) => [model, { status: 429 }])),
    });
    const response = await handle(request(), deps);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('ai_busy');
  });

  it('uses the models named in the secret instead, in that order', async () => {
    const { deps, calls } = world({
      env: { GEMINI_MODELS: ' gemini-x , gemini-y ' },
      models: { 'gemini-x': { status: 429 }, 'gemini-y': reply(MEAL) },
    });
    expect((await handle(request(), deps)).status).toBe(200);
    expect(modelCalls(calls).map((call) => /models\/([^:]+):/.exec(call.url)![1])).toEqual([
      'gemini-x',
      'gemini-y',
    ]);
  });

  it('does not try another model when this one refused the request itself', async () => {
    // A 400 is about what was sent, and the next model would be sent the same thing.
    const { deps, calls } = world({
      models: { [DEFAULT_MODELS[0]!]: { status: 400 }, [DEFAULT_MODELS[1]!]: reply(MEAL) },
    });
    const response = await handle(request(), deps);
    expect(await errorOf(response)).toBe('server_error');
    expect(modelCalls(calls)).toHaveLength(1);
  });
});

describe('what the model says is not taken on trust', () => {
  it('says a blocked photo could not be read', async () => {
    const { deps } = world({
      models: {
        [DEFAULT_MODELS[0]!]: { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } },
      },
    });
    const response = await handle(request(), deps);
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toBe('not_readable');
  });

  it('says an empty reply and a reply that is not JSON could not be read', async () => {
    for (const body of [
      { candidates: [] },
      { candidates: [{ content: { parts: [{ text: 'I think this is rice.' }] } }] },
      { candidates: [{ content: { parts: [{ text: '[1, 2, 3]' }] } }] },
    ]) {
      const { deps } = world({ models: { [DEFAULT_MODELS[0]!]: { status: 200, body } } });
      expect(await errorOf(await handle(request(), deps))).toBe('not_readable');
    }
  });

  it('leaves out the model’s shown reasoning, which is not part of the answer', async () => {
    const { deps } = world({
      models: {
        [DEFAULT_MODELS[0]!]: reply(MEAL, [{ thought: true, text: 'Let me look at the plate…' }]),
      },
    });
    const response = await handle(request(), deps);
    expect(FoodScanResultSchema.parse(await response.json()).items).toHaveLength(2);
  });

  it('drops an item it cannot use and keeps the rest', () => {
    const result = readEstimate(
      JSON.stringify({
        is_food: true,
        confidence: 'high',
        items: [
          { name: 'Rice', grams: 180, calories: 234, protein_g: 4, carbs_g: 51, fat_g: 0.5 },
          { name: '', grams: 100, calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
          { name: 'No portion', grams: 0, calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
          { name: 'Negative', grams: 50, calories: 10, protein_g: -3, carbs_g: 1, fat_g: 1 },
          { name: 'Missing macro', grams: 50, calories: 10, protein_g: 1, carbs_g: 1 },
          'not an object',
          null,
        ],
      }),
    );
    expect(result?.items.map((item) => item.name)).toEqual(['Rice']);
  });

  it('holds every number inside the bounds the phone accepts', () => {
    const result = readEstimate(
      JSON.stringify({
        is_food: true,
        confidence: 'high',
        items: [
          {
            name: 'x'.repeat(300),
            grams: 999999,
            calories: 999999,
            protein_g: 999999,
            carbs_g: 999999,
            fat_g: 999999,
          },
        ],
      }),
    );
    expect(result?.items[0]).toEqual({
      name: 'x'.repeat(FOOD_SCAN_LIMITS.nameLength),
      grams: FOOD_SCAN_LIMITS.grams,
      calories: FOOD_SCAN_LIMITS.calories,
      proteinG: FOOD_SCAN_LIMITS.macroGrams,
      carbsG: FOOD_SCAN_LIMITS.macroGrams,
      fatG: FOOD_SCAN_LIMITS.macroGrams,
    });
    expect(FoodScanResultSchema.safeParse(result).success).toBe(true);
  });

  it('keeps no more items than the phone accepts', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      name: `Item ${index}`,
      grams: 10,
      calories: 10,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 0,
    }));
    const result = readEstimate(JSON.stringify({ is_food: true, confidence: 'low', items }));
    expect(result?.items).toHaveLength(FOOD_SCAN_LIMITS.maxItems);
    expect(FoodScanResultSchema.safeParse(result).success).toBe(true);
  });

  it('works the calories out from the macros when the model left them out', () => {
    const result = readEstimate(
      JSON.stringify({
        is_food: true,
        confidence: 'medium',
        items: [{ name: 'Egg', grams: 50, calories: 0, protein_g: 6, carbs_g: 0.5, fat_g: 5 }],
      }),
    );
    // 6 × 4 + 0.5 × 4 + 5 × 9
    expect(result?.items[0]?.calories).toBe(71);
  });

  it('keeps the calories the model gave, even where the macros do not add up to them', () => {
    // A beer: the calories are mostly alcohol, which is none of the three.
    const result = readEstimate(
      JSON.stringify({
        is_food: true,
        confidence: 'medium',
        items: [{ name: 'Beer', grams: 330, calories: 140, protein_g: 1, carbs_g: 11, fat_g: 0 }],
      }),
    );
    expect(result?.items[0]?.calories).toBe(140);
  });

  it('reads numbers the model wrote as text, and rounds to one decimal', () => {
    const result = readEstimate(
      JSON.stringify({
        is_food: true,
        confidence: 'medium',
        items: [
          {
            name: 'Yoghurt',
            grams: '150',
            calories: '89.96',
            protein_g: 5.249,
            carbs_g: 7,
            fat_g: 4.5,
          },
        ],
      }),
    );
    expect(result?.items[0]).toEqual({
      name: 'Yoghurt',
      grams: 150,
      calories: 90,
      proteinG: 5.2,
      carbsG: 7,
      fatG: 4.5,
    });
  });

  it('treats a confidence it does not recognise as low', () => {
    expect(
      readEstimate(JSON.stringify({ is_food: true, confidence: 'certain', items: [] }))?.confidence,
    ).toBe('low');
    expect(readEstimate(JSON.stringify({ is_food: true, items: [] }))?.confidence).toBe('low');
  });

  it('is not an estimate when there is no list of items', () => {
    expect(readEstimate(JSON.stringify({ is_food: true, confidence: 'high' }))).toBeNull();
    expect(readEstimate('null')).toBeNull();
    expect(readEstimate('')).toBeNull();
  });
});
