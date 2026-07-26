/**
 * Claude implementation of CoachProvider.
 *
 * The client is constructed eagerly in the constructor, deliberately: an invalid or missing
 * API key should fail at startup (when the factory builds the provider), not on a user's
 * first chat message.
 *
 * Three Opus 5 specifics shape this file, all of which are 400s rather than warnings if got
 * wrong:
 *  - `temperature` / `top_p` / `top_k` are rejected. Behaviour is steered by prompting only.
 *  - `thinking.budget_tokens` is rejected; depth is controlled by `output_config.effort`.
 *    Thinking is on by default, so it is not configured here at all.
 *  - Assistant prefill is rejected, so `generatePlan` constrains output with
 *    `output_config.format` instead — which also means the API validates the schema rather
 *    than us parsing hopefully and repairing.
 */

import Anthropic from '@anthropic-ai/sdk';

import { CoachRefusalError } from './provider.js';
import type { CoachContext, CoachMessage, CoachProvider } from './provider.js';

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
}

/**
 * Chat runs at `medium`, plan generation at `high`.
 *
 * Chat answers a question about numbers already computed for it — the reasoning is shallow and
 * `medium` keeps it responsive. Generating a week of programming is the opposite: it has to
 * hold volume, frequency, and equipment constraints together, and is worth the extra tokens.
 */
const CHAT_EFFORT = 'medium' as const;
const PLAN_EFFORT = 'high' as const;

export class ClaudeProvider implements CoachProvider {
  readonly name = 'claude' as const;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
  }

  /**
   * System blocks with the cache breakpoint after the persona.
   *
   * Order matters: the persona is byte-identical for every user, the context is not. Marking
   * the persona caches it across every request from every athlete; putting the marker after
   * the context instead would key the cache to one user's numbers and never hit twice.
   */
  private systemBlocks(ctx: CoachContext): Anthropic.TextBlockParam[] {
    return [
      {
        type: 'text',
        text: ctx.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: ctx.userContext },
    ];
  }

  async *streamChat(ctx: CoachContext, messages: CoachMessage[]): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: this.systemBlocks(ctx),
      output_config: { effort: CHAT_EFFORT },
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }

    // Checked after the stream drains rather than before: a refusal can arrive mid-output, in
    // which case some text has already reached the user and the caller needs to know the
    // answer is truncated rather than complete.
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new CoachRefusalError(final.stop_details?.category ?? null);
    }
  }

  /**
   * Structured generation via `output_config.format`.
   *
   * The API enforces the schema, so the result parses or the request fails — there is no
   * "model returned prose instead of JSON" path to defend against, which is the failure mode
   * that makes prompt-and-parse plan generation unreliable.
   */
  async generatePlan<T>(
    ctx: CoachContext,
    jsonSchema: Record<string, unknown>,
    prompt: string,
  ): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: this.systemBlocks(ctx),
      output_config: {
        effort: PLAN_EFFORT,
        format: { type: 'json_schema', schema: jsonSchema },
      },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') {
      throw new CoachRefusalError(response.stop_details?.category ?? null);
    }

    // A truncated response is still syntactically incomplete JSON, so surface the real cause
    // rather than letting it fail as an opaque parse error two lines down.
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Plan generation hit the output limit before completing.');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return JSON.parse(text) as T;
  }
}
