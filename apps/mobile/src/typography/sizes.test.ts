/**
 * Text comes in the app's sizes, not in whichever number looked right that day.
 *
 * The scale in `theme.ts` is 11, 12, 14, 16, 18, 22. A screen written with 13 here and 15
 * there looks fine alone and slightly off beside its neighbours: the same kind of label a
 * point bigger on one screen than on the next. Fifty-one styles had drifted that way before
 * they were brought back, and this is what stops the next one.
 *
 * Two things are deliberately outside it:
 *
 *  - **9 and 10** are for text inside something else — a calendar cell, a tab, the unit beside
 *    a number in a set row — where a caption will not fit. Nowhere else.
 *  - **24 and up** are display sizes: the numbers read from across a gym, the clock, a
 *    screen's title, an icon drawn through a text style. Each is set for where it sits, and
 *    snapping them to a step would be tidiness at the cost of the thing being read.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fontSize } from '../theme.js';

const mobile = fileURLToPath(new URL('../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Where display sizes begin. Below this, a size is text and must be one of the steps. */
const DISPLAY_FROM = 24;
/** Text inside a control or a calendar cell. */
const MICRO = [9, 10];

describe('text sizes', () => {
  const steps = new Set<number>([
    ...MICRO,
    ...Object.values(fontSize).filter((size) => size < DISPLAY_FROM),
  ]);
  const files = [...sources(join(mobile, 'app')), ...sources(join(mobile, 'src'))];

  it('finds the screens it is checking', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('are the steps of the scale', () => {
    expect([...steps].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 14, 16, 18, 22]);
  });

  it('are never an in-between number', () => {
    const drifted: string[] = [];
    for (const path of files) {
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const [index, line] of lines.entries()) {
        for (const match of line.matchAll(/fontSize: (\d+)/g)) {
          const size = Number(match[1]);
          if (size < DISPLAY_FROM && !steps.has(size)) {
            drifted.push(`${relative(mobile, path).replace(/\\/g, '/')}:${index + 1} (${size})`);
          }
        }
      }
    }
    expect(drifted).toEqual([]);
  });
});
