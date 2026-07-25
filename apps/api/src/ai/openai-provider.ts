/**
 * OpenAI implementation of CoachProvider. Mirrors ClaudeProvider — see that file for why the
 * client is constructed eagerly and why streaming/plan-generation are stubbed until Phase 5.
 */

import OpenAI from 'openai';

import { CoachProviderNotImplementedError } from './provider.js';
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

  streamChat(_ctx: CoachContext, _messages: CoachMessage[]): AsyncIterable<string> {
    throw new CoachProviderNotImplementedError(this.name, 'streamChat');
  }

  // See ClaudeProvider.generatePlan — `async` here is what turns this throw into a
  // rejected promise instead of a synchronous exception.
  // eslint-disable-next-line @typescript-eslint/require-await
  async generatePlan<T>(
    _ctx: CoachContext,
    _jsonSchema: Record<string, unknown>,
    _prompt: string,
  ): Promise<T> {
    throw new CoachProviderNotImplementedError(this.name, 'generatePlan');
  }
}
