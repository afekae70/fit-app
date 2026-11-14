/**
 * A week as a picture: the weekly summary, captured and sent from the same window as a workout.
 *
 * Drawn in the workout card's language (`WorkoutShareCard`) so the two read as one family — the
 * accent-to-pink wash and the logo across the top — and lean, as asked: four numbers on glass,
 * the three counters, and the coach's tip for next week in one line. Nothing else to read.
 *
 * What it says is `workout/weekShareCard.ts`.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Lightbulb } from 'phosphor-react-native';
import { useMemo, type Ref } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import logo from '../../../assets/icon.png';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import type { WeekShareModel } from '../../workout/weekShareCard.js';
import { Text } from '../Text.js';
import { SHARE_CARD_WIDTH } from './WorkoutShareCard.js';

export function WeekShareCard({
  model,
  footer,
  ref,
}: {
  model: WeekShareModel;
  footer: string;
  /** The view that is photographed. */
  ref?: Ref<View>;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    // `collapsable={false}`: a view that is not in the native tree cannot be photographed.
    <View ref={ref} collapsable={false} style={s.card}>
      <View style={s.top}>
        <LinearGradient
          colors={[colors.accent, colors.info]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.brandRow}>
          <View style={s.brand}>
            <View style={s.logoTile}>
              <Image source={logo} style={s.logo} accessibilityIgnoresInvertColors />
            </View>
            <Text style={s.brandName}>JUSTFIT</Text>
          </View>
          <Text style={s.when} numberOfLines={1}>
            {model.when}
          </Text>
        </View>

        <Text style={s.title} numberOfLines={1}>
          {model.title}
        </Text>

        {model.stats.length > 0 ? (
          <View style={s.stats}>
            {model.stats.map((stat) => (
              <View key={stat.key} style={s.stat}>
                <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
                  {stat.value}
                </Text>
                <Text style={s.statLabel} numberOfLines={1}>
                  {stat.label}
                </Text>
                {stat.sub ? (
                  <Text style={s.statSub} numberOfLines={1}>
                    {stat.sub}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={s.panel}>
        {model.counts ? (
          <View style={s.counts}>
            <Text style={[s.count, { color: colors.accent }]}>▲ {model.counts.up}</Text>
            <Text style={[s.count, { color: colors.textMuted }]}>＝ {model.counts.same}</Text>
            <Text style={[s.count, { color: colors.warning }]}>▼ {model.counts.down}</Text>
          </View>
        ) : null}

        {/* One line from the coach: what to do next week. */}
        {model.tip ? (
          <View style={s.tip}>
            <Lightbulb size={16} color={colors.bg} weight="fill" />
            <View style={s.tipText}>
              <Text style={s.tipTitle}>{model.tip.title}</Text>
              <Text style={s.tipLine}>{model.tip.text}</Text>
            </View>
          </View>
        ) : null}

        <Text style={s.footer}>{footer}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    card: ViewStyle;
    top: ViewStyle;
    brandRow: ViewStyle;
    brand: ViewStyle;
    logoTile: ViewStyle;
    logo: ImageStyle;
    brandName: TextStyle;
    when: TextStyle;
    title: TextStyle;
    stats: ViewStyle;
    stat: ViewStyle;
    statValue: TextStyle;
    statLabel: TextStyle;
    statSub: TextStyle;
    panel: ViewStyle;
    counts: ViewStyle;
    count: TextStyle;
    tip: ViewStyle;
    tipText: ViewStyle;
    tipTitle: TextStyle;
    tipLine: TextStyle;
    footer: TextStyle;
  }>({
    card: {
      width: SHARE_CARD_WIDTH,
      borderRadius: 28,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      ...shadow(colors.shadow).card,
    },
    top: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, gap: 10 },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoTile: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    logo: { width: 30, height: 30 },
    brandName: { color: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 2.4 },
    when: { color: colors.bg, fontSize: 12, fontWeight: '500', opacity: 0.85, flexShrink: 1 },
    title: { color: colors.bg, fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'auto' },
    // Two to a row, so four numbers stay large enough to read in a story.
    stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    stat: {
      flexGrow: 1,
      flexBasis: '45%',
      borderRadius: radius.lg,
      backgroundColor: 'rgba(255, 255, 255, 0.18)',
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 1,
    },
    statValue: {
      color: colors.bg,
      fontSize: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    statLabel: { color: colors.bg, fontSize: 11, fontWeight: '500', opacity: 0.9, textAlign: 'auto' },
    statSub: { color: colors.bg, fontSize: 11, opacity: 0.75, textAlign: 'auto' },

    panel: {
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 14,
      gap: 12,
    },
    counts: { flexDirection: 'row', gap: 8 },
    count: {
      flex: 1,
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      paddingVertical: 4,
      borderRadius: radius.pill,
      overflow: 'hidden',
      backgroundColor: colors.surfaceRaised,
    },
    tip: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      padding: 12,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
    },
    tipText: { flex: 1, gap: 1 },
    tipTitle: { color: colors.bg, fontSize: 11, fontWeight: '700', opacity: 0.85, textAlign: 'auto' },
    tipLine: { color: colors.bg, fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'auto' },
    footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  });
