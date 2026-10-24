/**
 * The store listing against Google Play's limits, so a sentence added later cannot make the
 * text fail at the moment it is pasted into Play Console.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const listing = readFileSync(join(import.meta.dirname, 'listing.md'), 'utf8').replace(/\r\n/g, '\n');

/** The text under `### field` within `## language`, trimmed. */
function field(language: string, name: string): string {
  const section = listing.split(/^## /m).find((part) => part.startsWith(`${language}\n`)) ?? '';
  const block = section.split(/^### /m).find((part) => part.startsWith(`${name}\n`)) ?? '';
  return block.slice(name.length + 1).trim();
}

/** Play counts characters as people see them, not UTF-16 units. */
const length = (text: string) => [...text].length;

describe.each(['he-IL', 'en-US'])('the %s listing', (language) => {
  it('has a title of at most 30 characters', () => {
    expect(field(language, 'title')).not.toBe('');
    expect(length(field(language, 'title'))).toBeLessThanOrEqual(30);
  });

  it('has a short description of at most 80 characters', () => {
    expect(field(language, 'short')).not.toBe('');
    expect(length(field(language, 'short'))).toBeLessThanOrEqual(80);
  });

  it('has a full description of at most 4000 characters', () => {
    expect(length(field(language, 'full'))).toBeGreaterThan(400);
    expect(length(field(language, 'full'))).toBeLessThanOrEqual(4000);
  });

  it('uses no emoji, which Play counts against an app in its titles and reads as spam', () => {
    const all = ['title', 'short', 'full'].map((name) => field(language, name)).join('\n');
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
