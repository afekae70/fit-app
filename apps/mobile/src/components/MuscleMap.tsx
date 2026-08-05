/**
 * A schematic body that highlights the muscles an exercise works.
 *
 * Drawn with plain Views rather than SVG on purpose. `react-native-svg` is a native module, and
 * adding one means the installed app cannot run the new JS until it is rebuilt (see CLAUDE.md).
 * A geometric figure of rounded blocks also fails more gracefully than hand-authored anatomy
 * paths would: it reads as a deliberate diagram rather than as a bad drawing of a person.
 *
 * Every exercise in the catalogue is covered automatically, because the highlighting is driven
 * by `primaryMuscle`/`secondaryMuscles` — fields that already exist on all of them. That is
 * what makes this a real fallback rather than a placeholder: the 78 exercises with no photo
 * still show something specific to them.
 */

import { useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { radius, type ColorPalette } from '../theme.js';

/**
 * One block of the figure, positioned as a percentage of the frame.
 *
 * Two figures stand side by side — front on the left, back on the right — because a single
 * silhouette cannot show both a chest and a set of lats. `muscles` lists every catalogue muscle
 * that lights this block up.
 */
interface Region {
  key: string;
  muscles: string[];
  /** Percentages within the figure's own half of the frame. */
  left: number;
  top: number;
  width: number;
  height: number;
  round?: number;
}

const FRONT: Region[] = [
  { key: 'head', muscles: [], left: 38, top: 1, width: 24, height: 11, round: 999 },
  { key: 'front_delt_l', muscles: ['front_delts', 'side_delts'], left: 20, top: 14, width: 17, height: 9, round: 999 },
  { key: 'front_delt_r', muscles: ['front_delts', 'side_delts'], left: 63, top: 14, width: 17, height: 9, round: 999 },
  { key: 'chest', muscles: ['chest'], left: 32, top: 15, width: 36, height: 13 },
  { key: 'core', muscles: ['core'], left: 36, top: 29, width: 28, height: 15 },
  { key: 'oblique_l', muscles: ['obliques'], left: 29, top: 29, width: 6, height: 15 },
  { key: 'oblique_r', muscles: ['obliques'], left: 65, top: 29, width: 6, height: 15 },
  { key: 'bicep_l', muscles: ['biceps'], left: 17, top: 24, width: 12, height: 14 },
  { key: 'bicep_r', muscles: ['biceps'], left: 71, top: 24, width: 12, height: 14 },
  { key: 'forearm_l', muscles: ['forearms'], left: 14, top: 39, width: 11, height: 13 },
  { key: 'forearm_r', muscles: ['forearms'], left: 75, top: 39, width: 11, height: 13 },
  { key: 'quad_l', muscles: ['quads'], left: 33, top: 46, width: 14, height: 24 },
  { key: 'quad_r', muscles: ['quads'], left: 53, top: 46, width: 14, height: 24 },
  { key: 'calf_fl', muscles: ['calves'], left: 34, top: 72, width: 12, height: 18 },
  { key: 'calf_fr', muscles: ['calves'], left: 54, top: 72, width: 12, height: 18 },
];

const BACK: Region[] = [
  { key: 'head_b', muscles: [], left: 38, top: 1, width: 24, height: 11, round: 999 },
  { key: 'trap', muscles: ['traps'], left: 34, top: 12, width: 32, height: 9 },
  { key: 'rear_delt_l', muscles: ['rear_delts', 'side_delts'], left: 20, top: 14, width: 17, height: 9, round: 999 },
  { key: 'rear_delt_r', muscles: ['rear_delts', 'side_delts'], left: 63, top: 14, width: 17, height: 9, round: 999 },
  { key: 'lat_l', muscles: ['lats'], left: 27, top: 22, width: 12, height: 16 },
  { key: 'lat_r', muscles: ['lats'], left: 61, top: 22, width: 12, height: 16 },
  { key: 'mid_back', muscles: ['mid_back'], left: 39, top: 22, width: 22, height: 12 },
  { key: 'lower_back', muscles: ['lower_back'], left: 39, top: 35, width: 22, height: 10 },
  { key: 'tricep_l', muscles: ['triceps'], left: 17, top: 24, width: 12, height: 14 },
  { key: 'tricep_r', muscles: ['triceps'], left: 71, top: 24, width: 12, height: 14 },
  { key: 'forearm_bl', muscles: ['forearms'], left: 14, top: 39, width: 11, height: 13 },
  { key: 'forearm_br', muscles: ['forearms'], left: 75, top: 39, width: 11, height: 13 },
  { key: 'glute', muscles: ['glutes'], left: 33, top: 46, width: 34, height: 12 },
  { key: 'ham_l', muscles: ['hamstrings'], left: 33, top: 59, width: 14, height: 13 },
  { key: 'ham_r', muscles: ['hamstrings'], left: 53, top: 59, width: 14, height: 13 },
  { key: 'calf_bl', muscles: ['calves'], left: 34, top: 74, width: 12, height: 16 },
  { key: 'calf_br', muscles: ['calves'], left: 54, top: 74, width: 12, height: 16 },
];

export interface MuscleMapProps {
  primaryMuscle: string;
  secondaryMuscles?: string[];
  /** Height of the figures in points; width follows from the aspect ratio. */
  height?: number;
}

export function MuscleMap({ primaryMuscle, secondaryMuscles = [], height = 120 }: MuscleMapProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const secondary = useMemo(() => new Set(secondaryMuscles), [secondaryMuscles]);

  const renderFigure = (regions: Region[]) => (
    <View style={[styles.figure, { height }]}>
      {regions.map((r) => {
        const isPrimary = r.muscles.includes(primaryMuscle);
        const isSecondary = !isPrimary && r.muscles.some((m) => secondary.has(m));
        return (
          <View
            key={r.key}
            style={[
              styles.block,
              isPrimary && styles.primary,
              isSecondary && styles.secondary,
              {
                left: `${r.left}%`,
                top: `${r.top}%`,
                width: `${r.width}%`,
                height: `${r.height}%`,
                borderRadius: r.round ?? radius.sm,
              },
            ]}
          />
        );
      })}
    </View>
  );

  return (
    <View style={styles.row}>
      {renderFigure(FRONT)}
      {renderFigure(BACK)}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    row: ViewStyle;
    figure: ViewStyle;
    block: ViewStyle;
    primary: ViewStyle;
    secondary: ViewStyle;
  }>({
    // `row`, not `row-reverse`: this is an anatomical figure, not a text layout, so it must not
    // mirror under RTL — front stays on the same side as the label that follows it.
    row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
    figure: { aspectRatio: 0.62 },
    block: {
      position: 'absolute',
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent },
    secondary: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  });
