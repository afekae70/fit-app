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

const KEYS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
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

  const done = () => {
    request.onCommit(padValue(text));
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Outside the sheet closes it without saving — the same bargain every sheet in the app
          makes, and the reason the number is committed by a key rather than by dismissing. */}
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" />

      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={s.title} numberOfLines={1}>
          {request.title}
        </Text>

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
                    accessibilityLabel={key === 'back' ? t('common.delete') : key}
                    style={({ pressed }) => [
                      s.key,
                      disabled && s.keyOff,
                      pressed && s.keyPressed,
                    ]}
                  >
                    <Text style={s.keyText}>{key === 'back' ? '⌫' : key}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View style={s.actions}>
          <Pressable
            onPress={() => press('clear')}
            accessibilityRole="button"
            style={({ pressed }) => [s.action, pressed && s.keyPressed]}
          >
            <Text style={s.actionText}>{t('common.clear')}</Text>
          </Pressable>
          <Pressable
            onPress={done}
            accessibilityRole="button"
            style={({ pressed }) => [s.action, s.actionPrimary, pressed && s.keyPressed]}
          >
            <Text style={[s.actionText, s.actionPrimaryText]}>{t('common.done')}</Text>
          </Pressable>
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
    valueRow: ViewStyle;
    value: TextStyle;
    unit: TextStyle;
    keys: ViewStyle;
    keyRow: ViewStyle;
    key: ViewStyle;
    keyOff: ViewStyle;
    keyPressed: ViewStyle;
    keyText: TextStyle;
    actions: ViewStyle;
    action: ViewStyle;
    actionPrimary: ViewStyle;
    actionText: TextStyle;
    actionPrimaryText: TextStyle;
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
    title: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
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

    actions: { flexDirection: 'row', gap: 8 },
    action: {
      flex: 1,
      minHeight: 50,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    actionText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
    actionPrimaryText: { color: colors.bg, fontWeight: '700' },
  });
