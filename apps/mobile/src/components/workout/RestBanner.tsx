/**
 * The rest banner: a countdown ring, what is coming up, and two ways out.
 *
 * Pinned directly above the tab bar and occupying the same slot the finish bar otherwise uses, so
 * the two can never overlap — while resting, finishing is not the thing you are about to do.
 *
 * ## The clock is a deadline, not a counter
 *
 * `deadline` is an absolute epoch millisecond, and every tick recomputes the remainder from
 * `Date.now()`. A counter decremented once a second is wrong the moment the phone sleeps: iOS and
 * Android both throttle or suspend timers for a backgrounded app, so a pocketed phone comes back
 * showing a minute of rest still to go after two minutes have passed. Reading the wall clock makes
 * the interval a repaint trigger rather than the source of truth — miss ten ticks and the next one
 * still shows the right number.
 *
 * The ring is `react-native-svg`, which is what a stroke-dashoffset countdown needs. In RTL it is
 * mirrored as well as rotated, so it drains in the direction the language reads.
 *
 * ## The last ten seconds
 *
 * The ring turns amber and the whole banner breathes, once a second, in time with the count. It
 * is the one thing on this screen that is about to change by itself, and someone looking at a
 * barbell rather than at their phone should be able to catch it in the corner of an eye. Amber
 * rather than red: rest running out is not a problem, it is the next set arriving.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { formatRemaining, restRingOffset } from '../../workout/derived.js';
import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { duration, radius, type ColorPalette } from '../../theme.js';

const RING_SIZE = 48;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const FADE_MS = duration.normal;
/** When the ring changes colour and the banner starts to pulse. */
const WARNING_SECONDS = 10;
/** What "+30" adds. Named because it appears in the label and the handler and must not drift. */
export const EXTEND_SECONDS = 30;

export interface RestBannerProps {
  /** Absolute epoch ms the rest ends at, or null when not resting. */
  deadline: number | null;
  /** The full rest length in seconds, for the ring's proportion. */
  totalSeconds: number;
  nextLabel: string | null;
  onExtend: () => void;
  onSkip: () => void;
  /** Called once when the countdown reaches zero. */
  onComplete: () => void;
}

export function RestBanner({
  deadline,
  totalSeconds,
  nextLabel,
  onExtend,
  onSkip,
  onComplete,
}: RestBannerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [remaining, setRemaining] = useState(() => remainingFrom(deadline));
  const pulse = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(deadline === null ? 0 : 1)).current;

  // A ref, not state: `onComplete` must fire exactly once per rest, and a re-render between the
  // check and the call would otherwise let it fire twice.
  const completed = useRef(false);

  useEffect(() => {
    completed.current = false;
    setRemaining(remainingFrom(deadline));
    if (deadline === null) return;

    const tick = () => {
      const left = remainingFrom(deadline);
      setRemaining(left);
      if (left <= 0 && !completed.current) {
        completed.current = true;
        onComplete();
      }
    };
    const id = setInterval(tick, 250);
    // Four times a second rather than once: the displayed second should change within a frame or
    // two of the real one, not up to a full second late. It is a cheap repaint of one number.
    return () => clearInterval(id);
    // `onComplete` is a fresh closure each render; depending on it would restart the interval on
    // every tick and reset the fire-once guard along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: deadline === null ? 0 : 1,
      duration: FADE_MS,
      easing: Easing.ease,
      useNativeDriver: true,
    }).start();
  }, [deadline, fade]);

  /*
   * One pulse per second through the last ten, and nothing before them.
   *
   * Driven off the remaining seconds rather than a loop, so the beat lands on the tick rather
   * than drifting against it — the number changing and the banner swelling are the same event.
   */
  const ending = deadline !== null && remaining > 0 && remaining <= WARNING_SECONDS;
  useEffect(() => {
    if (!ending) {
      pulse.setValue(0);
      return;
    }
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [ending, remaining, pulse]);

  if (deadline === null) return null;

  const offset = restRingOffset(remaining, totalSeconds, CIRCUMFERENCE);
  const ringColor = ending ? colors.warning : colors.accent;

  return (
    <Animated.View
      style={[
        s.banner,
        ending && s.bannerEnding,
        {
          opacity: fade,
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) },
          ],
        },
      ]}
    >
      <View style={s.ring}>
        {/* Rotated so the stroke starts at twelve o'clock, and mirrored under RTL so it empties
            the way the text reads. Non-directional glyphs elsewhere deliberately do not mirror;
            a depleting arc is directional. */}
        <Svg
          width={RING_SIZE}
          height={RING_SIZE}
          style={{
            transform: [{ rotate: '-90deg' }, { scaleX: I18nManager.isRTL ? -1 : 1 }],
          }}
        >
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={colors.bg}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={ringColor}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </Svg>
        <View style={s.ringLabel} pointerEvents="none">
          <Text style={[s.ringText, ending && { color: colors.warning }]}>
            {formatRemaining(remaining)}
          </Text>
        </View>
      </View>

      <View style={s.text}>
        <Text style={s.title}>{t('workout.rest')}</Text>
        {nextLabel ? (
          <Text style={s.next} numberOfLines={1}>
            {t('workout.upNext')}: {nextLabel}
          </Text>
        ) : null}
      </View>

      <View style={s.actions}>
        <Pressable
          onPress={() => {
            void hapticLight();
            onExtend();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [s.action, pressed && s.pressed]}
        >
          <Text style={s.actionText}>+{EXTEND_SECONDS}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void hapticLight();
            onSkip();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [s.action, pressed && s.pressed]}
        >
          <Text style={s.actionText}>{t('workout.skipRest')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function remainingFrom(deadline: number | null): number {
  return deadline === null ? 0 : (deadline - Date.now()) / 1000;
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    banner: ViewStyle;
    bannerEnding: ViewStyle;
    ring: ViewStyle;
    ringLabel: ViewStyle;
    ringText: TextStyle;
    text: ViewStyle;
    title: TextStyle;
    next: TextStyle;
    actions: ViewStyle;
    action: ViewStyle;
    pressed: ViewStyle;
    actionText: TextStyle;
  }>({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.accent,
    },
    bannerEnding: { borderColor: colors.warning },

    ring: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
    ringLabel: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    ringText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '500',
      // Tabular, or the digits jostle the centre of the ring every second.
      fontVariant: ['tabular-nums'],
    },

    text: { flex: 1, gap: 2 },
    title: { color: colors.text, fontSize: 14, fontWeight: '500', textAlign: 'auto' },
    next: { color: colors.textFaint, fontSize: 12, textAlign: 'auto' },

    actions: { flexDirection: 'row', gap: 8 },
    action: {
      minWidth: 52,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    pressed: { opacity: 0.6 },
    actionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  });
