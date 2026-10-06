/**
 * The sticky header of the active workout: name, set count, elapsed time, and a progress track.
 *
 * One control up here: Finish, on the leading side, away from the sets. It used to sit at the
 * bottom of the page, under every exercise — a scroll away in the full list, and easy to miss in
 * focus mode. At the top it is always where the eye starts, and far from anything a thumb is
 * reaching for mid-set.
 *
 * The elapsed clock is derived from `startedAt`, never accumulated. A workout survives the phone
 * being locked, an incoming call, and the app being evicted and restored — a counter would lose
 * all three, and a session's duration is one of the few numbers the user cannot reconstruct
 * afterwards.
 *
 * The heart rate, when a watch is sending one, sits beside the clock. It is not there at all
 * otherwise: someone training without a watch gets the header they always had, rather than a
 * dash where a number would be.
 */

import { Heart } from 'phosphor-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { ProgressRing } from '../ProgressRing.js';
import { RollingNumber } from '../RollingNumber.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import type { HeartRateZone } from '../../workout/heartRate.js';

/** A live reading and the zone it falls in — null zone when there is no maximum to measure by. */
export interface HeaderHeartRate {
  bpm: number;
  zone: HeartRateZone | null;
}

export interface WorkoutHeaderProps {
  name: string;
  doneSets: number;
  totalSets: number;
  /** ISO timestamp the session began. */
  startedAt: string;
  /** 0–1. */
  progress: number;
  /** Open the finish sheet. */
  onFinish?: () => void;
  /** The current heart rate from the watch. Null, and nothing is shown. */
  heartRate?: HeaderHeartRate | null;
}

export function WorkoutHeader({
  name,
  doneSets,
  totalSets,
  startedAt,
  progress,
  onFinish,
  heartRate = null,
}: WorkoutHeaderProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const elapsed = useElapsed(startedAt);

  return (
    <View style={s.header}>
      <View style={s.row}>
        {onFinish ? (
          <Pressable
            onPress={onFinish}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [s.finish, pressed && s.pressed]}
          >
            <Text style={s.finishText}>{t('workout.finishShort')}</Text>
          </Pressable>
        ) : null}
        <View style={s.titleBlock}>
          <Text style={s.name} numberOfLines={1}>
            {name}
          </Text>
          {/* The clock rolls: only the digit that changed moves, which is what makes a second
              passing read as a second passing. */}
          <RollingNumber value={elapsed} style={s.time} lineHeight={30} align="start" />
          <Text style={s.timeLabel}>{t('workout.elapsed')}</Text>
        </View>

        {heartRate ? <HeartRateReadout heartRate={heartRate} /> : null}

        {/* The sets as a ring rather than a bar under the header: it holds its own number, and
            it reads from the distance a phone is held at between sets. */}
        <ProgressRing fraction={progress} size={62} thickness={7}>
          <Text style={s.ringValue}>
            {doneSets}
            <Text style={s.ringTotal}>/{totalSets}</Text>
          </Text>
        </ProgressRing>
      </View>
    </View>
  );
}

/**
 * The colour a zone is shown in, climbing the palette as the effort does.
 *
 * Violet, magenta, amber, red — the palette's own ramp rather than the traffic lights every
 * fitness app borrows, which would be the only green on the screen. Resting and "no zone known"
 * are both quiet: a heart rate between sets is information, not an alarm.
 */
function zoneColor(zone: HeartRateZone | null, colors: ColorPalette): string {
  switch (zone) {
    case 5:
      return colors.danger;
    case 4:
      return colors.warning;
    case 3:
      return colors.info;
    case 2:
      return colors.accent;
    case 1:
      return colors.textSecondary;
    default:
      return colors.textMuted;
  }
}

/**
 * The heart rate: the number, and a heart that beats in time with it.
 *
 * The beat is the reading made visible — at 150 it visibly races, at 70 it idles — which says more
 * at a glance from arm's length than three digits do. It is keyed to the nearest ten rather than
 * to the exact figure, because a loop restarted on every reading never completes a beat.
 *
 * Transform only, on the native driver. The colour is a plain prop on the icon and never
 * animated: mixing a JS-driven colour onto this node is the crash CLAUDE.md warns about.
 */
function HeartRateReadout({ heartRate }: { heartRate: HeaderHeartRate }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const beat = useRef(new Animated.Value(0)).current;
  const pace = Math.max(40, Math.round(heartRate.bpm / 10) * 10);

  useEffect(() => {
    const period = 60000 / pace;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, {
          toValue: 1,
          duration: period * 0.25,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(beat, {
          toValue: 0,
          duration: period * 0.75,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beat, pace]);

  const color = zoneColor(heartRate.zone, colors);
  const scale = beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });

  return (
    <View
      style={s.heart}
      accessible
      accessibilityLabel={t('workout.heartRateLabel', { bpm: heartRate.bpm })}
    >
      <View style={s.heartRow}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Heart size={15} weight="fill" color={color} />
        </Animated.View>
        <Text style={s.heartValue}>{heartRate.bpm}</Text>
      </View>
      <Text style={s.heartLabel}>
        {heartRate.zone && heartRate.zone > 0
          ? t('workout.heartRateZone', { zone: heartRate.zone })
          : t('workout.heartRate')}
      </Text>
    </View>
  );
}

/**
 * `h:mm` or `m:ss` since the session started, recomputed from the wall clock.
 *
 * Same reasoning as the rest banner: the interval only asks for a repaint. The number itself is
 * always `now - startedAt`, so a suspended timer costs a stale second on screen and nothing more.
 */
function useElapsed(startedAt: string): string {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return '0:00';
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}:${`${minutes}`.padStart(2, '0')}`;
  return `${minutes}:${`${seconds % 60}`.padStart(2, '0')}`;
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    header: ViewStyle;
    row: ViewStyle;
    titleBlock: ViewStyle;
    name: TextStyle;
    count: TextStyle;
    time: TextStyle;
    timeLabel: TextStyle;
    ringValue: TextStyle;
    ringTotal: TextStyle;
    finish: ViewStyle;
    finishText: TextStyle;
    pressed: ViewStyle;
    heart: ViewStyle;
    heartRow: ViewStyle;
    heartValue: TextStyle;
    heartLabel: TextStyle;
  }>({
    finish: {
      alignSelf: 'center',
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      ...shadow(colors.shadow).card,
    },
    ringValue: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    ringTotal: { color: colors.textFaint, fontSize: 11, fontWeight: '500' },
    finishText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
    pressed: { opacity: 0.7 },
    // A card of its own rather than a strip welded to the top of the page, like everything
    // else on this screen now.
    header: {
      marginHorizontal: 4,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).card,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    titleBlock: { flex: 1, gap: 1 },
    name: { color: colors.text, fontSize: 18, fontWeight: '500', textAlign: 'auto' },
    count: { color: colors.textFaint, fontSize: 12, textAlign: 'auto', fontVariant: ['tabular-nums'] },
    time: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '500',
      letterSpacing: -0.5,
      fontVariant: ['tabular-nums'],
    },
    timeLabel: { color: colors.textFaint, fontSize: 11 },
    heart: { alignItems: 'center', gap: 1, minWidth: 48 },
    // Always left to right: the heart leads its number in Hebrew as well, the way a unit follows
    // a figure — a mirrored row would read as "132 ♥".
    heartRow: { flexDirection: 'row', alignItems: 'center', gap: 4, direction: 'ltr' },
    heartValue: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
      letterSpacing: -0.5,
      fontVariant: ['tabular-nums'],
    },
    heartLabel: { color: colors.textFaint, fontSize: 11 },
  });
