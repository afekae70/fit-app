import { describe, expect, it } from 'vitest';

import {
  primePlayers,
  replayFromStart,
  type PrimablePlayer,
  type ReplayablePlayer,
} from './replay.js';

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

describe('warming the players up', () => {
  function logged(name: string, log: string[], failOnPlay = false): PrimablePlayer {
    let volume = 1;
    return {
      currentTime: 0,
      get volume() {
        return volume;
      },
      set volume(value: number) {
        volume = value;
        log.push(`${name}:volume=${value}`);
      },
      seekTo: () => Promise.resolve(),
      play: () => {
        if (failOnPlay) throw new Error('no audio');
        log.push(`${name}:play@${volume}`);
      },
      pause: () => log.push(`${name}:pause`),
    };
  }
  const instant = () => Promise.resolve();

  it('plays every player only after it has been silenced, and gives the volume back after', async () => {
    const log: string[] = [];
    await primePlayers([logged('tick', log), logged('end', log)], instant);
    expect(log).toEqual([
      'tick:volume=0',
      'end:volume=0',
      'tick:play@0',
      'end:play@0',
      'tick:pause',
      'end:pause',
      'tick:volume=1',
      'end:volume=1',
    ]);
  });

  it('never plays anything at full volume', async () => {
    const log: string[] = [];
    await primePlayers([logged('tick', log), logged('end', log)], instant);
    expect(log.filter((entry) => entry.includes(':play@')).every((entry) => entry.endsWith('@0'))).toBe(true);
  });

  it('restores the volume even when a play fails, so the workout is not left silent', async () => {
    const log: string[] = [];
    const tick = logged('tick', log, true);
    await expect(primePlayers([tick], instant)).rejects.toThrow('no audio');
    expect(tick.volume).toBe(1);
  });

  it('waits before playing, so the silenced volume has reached the player', async () => {
    const order: string[] = [];
    const player = logged('tick', order);
    await primePlayers([player], async (ms) => {
      order.push(`wait:${ms}`);
    });
    expect(order.indexOf('wait:150')).toBeLessThan(order.indexOf('tick:play@0'));
  });
});
