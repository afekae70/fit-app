/**
 * The AI coach, as one of the two jobs of the Supabase function (`main.ts`).
 *
 * ## Why the coach is here as well
 *
 * It was built as a route on the Fastify service (`routes/coach.ts`), which is where the
 * app's LLM key was meant to live. That service costs money to keep running and has been
 * left switched off, which switched the coach off with it. The meal scan was put on Supabase
 * so that it would cost nothing; the coach is asked to cost nothing too, and nothing about it
 * needs a server of its own — it reads no database. The phone sends a digest of the athlete
 * and the conversation so far, and this passes them to the model and streams the answer back.
 *
 * So this is the same coach: the same persona and context (`ai/context.ts`), the same request
 * the phone already sends (`coachChatRequestSchema`), the same two proposal tools, and the
 * same event stream going back — `delta`, `plan_proposal`, `nutrition_proposal`, `refusal`,
 * `error`, `done` — which is why the app needed its base URL changed and nothing else.
 *
 * ## What is different
 *
 *  - **Gemini over plain HTTP, not through Google's SDK.** The function is deployed as one
 *    pasted file, and the SDK is most of a megabyte of it. The request it would have made is
 *    made here by hand; `ai/gemini-schema.ts` is shared with the SDK path so the two agree on
 *    what a schema and a refusal are.
 *  - **A list of models, not one.** On the free tier each model has its own daily allowance.
 *    One that is out — or unknown, or down — hands on to the next, as long as nothing has
 *    been said yet: a second model cannot continue the first one's sentence.
 *  - **A daily limit per account** (drizzle/0016), for the reason the scan has one: the
 *    allowance is shared by everyone, and the key that reaches this function is public.
 *
 * ## What it refuses, in order
 *
 * No token; a request that is not a coach request; a digest with nothing in it (the model
 * would answer confidently about nobody); no key; a token that is not a signed-in person; an
 * account past its day. Only then is the model asked. Nothing is stored — not the digest, not
 * the question, not the answer — only that a turn was taken, and when.
 */

import {
  aiNutritionMenuSchema,
  aiWorkoutPlanSchema,
  coachChatRequestSchema,
  PROPOSE_NUTRITION_MENU_TOOL,
  PROPOSE_WORKOUT_PLAN_TOOL,
  type CoachChatRequest,
} from '@fit/shared/schemas';

import { COACH_PERSONA, hasUsableContext, renderContext } from '../ai/context.js';
import { REFUSAL_FINISH_REASONS, toGeminiSchema } from '../ai/gemini-schema.js';
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

/**
 * The largest request accepted, in characters. Forty messages of eight thousand characters is
 * the schema's own ceiling; this is that and room for the digest, refused by length before
 * anything is parsed.
 */
export const MAX_COACH_BODY = 400_000;

/** How long a model is given to start answering before the next one is tried. */
const FIRST_BYTE_TIMEOUT_MS = 45_000;

export type CoachError =
  | 'sign_in_required'
  | 'invalid_request'
  | 'request_too_large'
  | 'insufficient_context'
  | 'daily_limit'
  | 'ai_busy'
  | 'not_set_up'
  | 'age_restricted'
  | 'age_unknown'
  | 'server_error';

const STATUS: Record<CoachError, number> = {
  sign_in_required: 401,
  invalid_request: 400,
  request_too_large: 413,
  insufficient_context: 422,
  daily_limit: 429,
  ai_busy: 503,
  not_set_up: 503,
  age_restricted: 403,
  age_unknown: 403,
  server_error: 500,
};

/**
 * A sentence for each, in English. The phone says them in its own language by the code; this
 * is what an older build of the app, which shows the server's words, falls back on.
 */
const MESSAGE: Record<CoachError, string> = {
  sign_in_required: 'Sign in to ask the coach.',
  invalid_request: 'The coach could not read that request.',
  request_too_large: 'That conversation is too long to send. Start a new one.',
  insufficient_context: 'Log a workout or a bodyweight measurement before asking the coach.',
  daily_limit: 'You have reached the number of coach messages for today.',
  ai_busy: 'The coach is busy right now. Try again in a few minutes.',
  not_set_up: 'The coach has not been switched on in the server yet.',
  age_restricted: 'The AI coach is for ages 18 and over.',
  age_unknown: 'Add your date of birth to your profile to use the AI coach.',
  server_error: 'The coach is unavailable.',
};

const refuse = (error: CoachError, extra: Record<string, unknown> = {}) =>
  jsonResponse({ error, message: MESSAGE[error], ...extra }, STATUS[error]);

/* ------------------------------------------------------------------------------------ */
/* What Gemini is sent                                                                   */
/* ------------------------------------------------------------------------------------ */

/**
 * The two proposal tools, in Gemini's shape. `parametersJsonSchema` is the field that takes a
 * plain JSON Schema, which is what the shared package hands over.
 */
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: PROPOSE_WORKOUT_PLAN_TOOL.name,
        description: PROPOSE_WORKOUT_PLAN_TOOL.description,
        parametersJsonSchema: toGeminiSchema(PROPOSE_WORKOUT_PLAN_TOOL.input_schema),
      },
      {
        name: PROPOSE_NUTRITION_MENU_TOOL.name,
        description: PROPOSE_NUTRITION_MENU_TOOL.description,
        parametersJsonSchema: toGeminiSchema(PROPOSE_NUTRITION_MENU_TOOL.input_schema),
      },
    ],
  },
];

/** The request body for one turn. Exported so a test can read exactly what would be sent. */
export function geminiRequest({ context, messages }: CoachChatRequest): Record<string, unknown> {
  return {
    // Persona then athlete, blank line between — the order `ai/gemini-provider.ts` keeps, and
    // for its reason: the stable text stays at the front.
    systemInstruction: { parts: [{ text: `${COACH_PERSONA}\n\n${renderContext(context)}` }] },
    // `assistant` is this codebase's word for it; Gemini's is `model`.
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    tools: TOOLS,
    generationConfig: { maxOutputTokens: 4096 },
  };
}

/* ------------------------------------------------------------------------------------ */
/* What Gemini sends back                                                                */
/* ------------------------------------------------------------------------------------ */

interface GeminiPart {
  text?: string;
  /** The model's shown reasoning, when it shows any. Not part of the answer. */
  thought?: boolean;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

export interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * The JSON objects in a server-sent event stream, one at a time.
 *
 * Events are separated by a blank line and carry their payload on `data:` lines. A network
 * chunk can end anywhere — mid-line, mid-character — so bytes are decoded as a stream and
 * only whole events are parsed. An event that is not JSON is skipped rather than fatal: a
 * keep-alive comment is not an error.
 */
export async function* eventsOf(body: ReadableStream<Uint8Array>): AsyncGenerator<GeminiChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parse = (block: string): GeminiChunk | null => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '') return null;
    try {
      return JSON.parse(data) as GeminiChunk;
    } catch {
      return null;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const end = /\r?\n\r?\n/.exec(buffer);
        if (!end) break;
        const chunk = parse(buffer.slice(0, end.index));
        buffer = buffer.slice(end.index + end[0].length);
        if (chunk) yield chunk;
      }
    }
    // Whatever was left when the stream ended without a closing blank line.
    const last = parse(buffer + decoder.decode());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/** What goes back to the phone, before it is framed as an event. */
export type CoachEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'plan_proposal'; data: { plan: unknown } }
  | { event: 'nutrition_proposal'; data: { menu: unknown } }
  | { event: 'refusal'; data: { category: string | null } }
  | { event: 'error'; data: { message: string; code: string } }
  | { event: 'done'; data: Record<string, never> };

/**
 * A proposal the model made, validated against the schema its tool was declared from.
 *
 * Not trusted: a schema shown to a model is not a schema it always obeys, and an unvalidated
 * plan reaching the phone would be a card the person could apply to their training with fields
 * nothing had checked. Throws on a bad one, as the SDK path does — the turn then ends in an
 * error the phone can show, rather than in prose about a card that never arrived.
 */
function proposalFrom(call: { name?: string; args?: Record<string, unknown> }): CoachEvent | null {
  // A call with no name is not something to parse; skipping beats throwing on a shape the
  // model is not supposed to be able to produce.
  if (!call.name) return null;
  if (call.name === PROPOSE_WORKOUT_PLAN_TOOL.name) {
    return {
      event: 'plan_proposal',
      data: { plan: aiWorkoutPlanSchema.parse(call.args ?? {}) },
    };
  }
  if (call.name === PROPOSE_NUTRITION_MENU_TOOL.name) {
    return {
      event: 'nutrition_proposal',
      data: { menu: aiNutritionMenuSchema.parse(call.args ?? {}) },
    };
  }
  throw new Error(`Unknown tool call from model: ${call.name}`);
}

/**
 * One model's answer as the events the phone understands.
 *
 * The verdict is read after the last chunk, not thrown from inside the loop: a refusal can
 * land after some prose has already gone out, and the phone needs to learn the answer was cut
 * short rather than never begun.
 */
export async function* answerFrom(chunks: AsyncIterable<GeminiChunk>): AsyncGenerator<CoachEvent> {
  let finishReason: string | undefined;
  let blockReason: string | undefined;

  for await (const chunk of chunks) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.functionCall) {
        const proposal = proposalFrom(part.functionCall);
        if (proposal) yield proposal;
      } else if (part.thought !== true && typeof part.text === 'string' && part.text !== '') {
        // An empty text part would put a no-op through the stream and, on the phone, look
        // briefly like the coach said nothing.
        yield { event: 'delta', data: { text: part.text } };
      }
    }
    finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
    blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
  }

  // A blocked prompt never produces a candidate, so it is reported on its own field.
  if (blockReason) {
    yield { event: 'refusal', data: { category: blockReason } };
  } else if (finishReason && REFUSAL_FINISH_REASONS.has(finishReason)) {
    yield { event: 'refusal', data: { category: finishReason } };
  } else {
    yield { event: 'done', data: {} };
  }
}

/* ------------------------------------------------------------------------------------ */
/* Asking a model                                                                        */
/* ------------------------------------------------------------------------------------ */

type Opened =
  | { kind: 'answer'; chunks: AsyncIterable<GeminiChunk> }
  /** Out of quota, unknown or down: the following model is worth trying. */
  | { kind: 'next' }
  /** Refused the request itself; the next model would be sent the same thing. */
  | { kind: 'failed'; code: string };

async function post(
  deps: EdgeDeps,
  key: string,
  model: string,
  method: 'streamGenerateContent?alt=sse' | 'generateContent',
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  return deps.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`,
    {
      method: 'POST',
      // In a header, never in the URL: URLs are what end up in logs.
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body,
      signal,
    },
  );
}

/**
 * Start one model answering.
 *
 * Streaming first. Not every key can reach the streaming method — Google answers 404 for a
 * method a model does not offer exactly as it does for a model that does not exist — so a 404
 * there is followed by the plain method on the same model, whose whole answer then arrives as
 * a single chunk. Only if that is missing too is the model itself written off.
 */
async function open(
  deps: EdgeDeps,
  key: string,
  model: string,
  body: string,
  hangUp: AbortSignal,
): Promise<Opened> {
  // Given up on if it has not started answering in time; left alone once it has. The same
  // controller is what ends the request when the phone hangs up — at any point, which is why
  // that listener is never taken off again: an answer is still being read long after this
  // function has returned it.
  const controller = new AbortController();
  hangUp.addEventListener('abort', () => controller.abort());
  const timer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);

  const worthAnother = (status: number) => status === 429 || status >= 500;

  try {
    const streamed = await post(
      deps,
      key,
      model,
      'streamGenerateContent?alt=sse',
      body,
      controller.signal,
    );
    if (streamed.ok && streamed.body) {
      return { kind: 'answer', chunks: eventsOf(streamed.body) };
    }
    const whyNot = await googleErrorCode(streamed);
    deps.log?.(`[coach] ${model} (streaming): ${whyNot}`);
    if (worthAnother(streamed.status)) return { kind: 'next' };
    if (streamed.status !== 404) return { kind: 'failed', code: whyNot };

    const whole = await post(deps, key, model, 'generateContent', body, controller.signal);
    if (whole.ok) {
      const chunk = (await whole.json()) as GeminiChunk;
      return {
        kind: 'answer',
        chunks: (async function* single() {
          yield chunk;
        })(),
      };
    }
    const whyNeither = await googleErrorCode(whole);
    deps.log?.(`[coach] ${model}: ${whyNeither}`);
    if (whole.status === 404 || worthAnother(whole.status)) return { kind: 'next' };
    return { kind: 'failed', code: whyNeither };
  } catch {
    // A timeout or a dropped connection before anything was said. The next may well answer.
    deps.log?.(`[coach] ${model}: no answer`);
    return { kind: 'next' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------------------ */
/* The function                                                                          */
/* ------------------------------------------------------------------------------------ */

/** A server-sent event. The blank line ends it — without it the phone waits for more. */
const frame = ({ event, data }: CoachEvent) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function handleCoach(request: Request, deps: EdgeDeps): Promise<Response> {
  if (request.method !== 'POST') return refuse('invalid_request');

  const token = bearerToken(request);
  if (!token) return refuse('sign_in_required');

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return refuse('invalid_request');
  }
  if (raw.length > MAX_COACH_BODY) return refuse('request_too_large');

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse('invalid_request');
  }
  const parsed = coachChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return refuse('invalid_request', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  // Refused before spending a request. A model handed an all-null digest produces confident
  // generic advice that reads as personal while being about nobody.
  if (!hasUsableContext(parsed.data.context)) return refuse('insufficient_context');

  const key = deps.env('GEMINI_API_KEY');
  if (!key) return refuse('not_set_up');

  const userId = await signedInUser(deps, token);
  if (userId === null) return refuse('sign_in_required');

  // Google's Gemini API terms are for 18 and over (see AI_MIN_AGE). Before a turn is counted.
  const age = await ageVerdict(deps, token, userId);
  if (age === 'minor') return refuse('age_restricted');
  if (age === 'unknown') return refuse('age_unknown');
  if (age === 'server_error') return refuse('server_error');

  // A row in `coach_turns`, whose trigger refuses past the day's allowance (drizzle/0016).
  const counted = await countAgainstLimit(deps, token, 'coach_turns', 'coach_limit');
  if (counted !== 'ok') return refuse(counted);

  const hangUp = new AbortController();
  const payload = JSON.stringify(geminiRequest(parsed.data));

  let opened: Opened = { kind: 'next' };
  for (const model of modelsToTry(deps)) {
    opened = await open(deps, key, model, payload, hangUp.signal);
    if (opened.kind !== 'next') break;
  }
  // Every model was out of quota or unreachable — said as a status, since nothing has been
  // streamed yet and the phone can still be told plainly.
  if (opened.kind === 'next') return refuse('ai_busy');
  if (opened.kind === 'failed') return refuse('server_error', { code: opened.code });

  const answer = answerFrom(opened.chunks);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await answer.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(frame(next.value)));
      } catch (error) {
        // After the stream has opened there is no status left to send, so a failure is an
        // event: the phone must learn that the text it has is truncated, not complete. What
        // kind of failure goes to the log, by name only — an error's message can quote the
        // model, and the model was quoting the person.
        deps.log?.(`[coach] answer failed: ${error instanceof Error ? error.name : 'unknown'}`);
        controller.enqueue(
          encoder.encode(
            frame({
              event: 'error',
              data: { message: MESSAGE.server_error, code: 'server_error' },
            }),
          ),
        );
        controller.close();
      }
    },
    // The phone hanging up mid-answer is routine — a backgrounded app, a screen left — and
    // the model should stop being paid attention to when nobody is reading.
    cancel() {
      hangUp.abort();
      void answer.return(undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      // Proxies buffer by default, which defeats streaming: nothing arrives until it is over.
      'X-Accel-Buffering': 'no',
    },
  });
}
