/**
 * Makes the one file that is deployed as the Supabase function: `edge/justfit-ai.js`.
 *
 *   npm run build:edge -w @fit/api
 *
 * ## Why there is a build at all
 *
 * The function is deployed by pasting a file into the Supabase dashboard — there is no CLI
 * login on this machine and no deploy step that runs anywhere. When the function only read
 * meal photos it was written as one file with no imports, so the source was the thing pasted.
 * The coach cannot be written that way: it validates what the phone sends and what the model
 * proposes against the shared schemas, and those bring the exercise catalogue and a validation
 * library with them. Copying them in by hand would be a second copy to keep in step with the
 * first, which is the one thing `packages/shared` exists to avoid.
 *
 * So `src/edge/main.ts` and everything it imports are folded into one file, and that file is
 * committed: what is in the repository is what is running, and it can be read before it is
 * pasted. `build-edge.test.ts` fails when the committed file is not what the sources produce.
 *
 * ## Why it is not minified
 *
 * Because it is pasted by a person into a public project's dashboard and should be something
 * they could read. It is a few hundred kilobytes, which the dashboard takes without complaint.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the bundle is kept, relative to the API workspace. */
export const EDGE_BUNDLE = 'edge/justfit-ai.js';

const BANNER = `// @ts-nocheck
/*
 * GENERATED — do not edit. This is apps/api/src/edge/main.ts and everything it imports,
 * folded into one file by apps/api/scripts/build-edge.ts.
 *
 * It is the Supabase Edge Function that reads photographed meals and answers as the coach.
 * To deploy: Supabase dashboard -> Edge Functions -> the function -> Code, replace everything
 * there with this file, and deploy.
 *
 * It needs one secret, GEMINI_API_KEY, and the tables from apps/api/drizzle/0015 and 0016.
 */`;

/** The bundle as text, without writing it anywhere. */
export async function bundleEdge(): Promise<string> {
  const result = await build({
    absWorkingDir: API_ROOT,
    entryPoints: ['src/edge/main.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    // Neither Node nor a browser: Deno, which has the web platform and nothing of Node's. A
    // Node built-in reaching the bundle is then an error here rather than a crash on Supabase.
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    charset: 'utf8',
    legalComments: 'none',
    banner: { js: BANNER },
    logLevel: 'silent',
  });
  const [file] = result.outputFiles;
  if (!file) throw new Error('esbuild produced no output');
  return file.text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await bundleEdge();
  writeFileSync(path.join(API_ROOT, EDGE_BUNDLE), text);
  console.log(`${EDGE_BUNDLE}: ${Math.round(text.length / 1024)} KB`);
}
