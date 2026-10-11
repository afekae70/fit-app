/**
 * `Text` and `TextInput`, set in the app's own typeface.
 *
 * Every screen imports these instead of React Native's. They are the same components with one
 * thing added: the font. React Native has no app-wide default font, and the alternative — a
 * `fontFamily` on every one of several hundred styles — is a rule that the next screen written
 * would simply not know about. Importing `Text` from here is the whole rule, and
 * `typography/imports.test.ts` fails when a file reaches past it.
 *
 * The weight a style asks for chooses the file: see `typography/fontFamily.ts` for why a font
 * loaded at runtime cannot be asked for "the bold one".
 */

import { createContext, useContext, type ComponentPropsWithRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextStyle,
} from 'react-native';

import { fontFor } from '../typography/fontFamily.js';

/**
 * True inside another `Text`.
 *
 * Nested text inherits its parent's font, so it must not be handed regular by default — that
 * would un-bold a run sitting in a bold line. See `fontFor`.
 */
const InsideText = createContext(false);

/** The style that sets the font, or undefined when the style is to be left as it is. */
function withFont(style: unknown, nested: boolean): { fontFamily: string } | undefined {
  const flat = StyleSheet.flatten(style as TextStyle) as TextStyle | undefined;
  const fontFamily = fontFor(flat, { nested });
  return fontFamily ? { fontFamily } : undefined;
}

export function Text({ style, ...rest }: ComponentPropsWithRef<typeof NativeText>) {
  const nested = useContext(InsideText);
  const text = <NativeText {...rest} style={[style, withFont(style, nested)]} />;
  // Already inside text: the context is set, and setting it again is a provider for nothing.
  return nested ? text : <InsideText.Provider value>{text}</InsideText.Provider>;
}

/**
 * The instance type, under the same name — so `useRef<Text>(null)` means what it meant when
 * this was imported from React Native.
 */
export type Text = NativeText;

export function TextInput({ style, ...rest }: ComponentPropsWithRef<typeof NativeTextInput>) {
  return <NativeTextInput {...rest} style={[style, withFont(style, false)]} />;
}

export type TextInput = NativeTextInput;

/** Which field has the keyboard — asked of the component by the screens that scroll for it. */
TextInput.State = NativeTextInput.State;

/** `Animated.Text`, in the app's typeface. */
export const AnimatedText = Animated.createAnimatedComponent(Text);
