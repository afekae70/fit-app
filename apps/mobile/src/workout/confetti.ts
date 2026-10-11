/**
 * Where each piece of confetti goes when a workout is finished.
 *
 * The burst is thrown up and out from behind the trophy and falls past it: a fan across the
 * top half, not a ring, because paper thrown in the air goes up before it comes down and a
 * shape that spreads evenly in every direction reads as an explosion instead.
 *
 * Worked out here, as plain numbers, and drawn by `components/workout/ConfettiBurst.tsx`.
 * Apart from the drawing so the shape can be tested — that every piece leaves, that they go
 * both ways, that none of them starts by falling — and so that the burst is the same burst
 * every time. It is laid out from a fixed seed: a celebration that looked different on each
 * workout would be noise, and one that is identical is a signature.
 */

export interface ConfettiPiece {
  /** How far it ends up to the side of where it started, in points. Negative is left. */
  dx: number;
  /** How far up it is thrown before it turns. Always positive. */
  rise: number;
  /** How far below its start it has fallen by the end. Always positive. */
  fall: number;
  /** Total rotation over the flight, in degrees. Either direction. */
  spin: number;
  /** Width in points; a bar is this by 1.8 times this, a dot is this both ways. */
  size: number;
  shape: 'bar' | 'dot';
  /** Which of the burst's colours, as an index the drawing takes modulo its palette. */
  color: number;
  /** When in the burst this piece sets off, as a share of its length: 0 to about 0.15. */
  delay: number;
}

/**
 * A small deterministic generator (mulberry32). `Math.random` would do the job and make the
 * shape untestable; this gives the same sequence for the same seed on every phone.
 */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many colours the pieces are dealt across. The drawing supplies that many, or wraps. */
export const CONFETTI_COLOURS = 5;

export function confettiPieces(count: number, seed = 20261011): ConfettiPiece[] {
  const next = sequence(seed);
  const between = (low: number, high: number) => low + next() * (high - low);

  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => {
    // Spread evenly across the fan and then nudged, so the pieces cover it without lining up:
    // pure chance leaves gaps and clumps at this few pieces.
    const slot = (index + 0.5) / Math.max(1, count);
    // From 15° above the horizon on one side to 15° above it on the other, over the top.
    const angle = (15 + slot * 150 + between(-8, 8)) * (Math.PI / 180);
    const throwDistance = between(110, 230);

    return {
      dx: Math.round(Math.cos(angle) * throwDistance),
      rise: Math.round(Math.max(30, Math.sin(angle) * throwDistance)),
      fall: Math.round(between(140, 300)),
      spin: Math.round(between(180, 620) * (next() < 0.5 ? -1 : 1)),
      size: Math.round(between(6, 10)),
      shape: next() < 0.7 ? 'bar' : 'dot',
      color: index % CONFETTI_COLOURS,
      delay: Number(between(0, 0.15).toFixed(3)),
    };
  });
}
