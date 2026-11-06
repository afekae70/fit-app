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
 * What it says, and where it stops, is `workout/shareCard.ts`.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type Ref } from 'react';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import type { ShareCardModel } from '../../workout/shareCard.js';
import { Text } from '../Text.js';

/** The card's width in layout points. About a phone's, less its margins. */
export const SHARE_CARD_WIDTH = 320;

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
      <LinearGradient
        colors={[colors.accent, colors.info]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={s.top}>
        <View style={s.brandRow}>
          <Text style={s.brand}>JUSTFIT</Text>
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
                </Text>
                <Text style={s.statLabel} numberOfLines={1}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={s.panel}>
        {model.rows.map((row, index) => (
          <View key={`${index}-${row.name}`} style={[s.row, index > 0 && s.rowDivided]}>
            <Text style={s.rowName} numberOfLines={1}>
              {row.name}
            </Text>
            <Text style={s.rowDetail} numberOfLines={1}>
              {row.detail}
            </Text>
          </View>
        ))}
        {model.more ? <Text style={s.more}>{model.more}</Text> : null}
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
    brand: TextStyle;
    when: TextStyle;
    title: TextStyle;
    stats: ViewStyle;
    stat: ViewStyle;
    statValue: TextStyle;
    statLabel: TextStyle;
    panel: ViewStyle;
    row: ViewStyle;
    rowDivided: ViewStyle;
    rowName: TextStyle;
    rowDetail: TextStyle;
    more: TextStyle;
    footer: TextStyle;
  }>({
    card: {
      width: SHARE_CARD_WIDTH,
      borderRadius: 28,
      // The gradient is a child and would otherwise square off the corners.
      overflow: 'hidden',
      backgroundColor: colors.accent,
      ...shadow(colors.shadow).card,
    },
    top: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20, gap: 10 },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    // Type on the accent is `bg` throughout the app; the card keeps to that.
    brand: { color: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 2.4, opacity: 0.9 },
    when: { color: colors.bg, fontSize: 12, fontWeight: '500', opacity: 0.85, flexShrink: 1 },
    title: { color: colors.bg, fontSize: 30, lineHeight: 36, fontWeight: '800', textAlign: 'auto' },
    stats: { flexDirection: 'row', gap: 8, marginTop: 4 },
    // A pane of the gradient itself, a little lighter — glass on the colour, not a second colour.
    stat: {
      flex: 1,
      borderRadius: radius.lg,
      backgroundColor: 'rgba(255, 255, 255, 0.18)',
      paddingVertical: 10,
      paddingHorizontal: 8,
      alignItems: 'center',
      gap: 1,
    },
    statValue: {
      color: colors.bg,
      fontSize: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    statLabel: { color: colors.bg, fontSize: 11, fontWeight: '500', opacity: 0.85 },

    panel: {
      backgroundColor: colors.surface,
      borderTopStartRadius: 24,
      borderTopEndRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 9,
    },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      textAlign: 'auto',
      flexShrink: 1,
    },
    rowDetail: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    more: { color: colors.textMuted, fontSize: 12, textAlign: 'auto', marginTop: 6 },
    footer: {
      color: colors.textMuted,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 12,
    },
  });
