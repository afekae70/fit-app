/**
 * The sounds of a timed workout: a short pip on each of the last three seconds of a phase, then
 * an exercise ending, a rest ending, or the whole thing finishing.
 *
 * Several rather than one, because the sound is the whole interface while someone is holding a
 * plank with the phone on the floor. A falling pair means stop, a rising pair means go, and a
 * short chime means done — distinguishable without looking, which is the point of having a sound
 * at all.
 *
 * Generated tones, bundled with the app: no network, no licence, and each well under a second.
 *
 * Every call is wrapped so a sound that fails to load or play can never take the timer down with
 * it. A silent timer is a nuisance; a timer that throws halfway through an ab circuit is broken.
 *
 * ## Why the first sounds went missing, and the two things that stop it
 *
 * The first countdown pip of a workout, and the first end-of-rest, were silent while every later
 * one played. Getting the rewind and the play in order (replay.ts) was necessary and was not
 * enough, because the cause was below this code: Android's audio output.
 *
 * An audio output that has been quiet for a few seconds goes into standby, and the first fraction
 * of a second of the next sound is lost while it wakes. Between phases there is always quiet —
 * forty-odd seconds of an exercise before its countdown — so the "3" was always the sound that
 * woke it, and a 0.1-second pip is gone entirely in that fraction. It did not help that the old
 * mode requested and released audio focus around every single sound.
 *
 * 1. While the timer runs, a second of silence plays on a loop. Silence still counts as output,
 *    so the speaker path never sleeps and no cue has its start cut off.
 * 2. Every cue is played once, inaudibly, when the screen opens (`primePlayers`), so none of
 *    them builds its own output for the first time at the moment it is needed.
 *
 * Mixing with other audio, not ducking it, follows from the loop: ducking requests audio focus,
 * and a loop that holds focus for a whole workout would hold the user's music down for all of it.
 * The pips now play over music rather than dipping it, which for a sound this short is the better
 * trade.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import done from '../../assets/sounds/done.wav';
import restEnd from '../../assets/sounds/rest-end.wav';
import silence from '../../assets/sounds/silence.wav';
import tick from '../../assets/sounds/tick.wav';
import workEnd from '../../assets/sounds/work-end.wav';
import { primePlayers, replayFromStart } from './replay.js';

export type Cue = 'tick' | 'workEnd' | 'restEnd' | 'done';

const SOURCES: Record<Cue, number> = { tick, workEnd, restEnd, done };

let players: Partial<Record<Cue, AudioPlayer>> | null = null;
let keepAlive: AudioPlayer | null = null;
/** Resolves once the players have been warmed up; a cue asked for before then waits for it. */
let primed: Promise<void> = Promise.resolve();

/**
 * Load the players, set how they share the speaker, and warm them up.
 *
 * `mixWithOthers`: see the note at the top — the keep-alive loop must not hold other audio down.
 * `playsInSilentMode`: a timer that goes quiet because the ringer is off is a timer that fails
 * exactly in the place phones are most often on silent.
 */
export async function prepareCues(): Promise<void> {
  if (players) return;
  players = {};
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
    });
  } catch {
    // Keep going: the default mode still plays.
  }
  for (const cue of Object.keys(SOURCES) as Cue[]) {
    try {
      players[cue] = createAudioPlayer(SOURCES[cue]);
    } catch {
      // That one cue stays silent; the others and the timer carry on.
    }
  }
  try {
    keepAlive = createAudioPlayer(silence);
    keepAlive.loop = true;
  } catch {
    keepAlive = null;
  }

  const created = Object.values(players).filter((player): player is AudioPlayer => Boolean(player));
  primed = primePlayers(created).catch(() => {
    // A failed warm-up leaves the cues exactly as they would have been without one.
  });
  await primed;
}

export function playCue(cue: Cue): void {
  const player = players?.[cue];
  if (!player) return;
  // After the warm-up — a cue played during it would be at volume zero — and from the start
  // every time, with the rewind finished before the play (see replay.ts).
  void primed
    .then(() => replayFromStart(player))
    .catch(() => {
      // Silent rather than fatal. See the note at the top.
    });
}

/** Keep the audio output awake while the timer runs. See the note at the top. */
export function startKeepAlive(): void {
  try {
    keepAlive?.play();
  } catch {
    // Without it the cues still play; the first after a quiet stretch may just start clipped.
  }
}

/** Let the audio output sleep again: paused, finished, or leaving the screen. */
export function stopKeepAlive(): void {
  try {
    keepAlive?.pause();
  } catch {
    // Already stopped.
  }
}

/** Free the players when the timer screen goes away; they hold native resources. */
export function releaseCues(): void {
  stopKeepAlive();
  for (const player of [...Object.values(players ?? {}), keepAlive]) {
    try {
      player?.remove();
    } catch {
      // Already gone.
    }
  }
  players = null;
  keepAlive = null;
  primed = Promise.resolve();
}
