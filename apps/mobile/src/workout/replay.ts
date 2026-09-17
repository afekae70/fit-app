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
