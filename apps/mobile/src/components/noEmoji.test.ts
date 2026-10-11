/**
 * The app draws its own icons.
 *
 * An emoji in the interface is not drawn by the app: the phone draws it, each maker in its own
 * style, in full colour where the rest of the screen is two-tone. It also looks perfectly
 * fine to whoever typed it, on their phone — which is how forty-nine of them got in. Icons
 * come from the Phosphor set, through `Glyph` and `IconText`; this is what notices one that
 * did not.
 *
 * Plain typographic marks are not what this is about and are left alone: the `▲`/`▼` beside a
 * percentage and the `▸` on a row that opens are characters of the font, in the text's colour.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

const mobile = fileURLToPath(new URL('../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Pictographs, and the symbol blocks phones draw as emoji: ⚖ ⚠ ⏱ ⏸ ✓ ✕ all live there. */
const PICTURE = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

/** The selector that asks for the emoji form of whatever character it follows. */
const EMOJI_FORM = '\u{FE0F}';

const hasEmoji = (line: string) => PICTURE.test(line) || line.includes(EMOJI_FORM);

/** A line that is only a comment. Emoji in prose about the code are nobody's interface. */
const COMMENT = /^\s*(\/\/|\/?\*|\{\/\*)/;

/**
 * Text that leaves the app.
 *
 * A workout shared to a chat is read in that chat, among that chat's own emoji, drawn by the
 * same phone as everything around it. There an emoji is the idiom of the place, not a foreign
 * body in someone else's design.
 */
const SHOWN_ELSEWHERE = new Set(['src/workout/shareText.ts']);

describe('the interface draws its own icons', () => {
  const files = [...sources(join(mobile, 'app')), ...sources(join(mobile, 'src'))]
    .map((path) => ({ path, name: relative(mobile, path).replace(/\\/g, '/') }))
    .filter((file) => !SHOWN_ELSEWHERE.has(file.name));

  it('finds the screens it is checking', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.name === 'app/(tabs)/workouts.tsx')).toBe(true);
  });

  it('has no emoji in what is shown', () => {
    const found: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file.path, 'utf8').split('\n');
      let inBlockComment = false;
      for (const [index, line] of lines.entries()) {
        const opens = line.includes('/*');
        const closes = line.includes('*/');
        const commentLine = inBlockComment || COMMENT.test(line);
        if (opens && !closes) inBlockComment = true;
        if (closes) inBlockComment = false;
        if (commentLine || !hasEmoji(line)) continue;
        found.push(`${file.name}:${index + 1}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('would notice one', () => {
    // The check itself, against the kinds of thing it is there for.
    expect(hasEmoji("<Text>🏋 {t('home.empty')}</Text>")).toBe(true);
    expect(hasEmoji('label="⚖ שקילה"')).toBe(true);
    expect(hasEmoji('<Text style={s.tick}>✓</Text>')).toBe(true);
    expect(hasEmoji('{up ? "▲" : "▼"} {percent}%')).toBe(false);
    expect(hasEmoji("<Text>{t('home.empty')}</Text>")).toBe(false);
  });
});
