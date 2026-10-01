/**
 * The app's own number pad, in a sheet over the bottom of the screen.
 *
 * It replaces the system keyboard for the numbers typed during a workout. Two things it does
 * that the keyboard would not: it never loses the first keystroke, and it never covers the thing
 * being edited — because what is being edited is named at the top of the sheet, in words, with
 * the number itself at a size readable at arm's length.
 *
 * The keys are large on purpose. This is operated by one thumb, mid-set, by someone who is out
 * of breath; a 44pt target is the floor, and these are comfortably above it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import { padText, padValue, pressKey, type PadKey } from '../../workout/numberPad.js';

export interface NumberPadRequest {
  /** What is being filled in, in words: "חזה · סט 2 · ק״ג". */
  title: string;
  value: number | null;
  /** The unit, shown beside the number. */
  unit?: string;
  decimals?: boolean;
  onCommit: (value: number | null) => void;
}

/** Backspace is not among them: it sits at the top right, beside the number it deletes from. */
const KEYS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'clear'],
];

export function NumberPadSheet({
  request,
  onClose,
}: {
  request: NumberPadRequest | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [text, setText] = useState('');

  // Opens on what is already recorded, so a correction is a backspace rather than a retype.
  useEffect(() => {
    setText(padText(request?.value ?? null));
  }, [request]);

  if (!request) return null;

  const decimals = request.decimals ?? true;

  const press = (key: PadKey) => {
    void hapticLight();
    setText((current) => pressKey(current, key, { decimals }));
  };

  /*
   * Leaving the pad is what saves.
   *
   * There was a Done key, and it was a key that did nothing the act of closing could not: nobody
   * types a number and then means for it not to be kept. Tapping outside, pressing back, or
   * reaching for the next set all commit what is on the display.
   */
  const dismiss = () => {
    request.onCommit(padValue(text));
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss} statusBarTranslucent>
      {/* Tapping outside keeps what was typed, like every other field in the app: an edit ends
          when you look away from it. */}
      <Pressable
        style={s.backdrop}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t('common.done')}
      />

      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={s.title} numberOfLines={1}>
          {request.title}
        </Text>

        {/* Top right, physically: it belongs with the number it takes a digit off, and that is
            the corner a right-handed thumb reaches without crossing the keys. */}
        <Pressable
          onPress={() => press('back')}
          accessibilityRole="button"
          accessibilityLabel={t('common.delete')}
          hitSlop={8}
          style={({ pressed }) => [s.backspace, pressed && s.keyPressed]}
        >
          <Text style={s.backspaceGlyph}>⌫</Text>
        </Pressable>

        <View style={s.valueRow}>
          <Text style={s.value}>{text === '' ? '—' : text}</Text>
          {request.unit ? <Text style={s.unit}>{request.unit}</Text> : null}
        </View>

        <View style={s.keys}>
          {KEYS.map((row, rowIndex) => (
            <View key={rowIndex} style={s.keyRow}>
              {row.map((key) => {
                const disabled = key === '.' && !decimals;
                return (
                  <Pressable
                    key={key}
                    onPress={() => press(key)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={key === 'clear' ? t('common.clear') : key}
                    style={({ pressed }) => [
                      s.key,
                      disabled && s.keyOff,
                      pressed && s.keyPressed,
                    ]}
                  >
                    <Text style={s.keyText}>{key === 'clear' ? t('common.clear') : key}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

      </View>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    backdrop: ViewStyle;
    sheet: ViewStyle;
    title: TextStyle;
    backspace: ViewStyle;
    backspaceGlyph: TextStyle;
    valueRow: ViewStyle;
    value: TextStyle;
    unit: TextStyle;
    keys: ViewStyle;
    keyRow: ViewStyle;
    key: ViewStyle;
    keyOff: ViewStyle;
    keyPressed: ViewStyle;
    keyText: TextStyle;
  }>({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 12,
      paddingTop: 14,
      gap: 10,
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      ...shadow(colors.shadow).floating,
    },
    title: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 44 },
    backspace: {
      position: 'absolute',
      top: 8,
      right: 12,
      width: 46,
      height: 40,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    backspaceGlyph: { color: colors.text, fontSize: 19 },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
    value: {
      color: colors.text,
      fontSize: 40,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      // Always left to right: a number reads the same in Hebrew, and mirroring it would turn
      // 13.75 around as it is being typed.
      writingDirection: 'ltr',
    },
    unit: { color: colors.textFaint, fontSize: 15 },

    keys: { gap: 8 },
    keyRow: { flexDirection: 'row', gap: 8 },
    key: {
      flex: 1,
      height: 58,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    keyOff: { opacity: 0.35 },
    keyPressed: { opacity: 0.7 },
    keyText: { color: colors.text, fontSize: 24, fontWeight: '500' },

  });
