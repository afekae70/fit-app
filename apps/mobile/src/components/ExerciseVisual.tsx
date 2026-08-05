/**
 * What an exercise looks like: a real photo when one could be matched confidently, and the
 * muscle map otherwise.
 *
 * The photo is remote (see `exerciseImages.ts` for why it is not bundled), so it can be slow or
 * simply unavailable — this app is used in gyms and on bases where signal is worst. The muscle
 * map therefore is not only the fallback for the ~78 unmatched exercises but also what shows
 * while a photo loads and what is left behind if it fails. There is never a blank box and never
 * a spinner that outlives its usefulness.
 */

import { exerciseImageUrl, type ExerciseSeed } from '@fit/shared/catalog';
import { useMemo, useState } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { radius, spacing, type ColorPalette } from '../theme.js';
import { MuscleMap } from './MuscleMap.js';

export interface ExerciseVisualProps {
  exercise: ExerciseSeed;
  height?: number;
}

export function ExerciseVisual({ exercise, height = 120 }: ExerciseVisualProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const url = exerciseImageUrl(exercise.nameEn);

  // `failed` is deliberately separate from "no url": a photo that 404s or times out must fall
  // all the way back to the map, not sit as a broken frame.
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const showPhoto = url !== null && !failed;

  return (
    <View style={[styles.frame, { height }]}>
      {/* Always mounted underneath: it is the placeholder, the fallback, and the offline state
          all at once, so there is no separate loading branch to keep in sync. */}
      <View style={styles.layer}>
        <MuscleMap
          primaryMuscle={exercise.primaryMuscle}
          secondaryMuscles={exercise.secondaryMuscles}
          height={height - spacing.sm * 2}
        />
      </View>

      {showPhoto ? (
        <Image
          source={{ uri: url }}
          style={[styles.photo, !loaded && styles.photoHidden]}
          resizeMode="contain"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    frame: ViewStyle;
    layer: ViewStyle;
    photo: ImageStyle;
    photoHidden: ImageStyle;
  }>({
    frame: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
    },
    layer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
    photo: { width: '100%', height: '100%', backgroundColor: colors.surfaceRaised },
    // Kept mounted but invisible until decoded, so the map does not flash out early.
    photoHidden: { opacity: 0 },
  });
