/**
 * The short summary that opens once a workout is finished, after the trophy: how many exercises
 * got better than last time, and for each one what moved — the weight, the reps, the sets.
 *
 * Asked for by the owner (2026-11-09): "every time I finish a workout, besides 'the workout is
 * over', a short summary of how it went — improvement in the exercises, sets, reps and weight".
 *
 * The verdicts are `reviewSession`'s and the moves `movesOf`'s, both in `@fit/shared/progress`:
 * the same reading as the full summary on the workout's own page (`SessionReviewCard`) and on the
 * coach website, so this can never say "improved" where those say "same". This one is the short
 * version — one line per exercise, nothing to open — with a button through to the long one.
 *
 * A native `Modal` with a fade, and nothing animated by hand (see CLAUDE.md on driver modes).
 */

import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import {
  movesOf,
  type ExerciseMoves,
  type ExerciseSessionChange,
  type SessionReview,
  type SessionVerdict,
} from '@fit/shared/progress';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hapticLight } from '../../haptics.js';
import { isRtlLanguage, type Language } from '../../i18n/index.js';
import { useTheme } from '../../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../../theme.js';
import { useUnit } from '../../UnitsProvider.js';
import { kgToDisplay, weightUnitKey } from '../../units.js';
import { BrandButton } from '../BrandButton.js';
import { Pressable } from '../Pressable.js';
import { Text } from '../Text.js';
import { useSetText } from '../WorkoutProgressList.js';
import { topOf, verdictColor } from './SessionReviewCard.js';

/*
 * A signed number inside Hebrew text. Without an isolate the bidi algorithm is free to carry
 * the "+" to the far side of the number, so "+2.5" reads as "2.5+". The marks are built from
 * their code points rather than typed, because typed they are invisible in the source.
 */
const ISOLATE = String.fromCharCode(0x2066);
const END_ISOLATE = String.fromCharCode(0x2069);
const MINUS = String.fromCharCode(0x2212);
const signed = (negative: boolean, magnitude: number | string) =>
  `${ISOLATE}${negative ? MINUS : '+'}${magnitude}${END_ISOLATE}`;

/** One glyph per verdict, beside the name, in the verdict's colour. */
const MARK: Record<SessionVerdict, string> = {
  improved: '▲',
  same: '＝',
  declined: '▼',
  new: '•',
};

interface Move {
  text: string;
  better: boolean;
}

export interface FinishReviewModalProps {
  /** The finished workout's summary; null, or one with no exercises, keeps it shut. */
  review: SessionReview | null;
  onClose: () => void;
  /** Through to the workout's own page, where the full summary is. */
  onOpenDetails: () => void;
}

export function FinishReviewModal({ review, onClose, onOpenDetails }: FinishReviewModalProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setText = useSetText();

  if (!review || review.exercises.length === 0) return null;

  // A `Modal` renders into its own native root, outside the `direction` wrapper in `_layout`.
  const direction = isRtlLanguage(i18n.language as Language) ? 'rtl' : 'ltr';
  const isHebrew = i18n.language === 'he';
  const name = (key: string) => {
    const seed = EXERCISE_BY_KEY.get(key);
    return seed ? (isHebrew ? seed.nameHe : seed.nameEn) : key;
  };

  const { counts } = review;
  const compared = counts.improved + counts.same + counts.declined;
  const headline =
    compared === 0
      ? t('finishReview.headline_allNew')
      : counts.improved > 0
        ? t('finishReview.headline_improved', { count: counts.improved, total: compared })
        : counts.declined > 0
          ? t('finishReview.headline_down')
          : t('finishReview.headline_steady');

  const movesText = (moves: ExerciseMoves): Move[] => {
    const out: Move[] = [];
    if (moves.weightKg !== null) {
      out.push({
        text: t('finishReview.weight', {
          value: signed(moves.weightKg < 0, kgToDisplay(Math.abs(moves.weightKg), unit)),
          unit: t(`common.${weightUnitKey(unit)}`),
        }),
        better: moves.weightKg > 0,
      });
    }
    if (moves.reps !== null) {
      out.push({
        text: t('finishReview.reps', {
          count: Math.abs(moves.reps),
          value: signed(moves.reps < 0, Math.abs(moves.reps)),
        }),
        better: moves.reps > 0,
      });
    }
    if (moves.sets !== null) {
      out.push({
        text: t('finishReview.sets', {
          count: Math.abs(moves.sets),
          value: signed(moves.sets < 0, Math.abs(moves.sets)),
        }),
        better: moves.sets > 0,
      });
    }
    return out;
  };

  const line = (exercise: ExerciseSessionChange) => {
    if (exercise.status === 'new') {
      return (
        <Text style={styles.quiet}>
          {t('finishReview.firstTime')} · {setText(topOf(exercise.sets))}
        </Text>
      );
    }
    const moves = movesOf(exercise);
    const parts = moves ? movesText(moves) : [];
    if (parts.length === 0) return <Text style={styles.quiet}>{t('finishReview.same')}</Text>;
    return (
      <Text style={styles.moves}>
        {parts.map((part, index) => (
          <Text key={index} style={{ color: part.better ? colors.accent : colors.warning }}>
            {index > 0 ? '  ·  ' : ''}
            {part.text}
          </Text>
        ))}
      </Text>
    );
  };

  const close = () => {
    void hapticLight();
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          {
            direction,
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {t('finishReview.title')}
          </Text>
          <Text style={styles.headline}>{headline}</Text>

          {compared > 0 ? (
            <View style={styles.chips}>
              {(['improved', 'same', 'declined', 'new'] as const)
                .filter((status) => counts[status] > 0)
                .map((status) => (
                  <View
                    key={status}
                    style={[styles.chip, { borderColor: verdictColor(status, colors) }]}
                  >
                    <Text style={[styles.chipText, { color: verdictColor(status, colors) }]}>
                      {t(`monthly.count_${status}`, { count: counts[status] })}
                    </Text>
                  </View>
                ))}
            </View>
          ) : null}

          <Text style={styles.hint}>{t('finishReview.hint')}</Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {review.exercises.map((exercise) => (
              <View key={exercise.exerciseKey} style={styles.row}>
                <Text
                  style={[styles.mark, { color: verdictColor(exercise.status, colors) }]}
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                >
                  {MARK[exercise.status]}
                </Text>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name(exercise.exerciseKey)}
                  </Text>
                  {line(exercise)}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <BrandButton label={t('finishReview.close')} onPress={close} />
            <Pressable
              onPress={() => {
                void hapticLight();
                onOpenDetails();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>{t('finishReview.details')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    backdrop: ViewStyle;
    card: ViewStyle;
    title: TextStyle;
    headline: TextStyle;
    chips: ViewStyle;
    chip: ViewStyle;
    chipText: TextStyle;
    hint: TextStyle;
    list: ViewStyle;
    listContent: ViewStyle;
    row: ViewStyle;
    mark: TextStyle;
    rowText: ViewStyle;
    name: TextStyle;
    moves: TextStyle;
    quiet: TextStyle;
    actions: ViewStyle;
    secondary: ViewStyle;
    secondaryText: TextStyle;
    pressed: ViewStyle;
  }>({
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    card: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 440,
      maxHeight: '100%',
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    headline: {
      marginTop: spacing.xs,
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    chip: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
    hint: {
      marginTop: spacing.md,
      color: colors.textMuted,
      fontSize: fontSize.xs,
      textAlign: 'auto',
    },
    // Shrinks to what it holds, scrolls past what fits: a long workout must not push the
    // buttons off the screen.
    list: { flexGrow: 0, flexShrink: 1, marginTop: spacing.sm },
    listContent: { paddingBottom: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    mark: { width: 18, fontSize: fontSize.sm, lineHeight: 22, textAlign: 'center' },
    rowText: { flex: 1, gap: 2 },
    name: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    moves: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    quiet: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    actions: { gap: spacing.sm, marginTop: spacing.md },
    secondary: {
      minHeight: 48,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold },
    pressed: { opacity: 0.7 },
  });
