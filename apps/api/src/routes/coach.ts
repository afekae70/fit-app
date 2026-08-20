/**
 * The AI coach endpoint.
 *
 * Streams over Server-Sent Events rather than returning a completed message. A coaching reply
 * takes several seconds to generate; without streaming the app shows a spinner for the whole
 * duration and the request is a candidate for a proxy timeout. With it, text appears as it is
 * produced and the connection stays active.
 *
 * This route is the reason the API service exists at all. The LLM key lives here and only
 * here — bundling it into the mobile app would ship it to every device that installs the app,
 * where it is trivially extractable regardless of obfuscation.
 */

import { coachChatRequestSchema } from '@fit/shared/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { COACH_PERSONA, hasUsableContext, renderContext } from '../ai/context.js';
import { CoachRefusalError } from '../ai/provider.js';

/** SSE frame. The blank line terminates the event — omitting it stalls the client. */
function sendEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * A short, safe label for why the provider refused, for the client to log.
 *
 * The user-facing message stays the same deliberately vague sentence. This travels beside it so
 * that a failure is diagnosable from the phone instead of only from the server console — every
 * cause so far has looked identical from the app ("the coach is unavailable") while being a
 * completely different problem: no credit, a rejected key, a model the account cannot reach.
 *
 * Only the HTTP status and the provider's own error *type* are included. Both are enumerations,
 * not free text, so nothing from the request or the key can be carried out in them.
 */
function providerErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const source = error as { status?: unknown; error?: { error?: { type?: unknown } } };
  const status = typeof source.status === 'number' ? String(source.status) : null;
  const type = typeof source.error?.error?.type === 'string' ? source.error.error.type : null;

  return [status, type].filter(Boolean).join(' ') || undefined;
}

export default async function coachRoutes(app: FastifyInstance): Promise<void> {
  // Gated on a verified Supabase session. Without this, anyone who has the deployed URL — the
  // whole reason a URL is public — can run requests against the LLM key at the account's
  // expense; the 100/min rate limit alone does not stop that.
  app.post('/coach/chat', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = coachChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { context, messages } = parsed.data;

    // Refused before spending a request. A model handed an all-null digest produces confident
    // generic advice that reads as personalised while being about nobody — worse than saying
    // there is nothing to analyse yet.
    if (!hasUsableContext(context)) {
      return reply.status(422).send({
        error: 'insufficient_context',
        message: 'Log a workout or a bodyweight measurement before asking the coach.',
      });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Nginx and several PaaS proxies buffer responses by default, which defeats streaming
      // entirely — the client receives nothing until the whole reply is done.
      'X-Accel-Buffering': 'no',
    });

    // The client hanging up mid-generation is routine (backgrounded app, navigation away), not
    // an error. Tracked so the loop stops writing to a dead socket rather than throwing.
    let clientGone = false;
    request.raw.on('close', () => {
      clientGone = true;
    });

    try {
      const stream = app.coachProvider.streamChat(
        {
          // Guaranteed set: `authenticate` runs as this route's preHandler and 401s before
          // this handler body executes if the token were missing or invalid.
          userId: request.userId!,
          systemPrompt: COACH_PERSONA,
          userContext: renderContext(context),
        },
        messages,
      );

      for await (const event of stream) {
        if (clientGone) break;
        if (event.type === 'text') {
          sendEvent(reply, 'delta', { text: event.text });
        } else if (event.type === 'plan_proposal') {
          sendEvent(reply, 'plan_proposal', { plan: event.plan });
        } else {
          sendEvent(reply, 'nutrition_proposal', { menu: event.menu });
        }
      }

      if (!clientGone) sendEvent(reply, 'done', {});
    } catch (error) {
      if (error instanceof CoachRefusalError) {
        // Not a server fault: the request was well-formed and the model answered by declining.
        // Sent as an event rather than an HTTP status because headers are already flushed —
        // and because a refusal can arrive after partial output, in which case the client must
        // know the text it has is truncated rather than complete.
        app.log.info({ category: error.category }, 'coach refusal');
        if (!clientGone) sendEvent(reply, 'refusal', { category: error.category });
      } else {
        app.log.error({ err: error }, 'coach stream failed');
        if (!clientGone) {
          sendEvent(reply, 'error', {
            message: 'The coach is unavailable.',
            code: providerErrorCode(error),
          });
        }
      }
    } finally {
      reply.raw.end();
    }

    // Fastify must not also try to send a body — this handler owns the raw socket.
    return reply;
  });
}
