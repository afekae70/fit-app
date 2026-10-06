/**
 * Typing a set's number on the phone's own numeric keyboard.
 *
 * A bar that sits directly above the keyboard, says which number it is — "לחיצת חזה · סט 2 · ק״ג"
 * — and holds the one field being typed into. The keys are the system's: the layout a thumb
 * already knows, with nothing on it but digits.
 *
 * ## Why it is a bar, and not the row itself
 *
 * The system keyboard was here once before and was replaced by a pad of the app's own, for two
 * faults that were both real: the first digit of every entry vanished, and the keys covered the
 * row being filled in. Both came from *where the field was*, not from the keyboard.
 *
 * The field used to live inside the set row, in a list that reloads from the database after every
 * write. A reload could replace the row, and the keystroke that caused the write was typed into a
 * field that no longer existed. And a row near the bottom of the list is exactly where a keyboard
 * draws.
 *
 * So the field is out of the list. It is mounted once when an edit starts, nothing is written
 * while it is being typed into, and it is docked above the keys by the same `KeyboardSafe` that
 * lifts every other field in the app — so there is nothing to remount it and nothing to cover it.
 *
 * ## Why not a Modal
 *
 * Because on this build it does not work, and ActionSheetProvider records how: a Modal is its own
 * native window, an edge-to-edge window is not resized for the keyboard, React Native measures
 * the keyboard on the app's main window rather than a dialog's, and `autoFocus` inside one put a
 * cursor in the field without ever raising the keys. Here, in the main window, all four behave.
 *
 * ## Empty, with the current number behind it
 *
 * The field opens empty and shows what is already recorded as its placeholder. Typing is then
 * always "this is the number" — never an edit of a string with a cursor somewhere in it — and
 * leaving without typing changes nothing at all, which is what looking at a number should do.
 *
 * It is also uncontrolled: what is typed goes into a ref and nothing is passed back down as
 * `value`. A controlled field is a round trip through JavaScript on every key, and a round trip
 * that loses a race drops a character — the fault this exists to be rid of.
 *
 * ## One field for the whole edit
 *
 * Tapping another number while the bar is open does not close and reopen it. The same field
 * stays focused, saves what it held, and becomes the next number — so going from the weight to
 * the reps never lets go of the keyboard, and there is no moment for it to flicker shut.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { hapticLight } from '../../haptics.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, shadow, type ColorPalette } from '../../theme.js';
import { entryMaxLength, entryText, parseEntry } from '../../workout/numberEntry.js';

export interface NumberEntryRequest {
  /** Which number this is. A different id is a different number, and the last one is saved. */
  id: string;
  /** What is being filled in, in words: "חזה · סט 2 · ק״ג". */
  title: string;
  /** What is recorded now. Shown behind the field until something is typed over it. */
  value: number | null;
  /** The unit, shown beside the number. */
  unit?: string;
  decimals?: boolean;
  /** Called with what was typed — and not called at all when nothing was. */
  onCommit: (value: number) => void;
}

/**
 * A keyboard-hidden report this soon after opening is about the last edit, not this one.
 *
 * Finishing one number and tapping the next can have the previous keyboard's "hidden" arrive
 * after the new bar is already up. Nobody dismisses a keyboard a quarter of a second after
 * asking for it, so anything that early is ignored rather than obeyed.
 */
const IGNORE_HIDE_FOR_MS = 250;

/** A beat before believing the keyboard is gone, in case it is only changing layout. */
const HIDE_SETTLE_MS = 120;

export function NumberEntryBar({
  request,
  onClose,
}: {
  request: NumberEntryRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const decimals = request.decimals ?? true;
  const input = useRef<TextInput>(null);
  const text = useRef('');
  const alive = useRef(true);

  // The number being edited, and the way out, held in refs: this screen repaints every second,
  // and effects that re-ran on every new closure would be re-subscribing to the keyboard
  // mid-keystroke.
  const editing = useRef(request);
  const close = useRef(onClose);
  close.current = onClose;

  /** Save what was typed for the number being edited, if anything was, and empty the buffer. */
  const commit = useCallback(() => {
    const target = editing.current;
    const value = parseEntry(text.current, { decimals: target.decimals ?? true });
    text.current = '';
    if (value !== null) target.onCommit(value);
  }, []);

  /*
   * Leaving the field is what saves.
   *
   * There is no cancel, as there is none on any other field in the app: nobody types a number and
   * means for it not to be kept. The done key, the tick on the bar, hiding the keyboard and
   * dragging the list all end here.
   */
  const finish = useCallback(() => {
    commit();
    Keyboard.dismiss();
    close.current();
  }, [commit]);

  // A different number was tapped while this one was open: keep the field and the keyboard,
  // save the old number, and start the new one empty.
  useEffect(() => {
    if (editing.current.id === request.id) {
      editing.current = request;
      return;
    }
    commit();
    editing.current = request;
    input.current?.clear();
  }, [request, commit]);

  useEffect(() => {
    alive.current = true;
    const openedAt = Date.now();
    let shown = Keyboard.isVisible();
    let settle: ReturnType<typeof setTimeout> | null = null;

    // Belt and braces for the keyboard actually rising. `autoFocus` does it in the main window;
    // this covers the frame where the field mounts before the window is ready to take focus.
    const raise = requestAnimationFrame(() => input.current?.focus());

    const onShow = Keyboard.addListener('keyboardDidShow', () => {
      shown = true;
      if (settle) clearTimeout(settle);
      settle = null;
    });

    // On Android, hiding the keyboard does not blur the field — the cursor stays, with nothing
    // to type on. So the keyboard going away is itself the signal that the edit is over.
    const onHide = Keyboard.addListener('keyboardDidHide', () => {
      if (!shown || Date.now() - openedAt < IGNORE_HIDE_FOR_MS) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        if (alive.current && !Keyboard.isVisible()) finish();
      }, HIDE_SETTLE_MS);
    });

    return () => {
      alive.current = false;
      cancelAnimationFrame(raise);
      if (settle) clearTimeout(settle);
      onShow.remove();
      onHide.remove();
      // Unmounted without being finished — the screen went away mid-entry. What was typed is
      // still an entry. After `finish` this finds an empty buffer and does nothing.
      commit();
    };
  }, [commit, finish]);

  return (
    <View style={s.bar}>
      <Text style={s.title} numberOfLines={1}>
        {request.title}
      </Text>

      <View style={s.row}>
        <TextInput
          ref={input}
          autoFocus
          onChangeText={(next) => {
            text.current = next;
          }}
          onSubmitEditing={finish}
          // One layout for every number, weights and reps alike. Swapping the keyboard type on a
          // field that is already focused makes Android restart its input, and a restart is a
          // chance for the keys to blink shut between the weight and the reps. A point on the
          // keyboard while typing reps costs nothing: parseEntry drops the fraction.
          keyboardType="decimal-pad"
          returnKeyType="done"
          maxLength={entryMaxLength({ decimals })}
          // What is recorded now, shown until it is typed over. Stronger than a hint usually is,
          // because it is not a hint: it is the value, and leaving the field keeps it.
          placeholder={request.value === null ? '—' : entryText(request.value)}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          underlineColorAndroid="transparent"
          autoCorrect={false}
          contextMenuHidden
          accessibilityLabel={request.title}
          style={s.input}
        />
        {request.unit ? <Text style={s.unit}>{request.unit}</Text> : null}

        <Pressable
          onPress={() => {
            void hapticLight();
            finish();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          hitSlop={8}
          style={({ pressed }) => [s.done, pressed && s.pressed]}
        >
          <Text style={s.doneGlyph}>✓</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    bar: ViewStyle;
    title: TextStyle;
    row: ViewStyle;
    input: TextStyle;
    unit: TextStyle;
    done: ViewStyle;
    doneGlyph: TextStyle;
    pressed: ViewStyle;
  }>({
    // A card rising out of the keyboard rather than a strip of the page: it has to read as the
    // thing the keys are typing into.
    bar: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      borderTopStartRadius: radius.lg,
      borderTopEndRadius: radius.lg,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...shadow(colors.shadow).floating,
    },
    title: { color: colors.textMuted, fontSize: 13, textAlign: 'auto', marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // Large, because this is read from a bench with the phone at arm's length. Left to right
    // whatever the language: a number is written the same way in Hebrew.
    input: {
      flex: 1,
      minHeight: 52,
      paddingVertical: 4,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      color: colors.text,
      fontSize: 30,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
      writingDirection: 'ltr',
    },
    unit: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', minWidth: 28 },
    done: {
      width: 52,
      height: 52,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    doneGlyph: { color: colors.bg, fontSize: 22, fontWeight: '700' },
    pressed: { opacity: 0.7 },
  });
