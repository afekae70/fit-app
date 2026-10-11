/**
 * Every button is the app's `Pressable`.
 *
 * The press-in lives in `components/Pressable.tsx`. A file that imports `Pressable` straight
 * from React Native has buttons that only dim — which looks fine on its own and is simply the
 * one screen that feels different under the finger. Nothing else would notice.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

const mobile = fileURLToPath(new URL('../../', import.meta.url));
const WRAPPER = 'src/components/Pressable.tsx';

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

describe('a press feels the same everywhere', () => {
  it('finds the screens it is checking', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.name === 'app/(tabs)/workouts.tsx')).toBe(true);
  });

  it('never takes Pressable straight from React Native', () => {
    const offenders = files
      .filter((file) =>
        [...file.text.matchAll(NATIVE_IMPORT)].some((match) =>
          match[1]!
            .split(',')
            .map((specifier) => specifier.trim())
            .includes('Pressable'),
        ),
      )
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('uses the shared one somewhere, so the check above is not passing on an empty app', () => {
    const users = files.filter((file) =>
      /from '[./]+.*components\/Pressable\.js'|from '\.\/Pressable\.js'|from '\.\.\/Pressable\.js'/.test(
        file.text,
      ),
    );
    expect(users.length).toBeGreaterThan(40);
  });
});
