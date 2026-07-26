/**
 * OpenAI implementation of CoachProvider. Mirrors ClaudeProvider — see that file for why the
 * client is constructed eagerly.
 *
 * Two differences from the Claude path, both forced by the provider rather than chosen:
 *
 *  - **No prompt-cache breakpoint.** OpenAI caches automatically on a long stable prefix, with
 *    no marker to place. The persona is still sent first so that automatic caching has a
 *    prefix to match on, but the boundary cannot be declared.
 *  - **Schema conformance is not guaranteed the same way.** `json_schema` with `strict: true`
 *    is enforced, but the failure mode when a schema is not expressible under strict mode is a
 *    request error rather than a validated object — so the parse is defended here, where the
 *    Claude path can rely on the API having enforced it.
 */

import OpenAI from 'openai';

import type { CoachContext, CoachMessage, CoachProvider } from './provider.js';

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
}

export class OpenAiProvider implements CoachProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model;
  }

  /**
   * Persona and context as two separate system messages, in that order.
   *
   * Splitting them is not required by the API, but it keeps the stable text contiguous at the
   * front so automatic prefix caching has something to match — the same reason the Claude path
   * marks a breakpoint there.
   */
  private systemMessages(ctx: CoachContext): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: ctx.systemPrompt },
      { role: 'system', content: ctx.userContext },
    ];
  }

  async *streamChat(ctx: CoachContext, messages: CoachMessage[]): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 4096,
      stream: true,
      messages: [
        ...this.systemMessages(ctx),
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async generatePlan<T>(
    ctx: CoachContext,
    jsonSchema: Record<string, unknown>,
    prompt: string,
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 8192,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'plan', strict: true, schema: jsonSchema },
      },
      messages: [...this.systemMessages(ctx), { role: 'user', content: prompt }],
    });

    const choice = response.choices[0];

    // Truncation produces syntactically incomplete JSON; naming the cause here beats an opaque
    // parse error on the next line.
    if (choice?.finish_reason === 'length') {
      throw new Error('Plan generation hit the output limit before completing.');
    }

    const text = choice?.message?.content;
    if (!text) throw new Error('Plan generation returned no content.');

    return JSON.parse(text) as T;
  }
}
