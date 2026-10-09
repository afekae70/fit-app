/**
 * The signed-in user's profile picture, for a screen to draw — kept current.
 *
 * Null is no picture: draw the initials. The value follows the file, whoever changed it: the
 * user on the profile screen, or sync bringing one down from another phone while this screen
 * was already showing.
 */

import { useEffect, useState } from 'react';

import { loadAvatar, onAvatarChange } from './avatar.js';

export function useAvatar(userId: string): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadAvatar(userId).then((next) => {
        if (!cancelled) setUri(next);
      });
    };
    load();
    const stop = onAvatarChange(load);
    return () => {
      cancelled = true;
      stop();
    };
  }, [userId]);

  return uri;
}
