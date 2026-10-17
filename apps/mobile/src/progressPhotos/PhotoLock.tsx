/**
 * The door in front of the progress photos, and the blind over them.
 *
 * Two protections, both for as long as the photos screen is up:
 *
 *  - **A fingerprint to see them** (`lockRules.ts` says when). Until it is given, nothing of the
 *    photos is drawn — not a thumbnail, not a date.
 *  - **No screenshots, no screen recording, and a blank card in the recent-apps list.** Android's
 *    secure-window flag, through `expo-screen-capture`: a picture of someone's body should not be
 *    one press of two buttons away from the gallery, or visible to whoever swipes through the
 *    open apps. It applies to this screen only and is lifted when the screen is left.
 *
 * `expo-screen-capture` is native code (see CLAUDE.md): it is in the build from this version on,
 * and only this file imports it.
 */

import { usePreventScreenCapture } from 'expo-screen-capture';
import { Fingerprint, LockSimple } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { biometricsAvailable, unlockWithBiometrics } from '../auth/appLock.js';
import { BrandButton } from '../components/BrandButton.js';
import { Text } from '../components/Text.js';
import { Card } from '../components/ui.js';
import { hapticSuccess } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import {
  locksOnReturn,
  needsUnlock,
  photosLastUnlockedAt,
  photosUnlockedNow,
} from './lockRules.js';

type Door = 'asking' | 'open' | 'closed' | 'locked_out' | 'no_biometrics';

export function PhotoLock({ children }: { children: ReactNode }) {
  usePreventScreenCapture('progress-photos');
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [door, setDoor] = useState<Door>(() => {
    if (!biometricsAvailable()) return 'no_biometrics';
    return needsUnlock(photosLastUnlockedAt(), Date.now()) ? 'asking' : 'open';
  });

  const ask = useCallback(async () => {
    setDoor('asking');
    const outcome = await unlockWithBiometrics(t('progressPhotos.unlockPrompt'));
    if (outcome === 'unlocked' || outcome === 'unavailable') {
      photosUnlockedNow();
      if (outcome === 'unlocked') hapticSuccess();
      setDoor(outcome === 'unlocked' ? 'open' : 'no_biometrics');
    } else {
      setDoor(outcome === 'locked_out' ? 'locked_out' : 'closed');
    }
  }, [t]);

  // Asked for straight away on the way in: the person has just chosen to look.
  const askedOnce = useRef(false);
  useEffect(() => {
    if (door === 'asking' && !askedOnce.current) {
      askedOnce.current = true;
      void ask();
    }
  }, [door, ask]);

  // Put down and picked up again later: closed, and not asked for by itself — the app's own
  // lock may be asking at that same moment, and two prompts at once refuse each other.
  useEffect(() => {
    let leftAt: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') leftAt = Date.now();
      if (state === 'active') {
        if (locksOnReturn(leftAt, Date.now()) && biometricsAvailable()) setDoor('closed');
        leftAt = null;
      }
    });
    return () => subscription.remove();
  }, []);

  if (door === 'open') return <>{children}</>;

  if (door === 'no_biometrics') {
    return (
      <>
        <Text style={styles.notice}>{t('progressPhotos.noBiometrics')}</Text>
        {children}
      </>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.icon}>
        <LockSimple size={30} color={colors.accent} weight="duotone" />
      </View>
      <Text style={styles.title}>{t('progressPhotos.lockedTitle')}</Text>
      <Text style={styles.body}>
        {door === 'locked_out' ? t('progressPhotos.lockedOut') : t('progressPhotos.lockedBody')}
      </Text>
      {door !== 'asking' ? (
        <BrandButton label={t('progressPhotos.unlock')} onPress={() => void ask()} />
      ) : (
        <Fingerprint size={28} color={colors.textMuted} weight="duotone" />
      )}
    </Card>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    icon: ViewStyle;
    title: TextStyle;
    body: TextStyle;
    notice: TextStyle;
  }>({
    card: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
    icon: {
      width: 64,
      height: 64,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    body: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      lineHeight: 21,
      textAlign: 'center',
    },
    notice: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18, textAlign: 'auto' },
  });
