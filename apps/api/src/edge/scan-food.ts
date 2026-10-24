/**
 * Reading a photographed meal: a photo in, an estimate of what is on the plate out. One of the
 * two jobs of the Supabase function (`main.ts`); the other is the coach (`coach.ts`).
 *
 * ## Why this is here and not in the Fastify service
 *
 * The app keeps its LLM key on a server because a key inside an app bundle belongs to anyone
 * who installs the app. That server is `apps/api`, and it costs money to keep running. This
 * one feature is asked to cost nothing, so it runs where the project already has a free
 * allowance: as a function on Supabase, holding a Gemini key on Google's free tier. The key is
 * still never in the app.
 *
 * ## Web standards only
 *
 * It uses only what every modern runtime has (`fetch`, `Request`, `Response`) and is handed
 * its environment rather than reaching for it, which is what lets the API workspace typecheck
 * it and run it under vitest, with a fake `fetch`, without a Deno in sight. What is deployed
 * is a bundle of this and its neighbours — see `scripts/build-edge.mjs`.
 *
 * The contract it answers to is `packages/shared/src/schemas/foodScan.ts`. The bounds are
 * repeated below rather than imported, so that this half does not pull a validation library
 * into the bundle for five numbers; `scan-food.test.ts` validates what this produces against
 * the shared schema, which is what keeps the two from drifting.
 *
 * ## What it refuses, in order
 *
 *  1. Anyone not signed in. Each scan spends quota, and the anon key that reaches this
 *     function is public — it ships in the app and sits in a public repository.
 *  2. A request that is not a reasonably sized photo.
 *  3. An account past its daily number of scans. That is a row inserted into `food_scans`,
 *     whose trigger (drizzle/0015) counts and refuses; the limit lives in the database, where
 *     a client cannot argue with it.
 *
 * Only then is the model asked. Nothing is stored: the photo is passed on and forgotten, and
 * the answer goes back to the phone, which shows it for review. This function never writes to
 * anybody's food log.
 *
 * ## Secrets it needs (Supabase dashboard → Edge Functions → Secrets)
 *
 *   GEMINI_API_KEY   a key from Google AI Studio, with no billing account attached
 *   GEMINI_MODELS    optional: comma-separated model ids to try, in order
 *
 * `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by Supabase.
 */

import {
  bearerToken,
  ageVerdict,
  countAgainstLimit,
  googleErrorCode,
  jsonResponse,
  modelsToTry,
  signedInUser,
  type EdgeDeps,
} from './shared.js';

export { DEFAULT_MODELS } from './shared.js';

/* ------------------------------------------------------------------------------------ */
/* Bounds — the same as FOOD_SCAN_LIMITS in packages/shared                              */
/* ------------------------------------------------------------------------------------ */

const LIMITS = {
  maxItems: 12,
  nameLength: 80,
  grams: 2000,
  calories: 5000,
  macroGrams: 500,
} as const;

/**
 * The largest photo accepted, as base64 characters: about 4.5 MB of image. The phone sends a
 * compressed JPEG a fraction of this size; the bound is for a client that is not the phone.
 */
export const MAX_IMAGE_BASE64 = 6_000_000;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** How long the model is given before the phone is told to try again. */
const MODEL_TIMEOUT_MS = 40_000;

export type ScanError =
  | 'sign_in_required'
  | 'bad_request'
  | 'image_too_large'
  | 'daily_limit'
  | 'ai_busy'
  | 'not_readable'
  | 'not_set_up'
  | 'age_restricted'
  | 'age_unknown'
  | 'server_error';

export interface ScanItem {
  name: string;
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface ScanResult {
  items: ScanItem[];
  confidence: 'low' | 'medium' | 'high';
}

/** What the scan reaches outside itself for. The same as the coach's. */
export type ScanDeps = EdgeDeps;

/* ------------------------------------------------------------------------------------ */
/* The prompt                                                                            */
/* ------------------------------------------------------------------------------------ */

export function promptFor(language: 'he' | 'en'): string {
  const tongue = language === 'he' ? 'Hebrew' : 'English';
  return [
    'You estimate the nutrition of a meal from one photograph.',
    '',
    'List each distinct food or drink you can see. For each one give:',
    '- name: a short everyday name, written in ' + tongue + ';',
    '- grams: your best estimate of the portion shown, in grams;',
    '- calories, protein_g, carbs_g, fat_g: for THAT portion, not per 100 g.',
    '',
    'Rules:',
    '- Use typical values for the food as it appears to be prepared. Count the oil, butter,',
    '  dressing or sauce a dish is visibly cooked or served with as part of that dish.',
    '- When the portion cannot be judged, assume one ordinary serving.',
    '- Merge garnishes and trivial amounts into the dish they are on. At most 12 items.',
    '- Do not invent food that is not visible. Packaging with a readable label may be used.',
    '- If the photograph does not show food or drink, set is_food to false and list nothing.',
    '- confidence is "high" only when both the foods and their portions are clear; "low" when',
    '  the photo is dark, partial, or the dish could be several different things.',
  ].join('\n');
}

/** The shape the model is held to. Gemini's own schema dialect, with its upper-case types. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_food: { type: 'BOOLEAN' },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          calories: { type: 'NUMBER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
      },
    },
  },
  required: ['is_food', 'confidence', 'items'],
} as const;

/* ------------------------------------------------------------------------------------ */
/* Reading the model's answer                                                            */
/* ------------------------------------------------------------------------------------ */

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A finite number within bounds, or null. The model is asked for numbers; it is not trusted to send them. */
function bounded(value: unknown, min: number, max: number): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min) return null;
  return round1(Math.min(number, max));
}

/**
 * The model's reply as a result the phone can use, or null when it is not an estimate at all.
 *
 * Defended rather than trusted. The schema above is enforced by Gemini for shapes it can
 * express and is a strong hint otherwise; a value out of range, a missing field or a stray
 * item is dropped here rather than passed on, and one bad item does not cost the others.
 */
export function readEstimate(text: string): ScanResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const reply = parsed as Record<string, unknown>;

  const confidence =
    reply.confidence === 'high' || reply.confidence === 'medium' ? reply.confidence : 'low';

  // Not food: an answer, and an empty one.
  if (reply.is_food === false) return { items: [], confidence };
  if (!Array.isArray(reply.items)) return null;

  const items: ScanItem[] = [];
  for (const raw of reply.items as unknown[]) {
    if (items.length >= LIMITS.maxItems) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;

    const name = typeof item.name === 'string' ? item.name.trim().slice(0, LIMITS.nameLength) : '';
    const grams = bounded(item.grams, 1, LIMITS.grams);
    const proteinG = bounded(item.protein_g, 0, LIMITS.macroGrams);
    const carbsG = bounded(item.carbs_g, 0, LIMITS.macroGrams);
    const fatG = bounded(item.fat_g, 0, LIMITS.macroGrams);
    if (name === '' || grams === null || proteinG === null || carbsG === null || fatG === null) {
      continue;
    }

    // Calories the model left out are worked out from what it did give. Calories it gave are
    // kept as given: alcohol and fibre mean the three macros need not add up to them.
    const fromMacros = round1(proteinG * 4 + carbsG * 4 + fatG * 9);
    const stated = bounded(item.calories, 0, LIMITS.calories);
    const calories = stated !== null && stated > 0 ? stated : Math.min(fromMacros, LIMITS.calories);

    items.push({ name, grams, calories, proteinG, carbsG, fatG });
  }

  return { items, confidence };
}

/* ------------------------------------------------------------------------------------ */
/* Asking the model                                                                     */
/* ------------------------------------------------------------------------------------ */

/** Ask one model. A result, or why not — `next` meaning the following model is worth trying. */
async function askModel(
  deps: ScanDeps,
  key: string,
  model: string,
  image: string,
  mimeType: string,
  language: 'he' | 'en',
): Promise<ScanResult | 'next' | 'not_readable' | 'server_error'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await deps.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        // In a header, never in the URL: URLs are what end up in logs.
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inline_data: { mime_type: mimeType, data: image } },
                { text: promptFor(language) },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );

    if (!response.ok) deps.log?.(`[scan] ${model}: ${await googleErrorCode(response)}`);
    // Out of free quota on this model, or a model id Google no longer serves: try the next.
    if (response.status === 429 || response.status === 404) return 'next';
    // Overloaded or briefly down: also worth the next model.
    if (response.status >= 500) return 'next';
    if (!response.ok) return 'server_error';

    const body = (await response.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    };
    if (body.promptFeedback?.blockReason) return 'not_readable';

    // The answer, without any reasoning the model showed on the way to it.
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (text.trim() === '') return 'not_readable';

    return readEstimate(text) ?? 'not_readable';
  } catch {
    // A timeout or a dropped connection. The next model may well answer.
    deps.log?.(`[scan] ${model}: no answer`);
    return 'next';
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------------------ */
/* The function                                                                          */
/* ------------------------------------------------------------------------------------ */

const STATUS: Record<ScanError, number> = {
  sign_in_required: 401,
  bad_request: 400,
  image_too_large: 413,
  daily_limit: 429,
  ai_busy: 503,
  not_readable: 422,
  not_set_up: 503,
  age_restricted: 403,
  age_unknown: 403,
  server_error: 500,
};

const refuse = (error: ScanError) => jsonResponse({ error }, STATUS[error]);

export async function handle(request: Request, deps: ScanDeps): Promise<Response> {
  if (request.method !== 'POST') return refuse('bad_request');

  const token = bearerToken(request);
  if (!token) return refuse('sign_in_required');

  // Read as text first, so an oversized body is refused by its length before it is parsed.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return refuse('bad_request');
  }
  // The JSON around the image is a few dozen characters; anything much past the image bound
  // is an image past the bound.
  if (raw.length > MAX_IMAGE_BASE64 + 1024) return refuse('image_too_large');

  let body: { image?: unknown; mimeType?: unknown; language?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return refuse('bad_request');
  }
  if (typeof body !== 'object' || body === null) return refuse('bad_request');

  const image = typeof body.image === 'string' ? body.image : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  if (image.length < 100 || !IMAGE_TYPES.has(mimeType) || !/^[A-Za-z0-9+/]+=*$/.test(image)) {
    return refuse('bad_request');
  }
  if (image.length > MAX_IMAGE_BASE64) return refuse('image_too_large');
  const language = body.language === 'en' ? 'en' : 'he';

  const key = deps.env('GEMINI_API_KEY');
  if (!key) return refuse('not_set_up');

  const userId = await signedInUser(deps, token);
  if (userId === null) return refuse('sign_in_required');

  // Google's Gemini API terms are for 18 and over (see AI_MIN_AGE). Before a scan is counted.
  const age = await ageVerdict(deps, token, userId);
  if (age === 'minor') return refuse('age_restricted');
  if (age === 'unknown') return refuse('age_unknown');
  if (age === 'server_error') return refuse('server_error');

  // A row in `food_scans`, whose trigger refuses the forty-first of the day (drizzle/0015).
  const counted = await countAgainstLimit(deps, token, 'food_scans', 'scan_limit');
  if (counted !== 'ok') return refuse(counted);

  for (const model of modelsToTry(deps)) {
    const answer = await askModel(deps, key, model, image, mimeType, language);
    if (answer === 'next') continue;
    if (answer === 'not_readable' || answer === 'server_error') return refuse(answer);
    return jsonResponse(answer, 200);
  }
  // Every model was out of quota or unreachable.
  return refuse('ai_busy');
}
