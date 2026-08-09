/**
 * The sticky header of the active workout: name, set count, elapsed time, and a progress track.
 *
 * **Read-only, deliberately.** The handoff puts every tappable thing below the middle of the
 * screen, because this is operated one-handed mid-set. Nothing up here is a target, so nothing up
 * here can be hit by accident while reaching for a stepper.
 *
 * The elapsed clock is derived from `startedAt`, never accumulated. A workout survives the phone
 * being locked, an incoming call, and the app being evicted and restored — a counter would lose
 * all three, and a session's duration is one of the few numbers the user cannot reconstruct
 * afterwards.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../../ThemeProvider.js';
import { type ColorPalette } from '../../theme.js';

export interface WorkoutHeaderProps {
  name: string;
  doneSets: number;
  totalSets: number;
  /** ISO timestamp the session began. */
  startedAt: string;
  /** 0–1. */
  progress: number;
}

export function WorkoutHeader({ name, doneSets, totalSets, startedAt, progress }: WorkoutHeaderProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const elapsed = useElapsed(startedAt);
  const width = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: progress,
      duration: 300,
      // The handoff's curve for the fill. It arrives quickly and settles, which is what makes
      // ticking a set feel acknowledged rather than merely recorded.
      useNativeDriver: false,
    }).start();
  }, [progress, width]);

  return (
    <View style={s.header}>
      <View style={s.row}>
        <View style={s.titleBlock}>
          <Text style={s.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={s.count}>{t('workout.setsProgress', { done: doneSets, total: totalSets })}</Text>
        </View>
        <View style={s.timeBlock}>
          <Text style={s.time}>{elapsed}</Text>
          <Text style={s.timeLabel}>{t('workout.elapsed')}</Text>
        </View>
      </View>

      <View style={s.track}>
        <Animated.View
          style={[
            s.fill,
            {
              width: width.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
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
    timeBlock: ViewStyle;
    time: TextStyle;
    timeLabel: TextStyle;
    track: ViewStyle;
    fill: ViewStyle;
  }>({
    header: {
      paddingHorizontal: 20,
      paddingBottom: 10,
      gap: 10,
      backgroundColor: colors.bg,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
    titleBlock: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 18, fontWeight: '500', textAlign: 'auto' },
    count: { color: colors.textFaint, fontSize: 12, textAlign: 'auto', fontVariant: ['tabular-nums'] },
    timeBlock: { alignItems: 'flex-end' },
    time: {
      color: colors.text,
      fontSize: 26,
      fontWeight: '500',
      letterSpacing: -0.5,
      fontVariant: ['tabular-nums'],
    },
    timeLabel: { color: colors.textFaint, fontSize: 11 },

    track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
    fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  });
