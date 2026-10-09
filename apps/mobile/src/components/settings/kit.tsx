/**
 * What the settings screen is built from.
 *
 * Settings had grown as a stack of cards, each one a title, a paragraph and a control laid out
 * however the feature behind it happened to need — so a screen meant to be scanned read as six
 * unrelated forms. These are the few shapes everything on it is now made of:
 *
 *  - `SettingsSection` — a card with a badge, a name and a line saying what it is for.
 *  - `SettingRow` — one setting: what it is on one side, its control on the other.
 *  - `Choice` — two or three options side by side, one of them lit.
 *  - `ToggleRow` — a setting that is on or off, with a switch that looks like one.
 *  - `LinkRow` — somewhere to go, or something to do.
 *
 * ## Motion
 *
 * A section rises in after the one above it. The lit option in a `Choice` cross-fades: the
 * highlight is its own view over each option, one opacity value, native-driven, on a node that
 * carries nothing else — so the label's colour can change as a plain style beside it without
 * the two ever meeting on one view. See CLAUDE.md for what happens when they do.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { CaretLeft, CaretRight, type Icon } from 'phosphor-react-native';

import { hapticLight } from '../../haptics.js';
import { isRtlLanguage, type Language } from '../../i18n/index.js';
import { useTheme } from '../../ThemeProvider.js';
import {
  duration,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  type ColorPalette,
} from '../../theme.js';
import { FadeSlideIn } from '../motion.js';

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export function SettingsSection({
  icon: IconComponent,
  title,
  hint,
  index = 0,
  children,
}: {
  icon: Icon;
  title: string;
  /** One line under the name. What the section is for, not how to use it. */
  hint?: string;
  /** Position on the screen, for the staggered entrance. */
  index?: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <FadeSlideIn index={index} style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.badge}>
          <IconComponent size={20} color={colors.accent} weight="duotone" />
        </View>
        <View style={styles.sectionText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </FadeSlideIn>
  );
}

/** A hairline between two rows of one section. */
export function RowDivider() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.divider} />;
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One setting. The label takes the room it needs; the control sits at the far end.
 *
 * `stacked` puts the control underneath instead — for a `Choice` with three options, which
 * does not fit beside a label on a phone in either language.
 */
export function SettingRow({
  label,
  hint,
  stacked = false,
  children,
}: {
  label: string;
  hint?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={stacked ? styles.rowStacked : styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <SettingRow label={label} hint={hint}>
      <Switch
        value={value}
        onValueChange={(next) => {
          hapticLight();
          onChange(next);
        }}
        disabled={disabled}
        trackColor={{ false: colors.surfaceHigh, true: colors.accent }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.surfaceHigh}
        accessibilityLabel={label}
      />
    </SettingRow>
  );
}

/** A row that goes somewhere or does something. `tone="danger"` for the ones that cannot be undone. */
export function LinkRow({
  label,
  hint,
  icon: IconComponent,
  onPress,
  tone = 'default',
  disabled = false,
  chevron = true,
}: {
  label: string;
  hint?: string;
  icon?: Icon;
  onPress: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** False for an action that happens here rather than leading somewhere. */
  chevron?: boolean;
}) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The chevron points where the row leads, which is the other way in a right-to-left layout.
  const Chevron = isRtlLanguage(i18n.language as Language) ? CaretLeft : CaretRight;
  const tint = tone === 'danger' ? colors.danger : colors.text;

  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.link, (pressed || disabled) && styles.pressed]}
    >
      {IconComponent ? (
        <IconComponent size={20} color={tone === 'danger' ? colors.danger : colors.textMuted} />
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {chevron ? <Chevron size={16} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Choice                                                                      */
/* -------------------------------------------------------------------------- */

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** Two or three options in one rounded track, the chosen one lit. */
export function Choice<T extends string>({
  options,
  selected,
  onSelect,
  style,
}: {
  options: readonly ChoiceOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.choice, style]} accessibilityRole="radiogroup">
      {options.map((option) => (
        <ChoiceItem
          key={option.value}
          label={option.label}
          active={option.value === selected}
          onPress={() => {
            if (option.value === selected) return;
            hapticLight();
            onSelect(option.value);
          }}
        />
      ))}
    </View>
  );
}

function ChoiceItem({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const lit = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(lit, {
      toValue: active ? 1 : 0,
      duration: duration.quick,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [lit, active]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={styles.choiceItem}
    >
      <Animated.View style={[styles.choiceLit, { opacity: lit }]} />
      <Text style={[styles.choiceText, active && styles.choiceTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    section: ViewStyle;
    sectionHead: ViewStyle;
    badge: ViewStyle;
    sectionText: ViewStyle;
    sectionTitle: TextStyle;
    sectionHint: TextStyle;
    sectionBody: ViewStyle;
    divider: ViewStyle;
    row: ViewStyle;
    rowStacked: ViewStyle;
    rowText: ViewStyle;
    rowLabel: TextStyle;
    rowHint: TextStyle;
    link: ViewStyle;
    pressed: ViewStyle;
    choice: ViewStyle;
    choiceItem: ViewStyle;
    choiceLit: ViewStyle;
    choiceText: TextStyle;
    choiceTextOn: TextStyle;
  }>({
    section: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.lg,
      ...shadow(colors.shadow).card,
    },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    badge: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    sectionText: { flex: 1, gap: spacing.xxs },
    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    sectionHint: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 17, textAlign: 'auto' },
    sectionBody: { gap: spacing.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: 40,
    },
    rowStacked: { gap: spacing.sm },
    rowText: { flex: 1, gap: spacing.xxs },
    rowLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.medium, textAlign: 'auto' },
    rowHint: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 17, textAlign: 'auto' },

    link: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 44,
    },
    pressed: { opacity: 0.55 },

    choice: {
      flexDirection: 'row',
      padding: 3,
      gap: 3,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    choiceItem: {
      flex: 1,
      minHeight: 38,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    choiceLit: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
    },
    choiceText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    choiceTextOn: { color: colors.bg, fontWeight: fontWeight.bold },
  });
