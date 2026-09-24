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

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { FadeSlideIn } from './motion.js';
import { useTheme } from '../ThemeProvider.js';
import {
  duration,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../theme.js';

/** Shared tactile feedback for Button and Segmented — a small scale dip under the finger. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  // 0.98, not 0.96. The deeper squeeze is something you watch happen; this one is only felt,
  // which is what the home screen's CTA settled on and the right amount of feedback for a
  // control the user is already looking at when they press it.
  const onPressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  return { scale, onPressIn, onPressOut };
}

/**
 * Shared mount entrance for Card, Banner and EmptyState.
 *
 * Delegates to `FadeSlideIn` rather than reimplementing the design system's `fu` — one
 * implementation of an entrance means one place its duration, travel and easing are decided,
 * and it is also how these three inherit reduce-motion support without each asking for it.
 *
 * `index` staggers a screen of cards so they arrive in sequence instead of together. Optional
 * and defaulting to 0: a lone card should not wait for a queue of one.
 */
function FadeIn({
  style,
  children,
  index,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  index?: number;
}) {
  return (
    <FadeSlideIn style={style} index={index}>
      {children}
    </FadeSlideIn>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  style,
  tone = 'default',
  index,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `accent` marks the one card on screen that is the primary action. */
  tone?: 'default' | 'accent';
  /**
   * Position in a stack of cards. Staggers the entrance so a screenful arrives in sequence
   * rather than as one flash. Omit it for a card that stands alone — a queue of one only adds
   * a delay before anything appears.
   */
  index?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <FadeIn style={[styles.card, tone === 'accent' && styles.cardAccent, style]} index={index}>
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
/**
 * The one header every screen uses: the title, and the menu in the masthead above it.
 *
 * It carried a back chevron until every screen lost one. Android's own back — the gesture or
 * the button — leaves any screen already, and a second one drawn inside the app repeated a
 * control the phone always has. Tabs are moved between by swiping now; see the tabs layout.
 *
 * Consolidated because six screens had grown their own copy of the same back Pressable and
 * chevron. That mattered beyond tidiness — the chevron points the other way in Hebrew, so a
 * duplicated rule is a rule that gets half-updated. It is decided here, once.
 *
 * The settings gear that used to sit at the end of this row is gone. It became the menu, and
 * the menu moved into the masthead that the root layout mounts above every screen — one fixed
 * bar rather than a control each header had to remember to draw.
 */
export function ScreenHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.screenHeaderRow}>
      <View style={styles.screenHeaderStart}>
        <ScreenTitle>{title}</ScreenTitle>
      </View>
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
      duration: duration.quick,
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
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  sublabel?: string;
  /** Dims the button and stops both the press and its animation. */
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = usePressScale();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={disabled ? undefined : onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      {() => (
        <Animated.View
          style={[
            { transform: [{ scale }] },
            styles.button,
            variant === 'primary' && styles.buttonPrimary,
            variant === 'secondary' && styles.buttonSecondary,
            variant === 'ghost' && styles.buttonGhost,
            variant === 'danger' && styles.buttonDanger,
            disabled && styles.buttonDisabled,
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
export function Skeleton({
  style,
  /**
   * Milliseconds to wait before this bar starts pulsing. A stack of placeholders all breathing
   * in unison reads as one flashing block; offsetting each by 200ms turns it into a wave, which
   * is the difference between "broken" and "working on it".
   */
  delay = 0,
}: {
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
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
    // The delay is a one-off before the loop rather than part of it, so the stagger offsets the
    // phase once instead of adding a pause to every cycle.
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [pulse, delay]);

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
    screenHeaderStart: ViewStyle;
    screenHeaderBack: TextStyle;
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
    buttonDisabled: ViewStyle;
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
      // Depth by shadow, not by outline — see the note on `shadow` in theme.ts.
      ...shadow(colors.shadow).card,
      // 20 across and 18 down, from the handoff, rather than a uniform spacing token. Cards
      // elsewhere in the app already use these, and matching them is the whole point: a card
      // that is four pixels tighter than the one on the previous screen is what makes an app
      // read as two apps stitched together.
      paddingHorizontal: 20,
      paddingVertical: 18,
      // More air between cards than inside them. When the two are equal the page reads as one
      // undifferentiated column; separating the groups is what lets the eye skip to the section
      // it wants instead of reading everything.
      marginBottom: spacing.lg,
    },
    cardAccent: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },

    /*
     * 24 in medium, matching the date that heads the home screen.
     *
     * It was 30 in bold — six points larger and two weights heavier than the title on the one
     * screen that went through a full design pass. That difference sits at the top of every
     * other screen, which makes it the first thing seen after each navigation and the most
     * expensive place in the app for the two generations to disagree.
     */
    screenTitle: {
      color: colors.text,
      fontSize: 24,
      fontWeight: fontWeight.medium,
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
    screenHeaderStart: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
    screenHeaderBack: { color: colors.accent, fontSize: fontSize.xl, fontWeight: '700' },
    // A label for the group below it, not a heading that competes with it. At full text colour
    // and body size in bold it carried the same weight as the numbers inside the card, so every
    // card opened with two things asking to be read first. Smaller, quieter and letterspaced, it
    // does the one job a section title has: say what this is, then get out of the way.
    /*
     * A card heading, in sentence case.
     *
     * It used to be a 12px uppercase micro-label with letter spacing — the treatment the design
     * reserves for a kicker, the small accent line that introduces a card. Using it for the
     * heading itself left every older screen whispering its titles while the home screen spoke
     * them, which was the loudest of the differences between the two.
     */
    sectionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: fontWeight.medium,
      marginBottom: spacing.sm,
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
      // Matched to the home screen's call to action: the larger card radius, and tall enough
      // that a primary action is unmistakably one. A button that is smaller and rounder than
      // the one on the previous screen is the same seam a tighter card is.
      borderRadius: radius.pill,
      minHeight: 54,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    // Filled, and the one filled thing on its screen. A primary action that looks like every
    // other outlined control is a primary action nobody finds.
    buttonPrimary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
      ...shadow(colors.shadow).card,
    },
    buttonSecondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },
    buttonGhost: { backgroundColor: 'transparent', borderColor: colors.border },
    buttonDanger: { backgroundColor: 'transparent', borderColor: 'transparent' },
    /*
     * No opacity flash on press; the scale above carries it alone.
     *
     * The two together read as two separate responses to one touch. The home screen's CTA
     * settled this: the button shrinks a hair, and the accent never floods — which is the one
     * thing this palette is not allowed to do.
     */
    buttonDisabled: { opacity: 0.45 },
    buttonLabel: { fontSize: 17, fontWeight: fontWeight.medium },
    buttonLabelPrimary: { color: colors.bg, fontWeight: fontWeight.bold },
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
    // Weight 500 and tabular figures, as on the home screen. Bold reads as emphasis on a
    // screen full of numbers where nothing is meant to shout, and proportional digits shuffle
    // sideways as a value ticks — which is exactly the movement the eye is trying to read.
    statValue: {
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.medium,
      letterSpacing: -0.3,
      fontVariant: ['tabular-nums'],
    },
    statValueEmphasis: {
      fontSize: fontSize.display,
      color: colors.accent,
      letterSpacing: -1,
      fontWeight: fontWeight.medium,
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
    // Same treatment as Stat: these sit three or four across in a summary row, and a tile whose
    // digits shift width makes the row jitter as a workout is logged.
    tileValue: {
      color: colors.text,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.medium,
      letterSpacing: -0.3,
      fontVariant: ['tabular-nums'],
    },
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
      borderColor: colors.borderSubtle,
      padding: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    skeletonTitle: { height: 16, width: '50%' },
    skeletonLine: { width: '100%' },
    skeletonLineShort: { width: '60%' },
  });
