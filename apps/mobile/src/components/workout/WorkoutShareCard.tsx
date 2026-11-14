/**
 * A finished workout as a picture: the card that is captured and sent.
 *
 * Built from ordinary views, not drawn — so the text is the app's own type, Hebrew is shaped
 * and ordered by the same engine as every other screen, and the card that is shared is the
 * card that was previewed, pixel for pixel. `ShareCardModal` shows it and photographs it.
 *
 * A fixed width, whatever the phone: this is a picture, and a picture that reflowed to the
 * screen it was made on would be a different picture from every phone. It is captured at the
 * screen's own pixel density, so the narrow layout is still a sharp image.
 *
 * In the app's own colours (the owner, 2026-11-13): the accent-to-pink wash across the top, as the
 * masthead carries it, and the logo beside the name. Progress is told in the accent — the palette
 * has no green, and the app never says "better" in any other colour — a step down in the warning
 * tone, standing still in a muted one. Always beside a symbol or a number, never colour alone.
 *
 * What it says, and where it stops, is `workout/shareCard.ts`.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type Ref } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import logo from '../../../assets/icon.png';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import type { Direction, ShareCardModel, ShareCardRow } from '../../workout/shareCard.js';
import { Text } from '../Text.js';

/** The card's width in layout points. About a phone's, less its margins. */
export const SHARE_CARD_WIDTH = 320;

const ARROW: Record<Direction, string> = { up: '↑', down: '↓', same: '=' };

function toneOf(direction: ShareCardRow['direction'] | Direction, colors: ColorPalette): string {
  if (direction === 'up') return colors.accent;
  if (direction === 'down') return colors.warning;
  if (direction === 'new') return colors.info;
  return colors.textMuted;
}

export function WorkoutShareCard({
  model,
  footer,
  ref,
}: {
  model: ShareCardModel;
  /** The last line: where this came from. */
  footer: string;
  /** The view that is photographed. */
  ref?: Ref<View>;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  return (
    // `collapsable={false}`: a view with nothing but children can be optimised out of the native
    // tree, and a view that is not there cannot be photographed.
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
            {/* The icon is drawn on white, so it sits on a white tile rather than the colour. */}
            <View style={s.logoTile}>
              <Image source={logo} style={s.logo} accessibilityIgnoresInvertColors />
            </View>
            <Text style={s.brandName}>JUSTFIT</Text>
          </View>
          <Text style={s.when} numberOfLines={1}>
            {model.when}
          </Text>
        </View>

        <Text style={s.title} numberOfLines={2}>
          {model.title}
        </Text>

        {model.stats.length > 0 ? (
          <View style={s.stats}>
            {model.stats.map((stat) => (
              <View key={stat.key} style={s.stat}>
                <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
                  {stat.value}
                  {stat.unit ? <Text style={s.statUnit}>{stat.unit}</Text> : null}
                </Text>
                <Text style={s.statLabel} numberOfLines={1}>
                  {stat.direction ? `${ARROW[stat.direction]} ` : ''}
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* How many exercises went up, stayed and went down: the whole workout in three marks. */}
        {model.counts ? (
          <>
            <View style={s.counts}>
              <Text style={[s.count, { color: colors.accent }]}>▲ {model.counts.up}</Text>
              <Text style={[s.count, { color: colors.textMuted }]}>＝ {model.counts.same}</Text>
              <Text style={[s.count, { color: colors.warning }]}>▼ {model.counts.down}</Text>
            </View>
            {model.comparedWith ? <Text style={s.compared}>{model.comparedWith}</Text> : null}
          </>
        ) : null}
      </View>

      <View style={s.panel}>
        {model.groups.map((group, groupIndex) => (
          <View key={group.key} style={groupIndex > 0 && s.groupSpaced}>
            <Text style={[s.groupTitle, { color: groupTone(group.key, colors) }]}>
              {group.title}
            </Text>
            {group.rows.map((row, index) => (
              <View key={`${index}-${row.name}`} style={[s.row, index > 0 && s.rowDivided]}>
                <View style={s.rowText}>
                  <Text style={s.rowName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  {row.detail ? (
                    <Text style={s.rowDetail} numberOfLines={1}>
                      {row.detail}
                    </Text>
                  ) : null}
                </View>
                {row.change ? (
                  <View style={[s.chip, { backgroundColor: chipBackground(row.direction, colors) }]}>
                    <Text style={[s.chipText, { color: toneOf(row.direction, colors) }]}>
                      {row.change}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ))}
        <Text style={s.footer}>{footer}</Text>
      </View>
    </View>
  );
}

function groupTone(key: string, colors: ColorPalette): string {
  if (key === 'progressed') return colors.accent;
  if (key === 'push') return colors.warning;
  if (key === 'new') return colors.info;
  return colors.textMuted;
}

function chipBackground(direction: ShareCardRow['direction'], colors: ColorPalette): string {
  if (direction === 'up') return colors.accentSoft;
  return colors.surfaceRaised;
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
    statUnit: TextStyle;
    statLabel: TextStyle;
    counts: ViewStyle;
    count: TextStyle;
    compared: TextStyle;
    panel: ViewStyle;
    groupSpaced: ViewStyle;
    groupTitle: TextStyle;
    row: ViewStyle;
    rowDivided: ViewStyle;
    rowText: ViewStyle;
    rowName: TextStyle;
    rowDetail: TextStyle;
    chip: ViewStyle;
    chipText: TextStyle;
    footer: TextStyle;
  }>({
    card: {
      width: SHARE_CARD_WIDTH,
      borderRadius: 28,
      // The gradient is a child and would otherwise square off the corners.
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
    // Type on the accent is `bg` throughout the app; the card keeps to that.
    brandName: { color: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 2.4 },
    when: { color: colors.bg, fontSize: 12, fontWeight: '500', opacity: 0.85, flexShrink: 1 },
    title: { color: colors.bg, fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'auto' },
    stats: { flexDirection: 'row', gap: 8 },
    // A pane of the gradient itself, a little lighter — glass on the colour, not a second colour.
    stat: {
      flex: 1,
      borderRadius: radius.lg,
      backgroundColor: 'rgba(255, 255, 255, 0.18)',
      paddingVertical: 8,
      paddingHorizontal: 6,
      alignItems: 'center',
      gap: 1,
    },
    statValue: {
      color: colors.bg,
      fontSize: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    statUnit: { fontSize: 12, fontWeight: '500', opacity: 0.85 },
    statLabel: { color: colors.bg, fontSize: 11, fontWeight: '500', opacity: 0.85 },
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
      backgroundColor: colors.surface,
    },
    compared: { color: colors.bg, fontSize: 11, fontWeight: '500', opacity: 0.85, textAlign: 'center' },

    panel: {
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 14,
    },
    groupSpaced: { marginTop: 10 },
    groupTitle: { fontSize: 12, fontWeight: '700', textAlign: 'auto', paddingTop: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 7,
    },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowText: { flexShrink: 1, gap: 1 },
    rowName: { color: colors.text, fontSize: 14, fontWeight: '500', textAlign: 'auto' },
    rowDetail: {
      color: colors.textMuted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    chip: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8 },
    chipText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 10 },
  });
