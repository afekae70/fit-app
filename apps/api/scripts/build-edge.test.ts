/**
 * The file that is pasted into Supabase, tested as that file.
 *
 * Everything in `src/edge/*.test.ts` runs the sources. What runs on Supabase is the bundle
 * made from them, and a bundle can differ from its sources in the ways that matter here: it
 * can be stale, it can have swallowed something that only exists in Node, and it can have
 * lost the export or the start-up line in the folding. So the committed file is checked for
 * being current, and then imported and asked real questions.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bundleEdge, EDGE_BUNDLE } from './build-edge.js';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Line endings are whatever the checkout made them; the code is the same either way.
const committed = readFileSync(path.join(API_ROOT, EDGE_BUNDLE), 'utf8').replace(/\r\n/g, '\n');

interface Deps {
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
}
type Route = (request: Request, deps: Deps) => Promise<Response>;

async function bundled(): Promise<Route> {
  // Through a variable, so that neither the compiler nor the bundler tries to follow it: the
  // point is to load the file as Supabase would, not to have it compiled in with the tests.
  const where = `../${EDGE_BUNDLE}`;
  const module = (await import(/* @vite-ignore */ where)) as { route: Route };
  return module.route;
}

const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  GEMINI_API_KEY: 'gemini-key',
};

/** Auth says yes, the caller is an adult, the count says yes, and the first model answers. */
function services(answer: (url: string) => Response, birthDate: string | null = '1990-05-01') {
  const asked: string[] = [];
  const fake = ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return Promise.resolve(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }));
    }
    if (url.includes('/rest/v1/profiles?')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ birth_date: birthDate }]), { status: 200 }),
      );
    }
    if (url.includes('/rest/v1/')) return Promise.resolve(new Response(null, { status: 201 }));
    return Promise.resolve(answer(url));
  }) as typeof fetch;
  return { deps: { fetch: fake, env: (name: string) => ENV[name] }, asked };
}

const FUNCTION = 'https://project.supabase.co/functions/v1/smooth-processor';

/** A question the coach accepts, so that what is tested is what comes after the body. */
const COACH_BODY = {
  context: {
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
    exercises: [],
    adherence: [],
    availableEquipment: [],
    planName: null,
  },
  messages: [{ role: 'user', content: 'שלום' }],
};

const MEAL_BODY = { image: 'A'.repeat(600), mimeType: 'image/jpeg' };

const post = (url: string, body: unknown, token: string | null = 'user-token') =>
  new Request(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });

describe('the bundle that is deployed', () => {
  it('is what the sources produce — run `npm run build:edge -w @fit/api` if this fails', async () => {
    expect(committed === (await bundleEdge())).toBe(true);
  });

  it('has nothing in it that only Node has', () => {
    expect(committed).not.toMatch(/from\s+["']node:/);
    expect(committed).not.toMatch(/\brequire\(/);
    expect(committed).not.toMatch(/\bprocess\.(env|argv|cwd)\b/);
    expect(committed).not.toMatch(/\bBuffer\./);
  });

  it('holds no key: only the names of the secrets it will be given', () => {
    expect(committed).toContain('GEMINI_API_KEY');
    // The shapes of a Google key, a JWT and a provider secret key.
    expect(committed).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(committed).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(committed).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}/);
  });

  it('starts itself where there is a Deno, and only there', () => {
    expect(committed).toMatch(/globalThis\.Deno/);
    expect(committed).toMatch(/\.serve\(/);
  });

  it('answers as the coach on the coach’s path', async () => {
    const route = await bundled();
    const said = { candidates: [{ content: { parts: [{ text: 'שלום' }] }, finishReason: 'STOP' }] };
    const { deps, asked } = services(
      () =>
        new Response(`data: ${JSON.stringify(said)}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );

    const response = await route(post(`${FUNCTION}/coach/chat`, COACH_BODY), deps);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      'event: delta\ndata: {"text":"שלום"}\n\nevent: done\ndata: {}\n\n',
    );
    expect(asked.map((url) => new URL(url).pathname)).toEqual([
      '/auth/v1/user',
      '/rest/v1/profiles',
      '/rest/v1/coach_turns',
      expect.stringMatching(/^\/v1beta\/models\/[^:]+:streamGenerateContent$/),
    ]);
  });

  it('still reads a meal on its own address', async () => {
    const route = await bundled();
    const meal = {
      is_food: true,
      confidence: 'medium',
      items: [
        { name: 'אורז לבן', grams: 180, calories: 234, protein_g: 4.3, carbs_g: 51.2, fat_g: 0.5 },
      ],
    };
    const { deps, asked } = services(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(meal) }] } }],
          }),
          { status: 200 },
        ),
    );

    const response = await route(post(FUNCTION, MEAL_BODY), deps);
    expect(asked.map((url) => new URL(url).pathname)).toEqual([
      '/auth/v1/user',
      '/rest/v1/profiles',
      '/rest/v1/food_scans',
      expect.stringMatching(/^\/v1beta\/models\/[^:]+:generateContent$/),
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      confidence: 'medium',
      items: [{ name: 'אורז לבן', grams: 180, calories: 234 }],
    });
  });

  it('turns away someone under 18 on both addresses, before any count or model', async () => {
    const route = await bundled();
    const { deps, asked } = services(() => new Response('{}', { status: 500 }), '2011-03-03');
    for (const [url, body] of [
      [FUNCTION, MEAL_BODY],
      [`${FUNCTION}/coach/chat`, COACH_BODY],
    ] as const) {
      const response = await route(post(url, body), deps);
      expect(response.status, url).toBe(403);
      expect(((await response.json()) as { error: string }).error, url).toBe('age_restricted');
    }
    expect(asked.map((url) => new URL(url).pathname)).toEqual([
      '/auth/v1/user',
      '/rest/v1/profiles',
      '/auth/v1/user',
      '/rest/v1/profiles',
    ]);
  });

  it('turns away a caller with no token on both addresses', async () => {
    const route = await bundled();
    const { deps, asked } = services(() => new Response('{}', { status: 500 }));
    for (const url of [FUNCTION, `${FUNCTION}/coach/chat`]) {
      const response = await route(post(url, {}, null), deps);
      expect(response.status, url).toBe(401);
    }
    expect(asked).toEqual([]);
  });
});
