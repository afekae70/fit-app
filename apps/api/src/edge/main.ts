/**
 * The Supabase Edge Function: one address, two jobs.
 *
 *   POST <function>/coach/chat   the AI coach            (`coach.ts`)
 *   POST <function>              a photographed meal     (`scan-food.ts`)
 *
 * One function rather than two, because of how it is deployed: by a person pasting a file into
 * the Supabase dashboard, which then serves it at an address of its own invention. A second
 * function would be a second paste, a second address to be told about, and a second thing to
 * keep deployed. As it is, adding the coach was "paste the new file over the old one".
 *
 * The coach's path is the one the Fastify service used (`/coach/chat`), so the app reaches it
 * by having this function's address as its base URL, and nothing else about the app's coach
 * code had to know that the server had changed.
 *
 * ## What is deployed
 *
 * Not this file: `edge/novafit-ai.js`, the bundle `scripts/build-edge.mjs` makes from it,
 * with everything it imports folded into one file. This and its neighbours use only what
 * every modern runtime has, so the same code is typechecked and tested here under Node.
 *
 * ## Secrets it needs (Supabase dashboard → Edge Functions → Secrets)
 *
 *   GEMINI_API_KEY   a key from Google AI Studio, with no billing account attached
 *   GEMINI_MODELS    optional: comma-separated model ids to try, in order
 *
 * `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by Supabase.
 */

import { handleCoach } from './coach.js';
import { handle as handleScan } from './scan-food.js';
import type { EdgeDeps } from './shared.js';

/** Which job a request is for, by the end of its path. */
export function route(request: Request, deps: EdgeDeps): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path.endsWith('/coach/chat') ? handleCoach(request, deps) : handleScan(request, deps);
}

/*
 * Started only where there is a Deno to start it — on Supabase. Under vitest there is none,
 * and importing this file must not try to open a port.
 */
const deno = (
  globalThis as {
    Deno?: {
      serve: (handler: (request: Request) => Promise<Response>) => unknown;
      env: { get: (name: string) => string | undefined };
    };
  }
).Deno;

if (deno) {
  deno.serve((request) =>
    route(request, {
      fetch: (...args) => fetch(...args),
      env: (name) => deno.env.get(name),
      log: (line) => console.error(line),
    }),
  );
}
