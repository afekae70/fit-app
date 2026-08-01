/**
 * `ClaudeProvider.streamChat` mixes two things in one async generator: plain text deltas, and a
 * `tool_use` content block whose JSON input arrives as fragments across several
 * `input_json_delta` events. The risk is entirely in the accumulation and dispatch logic — if a
 * fragment is dropped, or a block's index is mixed up with another block's, the failure is a
 * plan that silently doesn't match what the model actually said. The real Anthropic SDK is
 * mocked so these paths are exercised without a network call.
 */

import { describe, expect, it, vi } from 'vitest';

const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { stream: streamMock },
  })),
}));

import type { CoachContext } from './provider.js';
import { CoachRefusalError } from './provider.js';

// Imported after the mock is registered, matching vi.mock's hoisting contract.
const { ClaudeProvider } = await import('./claude-provider.js');

/** A minimal stand-in for Anthropic's `MessageStream`: async-iterable, plus `finalMessage()`. */
function fakeStream(events: unknown[], finalMessage: unknown) {
  return {
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        next: async () => {
          if (i < events.length) return { value: events[i++], done: false as const };
          return { value: undefined, done: true as const };
        },
      };
    },
    finalMessage: () => Promise.resolve(finalMessage),
  };
}

const ctx: CoachContext = { userId: 'u1', systemPrompt: 'persona', userContext: 'context' };

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function makeProvider() {
  return new ClaudeProvider({ apiKey: 'test-key', model: 'claude-opus-5' });
}

const validPlanJson = JSON.stringify({
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
});

describe('ClaudeProvider construction', () => {
  it('declares both proposal tools on every streamed request', async () => {
    streamMock.mockReturnValueOnce(fakeStream([], { stop_reason: 'end_turn' }));
    await drain(makeProvider().streamChat(ctx, []));

    const call = streamMock.mock.calls.at(-1)?.[0] as { tools?: { name: string }[] };
    expect(call.tools?.map((t) => t.name)).toEqual([
      'propose_workout_plan',
      'propose_nutrition_menu',
    ]);
  });
});

describe('ClaudeProvider.streamChat — text', () => {
  it('yields plain text deltas as { type: "text" } events, in order', async () => {
    streamMock.mockReturnValueOnce(
      fakeStream(
        [
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' there' } },
        ],
        { stop_reason: 'end_turn' },
      ),
    );

    const out = await drain(makeProvider().streamChat(ctx, []));

    expect(out).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
    ]);
  });
});

describe('ClaudeProvider.streamChat — tool use', () => {
  it('accumulates a tool_use block split across several deltas into a validated plan_proposal', async () => {
    const mid = Math.floor(validPlanJson.length / 2);

    streamMock.mockReturnValueOnce(
      fakeStream(
        [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 't1', name: 'propose_workout_plan', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: validPlanJson.slice(0, mid) },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: validPlanJson.slice(mid) },
          },
          { type: 'content_block_stop', index: 0 },
        ],
        { stop_reason: 'tool_use' },
      ),
    );

    const out = await drain(makeProvider().streamChat(ctx, []));

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'plan_proposal',
      plan: { planName: 'Push Pull Legs' },
    });
  });

  it('interleaves prose and a tool call within one turn without losing or reordering either', async () => {
    // A block index other than 0 for the tool_use block: the model wrote a sentence (block 0)
    // before proposing the plan (block 1). If the accumulator keyed on "the" pending tool
    // instead of its own index, a second interleaved block would corrupt this.
    streamMock.mockReturnValueOnce(
      fakeStream(
        [
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: "Here's a plan for you:" } },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 't1', name: 'propose_workout_plan', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: validPlanJson },
          },
          { type: 'content_block_stop', index: 1 },
        ],
        { stop_reason: 'tool_use' },
      ),
    );

    const out = await drain(makeProvider().streamChat(ctx, []));

    expect(out).toEqual([
      { type: 'text', text: "Here's a plan for you:" },
      { type: 'plan_proposal', plan: expect.objectContaining({ planName: 'Push Pull Legs' }) },
    ]);
  });

  it('dispatches propose_nutrition_menu to a nutrition_proposal event', async () => {
    const menuJson = JSON.stringify({
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
    });

    streamMock.mockReturnValueOnce(
      fakeStream(
        [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 't1', name: 'propose_nutrition_menu', input: {} },
          },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: menuJson } },
          { type: 'content_block_stop', index: 0 },
        ],
        { stop_reason: 'tool_use' },
      ),
    );

    const out = await drain(makeProvider().streamChat(ctx, []));

    expect(out).toEqual([
      { type: 'nutrition_proposal', menu: expect.objectContaining({ summary: expect.stringContaining('2381 kcal') }) },
    ]);
  });

  it('throws rather than yield an event when the accumulated tool input fails schema validation', async () => {
    streamMock.mockReturnValueOnce(
      fakeStream(
        [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 't1', name: 'propose_workout_plan', input: {} },
          },
          // Missing every required field — a plan the schema must reject, not silently pass on.
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
          { type: 'content_block_stop', index: 0 },
        ],
        { stop_reason: 'tool_use' },
      ),
    );

    await expect(drain(makeProvider().streamChat(ctx, []))).rejects.toThrow();
  });
});

describe('ClaudeProvider.streamChat — refusal', () => {
  it('surfaces a mid-stream refusal as CoachRefusalError after any partial text already yielded', async () => {
    streamMock.mockReturnValueOnce(
      fakeStream(
        [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } }],
        { stop_reason: 'refusal', stop_details: { category: 'disallowed_content' } },
      ),
    );

    const out: unknown[] = [];
    await expect(async () => {
      for await (const event of makeProvider().streamChat(ctx, [])) out.push(event);
    }).rejects.toThrow(CoachRefusalError);

    expect(out).toEqual([{ type: 'text', text: 'Partial' }]);
  });
});
