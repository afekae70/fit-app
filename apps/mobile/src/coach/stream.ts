/**
 * Reads the coach endpoint's Server-Sent Event stream.
 *
 * Hand-rolled rather than using `EventSource` or `fetch` body streaming, for two reasons:
 *
 *  1. **`EventSource` cannot POST.** The context digest is a few kilobytes of JSON; it belongs
 *     in a request body, not a query string.
 *  2. **React Native's `fetch` does not expose a readable body.** `response.body` is null on
 *     both platforms — awaiting `response.text()` would block until generation finished, which
 *     defeats the entire point of streaming.
 *
 * So this uses `XMLHttpRequest`, whose `onprogress` fires with the partial `responseText` as
 * bytes arrive. That is the only transport in React Native that streams a POST response today.
 *
 * The frame parser is separate and pure (`parseSseChunk`) so it can be tested without a server
 * — chunk boundaries are the easy thing to get wrong here, and they fail intermittently rather
 * than reproducibly.
 */

import type { AiNutritionMenu, AiWorkoutPlan } from '@fit/shared/schemas';

export interface SseFrame {
  event: string;
  data: unknown;
}

/**
 * Split a buffer into complete SSE frames plus the unterminated remainder.
 *
 * A frame ends at a blank line. Bytes arrive in arbitrary chunks, so a frame is routinely split
 * mid-way — the remainder must be carried into the next call rather than parsed or dropped.
 * Parsing it early yields truncated JSON; dropping it silently loses text mid-sentence.
 */
export function parseSseChunk(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const blocks = buffer.split('\n\n');

  // The final element is either an incomplete frame or '' when the buffer ended on a boundary.
  // Either way it is not yet parseable and belongs to the next chunk.
  const rest = blocks.pop() ?? '';

  for (const block of blocks) {
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      // Per the SSE spec a frame may carry several data lines, joined with newlines.
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }

    if (dataLines.length === 0) continue;

    try {
      frames.push({ event, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // A frame that survived the boundary check but still will not parse is corrupt, not
      // partial. Skipping it beats tearing down a stream that is otherwise fine.
    }
  }

  return { frames, rest };
}

/**
 * Structural checks, not full schema validation. The server already validated the tool call's
 * JSON against `aiWorkoutPlanSchema`/`aiNutritionMenuSchema` before ever emitting the event (see
 * `ClaudeProvider.parseToolCall`) — a malformed payload cannot leave the API. This just guards
 * against a corrupt frame the same way the `delta`/`refusal` cases already do, without pulling
 * zod and the exercise catalogue into the mobile bundle for a check that can't actually fire.
 */
function isPlanShaped(value: unknown): value is AiWorkoutPlan {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { planName?: unknown }).planName === 'string' &&
    Array.isArray((value as { days?: unknown }).days)
  );
}

function isMenuShaped(value: unknown): value is AiNutritionMenu {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { summary?: unknown }).summary === 'string' &&
    Array.isArray((value as { meals?: unknown }).meals)
  );
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  /** The model proposed a full workout plan — a card to review, never applied automatically. */
  onPlanProposal: (plan: AiWorkoutPlan) => void;
  /** The model proposed a nutrition menu — display-only, nothing to persist it into. */
  onNutritionProposal: (menu: AiNutritionMenu) => void;
  onDone: () => void;
  /** The model declined. Not a fault — and any text already delivered is truncated. */
  onRefusal: (category: string | null) => void;
  onError: (message: string) => void;
}

export interface StreamOptions {
  baseUrl: string;
  body: unknown;
  /** Supabase access token, once auth lands. Omitted today. */
  accessToken?: string;
  handlers: StreamHandlers;
}

/** Cancels an in-flight stream. Safe to call after completion. */
export type CancelStream = () => void;

export function streamCoachChat({
  baseUrl,
  body,
  accessToken,
  handlers,
}: StreamOptions): CancelStream {
  const request = new XMLHttpRequest();
  let consumed = 0;
  let buffer = '';
  let finished = false;

  const finish = (fn: () => void) => {
    if (finished) return;
    finished = true;
    fn();
  };

  request.open('POST', `${baseUrl.replace(/\/$/, '')}/coach/chat`);
  request.setRequestHeader('Content-Type', 'application/json');
  request.setRequestHeader('Accept', 'text/event-stream');
  if (accessToken) request.setRequestHeader('Authorization', `Bearer ${accessToken}`);

  request.onprogress = () => {
    // `responseText` is cumulative — it grows, it is not a per-chunk delta. Re-parsing the
    // whole thing each time would replay every token already emitted, so only the newly
    // arrived slice is appended.
    const fresh = request.responseText.slice(consumed);
    consumed = request.responseText.length;
    buffer += fresh;

    const { frames, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const frame of frames) {
      switch (frame.event) {
        case 'delta': {
          const text = (frame.data as { text?: unknown }).text;
          if (typeof text === 'string') handlers.onDelta(text);
          break;
        }
        case 'plan_proposal': {
          const plan = (frame.data as { plan?: unknown }).plan;
          if (isPlanShaped(plan)) handlers.onPlanProposal(plan);
          break;
        }
        case 'nutrition_proposal': {
          const menu = (frame.data as { menu?: unknown }).menu;
          if (isMenuShaped(menu)) handlers.onNutritionProposal(menu);
          break;
        }
        case 'refusal': {
          const category = (frame.data as { category?: unknown }).category;
          finish(() => handlers.onRefusal(typeof category === 'string' ? category : null));
          break;
        }
        case 'error': {
          const message = (frame.data as { message?: unknown }).message;
          finish(() => handlers.onError(typeof message === 'string' ? message : 'Unknown error'));
          break;
        }
        case 'done':
          finish(handlers.onDone);
          break;
      }
    }
  };

  request.onload = () => {
    // A non-2xx never streams — the server rejected before opening the event stream, and the
    // body is a plain JSON error rather than SSE frames.
    if (request.status >= 400) {
      let message = `Request failed (${request.status})`;
      try {
        const parsed = JSON.parse(request.responseText) as { message?: string; error?: string };
        message = parsed.message ?? parsed.error ?? message;
      } catch {
        /* non-JSON error body; the status-code message stands */
      }
      finish(() => handlers.onError(message));
      return;
    }

    // Reaching here without a `done` frame means the connection closed early — mid-generation.
    // Reported rather than treated as success, so a truncated answer is never shown as final.
    finish(() => handlers.onError('The connection closed before the answer finished.'));
  };

  request.onerror = () => {
    finish(() => handlers.onError('Could not reach the coach. Check your connection.'));
  };

  request.ontimeout = () => {
    finish(() => handlers.onError('The coach took too long to respond.'));
  };

  // Generous: a coaching reply at medium effort can take tens of seconds, and the timeout must
  // not fire while tokens are still arriving.
  request.timeout = 120_000;
  request.send(JSON.stringify(body));

  return () => {
    finished = true;
    request.abort();
  };
}
