/**
 * Shared UI primitives.
 *
 * RTL rule enforced throughout: only logical layout properties (`marginStart`/`marginEnd`,
 * `paddingStart`/`paddingEnd`) and `textAlign: 'auto'`, never `left`/`right`. React Native
 * mirrors the logical ones under RTL, so one component renders correctly in Hebrew and
 * English with no per-language branching.
 *
 * Theme-aware: `createStyles(colors)` is a function, not a static object, because a light/dark
 * switch has to repaint components already on screen — a `StyleSheet.create` evaluated once at
 * module load can't do that. Each component calls `useTheme()` and memoises `createStyles`
 * against the current palette, so a scheme change re-renders with new colours but doesn't pay
 * for rebuilding the stylesheet on every unrelated render.
 */

import { router } from 'expo-router';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, lineHeight, radius, spacing, type ColorPalette } from '../theme.js';

/** Shared tactile feedback for Button and Segmented — a small scale dip under the finger. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  return { scale, onPressIn, onPressOut };
}

/**
 * Shared mount entrance for Card, Banner, and EmptyState — a soft rise instead of popping in,
 * so a whole screen of data reads as settling into place rather than just appearing.
 */
function FadeIn({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // The design system's `fu`: 260ms, opacity 0->1, translateY 8->0, eased out.
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  style,
  tone = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `accent` marks the one card on screen that is the primary action. */
  tone?: 'default' | 'accent';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <FadeIn style={[styles.card, tone === 'accent' && styles.cardAccent, style]}>
      {children}
    </FadeIn>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.screenTitle}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.hint}>{children}</Text>;
}

export function Divider() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.divider} />;
}

/** Screen title paired with a settings shortcut — every tab root uses this now, so settings
 *  is reachable from wherever the user happens to be instead of only from Today and Coach. */
export function ScreenHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.screenHeaderRow}>
      <ScreenTitle>{title}</ScreenTitle>
      <Pressable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- settings.tsx is new;
        // expo-router's typed-routes union regenerates on the next `expo start`/build.
        onPress={() => router.push('/settings' as any)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.title')}
        hitSlop={8}
      >
        <Text style={styles.screenHeaderGear}>⚙️</Text>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export function NumberField({
  label,
  value,
  suffix,
  onChangeText,
  onEndEditing,
}: {
  label: string;
  value: string;
  suffix?: string;
  onChangeText: (next: string) => void;
  /** Fires on blur — use for writes that should not run per keystroke. */
  onEndEditing?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const focusProgress = useRef(new Animated.Value(0)).current;
  const animateFocus = (focused: boolean) =>
    Animated.timing(focusProgress, { toValue: focused ? 1 : 0, duration: 160, useNativeDriver: false }).start();

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Animated.View
        style={[
          styles.inputWrap,
          {
            borderColor: focusProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.border, colors.accentBorder],
            }),
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => animateFocus(true)}
          onEndEditing={() => {
            animateFocus(false);
            onEndEditing?.();
          }}
          keyboardType="numeric"
          inputMode="decimal"
          style={styles.input}
          placeholderTextColor={colors.textFaint}
          selectTextOnFocus
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </Animated.View>
    </View>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.segmentedBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segmentedRow}>
        {options.map((option) => (
          <SegmentButton
            key={option.value}
            option={option}
            active={option.value === selected}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

function SegmentButton<T extends string>({
  option,
  active,
  onSelect,
}: {
  option: SegmentedOption<T>;
  active: boolean;
  onSelect: (value: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = usePressScale();

  // Crossfades the active colours rather than swapping them instantly on tap — a hard swap
  // reads as a glitch at the moment of selection, a quick fade reads as a deliberate response.
  // Colour isn't a native-driver-eligible property, but this only runs on an occasional tap,
  // not anything scroll-linked, so a JS-driven animation is imperceptibly different here.
  const activeProgress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(activeProgress, {
      toValue: active ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [active, activeProgress]);

  return (
    <Pressable
      onPress={() => onSelect(option.value)}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {/* Two nested Animated.Views, not one, because `scale` (native-driven, from
          usePressScale) and `activeProgress`'s colour interpolations (JS-driven — colour
          isn't native-driver-eligible) crash React Native if they land in the same style
          array: "Attempting to run JS driven animation on animated node that has been moved
          to native". Splitting them onto separate views keeps each animation on its own
          graph. */}
      <Animated.View style={{ transform: [{ scale }] }}>
        <Animated.View
          style={[
            styles.segment,
            {
              backgroundColor: activeProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [colors.surfaceRaised, colors.accentSoft],
              }),
              borderColor: activeProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [colors.border, colors.accentBorder],
              }),
            },
          ]}
        >
          <Animated.Text
            style={[
              styles.segmentText,
              {
                color: activeProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [colors.textMuted, colors.accent],
                }),
                fontWeight: active ? fontWeight.bold : fontWeight.regular,
              },
            ]}
          >
            {option.label}
          </Animated.Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export function Button({
  label,
  onPress,
  variant = 'primary',
  sublabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  sublabel?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = usePressScale();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            { transform: [{ scale }] },
            styles.button,
            variant === 'primary' && styles.buttonPrimary,
            variant === 'secondary' && styles.buttonSecondary,
            variant === 'ghost' && styles.buttonGhost,
            variant === 'danger' && styles.buttonDanger,
            // Press feedback via opacity rather than a colour swap — it reads consistently on
            // every variant without needing four extra pressed-state colours.
            pressed && styles.buttonPressed,
          ]}
        >
          <Text
            style={[
              styles.buttonLabel,
              variant === 'primary' && styles.buttonLabelPrimary,
              variant === 'secondary' && styles.buttonLabelSecondary,
              variant === 'ghost' && styles.buttonLabelGhost,
              variant === 'danger' && styles.buttonLabelDanger,
            ]}
          >
            {label}
          </Text>
          {sublabel ? <Text style={styles.buttonSublabel}>{sublabel}</Text> : null}
        </Animated.View>
      )}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Data display                                                                */
/* -------------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  unit,
  hint,
  emphasis,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  emphasis?: boolean;
  color?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text
          style={[
            styles.statValue,
            emphasis && styles.statValueEmphasis,
            color ? { color } : null,
          ]}
        >
          {value}
        </Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

/** Compact figure for a row of three or four — used in workout and history summaries. */
export function MetricTile({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'warning' | 'success';
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <FadeIn
      style={[
        styles.banner,
        tone === 'warning' && styles.bannerWarning,
        tone === 'info' && styles.bannerInfo,
        tone === 'success' && styles.bannerSuccess,
      ]}
    >
      <Text
        style={[
          styles.bannerText,
          tone === 'warning' && styles.bannerTextWarning,
          tone === 'info' && styles.bannerTextInfo,
          tone === 'success' && styles.bannerTextSuccess,
        ]}
      >
        {children}
      </Text>
    </FadeIn>
  );
}

/**
 * A pulsing placeholder bar. Opacity-only, native-driven — the shape it fills in is up to the
 * caller via `style` (width/height/borderRadius), so one primitive covers a title-sized bar, a
 * full-width line, or a short trailing one.
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.skeletonBar,
        style,
        { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] }) },
      ]}
    />
  );
}

/**
 * A screen-shaped stand-in shown while the first load hits SQLite — replaces the old bare
 * "Loading…" text so the screen's shape is recognisable immediately instead of flashing blank.
 */
export function SkeletonScreen({ paddingTop }: { paddingTop: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.skeletonScreen, { paddingTop }]}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <Skeleton style={styles.skeletonTitle} />
          <Skeleton style={styles.skeletonLine} />
          <Skeleton style={[styles.skeletonLine, styles.skeletonLineShort]} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  emoji,
  title,
  hint,
}: {
  emoji: string;
  title: string;
  hint?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <FadeIn style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </FadeIn>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    cardAccent: ViewStyle;
    screenTitle: TextStyle;
    screenHeaderRow: ViewStyle;
    screenHeaderGear: TextStyle;
    sectionTitle: TextStyle;
    hint: TextStyle;
    divider: ViewStyle;
    fieldRow: ViewStyle;
    fieldLabel: TextStyle;
    inputWrap: ViewStyle;
    input: TextStyle;
    suffix: TextStyle;
    segmentedBlock: ViewStyle;
    segmentedRow: ViewStyle;
    segment: ViewStyle;
    segmentText: TextStyle;
    button: ViewStyle;
    buttonPrimary: ViewStyle;
    buttonSecondary: ViewStyle;
    buttonGhost: ViewStyle;
    buttonDanger: ViewStyle;
    buttonPressed: ViewStyle;
    buttonLabel: TextStyle;
    buttonLabelPrimary: TextStyle;
    buttonLabelSecondary: TextStyle;
    buttonLabelGhost: TextStyle;
    buttonLabelDanger: TextStyle;
    buttonSublabel: TextStyle;
    stat: ViewStyle;
    statLabel: TextStyle;
    statValueRow: ViewStyle;
    statValue: TextStyle;
    statValueEmphasis: TextStyle;
    statUnit: TextStyle;
    statHint: TextStyle;
    tile: ViewStyle;
    tileValue: TextStyle;
    tileLabel: TextStyle;
    banner: ViewStyle;
    bannerInfo: ViewStyle;
    bannerWarning: ViewStyle;
    bannerSuccess: ViewStyle;
    bannerText: TextStyle;
    bannerTextInfo: TextStyle;
    bannerTextWarning: TextStyle;
    bannerTextSuccess: TextStyle;
    empty: ViewStyle;
    emptyEmoji: TextStyle;
    emptyTitle: TextStyle;
    emptyHint: TextStyle;
    skeletonBar: ViewStyle;
    skeletonScreen: ViewStyle;
    skeletonCard: ViewStyle;
    skeletonTitle: ViewStyle;
    skeletonLine: ViewStyle;
    skeletonLineShort: ViewStyle;
  }>({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    cardAccent: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },

    screenTitle: {
      color: colors.text,
      fontSize: fontSize.xxl,
      fontWeight: fontWeight.bold,
      letterSpacing: -0.5,
      marginBottom: spacing.lg,
      textAlign: 'auto',
    },
    screenHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    screenHeaderGear: { fontSize: fontSize.lg, marginBottom: spacing.lg },
    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      marginBottom: spacing.xs,
      textAlign: 'auto',
    },
    hint: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.tight,
      marginBottom: spacing.md,
      textAlign: 'auto',
    },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
    },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      minWidth: 112,
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      paddingVertical: spacing.sm,
      // Numerals read left-to-right in Hebrew too, so centring beats a logical alignment here.
      textAlign: 'center',
    },
    suffix: { color: colors.textMuted, fontSize: fontSize.xs, marginStart: spacing.xs },

    segmentedBlock: { paddingVertical: spacing.sm },
    segmentedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    segment: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceRaised,
    },
    segmentText: { color: colors.textMuted, fontSize: fontSize.sm },

    button: {
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      borderWidth: 1,
    },
    buttonPrimary: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
    buttonSecondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },
    buttonGhost: { backgroundColor: 'transparent', borderColor: colors.border },
    buttonDanger: { backgroundColor: 'transparent', borderColor: 'transparent' },
    buttonPressed: { opacity: 0.6 },
    buttonLabel: { fontSize: fontSize.md, fontWeight: fontWeight.bold },
    buttonLabelPrimary: { color: colors.accent },
    buttonLabelSecondary: { color: colors.text },
    buttonLabelGhost: { color: colors.textSecondary },
    buttonLabelDanger: { color: colors.danger, fontWeight: fontWeight.medium },
    buttonSublabel: {
      color: colors.textMuted,
      fontSize: fontSize.xxs,
      marginTop: spacing.xxs,
      textAlign: 'center',
    },

    stat: { paddingVertical: spacing.sm },
    statLabel: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    statValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.xxs },
    statValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    statValueEmphasis: {
      fontSize: fontSize.display,
      color: colors.accent,
      letterSpacing: -1,
    },
    statUnit: { color: colors.textMuted, fontSize: fontSize.sm, marginStart: spacing.xs },
    statHint: {
      color: colors.textFaint,
      fontSize: fontSize.xxs,
      marginTop: spacing.xxs,
      lineHeight: 16,
      textAlign: 'auto',
    },

    tile: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
    tileValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
    tileLabel: { color: colors.textMuted, fontSize: fontSize.xxs, marginTop: spacing.xxs },

    banner: {
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    bannerInfo: { backgroundColor: colors.infoSoft, borderColor: colors.info },
    bannerWarning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
    bannerSuccess: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
    bannerText: { fontSize: fontSize.sm, lineHeight: lineHeight.tight, textAlign: 'auto' },
    bannerTextInfo: { color: colors.info },
    bannerTextWarning: { color: colors.warning },
    bannerTextSuccess: { color: colors.accent },

    empty: { alignItems: 'center', paddingVertical: spacing.xxl },
    emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
    emptyTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
    },
    emptyHint: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      marginTop: spacing.xs,
      textAlign: 'center',
    },

    skeletonBar: {
      height: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
    },
    skeletonScreen: { paddingHorizontal: spacing.lg },
    skeletonCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    skeletonTitle: { height: 16, width: '50%' },
    skeletonLine: { width: '100%' },
    skeletonLineShort: { width: '60%' },
  });
