/**
 * Shared UI primitives.
 *
 * RTL rule enforced throughout: only logical layout properties (`marginStart`/`marginEnd`,
 * `paddingStart`/`paddingEnd`) and `textAlign: 'auto'`, never `left`/`right`. React Native
 * mirrors the logical ones under RTL, so one component renders correctly in Hebrew and
 * English with no per-language branching.
 */

import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '../theme.js';

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
  return (
    <View style={[styles.card, tone === 'accent' && styles.cardAccent, style]}>{children}</View>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
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
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onEndEditing={onEndEditing}
          keyboardType="numeric"
          inputMode="decimal"
          style={styles.input}
          placeholderTextColor={colors.textFaint}
          selectTextOnFocus
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
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
  return (
    <View style={styles.segmentedBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segmentedRow}>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={[styles.segment, active && styles.segmentActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
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
  return (
    <View
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
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create<{
  card: ViewStyle;
  cardAccent: ViewStyle;
  screenTitle: TextStyle;
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
  segmentActive: ViewStyle;
  segmentText: TextStyle;
  segmentTextActive: TextStyle;
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
  segmentActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  segmentText: { color: colors.textMuted, fontSize: fontSize.sm },
  segmentTextActive: { color: colors.accent, fontWeight: fontWeight.bold },

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
  bannerInfo: { backgroundColor: colors.infoSoft, borderColor: '#1E3E56' },
  bannerWarning: { backgroundColor: colors.warningSoft, borderColor: '#5C4614' },
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
});
