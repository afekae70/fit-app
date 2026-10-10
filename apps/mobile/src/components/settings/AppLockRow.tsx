/**
 * The switch for the fingerprint door (see `auth/lockPolicy.ts`), as a row in settings.
 *
 * This switch is the only way the lock comes into being: it is off until someone turns it on
 * here. Nobody is met at the door by a fingerprint prompt they did not ask for.
 *
 * Draws nothing on a phone with no fingerprint enrolled. A switch that could only ever say
 * "cannot be turned on" is clutter, and the row would otherwise advertise a feature the phone
 * does not offer.
 *
 * Changing it — either way — takes a fingerprint first. Turning it on, because that is the
 * moment to find out the reader works rather than the next time the app is opened and the door
 * is already shut. Turning it off, because otherwise the lock would stop exactly nobody: anyone
 * handed the unlocked phone could switch it off in two taps and keep it that way.
 *
 * It carries its own divider underneath, so the section it sits in needs no logic of its own
 * about whether the row is there.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  biometricsAvailable,
  loadLockEnabled,
  saveLockEnabled,
  unlockWithBiometrics,
} from '../../auth/appLock.js';
import { useActionSheet } from '../ActionSheetProvider.js';
import { RowDivider, ToggleRow } from './kit.js';

export function AppLockRow({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { notify } = useActionSheet();
  // Asked once: a fingerprint enrolled while this screen is open shows up the next time it is.
  const [available] = useState(biometricsAvailable);
  const [on, setOn] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void loadLockEnabled(userId).then((enabled) => {
      if (!cancelled) setOn(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [available, userId]);

  if (!available) return null;

  const change = (next: boolean) => {
    if (changing) return;
    setChanging(true);
    void (async () => {
      try {
        const outcome = await unlockWithBiometrics(t('lock.prompt'));
        if (outcome === 'unlocked') {
          await saveLockEnabled(userId, next);
          setOn(next);
        } else if (outcome !== 'cancelled') {
          // The switch stays where it was, and they are told why it did not move.
          await notify({
            message: t(outcome === 'locked_out' ? 'lock.lockedOut' : 'lock.failed'),
          });
        }
      } catch {
        await notify({ message: t('lock.failed') });
      } finally {
        setChanging(false);
      }
    })();
  };

  return (
    <>
      <ToggleRow
        label={t('settings.appLock')}
        hint={t('settings.appLockHint')}
        value={on}
        onChange={change}
        disabled={changing}
      />
      <RowDivider />
    </>
  );
}
