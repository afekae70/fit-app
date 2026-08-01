/**
 * Horizontal swipe-to-reveal-delete for a single list row.
 *
 * Built on `PanResponder` rather than `react-native-gesture-handler`: gesture-handler is a
 * native module, and adding one now would sit inert until the next native rebuild — it would not
 * load on the dev client already installed on the user's phone. `PanResponder` ships in
 * react-native core, so this works against today's build with no rebuild required.
 *
 * `translateX` stays native-driven for its whole life (`setValue` during the drag, `timing`/
 * `spring` on release) — see ui.tsx's SegmentButton for why mixing driver modes on one node is a
 * hard crash, not just a warning.
 */

import { useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  I18nManager,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

const REVEAL_WIDTH = 88;
const SWIPE_THRESHOLD = 56;
const DISMISS_DISTANCE = 500;
// The backdrop's label sits at the logical "end" (`paddingEnd`/`flex-end` below), which RN
// mirrors to the correct physical side under RTL on its own — but a touch gesture's dx is
// always a physical delta, so the reveal direction itself has to be flipped explicitly to keep
// the two in sync. `I18nManager.isRTL`, not the active language, drives layout mirroring
// throughout this app (see src/i18n/index.ts) — the two can briefly disagree right after a
// language switch, before the "reopen the app" reload happens.
const REVEAL_SIGN = I18nManager.isRTL ? 1 : -1;

export function SwipeableRow({ children, onDelete }: { children: ReactNode; onDelete: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        translateX.stopAnimation((value) => {
          dragStart.current = value;
        });
      },
      onPanResponderMove: (_evt, gesture) => {
        const raw = dragStart.current + gesture.dx;
        // Only lets the row move in the reveal direction, up to the reveal width plus a
        // little give — same clamp shape either way, just mirrored by REVEAL_SIGN.
        const next =
          REVEAL_SIGN < 0
            ? Math.min(0, Math.max(raw, -(REVEAL_WIDTH + 24)))
            : Math.max(0, Math.min(raw, REVEAL_WIDTH + 24));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const dx = dragStart.current + gesture.dx;
        const pastThreshold = REVEAL_SIGN < 0 ? dx < -SWIPE_THRESHOLD : dx > SWIPE_THRESHOLD;
        if (pastThreshold) {
          Animated.timing(translateX, {
            toValue: REVEAL_SIGN * DISMISS_DISTANCE,
            duration: 180,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) onDelete();
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.wrap}>
      <View style={styles.backdrop}>
        <Text style={styles.backdropText}>{t('common.remove')}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    wrap: ViewStyle;
    backdrop: ViewStyle;
    backdropText: TextStyle;
  }>({
    wrap: { justifyContent: 'center' },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.md,
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingEnd: spacing.lg,
    },
    backdropText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  });
