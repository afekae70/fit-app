/**
 * "The profile on this phone was just changed by sync."
 *
 * Screens read the profile when they come into view, which is enough for an edit the user made
 * themselves — they made it on a screen, and left it. A change that arrives from another phone
 * arrives while something is already showing, and the one thing mounted for the whole session
 * that depends on the profile is the units setting.
 *
 * Its own file, with nothing in it but this, so that listening does not mean importing the
 * network and file code that does the syncing.
 */

const listeners = new Set<() => void>();

/** Be told when sync has written to the profile. Returns the way to stop. */
export function onProfilePulled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceProfilePulled(): void {
  for (const listener of [...listeners]) listener();
}
