/**
 * Every screen draws its text through `components/Text.tsx`.
 *
 * The app's typeface is applied there and nowhere else, so a file that imports `Text` straight
 * from React Native is a screen in the system font — and it looks fine to whoever wrote it,
 * because nothing fails; it is simply the one screen that does not match. This is what fails
 * instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

const mobile = fileURLToPath(new URL('../../', import.meta.url));
const WRAPPER = 'src/components/Text.tsx';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = [...sources(join(mobile, 'app')), ...sources(join(mobile, 'src'))]
  .map((path) => ({
    name: relative(mobile, path).replace(/\\/g, '/'),
    text: readFileSync(path, 'utf8'),
  }))
  .filter((file) => file.name !== WRAPPER);

/** Value imports from react-native — `import type { … }` only names a type, and is fine. */
const NATIVE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g;

describe('text is drawn in the app’s typeface', () => {
  it('finds the screens it is checking', () => {
    // A guard that walked the wrong folder would pass by checking nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.name === 'app/(tabs)/workouts.tsx')).toBe(true);
  });

  it('never takes Text or TextInput straight from React Native', () => {
    const offenders = files
      .filter((file) =>
        [...file.text.matchAll(NATIVE_IMPORT)].some((match) =>
          match[1]!
            .split(',')
            .map((specifier) => specifier.trim())
            .some((specifier) => specifier === 'Text' || specifier === 'TextInput'),
        ),
      )
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('never uses Animated.Text, which is React Native’s Text again', () => {
    const offenders = files
      // In code, not in a comment explaining why something is not one.
      .filter((file) => /<\/?Animated\.Text[\s>]/.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });
});
