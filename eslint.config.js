// @ts-check
/**
 * Flat config (ESLint 9+). The old `.eslintrc` format is gone, which is why `npm run lint` had
 * been failing with "couldn't find an eslint.config.js" — the script existed, the config never did.
 *
 * Two rules govern what is switched on here:
 *
 *   1. A lint error must mean something is wrong. Rules that fire constantly on correct code
 *      train everyone to run with the output folded away, at which point the real finding
 *      scrolls past unread.
 *   2. Every `eslint-disable` comment already in the tree must refer to a rule that is actually
 *      enabled. A disable for a rule nobody runs is worse than no comment: it reads as a
 *      considered exception when in fact it does nothing.
 *
 * Point 2 is what forces type-aware linting. The tree disables `@typescript-eslint/require-await`
 * and `@typescript-eslint/no-unsafe-return` in a dozen places, and neither rule can work without
 * type information.
 *
 * The `no-unsafe-*` family is left ON, which was worth checking rather than assuming: on this
 * tree it produces nine findings, not the hundreds that family usually means. The boundaries
 * where it would normally shout — SQLite rows, expo-router params — are already cast
 * deliberately and commented, so the rules stay quiet and the handful that remain are real.
 */

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Generated, vendored, or native output — none of it is ours to lint.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      'apps/api/drizzle/**',
      'apps/mobile/expo-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Resolves each file against the nearest tsconfig automatically, so the three workspaces
        // do not each need listing — and a new package is linted the day it is added.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // `void somePromise()` is the established way this codebase fires an async effect it does
      // not await — it appears in nearly every screen. The rule's point is caught floating
      // promises, and the explicit `void` IS the catch.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],

      // Unused args are how you document a signature you must match but do not use. Leading
      // underscore is the opt-out, which is the convention already in the tree.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Downgraded from the plugin's default. The tree disables it in six places, each with a
      // written reason (a deliberately-once effect, a ref-keyed reformat). Those are judgements,
      // not defects, and the rule is wrong often enough that failing a build on it is worse than
      // reading it.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    /*
     * Fastify's contract is async whether or not a body awaits: `FastifyPluginAsync` must
     * return a promise, and a route handler that returns a value is written `async` by the
     * framework's own convention. Rewriting these to satisfy the rule would mean changing
     * working route signatures to please a linter.
     */
    files: ['apps/api/src/**'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },

  {
    /*
     * Test doubles mirror interfaces that are async by contract even when the fake body has
     * nothing to await (every SqlExecutor fake), and fixture payloads are deliberately untyped
     * — typing a stub response fully would mean asserting the very shape under test.
     */
    files: ['**/*.test.ts', '**/*.test.tsx', '**/testUtils.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  {
    // `projectService` only auto-discovers configs literally named tsconfig.json. This one is
    // covered by apps/api/tsconfig.tools.json, so it has to be pointed at by hand or every rule
    // needing type information reports a parse failure here.
    files: ['apps/api/drizzle.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['apps/api/tsconfig.tools.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Two objects, not one. `disableTypeChecked` carries its own `languageOptions` to switch the
  // type-aware parser off, so spreading it alongside a `languageOptions` of ours in a single
  // object silently replaces the globals with its own — which is exactly how every Node global
  // in these files came back as no-undef.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
    // Metro's config is CommonJS by necessity — it is loaded by Metro, not by our bundler.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

);
