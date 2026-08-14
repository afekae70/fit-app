/**
 * Gemini implementation of CoachProvider. Mirrors ClaudeProvider and OpenAiProvider — see the
 * Claude file for why the client is constructed eagerly.
 *
 * Three differences from the other two, all forced by the provider rather than chosen:
 *
 *  - **The persona is a `systemInstruction`, not a message.** Gemini takes system text as its own
 *    field rather than as a turn in the conversation, so the split this interface maintains
 *    between `systemPrompt` and `userContext` has to be joined here. That split exists to place a
 *    prompt-cache breakpoint, and Gemini has no inline marker for one — its caching is an
 *    explicit `CachedContent` object with a substantial minimum token count, which the persona
 *    alone does not reach. So the boundary is preserved in the text (persona first, context
 *    second, separated) but buys nothing yet. Worth revisiting if the persona grows.
 *  - **Roles are `user` and `model`.** Not `assistant`. Mapped on the way in.
 *  - **Schema-constrained output is a first-class request field.** `responseMimeType` plus
 *    `responseSchema` makes the model emit JSON conforming to the schema, so `generatePlan` does
 *    not need the tool-call detour the Claude path uses. The parse is still defended, for the
 *    same reason the OpenAI path defends it: a schema the provider cannot express degrades to
 *    ordinary generation rather than failing loudly.
 *
 * `streamChat` here is text-only, exactly as the OpenAI path is: it wraps every chunk as a
 * `{ type: 'text' }` event to satisfy `CoachProvider` but does not declare the
 * `propose_workout_plan` / `propose_nutrition_menu` tools. Gemini streams function calls in its
 * own shape and would need its own accumulation logic. Until that is built, plan and menu
 * proposals in chat only work when `AI_PROVIDER=claude` — the coach still answers normally here,
 * it simply will not offer a card mid-conversation.
 */

import { GoogleGenAI, type Content } from '@google/genai';

import type { CoachContext, CoachMessage, CoachProvider, CoachStreamEvent } from './provider.js';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
}

export class GeminiProvider implements CoachProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
  }

  /**
   * Persona then athlete, blank line between.
   *
   * Kept in that order even though nothing currently caches on it: the order is what a future
   * `CachedContent` would need, and reversing it now would mean the stable text no longer sits
   * at the front when that becomes worth doing.
   */
  private systemInstruction(ctx: CoachContext): string {
    return `${ctx.systemPrompt}\n\n${ctx.userContext}`;
  }

  /** `assistant` is this codebase's word for it; Gemini's is `model`. */
  private toContents(messages: CoachMessage[]): Content[] {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }

  async *streamChat(ctx: CoachContext, messages: CoachMessage[]): AsyncIterable<CoachStreamEvent> {
    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents: this.toContents(messages),
      config: {
        systemInstruction: this.systemInstruction(ctx),
        maxOutputTokens: 4096,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      // A chunk can carry no text at all — a safety verdict, or the final one with only usage
      // metadata. Yielding an empty event would put a no-op through the SSE stream and, on the
      // client, look briefly like the coach said nothing.
      if (text) yield { type: 'text', text };
    }
  }

  async generatePlan<T>(
    ctx: CoachContext,
    jsonSchema: Record<string, unknown>,
    prompt: string,
  ): Promise<T> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: this.systemInstruction(ctx),
        responseMimeType: 'application/json',
        // Typed loosely on purpose: the caller hands over a plain JSON Schema object (derived
        // from the Zod schemas in packages/shared) and the SDK's own Schema type is a narrower
        // subset. Asserting here would claim a compatibility that is the caller's to guarantee.
        responseSchema: jsonSchema,
        maxOutputTokens: 8192,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('gemini provider: the model returned no content for generatePlan()');
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // Defended rather than trusted. `responseSchema` is enforced for schemas Gemini can
      // express; one it cannot degrades to ordinary generation, and the failure then arrives as
      // prose where JSON was expected. A parse error naming the provider is far easier to act on
      // than a Zod error deep in the route.
      throw new Error('gemini provider: generatePlan() returned content that was not valid JSON');
    }
  }
}
