/**
 * Provider-agnostic interface for the AI coach.
 *
 * Both Claude and OpenAI implementations satisfy this shape, selected at startup by
 * `AI_PROVIDER`. No call site elsewhere in the API should import `@anthropic-ai/sdk` or
 * `openai` directly — that would defeat the point of the adapter.
 *
 * The actual prompt construction (system persona, TDEE, progression digest, equipment
 * context) is Phase 5. This interface is stable now so routes and tests can be written
 * against it before that logic exists.
 */

import type { AiNutritionMenu, AiWorkoutPlan } from '@fit/shared/schemas';

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * What `streamChat` yields. A plain string was enough while the coach only ever talked; once it
 * can also propose a structured plan or menu mid-turn (see `packages/shared/schemas/aiPlan.ts`),
 * the stream needs to carry both kinds of output without losing the interleaving — the model may
 * write a sentence of prose, then a plan, in one turn.
 */
export type CoachStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_proposal'; plan: AiWorkoutPlan }
  | { type: 'nutrition_proposal'; menu: AiNutritionMenu };

/**
 * Everything a provider call needs beyond the message history.
 *
 * `systemPrompt` and `userContext` are separate fields rather than one concatenated string
 * because the split is load-bearing for prompt caching: the persona is identical across every
 * request and is what gets cached, the per-athlete context is not. Joining them here would
 * make the cacheable prefix per-user and silently destroy the hit rate — the provider needs
 * to see the boundary to place the cache breakpoint on it.
 */
export interface CoachContext {
  userId: string;
  /** Stable across all requests and users. Cacheable. */
  systemPrompt: string;
  /** This athlete, this moment. Never cacheable. */
  userContext: string;
}

export interface CoachProvider {
  /**
   * Which model this provider was configured with.
   *
   * Reported by `/health` so a misconfiguration is readable from outside the server. Chasing a
   * 404 from Google cost several rounds of asking someone to read an environment variable back
   * to me, when the process itself knew the answer the whole time.
   */
  readonly model: string;
  readonly name: 'claude' | 'openai' | 'gemini';

  /** Stream the assistant's reply token-by-token, plus any plan/menu it proposes mid-turn. */
  streamChat(ctx: CoachContext, messages: CoachMessage[]): AsyncIterable<CoachStreamEvent>;

  /**
   * Generate a plan (workout or nutrition) constrained to a JSON schema.
   * `jsonSchema` is a plain JSON Schema object — see `packages/shared` for the Zod schemas
   * these are derived from once Phase 5 defines them.
   */
  generatePlan<T>(ctx: CoachContext, jsonSchema: Record<string, unknown>, prompt: string): Promise<T>;
}

/**
 * Thrown when a provider is selected but not implemented. Retained so the factory's tests can
 * assert on "not built" specifically rather than treating it as a generic failure.
 */
export class CoachProviderNotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`${provider} provider: ${method}() is not implemented yet.`);
    this.name = 'CoachProviderNotImplementedError';
  }
}

/**
 * The model declined the request.
 *
 * A distinct type because it is not a failure of ours and must not be retried or reported as a
 * server error: the request was well-formed and the model answered by refusing. The route maps
 * it to a message the user can act on rather than a 500.
 *
 * A refusal can also arrive mid-stream, after some text has already been sent — so a caller
 * that catches this must treat whatever it has already emitted as truncated, not complete.
 */
export class CoachRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`The model declined to answer${category ? ` (${category})` : ''}.`);
    this.name = 'CoachRefusalError';
  }
}
