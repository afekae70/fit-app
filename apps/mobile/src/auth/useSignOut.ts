/**
 * Signing out, asked about once.
 *
 * Offered from two places — the menu on every screen and the account section of settings — and
 * the menu is one tap from an entry that sits next to "settings". A sign-out that happens on a
 * slip of the thumb costs a password someone may not remember, so both ask first, in the same
 * words, from here.
 *
 * Nothing on the device is removed. Rows are kept per account, so signing back in finds the
 * training log where it was — which is what the question says, because "sign out" on most
 * phones reads as "and lose what was here".
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActionSheet } from '../components/ActionSheetProvider.js';
import { useAuth } from './AuthProvider.js';

export function useSignOut(): () => void {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const { confirm } = useActionSheet();

  return useCallback(() => {
    void (async () => {
      const sure = await confirm({
        title: t('settings.signOutTitle'),
        message: t('settings.signOutBody'),
        confirmLabel: t('auth.signOut'),
      });
      if (sure) await signOut();
    })();
  }, [confirm, signOut, t]);
}
