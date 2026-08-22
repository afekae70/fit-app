/**
 * Where this week's work actually went.
 *
 * The weekly volume chart answers "how much" with one number for the whole body, which cannot
 * tell a week of nothing but pressing from a balanced one. This answers "where".
 *
 * Sets, not kilograms: volume per muscle is programmed and researched in sets, and tonnage
 * across muscles is not comparable — a set of calf raises moves more weight than a set of
 * lateral raises and means far less.
 *
 * The bar is scaled against the busiest muscle rather than against the 10-20 target, so the
 * shape of the week is readable at a glance even when everything is under target. The verdict
 * colour carries the comparison to the target instead.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { volumeVerdict, type MuscleWork } from '@fit/shared/calculations';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../theme.js';

export interface MuscleVolumeCardProps {
  worked: readonly MuscleWork[];
  untrained: readonly string[];
}

export function MuscleVolumeCard({ worked, untrained }: MuscleVolumeCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const busiest = worked[0]?.total ?? 0;
  if (worked.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {worked.map((entry) => {
        const verdict = volumeVerdict(entry.total);
        // Guarded: every muscle at zero would divide by zero, and a NaN width renders as a
        // zero-width bar that looks correct by accident.
        const fraction = busiest > 0 ? entry.total / busiest : 0;

        return (
          <View key={entry.muscle} style={styles.row}>
            <Text style={styles.name} numberOfLines={1}>
              {t(`muscle.${entry.muscle}`)}
            </Text>

            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  verdict === 'low' && styles.fillLow,
                  verdict === 'high' && styles.fillHigh,
                  { width: `${Math.max(2, fraction * 100)}%` },
                ]}
              />
            </View>

            {/* The total, with the indirect share beside it. Half a set for a helper is a
                convention rather than a measurement, so a reader deciding whether to add arm
                work should be able to see how much of the arm total came from rows. */}
            <Text style={styles.count}>
              {entry.total}
              {entry.indirect > 0 ? (
                <Text style={styles.indirect}> ({entry.direct})</Text>
              ) : null}
            </Text>
          </View>
        );
      })}

      {untrained.length > 0 ? (
        // The half that changes next week. A list of what was trained describes the week; a list
        // of what was not is what someone acts on.
        <Text style={styles.untrained}>
          {t('progress.untrained')}: {untrained.map((m) => t(`muscle.${m}`)).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    wrap: ViewStyle;
    row: ViewStyle;
    name: TextStyle;
    track: ViewStyle;
    fill: ViewStyle;
    fillLow: ViewStyle;
    fillHigh: ViewStyle;
    count: TextStyle;
    indirect: TextStyle;
    untrained: TextStyle;
  }>({
    wrap: { gap: 6, marginTop: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { color: colors.textSecondary, fontSize: fontSize.xs, width: 78, textAlign: 'auto' },
    track: {
      flex: 1,
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      overflow: 'hidden',
    },
    fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
    // Under the usual range, and over it. Both are worth seeing and neither is an error, so
    // neither uses the app's danger colour.
    fillLow: { backgroundColor: colors.borderStrong },
    fillHigh: { backgroundColor: colors.warning },
    count: {
      color: colors.text,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
      minWidth: 46,
      textAlign: 'auto',
    },
    indirect: { color: colors.textFaint },
    untrained: {
      color: colors.textFaint,
      fontSize: fontSize.xxs,
      lineHeight: 16,
      marginTop: spacing.xs,
      textAlign: 'auto',
    },
  });
