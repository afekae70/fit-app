/**
 * Claude implementation of CoachProvider.
 *
 * The client is constructed eagerly in the constructor, deliberately: an invalid or missing
 * API key should fail at startup (when the factory builds the provider), not on a user's
 * first chat message. Streaming and structured plan generation are Phase 5 — see
 * `shared/model-migration.md` / `shared/agent-design.md` in the claude-api skill for the
 * adaptive-thinking and prompt-caching setup that belongs there.
 */

import Anthropic from '@anthropic-ai/sdk';

import { CoachProviderNotImplementedError } from './provider.js';
import type { CoachContext, CoachMessage, CoachProvider } from './provider.js';

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
}

export class ClaudeProvider implements CoachProvider {
  readonly name = 'claude' as const;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
  }

  // A plain (non-generator) method typed to return AsyncIterable<string> is a valid
  // implementation as long as every code path either returns that type or throws — it
  // does not need to be an async generator itself. Throwing here needs no unreachable
  // yield or empty-generator workaround.
  streamChat(_ctx: CoachContext, _messages: CoachMessage[]): AsyncIterable<string> {
    throw new CoachProviderNotImplementedError(this.name, 'streamChat');
  }

  // Declared `async` specifically so the throw below becomes a rejected promise rather
  // than a synchronous exception — callers `await`ing this method (matching its Promise<T>
  // signature) must never need a try/catch around the call expression itself, only around
  // the await.
  // eslint-disable-next-line @typescript-eslint/require-await
  async generatePlan<T>(
    _ctx: CoachContext,
    _jsonSchema: Record<string, unknown>,
    _prompt: string,
  ): Promise<T> {
    throw new CoachProviderNotImplementedError(this.name, 'generatePlan');
  }
}
