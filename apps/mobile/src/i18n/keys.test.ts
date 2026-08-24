/**
 * Every key the app asks for must exist in both bundles.
 *
 * i18next renders a missing key as the key itself, so the failure ships silently and then sits
 * on screen looking like a bug in the layout: a button labelled `workout.addWarmup`, a header
 * reading `tabs.workouts`. Both of those were live in the app at once — one a typo (the bundle
 * says `workout`, the code asked for `workouts`) and one a string I said I had added and had
 * not. Neither typechecks, because `t()` takes a string.
 *
 * The bundles are imported and walked as real objects rather than parsed out of the source. An
 * earlier version of this check read the `.ts` files with a regex, and quietly missed every
 * value written across two lines — reporting a dozen keys as absent that were sitting right
 * there, which is worse than not checking at all.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { en } from './locales/en.js';
import { he } from './locales/he.js';

/** Every leaf path in a bundle, as `section.key`. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const APP = join(import.meta.dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry === 'android' || entry === 'ios') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/**
 * `t('some.key')` in real code.
 *
 * Block comments are stripped first: the doc comment on `ActionSheetProvider` shows an example
 * call, and a check that fails on an illustration in a comment is a check people learn to
 * ignore. Keys built at runtime — `t(\`workout.rpe${value}\`)` — use backticks and are not
 * matched here; those are covered by the explicit test at the bottom.
 */
function usedKeys(text: string): string[] {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...withoutComments.matchAll(/\bt\(\s*'([a-zA-Z][a-zA-Z0-9_.]*)'/g)].map((m) => m[1]!);
}

/**
 * i18next resolves a plural key through a suffix: `t('streak.days', { count })` reads
 * `streak.days_one` or `streak.days_other`, and the bare `streak.days` never exists in the
 * bundle. Both forms are registered under the bare name so a plural key counts as present —
 * without this the check reports two keys that work perfectly as broken, which is the kind of
 * false alarm that gets a test deleted.
 */
function withPlurals(keys: readonly string[]): Set<string> {
  const out = new Set(keys);
  for (const key of keys) {
    const plural = key.match(/^(.*)_(one|other|two|few|many|zero)$/);
    if (plural) out.add(plural[1]!);
  }
  return out;
}

const hebrewKeys = withPlurals(flatten(he));
const englishKeys = withPlurals(flatten(en));
const files = sourceFiles(APP);

describe('the check itself works', () => {
  it('found the bundles and the source', () => {
    // Without this, an empty scan passes every assertion below while proving nothing — which is
    // exactly how the regex version of this check managed to be both green and wrong.
    expect(hebrewKeys.size).toBeGreaterThan(400);
    expect(files.length).toBeGreaterThan(50);
    expect(hebrewKeys.has('tabs.workout')).toBe(true);
  });

  it('finds keys in real code and ignores the ones in comments', () => {
    expect(usedKeys(`const a = t('some.key');`)).toEqual(['some.key']);
    expect(usedKeys(`/** example: t('not.real') */`)).toEqual([]);
    expect(usedKeys(`// t('also.not.real')`)).toEqual([]);
  });
});

describe('every key the app asks for exists', () => {
  const missing: string[] = [];
  for (const file of files) {
    for (const key of usedKeys(readFileSync(file, 'utf8'))) {
      if (!hebrewKeys.has(key)) missing.push(`${relative(APP, file)} -> ${key}`);
    }
  }

  it('in Hebrew', () => {
    // Named in the failure, because "a key is missing" without saying which sends the reader
    // through a hundred files.
    expect(missing).toEqual([]);
  });
});

describe('keys assembled at runtime', () => {
  // These are built from a value rather than written out, so the scan above cannot see them.
  // Listed by hand because the alternative is a missing rating label that only appears when
  // somebody taps that exact option.
  it.each([6, 7, 8, 9, 10])('workout.rpe%i', (value) => {
    expect(hebrewKeys.has(`workout.rpe${value}`)).toBe(true);
  });

  it.each([2, 4, 6, 8, 10])('workout.effort%i', (value) => {
    expect(hebrewKeys.has(`workout.effort${value}`)).toBe(true);
  });

  it.each(['not-json', 'wrong-format', 'newer-schema', 'different-user', 'no-tables'])(
    'restore.problem.%s',
    (problem) => {
      expect(hebrewKeys.has(`restore.problem.${problem}`)).toBe(true);
    },
  );
});

describe('the two bundles stay in step', () => {
  it('has the same keys in English as in Hebrew', () => {
    // `en.ts` is typed against `he.ts`, so a missing key is normally a compile error. This
    // catches the case that slips through: a key present in both files but nested differently.
    expect([...hebrewKeys].filter((k) => !englishKeys.has(k))).toEqual([]);
    expect([...englishKeys].filter((k) => !hebrewKeys.has(k))).toEqual([]);
  });
});
