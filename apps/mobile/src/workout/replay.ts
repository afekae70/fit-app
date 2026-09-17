/**
 * Play a short sound from its beginning, every time — including the first.
 *
 * Kept free of expo-audio so the ordering can be tested; `sounds.ts` passes the real player in.
 *
 * The bug this exists for: the first sound of every kind in a timed workout was silent — the
 * first countdown pip (so the countdown seemed to start a second late), the first exercise-end,
 * the first rest-end — while every later one played. The rewind and the play were fired together
 * as `void seekTo(0); play()`. In expo-audio `play` is a synchronous function and `seekTo` an async
 * one, so on the device they could reach the native player in the opposite order: play, then the
 * rewind landing on top of it.
 *
 * From the second time on that happened to work. A player that has already played is parked at
 * its end, where play alone does nothing, and the late rewind restarted it. The first time, the
 * player was fresh at position zero: play started it, and the rewind arriving a moment later cut
 * into the very start, while Android was still opening the audio output, and the sound was lost.
 *
 * So the rewind is awaited before playing, and skipped entirely for a player already at its
 * start — there is nothing to rewind, and no reason to disturb the one play that has to succeed
 * cold.
 */

export interface ReplayablePlayer {
  readonly currentTime: number;
  seekTo(seconds: number): Promise<void>;
  play(): void;
}

export async function replayFromStart(player: ReplayablePlayer): Promise<void> {
  if (player.currentTime > 0) await player.seekTo(0);
  player.play();
}

export interface PrimablePlayer extends ReplayablePlayer {
  volume: number;
  pause(): void;
}

/**
 * Play every player once, inaudibly, so that none of them makes its first real sound cold.
 *
 * Android builds a player's audio output the first time it plays, and the first fraction of a
 * second of that play can be lost while it does. For a 0.1-second countdown pip that is the whole
 * sound — which is how the first "3" of a workout went missing while every later pip played.
 *
 * The volume goes to zero first and play waits for it: the setter reaches the native player
 * asynchronously, and a play that arrived before it would sound all four cues at once. Each is
 * paused and its volume restored only after it has had time to run, and restored even when a
 * step fails, so a hiccup here can never leave the cues muted for the workout.
 */
export async function primePlayers(
  players: readonly PrimablePlayer[],
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (const player of players) player.volume = 0;
  try {
    await wait(150);
    for (const player of players) player.play();
    await wait(900);
    for (const player of players) player.pause();
  } finally {
    for (const player of players) player.volume = 1;
  }
}
