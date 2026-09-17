import { describe, expect, it } from 'vitest';

import { replayFromStart, type ReplayablePlayer } from './replay.js';

/** A player that records what reached it, and in what order — the order is the bug. */
function recorder(startAt: number, seekDelayMs = 20) {
  const calls: string[] = [];
  let position = startAt;
  const player: ReplayablePlayer = {
    get currentTime() {
      return position;
    },
    seekTo: (seconds) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          position = seconds;
          calls.push(`seek:${seconds}`);
          resolve();
        }, seekDelayMs),
      ),
    play: () => {
      calls.push(`play@${position}`);
    },
  };
  return { player, calls };
}

describe('replaying a cue', () => {
  it('plays a fresh player straight away, without rewinding it first', async () => {
    // The first sound of each kind: a rewind landing on top of this play is what silenced it.
    const { player, calls } = recorder(0);
    await replayFromStart(player);
    // Wait past the rewind delay: a rewind fired alongside the play lands after the function has
    // returned, and checking straight away would miss exactly the late arrival that was the bug.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toEqual(['play@0']);
  });

  it('rewinds a player that has played before, and only then plays', async () => {
    const { player, calls } = recorder(0.49);
    await replayFromStart(player);
    expect(calls).toEqual(['seek:0', 'play@0']);
  });

  it('waits for a slow rewind rather than playing from the end', async () => {
    const { player, calls } = recorder(0.11, 80);
    await replayFromStart(player);
    expect(calls[calls.length - 1]).toBe('play@0');
    expect(calls.indexOf('seek:0')).toBeLessThan(calls.indexOf('play@0'));
  });
});
