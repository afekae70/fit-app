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
  PanResponder,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';

const REVEAL_WIDTH = 88;
const SWIPE_THRESHOLD = 56;
const DISMISS_DISTANCE = 500;

export function SwipeableRow({ children, onDelete }: { children: ReactNode; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);

  /*
   * Which way the row slides to reveal delete.
   *
   * The backdrop's label sits at the logical "end", which mirrors on its own — but a gesture's
   * `dx` is a physical delta and does not, so the direction has to be flipped explicitly.
   *
   * Keyed on the active language, NOT `I18nManager.isRTL`. The app's layout direction now
   * follows i18next immediately (see app/_layout.tsx) while the native flag only updates on the
   * next launch, so reading the flag would leave the swipe running backwards against the layout
   * it is part of for the rest of the session.
   *
   * Held in a ref because the PanResponder below is built once and its handlers would otherwise
   * close over the sign that happened to be current on mount — the same reason WeightSparkline
   * keeps its points in a ref.
   */
  const revealSign = isRtlLanguage(i18n.language as Language) ? 1 : -1;
  const revealSignRef = useRef(revealSign);
  revealSignRef.current = revealSign;

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
        // little give — same clamp shape either way, just mirrored by the reveal sign.
        const next =
          revealSignRef.current < 0
            ? Math.min(0, Math.max(raw, -(REVEAL_WIDTH + 24)))
            : Math.max(0, Math.min(raw, REVEAL_WIDTH + 24));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const dx = dragStart.current + gesture.dx;
        const pastThreshold =
          revealSignRef.current < 0 ? dx < -SWIPE_THRESHOLD : dx > SWIPE_THRESHOLD;
        if (pastThreshold) {
          Animated.timing(translateX, {
            toValue: revealSignRef.current * DISMISS_DISTANCE,
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
