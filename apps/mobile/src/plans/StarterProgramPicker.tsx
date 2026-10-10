/**
 * Choosing a ready-made programme: two questions, then the programmes that suit the answers.
 *
 * Used in two places, which is why it is a component and not a screen: as the last thing a new
 * account sees before the app (`StarterWelcome`, below), and from the plan screen for anyone
 * who wants another plan without building it (`app/starter-programs.tsx`).
 *
 * The questions are where and how many days, because those are the two facts that decide a
 * split. Each programme is shown whole — every workout, every exercise by name — rather than
 * behind a tap, since the thing being chosen *is* the list of exercises and a title alone
 * ("Upper · Lower") tells a beginner nothing.
 *
 * See `starterPrograms.ts` for what the programmes are and why adding one keeps no link to it.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_BY_KEY } from '@fit/shared';

import { useActionSheet } from '../components/ActionSheetProvider.js';
import { BrandButton } from '../components/BrandButton.js';
import { Rise } from '../components/Rise.js';
import { Button, Card, Segmented } from '../components/ui.js';
import { getExecutor, newId } from '../db/provider.js';
import { hapticLight, hapticSuccess } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { applyStarterProgram } from './applyStarterProgram.js';
import {
  STARTER_DAY_CHOICES,
  starterFit,
  starterProgramsFor,
  type StarterPlace,
  type StarterProgram,
} from './starterPrograms.js';

export function StarterProgramPicker({
  userId,
  onAdded,
}: {
  userId: string;
  /** Called once the programme is in the account's plans, with the new plan's id. */
  onAdded: (planId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { notify } = useActionSheet();
  const language = i18n.language === 'he' ? 'he' : 'en';

  const [place, setPlace] = useState<StarterPlace>('gym');
  const [days, setDays] = useState<number>(3);
  /** The programme being added, so its button can show it and the others can wait. */
  const [adding, setAdding] = useState<string | null>(null);

  const programs = useMemo(() => starterProgramsFor(days, place), [days, place]);

  const add = (program: StarterProgram) => {
    if (adding) return;
    setAdding(program.id);
    void (async () => {
      try {
        const planId = await applyStarterProgram(
          await getExecutor(),
          userId,
          newId,
          program,
          language,
        );
        hapticSuccess();
        onAdded(planId);
      } catch {
        setAdding(null);
        await notify({ message: t('starter.failed') });
      }
    })();
  };

  return (
    <View style={styles.block}>
      <Card>
        <Segmented
          label={t('starter.place')}
          options={[
            { value: 'gym', label: t('starter.placeGym') },
            { value: 'home', label: t('starter.placeHome') },
          ]}
          selected={place}
          onSelect={setPlace}
        />
        {/* At home there is one programme and it suits any number of days, so the question
            would be one whose answer changes nothing. */}
        {place === 'gym' ? (
          <View style={styles.daysBlock}>
            <Text style={styles.label}>{t('starter.days')}</Text>
            <View style={styles.daysRow}>
              {STARTER_DAY_CHOICES.map((choice) => {
                const on = choice === days;
                return (
                  <Pressable
                    key={choice}
                    onPress={() => {
                      hapticLight();
                      setDays(choice);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t('starter.daysOption', { count: choice })}
                    style={[styles.day, on && styles.dayOn]}
                  >
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{choice}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Card>

      {programs.map((program, index) => {
        const suits = place === 'home' || starterFit(program, days) === 0;
        const first = index === 0;
        return (
          <Card key={program.id} tone={first ? 'accent' : 'default'}>
            <View style={styles.programHead}>
              <Text style={styles.programName}>{program.name[language]}</Text>
              {first && suits ? (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{t('starter.recommended')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.blurb}>{program.blurb[language]}</Text>

            <View style={styles.workouts}>
              {program.days.map((day) => (
                <View key={day.name.en} style={styles.workout}>
                  <Text style={styles.workoutName}>{day.name[language]}</Text>
                  <Text style={styles.exercises}>
                    {day.exercises
                      .map((exercise) => {
                        const seed = EXERCISE_BY_KEY.get(exercise.key);
                        return seed
                          ? language === 'he'
                            ? seed.nameHe
                            : seed.nameEn
                          : exercise.key;
                      })
                      .join(' · ')}
                  </Text>
                </View>
              ))}
            </View>

            {first ? (
              <BrandButton
                label={t('starter.add')}
                onPress={() => add(program)}
                busy={adding === program.id}
                disabled={adding !== null && adding !== program.id}
              />
            ) : (
              <Button
                label={adding === program.id ? t('starter.adding') : t('starter.add')}
                variant="secondary"
                onPress={() => add(program)}
                disabled={adding !== null}
              />
            )}
          </Card>
        );
      })}
    </View>
  );
}

/**
 * The picker as the last step of signing up: a screen of its own, in front of the app.
 *
 * Offered, never required. The way past it is as plain as the way through — some people arrive
 * with a programme of their own, from a coach or from years of doing it, and for them this is
 * one more screen between them and the app.
 */
export function StarterWelcome({
  userId,
  onDone,
}: {
  userId: string;
  onDone: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Rise order={0}>
        <Text style={styles.title} accessibilityRole="header">
          {t('starter.welcomeTitle')}
        </Text>
        <Text style={styles.subtitle}>{t('starter.welcomeSubtitle')}</Text>
      </Rise>

      <StarterProgramPicker userId={userId} onAdded={onDone} />

      <Pressable
        onPress={() => {
          hapticLight();
          onDone();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.skip, pressed && styles.skipPressed]}
      >
        <Text style={styles.skipText}>{t('starter.skip')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    title: TextStyle;
    subtitle: TextStyle;
    block: ViewStyle;
    label: TextStyle;
    daysBlock: ViewStyle;
    daysRow: ViewStyle;
    day: ViewStyle;
    dayOn: ViewStyle;
    dayText: TextStyle;
    dayTextOn: TextStyle;
    programHead: ViewStyle;
    programName: TextStyle;
    tag: ViewStyle;
    tagText: TextStyle;
    blurb: TextStyle;
    workouts: ViewStyle;
    workout: ViewStyle;
    workoutName: TextStyle;
    exercises: TextStyle;
    skip: ViewStyle;
    skipPressed: ViewStyle;
    skipText: TextStyle;
  }>({
    // No fill: in front of the app, the gradient the whole app sits on is meant to show.
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    title: {
      color: colors.text,
      fontSize: 28,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: fontSize.md,
      textAlign: 'auto',
      marginTop: spacing.xs,
    },

    block: { gap: spacing.lg },
    label: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    daysBlock: { gap: spacing.sm, marginTop: spacing.md },
    daysRow: { flexDirection: 'row', gap: spacing.sm },
    day: {
      flex: 1,
      minHeight: 46,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    dayOn: { backgroundColor: colors.accent },
    dayText: {
      color: colors.textMuted,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
    },
    dayTextOn: { color: colors.bg },

    programHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    programName: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    tag: {
      paddingVertical: 3,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    tagText: { color: colors.bg, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
    blurb: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      textAlign: 'auto',
      marginTop: spacing.xs,
    },

    workouts: { gap: spacing.md, marginVertical: spacing.lg },
    workout: { gap: spacing.xxs },
    workoutName: {
      color: colors.accent,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    exercises: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },

    skip: { alignSelf: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
    skipPressed: { opacity: 0.6 },
    skipText: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  });
