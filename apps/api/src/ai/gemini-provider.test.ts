/**
 * `GeminiProvider.streamChat` carries the same two things as the Claude path — prose and a
 * proposal — but the risk sits somewhere else entirely.
 *
 * Claude streams a tool's JSON as fragments, so its tests are about accumulation. Gemini hands
 * over a complete `args` object, so nothing can be dropped mid-flight; what can go wrong here is
 * dispatch (the wrong event type for a tool name), validation (an unchecked object reaching the
 * UI as an appliable card), and the refusal mapping — Gemini has no `refusal` verdict, so a
 * decline has to be recognised from a finish reason or a blocked prompt, and getting that wrong
 * either reports a safety block as a server error or, worse, reports a truncated answer as a
 * refusal the user never triggered.
 *
 * The SDK is mocked so all of it runs without a network call.
 */

import { describe, expect, it, vi } from 'vitest';

const generateContentStreamMock = vi.fn();
const generateContentMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: generateContentStreamMock,
      generateContent: generateContentMock,
    },
  })),
}));

import type { CoachContext } from './provider.js';
import { CoachRefusalError } from './provider.js';

// Imported after the mock is registered, matching vi.mock's hoisting contract.
const { GeminiProvider, __toGeminiSchemaForTests: toGeminiSchema } = await import(
  './gemini-provider.js'
);

/** Gemini's stream is a plain async iterable of chunks — no `finalMessage()` equivalent. */
function fakeStream(chunks: unknown[]) {
  return Promise.resolve({
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        next: () =>
          Promise.resolve(
            i < chunks.length
              ? { value: chunks[i++], done: false as const }
              : { value: undefined, done: true as const },
          ),
      };
    },
  });
}

const ctx: CoachContext = { userId: 'u1', systemPrompt: 'persona', userContext: 'context' };

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function makeProvider() {
  return new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
}

const validPlan = {
  planName: 'Push Pull Legs',
  rationale: 'Three-day split hitting each muscle group with enough recovery between sessions.',
  days: [
    {
      name: 'Push',
      exercises: [
        {
          exerciseKey: 'Barbell Bench Press',
          targetSets: 4,
          targetRepsMin: 6,
          targetRepsMax: 10,
          notes: null,
        },
      ],
    },
  ],
};

const validMenu = {
  summary: 'Matches your 2381 kcal cut target within 3%.',
  meals: [
    {
      name: 'Breakfast',
      items: [{ name: 'Oats', grams: 80, kcal: 300, proteinG: 10, carbsG: 54, fatG: 6 }],
    },
  ],
  totalKcal: 300,
  totalProteinG: 10,
  totalCarbsG: 54,
  totalFatG: 6,
};

/** A chunk with no text and no calls — what the final, usage-only chunk looks like. */
const finish = (reason: string) => ({ candidates: [{ finishReason: reason }] });

describe('GeminiProvider construction', () => {
  it('declares both proposal tools on every streamed request', async () => {
    generateContentStreamMock.mockReturnValueOnce(fakeStream([]));
    await drain(makeProvider().streamChat(ctx, []));

    const call = generateContentStreamMock.mock.calls.at(-1)?.[0] as {
      config?: { tools?: { functionDeclarations?: { name: string }[] }[] };
    };
    expect(call.config?.tools?.[0]?.functionDeclarations?.map((d) => d.name)).toEqual([
      'propose_workout_plan',
      'propose_nutrition_menu',
    ]);
  });

  it('sends the persona ahead of the athlete context in the system instruction', async () => {
    generateContentStreamMock.mockReturnValueOnce(fakeStream([]));
    await drain(makeProvider().streamChat(ctx, []));

    const call = generateContentStreamMock.mock.calls.at(-1)?.[0] as {
      config?: { systemInstruction?: string };
    };
    // Order is load-bearing for a future CachedContent — the stable half has to sit at the front.
    expect(call.config?.systemInstruction).toBe('persona\n\ncontext');
  });

  it("maps this codebase's 'assistant' role onto Gemini's 'model'", async () => {
    generateContentStreamMock.mockReturnValueOnce(fakeStream([]));
    await drain(
      makeProvider().streamChat(ctx, [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    );

    const call = generateContentStreamMock.mock.calls.at(-1)?.[0] as {
      contents?: { role: string }[];
    };
    expect(call.contents?.map((c) => c.role)).toEqual(['user', 'model']);
  });
});

describe('GeminiProvider.streamChat — text', () => {
  it('yields text chunks as { type: "text" } events, in order', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([{ text: 'Hello' }, { text: ' there' }, finish('STOP')]),
    );

    expect(await drain(makeProvider().streamChat(ctx, []))).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
    ]);
  });

  it('skips chunks carrying no text rather than emitting an empty event', async () => {
    // The usage-only final chunk is the common case. An empty text event would reach the client
    // as the coach having said nothing.
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([{ text: 'A' }, { text: '' }, { text: undefined }, finish('STOP')]),
    );

    expect(await drain(makeProvider().streamChat(ctx, []))).toEqual([{ type: 'text', text: 'A' }]);
  });
});

describe('GeminiProvider.streamChat — function calls', () => {
  it('turns a propose_workout_plan call into a validated plan_proposal', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([
        { functionCalls: [{ name: 'propose_workout_plan', args: validPlan }] },
        finish('STOP'),
      ]),
    );

    expect(await drain(makeProvider().streamChat(ctx, []))).toEqual([
      { type: 'plan_proposal', plan: expect.objectContaining({ planName: 'Push Pull Legs' }) },
    ]);
  });

  it('dispatches propose_nutrition_menu to a nutrition_proposal event', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([
        { functionCalls: [{ name: 'propose_nutrition_menu', args: validMenu }] },
        finish('STOP'),
      ]),
    );

    expect(await drain(makeProvider().streamChat(ctx, []))).toEqual([
      {
        type: 'nutrition_proposal',
        menu: expect.objectContaining({ summary: expect.stringContaining('2381 kcal') }),
      },
    ]);
  });

  it('interleaves prose and a call within one turn without losing or reordering either', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([
        { text: 'Here is a plan.' },
        { functionCalls: [{ name: 'propose_workout_plan', args: validPlan }] },
        { text: ' Let me know.' },
        finish('STOP'),
      ]),
    );

    const out = await drain(makeProvider().streamChat(ctx, []));
    expect(out.map((e) => e.type)).toEqual(['text', 'plan_proposal', 'text']);
  });

  it('throws rather than yield an event when the call fails schema validation', async () => {
    // An unvalidated proposal would render as a card the user can apply to their training.
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([
        { functionCalls: [{ name: 'propose_workout_plan', args: { planName: 'Broken' } }] },
      ]),
    );

    await expect(drain(makeProvider().streamChat(ctx, []))).rejects.toThrow();
  });

  it('throws on a tool name it does not recognise', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([{ functionCalls: [{ name: 'delete_everything', args: {} }] }]),
    );

    await expect(drain(makeProvider().streamChat(ctx, []))).rejects.toThrow(/delete_everything/);
  });

  it('ignores a nameless call instead of throwing', async () => {
    // `name` is optional on the SDK's type. A call the model should not be able to produce is
    // not worth failing an otherwise good answer over.
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([{ functionCalls: [{ args: {} }] }, { text: 'still here' }, finish('STOP')]),
    );

    expect(await drain(makeProvider().streamChat(ctx, []))).toEqual([
      { type: 'text', text: 'still here' },
    ]);
  });
});

describe('GeminiProvider.streamChat — refusals', () => {
  it('surfaces a safety finish reason as CoachRefusalError after any partial text', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([{ text: 'I can start to' }, finish('SAFETY')]),
    );

    const iterator = makeProvider().streamChat(ctx, []);
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const event of iterator) seen.push(event);
      })(),
    ).rejects.toBeInstanceOf(CoachRefusalError);

    // The text already emitted is the caller's to treat as truncated, not discard.
    expect(seen).toEqual([{ type: 'text', text: 'I can start to' }]);
  });

  it('reports the finish reason as the refusal category', async () => {
    generateContentStreamMock.mockReturnValueOnce(fakeStream([finish('PROHIBITED_CONTENT')]));

    await expect(drain(makeProvider().streamChat(ctx, []))).rejects.toMatchObject({
      category: 'PROHIBITED_CONTENT',
    });
  });

  it('treats a blocked prompt as a refusal even though no candidate comes back', async () => {
    generateContentStreamMock.mockReturnValueOnce(
      fakeStream([{ promptFeedback: { blockReason: 'SAFETY' } }]),
    );

    await expect(drain(makeProvider().streamChat(ctx, []))).rejects.toBeInstanceOf(
      CoachRefusalError,
    );
  });

  it('does NOT treat truncation or a malformed call as a refusal', async () => {
    // Both are failures, not declines. Reporting them as a refusal would tell the user the coach
    // would not answer when it tried and something else went wrong.
    for (const reason of ['MAX_TOKENS', 'MALFORMED_FUNCTION_CALL', 'OTHER']) {
      generateContentStreamMock.mockReturnValueOnce(fakeStream([{ text: 'partial' }, finish(reason)]));
      expect(await drain(makeProvider().streamChat(ctx, []))).toEqual([
        { type: 'text', text: 'partial' },
      ]);
    }
  });
});

describe('toGeminiSchema', () => {
  it('drops the keywords Gemini does not document support for', () => {
    // zodToJsonSchema emits all three from `.min()`/`.max()`/`.positive()` on the shared schemas.
    const out = toGeminiSchema({
      type: 'object',
      properties: {
        planName: { type: 'string', minLength: 1, maxLength: 60 },
        grams: { type: 'number', exclusiveMinimum: 0 },
      },
      required: ['planName'],
    }) as { properties: Record<string, unknown>; required: string[] };

    expect(out.properties.planName).toEqual({ type: 'string' });
    expect(out.properties.grams).toEqual({ type: 'number' });
    expect(out.required).toEqual(['planName']);
  });

  it('keeps a property literally named like a dropped keyword', () => {
    // `properties` keys are field names, not keywords. Filtering them by the keyword set would
    // delete real fields — `minLength` is a plausible thing for a schema to describe.
    const out = toGeminiSchema({
      type: 'object',
      properties: { minLength: { type: 'number', minimum: 0 } },
    }) as { properties: Record<string, unknown> };

    expect(out.properties.minLength).toEqual({ type: 'number', minimum: 0 });
  });

  it('recurses through items, anyOf and $defs', () => {
    const out = toGeminiSchema({
      $defs: { day: { type: 'string', maxLength: 5 } },
      type: 'array',
      items: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] },
    }) as { $defs: Record<string, unknown>; items: { anyOf: unknown[] } };

    expect(out.$defs.day).toEqual({ type: 'string' });
    expect(out.items.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
  });

  it('leaves the real tool schemas free of unsupported keywords', async () => {
    // The end-to-end assertion: whatever the shared package grows next, what reaches Gemini
    // stays inside the documented subset.
    const SUPPORTED = new Set(['$id','$defs','$ref','$anchor','type','format','title','description',
      'enum','items','prefixItems','minItems','maxItems','minimum','maximum','anyOf','oneOf',
      'properties','additionalProperties','required','propertyOrdering']);
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (!SUPPORTED.has(k)) offenders.push(`${path}.${k}`);
        if (k === 'properties' || k === '$defs') {
          for (const [n, sub] of Object.entries(v as Record<string, unknown>)) walk(sub, `${path}.${n}`);
        } else if (v && typeof v === 'object') walk(v, `${path}.${k}`);
      }
    };

    generateContentStreamMock.mockReturnValueOnce(fakeStream([]));
    await drain(makeProvider().streamChat(ctx, []));

    const sent = generateContentStreamMock.mock.calls.at(-1)?.[0] as {
      config?: { tools?: { functionDeclarations?: { parametersJsonSchema?: unknown }[] }[] };
    };
    const declarations = sent.config?.tools?.[0]?.functionDeclarations ?? [];

    // Guards the assertion below from passing because nothing was inspected.
    expect(declarations).toHaveLength(2);
    for (const declaration of declarations) walk(declaration.parametersJsonSchema, '$');

    expect(offenders).toEqual([]);
  });
});

describe('GeminiProvider.generatePlan', () => {
  it('constrains output with the schema and parses the result', async () => {
    generateContentMock.mockResolvedValueOnce({ text: JSON.stringify(validPlan) });

    const schema = { type: 'object', properties: { a: { type: 'string', minLength: 3 } } };
    const out = await makeProvider().generatePlan(ctx, schema, 'make me a plan');

    expect(out).toEqual(validPlan);
    const call = generateContentMock.mock.calls.at(-1)?.[0] as {
      config?: {
        responseMimeType?: string;
        responseJsonSchema?: { properties: Record<string, unknown> };
      };
    };
    expect(call.config?.responseMimeType).toBe('application/json');
    // The field built to take a raw JSON Schema, rather than the narrower one the SDK would
    // have had to rescue it from — and sanitised, since a caller's schema can carry the same
    // unsupported keywords the shared ones do.
    expect(call.config?.responseJsonSchema?.properties.a).toEqual({ type: 'string' });
  });

  it('names the provider when the model returns prose instead of JSON', async () => {
    // `responseJsonSchema` is enforced for schemas Gemini can express; one it cannot degrades to
    // ordinary generation, and a parse error naming the provider beats a Zod error in the route.
    generateContentMock.mockResolvedValueOnce({ text: 'Sure! Here is a plan:' });

    await expect(makeProvider().generatePlan(ctx, {}, 'p')).rejects.toThrow(/gemini provider/);
  });

  it('distinguishes empty content from unparseable content', async () => {
    generateContentMock.mockResolvedValueOnce({ text: '' });

    await expect(makeProvider().generatePlan(ctx, {}, 'p')).rejects.toThrow(/no content/);
  });
});
