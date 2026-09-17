/**
 * The sounds of a timed workout: a short pip on each of the last three seconds of a phase, then
 * an exercise ending, a rest ending, or the whole thing finishing.
 *
 * Three rather than one, because the sound is the whole interface while someone is holding a
 * plank with the phone on the floor. A falling pair means stop, a rising pair means go, and a
 * short chime means done — distinguishable without looking, which is the point of having a sound
 * at all.
 *
 * Generated tones, bundled with the app: no network, no licence, and each well under a second.
 *
 * Every call is wrapped so a sound that fails to load or play can never take the timer down with
 * it. A silent timer is a nuisance; a timer that throws halfway through an ab circuit is broken.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import done from '../../assets/sounds/done.wav';
import restEnd from '../../assets/sounds/rest-end.wav';
import tick from '../../assets/sounds/tick.wav';
import { replayFromStart } from './replay.js';
import workEnd from '../../assets/sounds/work-end.wav';

export type Cue = 'tick' | 'workEnd' | 'restEnd' | 'done';

const SOURCES: Record<Cue, number> = { tick, workEnd, restEnd, done };

let players: Partial<Record<Cue, AudioPlayer>> | null = null;

/**
 * Load the players and set how they share the speaker.
 *
 * `duckOthers`: music playing in another app is lowered for the beep and comes back, rather than
 * being stopped — at the gym the beep is almost always playing over someone's headphones.
 * `playsInSilentMode`: a timer that goes quiet because the ringer is off is a timer that fails
 * exactly in the place phones are most often on silent.
 */
export async function prepareCues(): Promise<void> {
  if (players) return;
  players = {};
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
    });
  } catch {
    // Keep going: the default mode still plays, it just handles other audio less politely.
  }
  for (const cue of Object.keys(SOURCES) as Cue[]) {
    try {
      players[cue] = createAudioPlayer(SOURCES[cue]);
    } catch {
      // That one cue stays silent; the others and the timer carry on.
    }
  }
}

export function playCue(cue: Cue): void {
  const player = players?.[cue];
  if (!player) return;
  // From the start every time, the rewind finished before the play — see replay.ts for why firing
  // the two together silenced the first sound of every kind.
  replayFromStart(player).catch(() => {
    // Silent rather than fatal. See the note at the top.
  });
}

/** Free the players when the timer screen goes away; they hold native resources. */
export function releaseCues(): void {
  if (!players) return;
  for (const player of Object.values(players)) {
    try {
      player?.remove();
    } catch {
      // Already gone.
    }
  }
  players = null;
}
