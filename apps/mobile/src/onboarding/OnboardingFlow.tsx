/**
 * The questions, one to a screen: weight, height, age, how active, what for — and then what
 * they add up to.
 *
 * One question at a time because each of them deserves a moment's thought and none of them
 * deserves a form. A page of six fields is something to get through; a single ruler with a
 * picture over it is something to answer.
 *
 * ## Why it comes after the account, not before
 *
 * The account is made first, on the screen before this, so that a mistyped or already-used
 * email is found out immediately rather than after five answers. It also means the answers are
 * written against a real user from the start, and that this same flow can serve the other
 * person who needs it: someone signing in on a new phone, whose profile did not come with them.
 *
 * ## Nothing is saved until the end
 *
 * The answers live in this component until the last button is pressed, then go down together.
 * Saving as each one is given would leave a half-filled profile behind an app closed part way
 * through — and a half-filled profile is exactly what `needsProfileSetup` reads as "ask again",
 * so nothing would be gained by it.
 *
 * ## Motion
 *
 * Each step rises in (`FadeSlideIn`, keyed on the step so it replays), and the picture arrives
 * with its own small overshoot. Vertical on purpose: a horizontal slide has a handedness, and
 * in a right-to-left app "forwards" is not the direction a transform assumes. The progress bar
 * is the one JS-driven animation here — a width — and it has a view to itself.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  Armchair,
  ArrowLeft,
  ArrowRight,
  Barbell,
  Cake,
  Check,
  Equals,
  Lightning,
  PersonSimpleBike,
  PersonSimpleRun,
  PersonSimpleWalk,
  Ruler,
  Scales,
  Sparkle,
  Target,
  TrendDown,
  type Icon,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACTIVITY_LEVELS, GOALS, type ActivityLevel, type Goal } from '@fit/shared/calculations';

import { BrandButton } from '../components/BrandButton.js';
import { KeyboardSafe } from '../components/KeyboardSafe.js';
import { CountUp, FadeSlideIn } from '../components/motion.js';
import { Banner } from '../components/ui.js';
import { getLatestWeight, getProfile, recordBodyMetric, saveProfile } from '../db/metrics.js';
import { getExecutor, newId } from '../db/provider.js';
import { hapticLight, hapticSuccess } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import {
  duration,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../theme.js';
import {
  bodyKgToDisplay,
  cmToDisplay,
  displayHeightToCm,
  displayWeightToKg,
  heightUnitKey,
  weightUnitKey,
} from '../units.js';
import { useUnit } from '../UnitsProvider.js';
import {
  AGE_RANGE,
  SETUP_STEPS,
  SETUP_TOTAL,
  ageFromBirthDate,
  birthDateFromAge,
  heightRange,
  isNewWeight,
  ontoScale,
  setupPosition,
  setupTargets,
  weightRange,
  type SetupSex,
  type SetupStep,
} from './profileSetup.js';
import { RulerPicker } from './RulerPicker.js';
import { StepArt } from './StepArt.js';

const STEP_ICON: Record<SetupStep, Icon> = {
  weight: Scales,
  height: Ruler,
  age: Cake,
  activity: PersonSimpleRun,
  goal: Target,
  done: Sparkle,
};

const ACTIVITY_ICON: Record<ActivityLevel, Icon> = {
  sedentary: Armchair,
  light: PersonSimpleWalk,
  moderate: PersonSimpleBike,
  active: PersonSimpleRun,
  very_active: Lightning,
};

const GOAL_ICON: Record<Goal, Icon> = {
  cut: TrendDown,
  maintain: Equals,
  bulk: Barbell,
};

export function OnboardingFlow({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const unit = useUnit();

  const weights = useMemo(() => weightRange(unit), [unit]);
  const heights = useMemo(() => heightRange(unit), [unit]);

  const [index, setIndex] = useState(0);
  // In the unit on screen. Converted once, at the end, to what the database keeps.
  const [weight, setWeight] = useState(weights.initial);
  const [height, setHeight] = useState(heights.initial);
  const [age, setAge] = useState(AGE_RANGE.initial);
  const [sex, setSex] = useState<SetupSex>('male');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [goal, setGoal] = useState<Goal>('maintain');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const step = SETUP_STEPS[index] ?? 'weight';

  /*
   * Start from whatever is already known.
   *
   * Nothing, on a new account. But this also runs for someone signing in on a second phone,
   * whose weigh-ins sync down while they are looking at the first question — and for an
   * account that answered some of this on the nutrition screen before setup existed. Opening
   * the rulers on their own numbers turns six questions into six confirmations.
   *
   * Once, on mount: a value arriving later must not move a ruler someone is already dragging.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await getExecutor();
        const [profile, latest] = await Promise.all([
          getProfile(db, userId),
          getLatestWeight(db, userId),
        ]);
        if (cancelled) return;
        if (latest?.weight_kg) setWeight(ontoScale(weights, bodyKgToDisplay(latest.weight_kg, unit)));
        if (profile?.height_cm) setHeight(ontoScale(heights, cmToDisplay(profile.height_cm, unit)));
        if (profile?.birth_date) setAge(ontoScale(AGE_RANGE, ageFromBirthDate(profile.birth_date)));
        if (profile?.sex === 'male' || profile?.sex === 'female') setSex(profile.sex);
        if (profile?.activity_level && isActivityLevel(profile.activity_level)) {
          setActivityLevel(profile.activity_level);
        }
        if (profile?.goal && isGoal(profile.goal)) setGoal(profile.goal);
      } catch {
        // Nothing to start from is the ordinary case, and is what the defaults are for.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const answers = useMemo(
    () => ({
      weightKg: displayWeightToKg(weight, unit),
      heightCm: displayHeightToCm(height, unit),
      ageYears: age,
      sex,
      activityLevel,
      goal,
    }),
    [weight, height, age, sex, activityLevel, goal, unit],
  );
  const targets = useMemo(() => setupTargets(answers), [answers]);

  /* ---------------------------------------------------------------- progress */

  // A fraction of the bar. JS-driven, because a width is layout and the native driver cannot
  // touch layout — which is why the fill below is a view that carries nothing else animated.
  const reached = step === 'done' ? 1 : setupPosition(step) / SETUP_TOTAL;
  const progress = useRef(new Animated.Value(reached)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: reached,
      duration: duration.slow,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, reached]);

  /* ------------------------------------------------------------------- moving */

  const forward = () => {
    setFailed(false);
    setIndex((current) => Math.min(SETUP_STEPS.length - 1, current + 1));
  };
  const back = () => {
    setFailed(false);
    hapticLight();
    setIndex((current) => Math.max(0, current - 1));
  };

  const finish = () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    void (async () => {
      try {
        const db = await getExecutor();
        await saveProfile(db, userId, {
          heightCm: answers.heightCm,
          birthDate: birthDateFromAge(answers.ageYears),
          sex: answers.sex,
          activityLevel: answers.activityLevel,
          goal: answers.goal,
        });
        const latest = await getLatestWeight(db, userId);
        if (isNewWeight(latest?.weight_kg ?? null, answers.weightKg)) {
          await recordBodyMetric(db, userId, newId, {
            weightKg: answers.weightKg,
            source: 'manual',
          });
        }
        hapticSuccess();
        onDone();
      } catch {
        // Still on this screen, with every answer intact and the button live again.
        setFailed(true);
        setSaving(false);
      }
    })();
  };

  /* ------------------------------------------------------------------- render */

  const rtl = isRtlLanguage(i18n.language as Language);
  // "Back" points at where the previous step came from, which is the other way in Hebrew.
  const BackArrow = rtl ? ArrowRight : ArrowLeft;

  return (
    // The three numbers can be typed, and a keyboard on this build is drawn over the app rather
    // than pushing it up. This is what keeps the button — and the number being typed — above it.
    <KeyboardSafe
      style={[
        styles.screen,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={back}
          disabled={index === 0 || saving}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('setup.back')}
          // Kept in the layout when there is nowhere to go back to, so the bar beside it does
          // not jump sideways between the first step and the second.
          style={[styles.back, index === 0 && styles.backHidden]}
        >
          <BackArrow size={20} color={colors.textSecondary} weight="bold" />
        </Pressable>

        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              },
            ]}
          />
        </View>

        <Text style={styles.count}>
          {step === 'done'
            ? ''
            : t('setup.stepOf', { step: setupPosition(step), total: SETUP_TOTAL })}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        // A tap on the ruler or its buttons while the number is being typed should act, not
        // merely put the keyboard away and need tapping again.
        keyboardShouldPersistTaps="handled"
      >
        {/* Keyed on the step, so that moving on replays the entrance instead of swapping the
            text under a picture that stays where it was. */}
        <FadeSlideIn key={step} style={styles.step}>
          <StepArt icon={STEP_ICON[step]} />

          <View style={styles.heading}>
            <Text style={styles.title}>{t(`setup.${step}Title`)}</Text>
            <Text style={styles.hint}>{t(`setup.${step}Hint`)}</Text>
          </View>

          {step === 'weight' ? (
            <Panel>
              <RulerPicker
                range={weights}
                value={weight}
                onChange={setWeight}
                unitLabel={t(`common.${weightUnitKey(unit)}`)}
                accessibilityLabel={t('profile.weight')}
                typeHint={t('setup.typeHint')}
              />
            </Panel>
          ) : null}

          {step === 'height' ? (
            <Panel>
              <RulerPicker
                range={heights}
                value={height}
                onChange={setHeight}
                unitLabel={t(`common.${heightUnitKey(unit)}`)}
                accessibilityLabel={t('profile.height')}
                typeHint={t('setup.typeHint')}
              />
            </Panel>
          ) : null}

          {step === 'age' ? (
            <>
              <Panel>
                <RulerPicker
                  range={AGE_RANGE}
                  value={age}
                  onChange={setAge}
                  unitLabel={t('profile.years')}
                  accessibilityLabel={t('profile.age')}
                  typeHint={t('setup.typeHint')}
                />
              </Panel>
              <View style={styles.pills}>
                {(['male', 'female'] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => {
                      hapticLight();
                      setSex(option);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sex === option }}
                    style={[styles.pill, sex === option && styles.pillOn]}
                  >
                    <Text style={[styles.pillText, sex === option && styles.pillTextOn]}>
                      {t(`profile.${option}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {step === 'activity' ? (
            <View style={styles.choices}>
              {ACTIVITY_LEVELS.map((level) => (
                <Choice
                  key={level}
                  icon={ACTIVITY_ICON[level]}
                  title={t(`activity.${level}`)}
                  detail={t(`setup.activityDetail.${level}`)}
                  selected={activityLevel === level}
                  onPress={() => setActivityLevel(level)}
                />
              ))}
            </View>
          ) : null}

          {step === 'goal' ? (
            <View style={styles.choices}>
              {GOALS.map((option) => (
                <Choice
                  key={option}
                  icon={GOAL_ICON[option]}
                  title={t(`goal.${option}`)}
                  detail={t(`setup.goalDetail.${option}`)}
                  selected={goal === option}
                  onPress={() => setGoal(option)}
                />
              ))}
            </View>
          ) : null}

          {step === 'done' && targets ? (
            <View style={styles.totals}>
              <View style={[styles.total, styles.totalWide]}>
                <CountUp value={targets.calories} style={styles.totalValue} />
                <Text style={styles.totalLabel}>{t('setup.caloriesPerDay')}</Text>
              </View>
              <View style={styles.total}>
                <CountUp value={targets.proteinG} style={styles.totalValue} />
                <Text style={styles.totalLabel}>{t('setup.proteinPerDay')}</Text>
              </View>
            </View>
          ) : null}
        </FadeSlideIn>
      </ScrollView>

      {failed ? <Banner tone="warning">{t('setup.saveFailed')}</Banner> : null}

      <BrandButton
        label={step === 'done' ? t('setup.start') : t('setup.continue')}
        onPress={step === 'done' ? finish : forward}
        busy={saving}
        style={styles.next}
      />
    </KeyboardSafe>
  );
}

function isActivityLevel(value: string): value is ActivityLevel {
  return (ACTIVITY_LEVELS as readonly string[]).includes(value);
}

function isGoal(value: string): value is Goal {
  return (GOALS as readonly string[]).includes(value);
}

/** The white card a ruler sits on. Its colour is what the ruler's ends fade into. */
function Panel({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.panel}>{children}</View>;
}

/**
 * One answer among a few: a picture, a name, a line saying what it means, and a tick.
 *
 * The tick springs in when the row is chosen. It is the only animated thing on the row and it
 * sits on its own node; the row's border and fill change as plain styles.
 */
function Choice({
  icon: IconComponent,
  title,
  detail,
  selected,
  onPress,
}: {
  icon: Icon;
  title: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tick = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(tick, {
      toValue: selected ? 1 : 0,
      friction: 6,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [tick, selected]);

  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceOn,
        pressed && !selected && styles.choicePressed,
      ]}
    >
      <View style={[styles.choiceIcon, selected && styles.choiceIconOn]}>
        <IconComponent
          size={24}
          color={selected ? colors.bg : colors.accent}
          weight={selected ? 'fill' : 'duotone'}
        />
      </View>
      <View style={styles.choiceText}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDetail}>{detail}</Text>
      </View>
      <Animated.View style={[styles.choiceTick, { opacity: tick, transform: [{ scale: tick }] }]}>
        <Check size={14} color={colors.bg} weight="bold" />
      </Animated.View>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    header: ViewStyle;
    back: ViewStyle;
    backHidden: ViewStyle;
    track: ViewStyle;
    fill: ViewStyle;
    count: TextStyle;
    scroll: ViewStyle;
    scrollContent: ViewStyle;
    step: ViewStyle;
    heading: ViewStyle;
    title: TextStyle;
    hint: TextStyle;
    panel: ViewStyle;
    pills: ViewStyle;
    pill: ViewStyle;
    pillOn: ViewStyle;
    pillText: TextStyle;
    pillTextOn: TextStyle;
    choices: ViewStyle;
    choice: ViewStyle;
    choiceOn: ViewStyle;
    choicePressed: ViewStyle;
    choiceIcon: ViewStyle;
    choiceIconOn: ViewStyle;
    choiceText: ViewStyle;
    choiceTitle: TextStyle;
    choiceDetail: TextStyle;
    choiceTick: ViewStyle;
    totals: ViewStyle;
    total: ViewStyle;
    totalWide: ViewStyle;
    totalValue: TextStyle;
    totalLabel: TextStyle;
    next: ViewStyle;
  }>({
    // No fill: the gradient the whole app sits on shows through, as it does behind sign-in.
    screen: { flex: 1, paddingHorizontal: spacing.xl, gap: spacing.md },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    back: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    backHidden: { opacity: 0 },
    track: {
      flex: 1,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
    count: {
      minWidth: 84,
      color: colors.textMuted,
      fontSize: fontSize.xs,
      textAlign: 'auto',
      fontVariant: ['tabular-nums'],
    },

    scroll: { flex: 1 },
    // Centred when there is room, scrollable when there is not: five activity levels on a
    // small phone are taller than the screen.
    scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.lg },
    step: { gap: spacing.xl },

    heading: { gap: spacing.sm, alignItems: 'center' },
    title: {
      color: colors.text,
      fontSize: 26,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    hint: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      lineHeight: 21,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },

    panel: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.md,
      ...shadow(colors.shadow).card,
    },

    pills: { flexDirection: 'row', gap: spacing.md },
    pill: {
      flex: 1,
      minHeight: 50,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    pillOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    pillText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.medium },
    pillTextOn: { color: colors.accent, fontWeight: fontWeight.bold },

    choices: { gap: spacing.md },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    choiceOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    choicePressed: { backgroundColor: colors.surfaceRaised },
    choiceIcon: {
      width: 46,
      height: 46,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    choiceIconOn: { backgroundColor: colors.accent },
    choiceText: { flex: 1, gap: spacing.xxs },
    choiceTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    choiceDetail: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18, textAlign: 'auto' },
    choiceTick: {
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },

    totals: { flexDirection: 'row', gap: spacing.md },
    total: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      gap: spacing.xs,
      ...shadow(colors.shadow).card,
    },
    totalWide: { flex: 1.4 },
    totalValue: {
      color: colors.accent,
      fontSize: 38,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
    },
    totalLabel: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'center' },

    next: { marginTop: spacing.xs },
  });
