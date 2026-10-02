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
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { ProgressRing } from '../ProgressRing.js';
import { RollingNumber } from '../RollingNumber.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';

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
}

export function WorkoutHeader({
  name,
  doneSets,
  totalSets,
  startedAt,
  progress,
  onFinish,
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


  });
