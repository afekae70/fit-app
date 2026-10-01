/**
 * A number you can type into, inside a row that is being rewritten underneath you.
 *
 * The fields on a set row used to be uncontrolled `TextInput`s re-keyed on their own committed
 * value. A new key is a new component: the moment the first keystroke reached the database, the
 * field it was typed into was replaced by a fresh one, and on Android the character that caused
 * it was swallowed — which is why a weight had to be typed twice before it took.
 *
 * So the text lives here instead, and nothing about it is keyed on the value. While the field has
 * focus it is the user's: no prop can overwrite what is half-typed. When focus leaves, the value
 * is committed and the field goes back to following the number it was given — which is what makes
 * a stepper press, a suggestion applied, or a reload from the database show up in it.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';

export interface NumberEntryHandle {
  /** Save whatever is typed but not yet committed. Called before a tick, and on unmount. */
  flush: () => void;
}

export interface NumberEntryProps {
  /** The committed value, as it should read when the field is not being typed into. */
  value: number | null;
  /** How that value is written out. Keeps units and decimals the caller's business. */
  format: (value: number) => string;
  /** What a typed string means, or null when it means nothing yet. */
  parse: (text: string) => number | null;
  onCommit: (next: number) => void;
  style?: StyleProp<TextStyle>;
  placeholder?: string;
  placeholderTextColor?: string;
  decimals?: boolean;
  accessibilityLabel?: string;
}

export const NumberEntry = forwardRef<NumberEntryHandle, NumberEntryProps>(function NumberEntry(
  { value, format, parse, onCommit, style, placeholder = '—', placeholderTextColor, decimals = false, accessibilityLabel },
  ref,
) {
  const [text, setText] = useState(value === null ? '' : format(value));
  const focused = useRef(false);

  // Follow the value, but never while it is being typed into.
  useEffect(() => {
    if (focused.current) return;
    setText(value === null ? '' : format(value));
    // `format` is rebuilt on every render by most callers; following it would fight the typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (raw: string) => {
    const parsed = parse(raw);
    if (parsed === null) {
      // Nothing usable typed: fall back to what the value says, so the field never sits on a
      // half-written number that was never saved.
      setText(value === null ? '' : format(value));
      return;
    }
    onCommit(parsed);
  };

  useImperativeHandle(ref, () => ({
    flush: () => {
      if (!focused.current) return;
      commit(text);
    },
  }));

  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit(text);
      }}
      keyboardType={decimals ? 'numeric' : 'number-pad'}
      inputMode={decimals ? 'decimal' : 'numeric'}
      selectTextOnFocus
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      accessibilityLabel={accessibilityLabel}
      style={style}
    />
  );
});
