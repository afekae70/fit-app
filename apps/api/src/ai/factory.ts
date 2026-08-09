/**
 * Selects the AI provider from validated env config.
 *
 * This is the ONE place `AI_PROVIDER` is read. Everywhere else in the API depends on the
 * `CoachProvider` interface, so switching providers — or A/B testing both, per the plan's
 * "both, behind one interface" requirement — never touches route code.
 */

import type { Env } from '../config/env.js';
import { ClaudeProvider } from './claude-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import type { CoachProvider } from './provider.js';

export function createCoachProvider(env: Env): CoachProvider {
  switch (env.AI_PROVIDER) {
    case 'claude':
      // env.ts's superRefine guarantees this is set when AI_PROVIDER is 'claude'.
      return new ClaudeProvider({
        apiKey: env.ANTHROPIC_API_KEY as string,
        model: env.ANTHROPIC_MODEL,
      });
    case 'openai':
      return new OpenAiProvider({
        apiKey: env.OPENAI_API_KEY as string,
        model: env.OPENAI_MODEL,
      });
    case 'gemini':
      return new GeminiProvider({
        apiKey: env.GOOGLE_API_KEY as string,
        model: env.GEMINI_MODEL,
      });
  }
}
