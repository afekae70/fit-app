/**
 * Small shared UI primitives.
 *
 * RTL rule enforced throughout: only logical layout properties are used
 * (`marginStart`/`marginEnd`, `paddingStart`/`paddingEnd`, `textAlign: 'auto'`) — never
 * `left`/`right`. React Native mirrors the logical ones automatically under RTL, so the same
 * component renders correctly in Hebrew and English without per-language branching.
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

import { colors, fontSize, radius, spacing } from '../theme.js';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/** A labelled numeric field. `suffix` shows the unit without putting it inside the input. */
export function NumberField({
  label,
  value,
  suffix,
  onChangeText,
}: {
  label: string;
  value: string;
  suffix?: string;
  onChangeText: (next: string) => void;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          inputMode="decimal"
          style={styles.input}
          placeholderTextColor={colors.textMuted}
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

/** Single-select control. Used for sex / activity level / goal. */
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

/** A single number with a caption — the primary way results are displayed. */
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

export function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'warning';
  children: ReactNode;
}) {
  return (
    <View style={[styles.banner, tone === 'warning' ? styles.bannerWarning : styles.bannerInfo]}>
      <Text
        style={[
          styles.bannerText,
          tone === 'warning' ? styles.bannerTextWarning : styles.bannerTextInfo,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * Explicit per-key style types.
 *
 * Without them, `StyleSheet.create` infers `ViewStyle | TextStyle | ImageStyle` for every key
 * in a mixed stylesheet, and passing e.g. `styles.card` to a `View` then fails to typecheck
 * because the union might be a TextStyle. Naming the type per key keeps the inference precise.
 */
const styles = StyleSheet.create<{
  card: ViewStyle;
  sectionTitle: TextStyle;
  hint: TextStyle;
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
  stat: ViewStyle;
  statLabel: TextStyle;
  statValueRow: ViewStyle;
  statValue: TextStyle;
  statValueEmphasis: TextStyle;
  statUnit: TextStyle;
  statHint: TextStyle;
  banner: ViewStyle;
  bannerInfo: ViewStyle;
  bannerWarning: ViewStyle;
  bannerText: TextStyle;
  bannerTextInfo: TextStyle;
  bannerTextWarning: TextStyle;
}>({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textAlign: 'auto',
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
    textAlign: 'auto',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.md,
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
    minWidth: 108,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    paddingVertical: spacing.sm,
    // Numbers read left-to-right even in Hebrew, so this stays 'center' rather than 'start'.
    textAlign: 'center',
  },
  suffix: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginStart: spacing.xs,
  },
  segmentedBlock: {
    paddingVertical: spacing.sm,
  },
  segmentedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  segment: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  segmentActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  segmentTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  stat: {
    paddingVertical: spacing.sm,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'auto',
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.xs,
  },
  statValue: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  statValueEmphasis: {
    fontSize: fontSize.xxl,
    color: colors.accent,
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginStart: spacing.xs,
  },
  statHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
    textAlign: 'auto',
  },
  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bannerInfo: {
    backgroundColor: '#12212E',
    borderColor: '#1E3A52',
  },
  bannerWarning: {
    backgroundColor: '#2A2010',
    borderColor: '#6B5518',
  },
  bannerText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'auto',
  },
  bannerTextInfo: {
    color: '#9DC7EA',
  },
  bannerTextWarning: {
    color: colors.warning,
  },
});
