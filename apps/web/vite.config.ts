/**
 * The coach's web dashboard: built into `docs/coach`, which GitHub Pages already serves.
 *
 * ## Why it is built into the repository
 *
 * The privacy policy is served from `docs/` on `main` by GitHub Pages, with no build step and
 * no settings beyond "serve this folder". Putting the dashboard's built files beside it means
 * it is published the same way — commit, push, live — at `…/fit-app/coach/`, free, with nothing
 * to configure on GitHub. The price is that the built files are in git; `npm run build -w
 * @fit/web` writes them, and they are committed with the change that made them.
 *
 * `base: './'` makes every asset path relative, so the same build works under `/fit-app/coach/`
 * on Pages and under `/` on the development server.
 *
 * ## The Supabase project
 *
 * Read from the app's own `app.json` at build time, so there is one place that says which
 * project the app and the dashboard talk to. Only the URL and the anon key, which are public by
 * design: the anon key identifies the project, and what anyone can do with it is decided by the
 * database's row-level security and by the coach functions' own checks.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

interface AppJson {
  expo?: { extra?: { supabaseUrl?: string; supabaseAnonKey?: string } };
}
const extra = (JSON.parse(readFileSync(path.join(here, '../mobile/app.json'), 'utf8')) as AppJson)
  .expo?.extra;

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  define: {
    __SUPABASE_URL__: JSON.stringify(extra?.supabaseUrl ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(extra?.supabaseAnonKey ?? ''),
  },
  build: {
    outDir: path.join(here, '../../docs/coach'),
    // The folder is this build's and nothing else's. Emptied so a file a previous build made
    // and this one did not cannot linger on the live site.
    emptyOutDir: true,
    sourcemap: false,
    // React, the Supabase client and the exercise catalogue: about 175 kB over the wire, for a
    // page a coach opens and keeps open. Splitting it would buy little.
    chunkSizeWarningLimit: 800,
  },
  server: {
    // The fonts are the app's own files, read from apps/mobile/assets.
    fs: { allow: [path.join(here, '../..')] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
