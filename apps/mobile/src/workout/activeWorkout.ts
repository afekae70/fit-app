/**
 * Whether a workout is open right now — shared with the parts of the app that behave differently
 * during one.
 *
 * The tab swipe is the reason it exists. Mid-workout a sideways drag means "next exercise", and a
 * drag that missed the card by a finger's width used to throw the whole screen onto another tab.
 * So while a workout is open, sideways belongs to the exercises alone.
 *
 * A tiny store rather than context: the workout screen writes it and the tab wrapper, which sits
 * above every screen, reads it — neither is the other's parent.
 */

let active = false;
const listeners = new Set<(value: boolean) => void>();

export function isWorkoutActive(): boolean {
  return active;
}

export function setWorkoutActive(value: boolean): void {
  if (value === active) return;
  active = value;
  for (const listener of listeners) listener(value);
}

export function onWorkoutActiveChange(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
