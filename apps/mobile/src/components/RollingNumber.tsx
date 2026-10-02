/**
 * A number whose digits roll to their new value instead of blinking to it.
 *
 * Every number in this app is the result of something the user just did — a set ticked, a plate
 * added, a second of rest gone. A digit that swaps instantly reports the result; one that rolls
 * shows the change, and the difference is most of what makes an interface feel built rather than
 * assembled.
 *
 * ## How it is drawn
 *
 * Each digit is a column holding 0–9, clipped to one digit's height, moved by `translateY`. That
 * keeps the whole thing on the native driver: no layout, no colour, nothing the UI thread has to
 * recompute per frame. A character that is not a digit — a point, a colon, a minus — is drawn as
 * itself and never animates, which is what keeps `1:09 → 1:10` rolling only the digits that
 * actually changed.
 *
 * The column is rebuilt when the number of characters changes (9 → 10, 99.5 → 100), because a
 * roll between two different shapes is a scramble rather than a change. That case appears
 * instantly, as it should: the number did not tick, it grew.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { duration } from '../theme.js';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export interface RollingNumberProps {
  /** Already formatted — "82.5", "1:09", "12". This draws what it is given. */
  value: string;
  style?: TextStyle;
  /** The height of one digit. Must clear the font's line height or the roll clips its own text. */
  lineHeight: number;
  align?: 'center' | 'start';
}

export function RollingNumber({ value, style, lineHeight, align = 'center' }: RollingNumberProps) {
  const characters = useMemo(() => [...value], [value]);

  return (
    <View style={[styles.row, align === 'center' && styles.centred, { height: lineHeight }]}>
      {characters.map((character, index) =>
        DIGITS.includes(character) ? (
          <Digit
            // Position, not the character: a digit that stays in place must keep its column so it
            // can roll rather than being replaced by a fresh one.
            key={`${characters.length}-${index}`}
            digit={Number(character)}
            style={style}
            lineHeight={lineHeight}
          />
        ) : (
          <Text key={`${characters.length}-${index}`} style={[style, { lineHeight }]}>
            {character}
          </Text>
        ),
      )}
    </View>
  );
}

function Digit({
  digit,
  style,
  lineHeight,
}: {
  digit: number;
  style?: TextStyle;
  lineHeight: number;
}) {
  const offset = useRef(new Animated.Value(digit)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      // The first value is where the number already was, not a change to show.
      first.current = false;
      offset.setValue(digit);
      return;
    }
    Animated.timing(offset, {
      toValue: digit,
      duration: duration.quick,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [digit, offset]);

  return (
    <View style={{ height: lineHeight, overflow: 'hidden' }}>
      <Animated.View
        style={{
          transform: [
            {
              translateY: offset.interpolate({
                inputRange: [0, 9],
                outputRange: [0, -9 * lineHeight],
              }),
            },
          ],
        }}
      >
        {DIGITS.map((character) => (
          <Text key={character} style={[style, { lineHeight, height: lineHeight }]}>
            {character}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create<{ row: ViewStyle; centred: ViewStyle }>({
  // Pinned left to right: a number reads the same in Hebrew, and mirroring the row would print
  // 13.75 backwards.
  row: { flexDirection: 'row', direction: 'ltr', overflow: 'hidden' },
  centred: { justifyContent: 'center' },
});
