/**
 * An icon where a character used to be.
 *
 * The app had two icon systems. One was a real set — Phosphor, on the tab bar and the quick
 * actions. The other was whatever the keyboard offered: 🏋 for an empty list, 💬 before a
 * coach's note, ✓ in a tick box, ▶ on a start button. Those are not drawn by the app at all.
 * The phone draws them, each maker in its own style, in full colour where the app is a quiet
 * two-tone, and at a weight that matches nothing beside them. The same screen looked like one
 * design on one phone and like a different one on the next.
 *
 * These two components put an icon from the real set in the place a character stood, and they
 * are shaped so that doing it is a swap rather than a redesign:
 *
 *  - `Glyph` takes the *text style* the character had, and reads its size and colour from it.
 *    A style written for `✓` — `{ color, fontSize }`, with a second style for the ticked
 *    state — goes on working unchanged, conditions and all.
 *  - `IconText` is a label with an icon in front of it: what `` `💬 ${note}` `` was.
 *
 * Icons follow the layout direction like any other child of a row, so the icon leads the label
 * in Hebrew and in English alike. They are not mirrored: none of the ones used here point
 * anywhere that Hebrew would point the other way.
 */

import type { Icon, IconWeight } from 'phosphor-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { Text } from './Text.js';

/**
 * What a text style says about *where* its text goes, as opposed to how it is drawn: margins,
 * and the position of a mark pinned to a corner. These belong to whatever now stands in the
 * text's place, so they move to the icon's own box.
 */
const PLACEMENT = [
  'margin',
  'marginTop',
  'marginBottom',
  'marginStart',
  'marginEnd',
  'marginHorizontal',
  'marginVertical',
  'position',
  'top',
  'bottom',
  'start',
  'end',
  'zIndex',
  'alignSelf',
] as const;

function placementOf(flat: TextStyle): ViewStyle {
  const out: Record<string, unknown> = {};
  for (const key of PLACEMENT) if (flat[key] !== undefined) out[key] = flat[key];
  return out;
}

/** Undoes the placement on the pieces inside a row that has taken it over. */
const UNPLACED: TextStyle = {
  margin: 0,
  marginTop: 0,
  marginBottom: 0,
  marginStart: 0,
  marginEnd: 0,
  marginHorizontal: 0,
  marginVertical: 0,
  position: 'relative',
  top: undefined,
  bottom: undefined,
  start: undefined,
  end: undefined,
  alignSelf: 'auto',
};

export interface GlyphProps {
  icon: Icon;
  /** The style the character had. Its `fontSize` is the icon's size, its `color` the colour. */
  style?: StyleProp<TextStyle>;
  /**
   * Stroke weight. Bold by default: a mark standing alone — a tick, a cross — is read at a
   * glance and at small sizes, where the regular stroke thins to a hairline.
   */
  weight?: IconWeight;
  /** A drawn icon fills its box less than a letter fills its line; this evens the two out. */
  scale?: number;
}

export function Glyph({ icon: IconComponent, style, weight = 'bold', scale = 1 }: GlyphProps) {
  const { colors } = useTheme();
  const flat = StyleSheet.flatten(style) ?? {};
  const size = Math.round((flat.fontSize ?? 16) * scale);
  const color = typeof flat.color === 'string' ? flat.color : colors.text;

  return (
    <View
      style={[placementOf(flat), flat.opacity === undefined ? null : { opacity: flat.opacity }]}
    >
      <IconComponent size={size} color={color} weight={weight} />
    </View>
  );
}

export interface IconTextProps {
  icon: Icon;
  /** The label's text style. The icon takes its colour and its size from it. */
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  weight?: IconWeight;
  numberOfLines?: number;
  /**
   * The label may run to several lines — a note, not a button. The icon then sits beside the
   * first line instead of centring itself against the whole paragraph.
   */
  multiline?: boolean;
}

export function IconText({
  icon,
  style,
  children,
  weight = 'bold',
  numberOfLines,
  multiline = false,
}: IconTextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = flat.fontSize ?? 16;
  const iconSize = Math.round(fontSize * 1.15);
  // Beside the first line: half of whatever the line is taller than the icon.
  const lineHeight = flat.lineHeight ?? Math.round(fontSize * 1.35);
  const nudge = multiline ? Math.max(0, Math.round((lineHeight - iconSize) / 2)) : 0;

  return (
    <View
      style={[
        styles.row,
        multiline ? styles.rowTop : null,
        { gap: Math.max(4, Math.round(fontSize * 0.4)) },
        placementOf(flat),
      ]}
    >
      <View style={nudge > 0 ? { marginTop: nudge } : null}>
        <Glyph icon={icon} style={[style, UNPLACED]} weight={weight} scale={1.15} />
      </View>
      <Text style={[style, UNPLACED, styles.label]} numberOfLines={numberOfLines}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowTop: { alignItems: 'flex-start' },
  // Lets a long label wrap or truncate instead of pushing the icon out of the row.
  label: { flexShrink: 1 },
});
