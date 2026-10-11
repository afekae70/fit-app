import { describe, expect, it } from 'vitest';

import { CONFETTI_COLOURS, confettiPieces } from './confetti.js';

describe('the confetti thrown when a workout is finished', () => {
  const pieces = confettiPieces(36);

  it('is as many pieces as were asked for', () => {
    expect(pieces).toHaveLength(36);
    expect(confettiPieces(0)).toEqual([]);
    expect(confettiPieces(-3)).toEqual([]);
  });

  it('is the same burst every time', () => {
    expect(confettiPieces(36)).toEqual(pieces);
  });

  it('is a different burst from a different seed', () => {
    expect(confettiPieces(36, 7)).not.toEqual(pieces);
  });

  it('throws every piece upward before it falls', () => {
    // `rise` and `fall` are both distances: up first, then down past the start.
    for (const piece of pieces) {
      expect(piece.rise).toBeGreaterThanOrEqual(30);
      expect(piece.fall).toBeGreaterThanOrEqual(140);
    }
  });

  it('goes both ways, and about evenly', () => {
    const left = pieces.filter((piece) => piece.dx < 0).length;
    const right = pieces.filter((piece) => piece.dx > 0).length;
    expect(left).toBeGreaterThan(pieces.length / 3);
    expect(right).toBeGreaterThan(pieces.length / 3);
  });

  it('covers the fan rather than clumping in one part of it', () => {
    // Sixths of the width the burst reaches; every one of them has something in it.
    const reach = Math.max(...pieces.map((piece) => Math.abs(piece.dx)));
    const bands = new Set(
      pieces.map((piece) => Math.min(5, Math.floor(((piece.dx + reach) / (2 * reach)) * 6))),
    );
    expect(bands.size).toBe(6);
  });

  it('stays on a phone screen', () => {
    for (const piece of pieces) {
      expect(Math.abs(piece.dx)).toBeLessThanOrEqual(230);
      expect(piece.rise).toBeLessThanOrEqual(230);
      expect(piece.fall).toBeLessThanOrEqual(300);
    }
  });

  it('spins every piece, some each way', () => {
    expect(pieces.every((piece) => Math.abs(piece.spin) >= 180)).toBe(true);
    expect(pieces.some((piece) => piece.spin < 0)).toBe(true);
    expect(pieces.some((piece) => piece.spin > 0)).toBe(true);
  });

  it('uses every colour, and both shapes', () => {
    expect(new Set(pieces.map((piece) => piece.color)).size).toBe(CONFETTI_COLOURS);
    expect(new Set(pieces.map((piece) => piece.shape))).toEqual(new Set(['bar', 'dot']));
  });

  it('sets the pieces off close together, not all at once', () => {
    expect(pieces.every((piece) => piece.delay >= 0 && piece.delay <= 0.15)).toBe(true);
    expect(new Set(pieces.map((piece) => piece.delay)).size).toBeGreaterThan(10);
  });

  it('keeps pieces small enough to be paper and big enough to see', () => {
    expect(pieces.every((piece) => piece.size >= 6 && piece.size <= 10)).toBe(true);
  });
});
