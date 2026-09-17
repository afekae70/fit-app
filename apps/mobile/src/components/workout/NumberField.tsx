/**
 * A number field that does not lose what was typed into it.
 *
 * The fields on these screens are uncontrolled — typing must not re-render the list on every
 * keystroke — and they save when an edit ends. That event is not guaranteed to arrive: tapping
 * back while the keyboard is still up removes the field, and the number goes with it. It is the
 * same fault that lost the reps in every exercise's last set, one screen over.
 *
 * So the field keeps what has been typed and saves it itself when it goes away. Clearing it is a
 * real instruction here — it is how a target is removed — so an emptied field saves as nothing
 * rather than being ignored.
 */

import { useEffect, useRef } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';

import { valueOrClearToCommit } from '../../workout/typedEntry.js';

export function NumberField({
  value,
  onCommit,
  placeholder = '—',
  placeholderTextColor,
  style,
  accessibilityLabel,
}: {
  value: number | null;
  onCommit: (next: number | null) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const typed = useRef<string | null>(null);

  // Held in a ref so the unmount below saves against the current value rather than the one this
  // field was first rendered with.
  const commit = useRef(() => {
    /* replaced on every render */
  });
  commit.current = () => {
    const next = valueOrClearToCommit(typed.current, value);
    typed.current = null;
    if (next !== undefined) onCommit(next);
  };
  useEffect(() => () => commit.current(), []);

  return (
    <TextInput
      // Re-keyed on the saved value so a change made elsewhere — a stepper, a reload — reaches
      // the field, which being uncontrolled would otherwise keep showing what it had.
      key={value ?? 'empty'}
      defaultValue={value === null ? '' : String(value)}
      onChangeText={(text) => {
        typed.current = text;
      }}
      onEndEditing={() => commit.current()}
      keyboardType="number-pad"
      inputMode="numeric"
      selectTextOnFocus
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      accessibilityLabel={accessibilityLabel}
      style={style}
    />
  );
}
