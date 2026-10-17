/**
 * A number that counts up to itself when it appears, and from its old value to its new one
 * when it changes.
 *
 * The figures on a stat tile arrive already formatted — "1,718", "83%", "−2.7" isolated for
 * right-to-left — so this works on the text: it finds the one number in it, and redraws the same
 * text with that number on its way there, in the same grouping and the same number of decimals.
 * A text with no number, or with two ("26/26"), is shown as it is: counting one half of a
 * fraction up while the other stands still reads as a glitch, not a flourish.
 *
 * The arithmetic is here and tested; the hook only drives it from animation frames. It does
 * nothing at all for anyone whose system asks for reduced motion.
 */

import { useEffect, useRef, useState } from 'react';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export interface CountableText {
  /** The text before and after the number. */
  before: string;
  after: string;
  value: number;
  decimals: number;
  grouped: boolean;
}

/** The single number in a formatted text, or null when there is not exactly one. */
export function countable(text: string): CountableText | null {
  const matches = [...text.matchAll(NUMBER)];
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  const raw = match[0];
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const index = match.index;
  return {
    before: text.slice(0, index),
    after: text.slice(index + raw.length),
    value,
    decimals: raw.includes('.') ? raw.split('.')[1]!.length : 0,
    grouped: raw.includes(','),
  };
}

/** The text with its number at `value`, written as the original was. */
export function withValue(parts: CountableText, value: number): string {
  const number = value.toLocaleString('en-US', {
    minimumFractionDigits: parts.decimals,
    maximumFractionDigits: parts.decimals,
    useGrouping: parts.grouped,
  });
  return `${parts.before}${number}${parts.after}`;
}

/** Ease-out: quick at first, settling into the figure — the way a counter on a scoreboard lands. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

const DURATION_MS = 700;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(text: string): string {
  const [shown, setShown] = useState(() => {
    const parts = countable(text);
    return parts && !reducedMotion() ? withValue(parts, 0) : text;
  });
  /** The value last drawn, so a count that is interrupted resumes from what was on screen. */
  const drawn = useRef(0);

  useEffect(() => {
    const parts = countable(text);
    if (!parts || reducedMotion()) {
      setShown(text);
      return;
    }
    const start = performance.now();
    const origin = drawn.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      drawn.current = origin + (parts.value - origin) * easeOut(t);
      setShown(t >= 1 ? text : withValue(parts, drawn.current));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text]);

  return shown;
}
