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

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Everything a provider call needs to know about the request beyond the message history.
 * Deliberately minimal today — `userId` and `systemPrompt` only. The Phase 5 context
 * builder assembles the real system prompt (profile, TDEE, stalling flags, equipment) and
 * passes it through here; this interface does not change shape when that lands.
 */
export interface CoachContext {
  userId: string;
  systemPrompt: string;
}

export interface CoachProvider {
  readonly name: 'claude' | 'openai';

  /** Stream the assistant's reply token-by-token. */
  streamChat(ctx: CoachContext, messages: CoachMessage[]): AsyncIterable<string>;

  /**
   * Generate a plan (workout or nutrition) constrained to a JSON schema.
   * `jsonSchema` is a plain JSON Schema object — see `packages/shared` for the Zod schemas
   * these are derived from once Phase 5 defines them.
   */
  generatePlan<T>(ctx: CoachContext, jsonSchema: Record<string, unknown>, prompt: string): Promise<T>;
}

/**
 * Thrown by both stub providers for every real call. Phase 5 replaces the throwing bodies
 * with actual implementations — this type exists so calling code and tests can assert on
 * "not built yet" specifically, rather than treating it as a generic failure.
 */
export class CoachProviderNotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`${provider} provider: ${method}() is not implemented yet (Phase 5).`);
    this.name = 'CoachProviderNotImplementedError';
  }
}
