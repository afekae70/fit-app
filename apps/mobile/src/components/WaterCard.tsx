/**
 * Water for one day: how much against an aim, and two buttons to add to it.
 *
 * Deliberately the smallest thing that works. Drinking is logged many times a day, usually
 * with the other hand holding the glass, so adding is one tap on a large target — a glass or
 * a bottle — and there is no sheet, no number to type and nothing to confirm. The price of
 * one-tap adding is adding by mistake, so the last one can be taken back from the same card.
 *
 * A third button is for every other amount: it opens a field to type millilitres into, and
 * opens it on whatever was typed last time, so a bottle of one's own is typed once.
 *
 * It loads and saves for itself, given a day. The food screen shows it for whichever day is
 * open; the home screen shows it for today. Neither has to know what water is.
 *
 * The aim is 45 ml for each kilogram of body weight (`food/water.ts`), and the card says so,
 * so that the number can be checked against the rule it came from.
 */

import { useFocusEffect } from 'expo-router';
import { ArrowCounterClockwise, Drop, PencilSimple } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Easing, Keyboard, StyleSheet, View } from 'react-native';

import { useCurrentUserId } from '../auth/CurrentUserProvider.js';
import { getLatestWeight } from '../db/metrics.js';
import { getExecutor, newId } from '../db/provider.js';
import {
  addWater,
  getLastCustomWater,
  getWaterTotal,
  MAX_WATER_ML,
  undoLastWater,
} from '../db/water.js';
import { parseAmount } from '../food/foodMath.js';
import { litres, WATER_ML_PER_KG, waterGoalMl } from '../food/water.js';
import {
  buttonAmount,
  DEFAULT_WATER_BUTTONS,
  isDefault,
  MIN_BUTTON_ML,
  type WaterButtons,
} from '../food/waterButtons.js';
import { adoptLegacyWaterButtons } from '../food/waterButtonsStore.js';
import { getWaterButtons, setWaterButtons } from '../db/waterButtons.js';
import { onProfilePulled } from '../sync/profileEvents.js';
import { syncProfileNow } from '../sync/profileSyncRunner.js';
import { hapticLight, hapticSuccess } from '../haptics.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, shadow, spacing, type ColorPalette } from '../theme.js';
import { Field } from './Field.js';
import { useReduceMotion } from './motion.js';
import { ConfettiBurst } from './workout/ConfettiBurst.js';
import { Pressable } from './Pressable.js';
import { Text } from './Text.js';

export function WaterCard({ date }: { date: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const reduceMotion = useReduceMotion();

  const [total, setTotal] = useState(0);
  const [goal, setGoal] = useState(() => waterGoalMl(null));
  /** Counts the goals reached while the card is up; each one replays the burst. */
  const [burst, setBurst] = useState(0);
  // Whether the aim is this person's, or the stand-in used until they have weighed in.
  const [weighed, setWeighed] = useState(true);
  // Typing an amount of one's own: the text in the field, or null while the field is shut.
  const [typed, setTyped] = useState<string | null>(null);
  // The last amount typed, on any day, offered again when the field opens.
  const [lastOwn, setLastOwn] = useState<number | null>(null);
  // The two quick-add buttons, as this account set them (food/waterButtons.ts).
  const [buttons, setButtons] = useState<WaterButtons>(DEFAULT_WATER_BUTTONS);
  // Setting them: the two amounts as typed, or null while the editor is shut.
  const [editing, setEditing] = useState<[string, string] | null>(null);

  const load = useCallback(async () => {
    const db = await getExecutor();
    // From the profile, which syncs; the one older build kept them on the phone and is moved over.
    const mine =
      (await getWaterButtons(db, userId)) ??
      (await adoptLegacyWaterButtons(db, userId)) ??
      DEFAULT_WATER_BUTTONS;
    const [drunk, latest, own] = await Promise.all([
      getWaterTotal(db, userId, date),
      getLatestWeight(db, userId),
      // A press of either button is not "an amount of one's own", whatever the buttons are set to.
      getLastCustomWater(db, userId, mine),
    ]);
    setButtons(mine);
    setTotal(drunk);
    setLastOwn(own);
    setGoal(waterGoalMl(latest?.weight_kg ?? null));
    setWeighed(latest?.weight_kg != null);
  }, [userId, date]);

  // Buttons set on another phone of this account arrive through the profile sync, while the card
  // may already be showing.
  useEffect(() => onProfilePulled(() => void load()), [load]);

  // On every return to the screen, and whenever the day shown changes.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const share = Math.max(0, Math.min(1, total / goal));
  const reached = total >= goal;

  // The bar's width is a layout property, so it is JS-driven, and it is the only animated
  // value on its node — nothing native-driven shares it (see CLAUDE.md on mixing drivers).
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      fill.setValue(share);
      return;
    }
    Animated.timing(fill, {
      toValue: share,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [fill, share, reduceMotion]);

  const add = (ml: number) => {
    const before = total;
    // Shown at once: the tap should feel like it did something before the database answers.
    setTotal(before + ml);
    if (before < goal && before + ml >= goal) {
      // The glass that crosses the line is a small win, and is treated as one: the same burst
      // as a finished workout, smaller in its card, and said aloud for anyone not looking.
      hapticSuccess();
      setBurst((count) => count + 1);
      AccessibilityInfo.announceForAccessibility(t('water.reached'));
    } else hapticLight();
    void (async () => {
      const id = await addWater(await getExecutor(), userId, newId, { drunkOn: date, ml });
      // Whatever was shown, the database is what is true.
      if (!id) setTotal(before);
      else await load();
    })();
  };

  const ownAmount = typed === null ? null : parseAmount(typed, MAX_WATER_ML);

  const editedAmounts = editing ? editing.map(buttonAmount) : null;
  const editValid = editedAmounts !== null && editedAmounts.every((ml) => ml !== null);

  /** Open or shut the editor for the two buttons. Shuts the typed-amount field: one at a time. */
  const toggleEditing = () => {
    hapticLight();
    if (editing) {
      Keyboard.dismiss();
      setEditing(null);
      return;
    }
    setTyped(null);
    setEditing([String(buttons[0]), String(buttons[1])]);
  };

  const saveButtons = () => {
    if (!editValid || !editedAmounts) return;
    const next: WaterButtons = [editedAmounts[0]!, editedAmounts[1]!];
    Keyboard.dismiss();
    setButtons(next);
    setEditing(null);
    hapticSuccess();
    void (async () => {
      const db = await getExecutor();
      // Sent at once rather than at the next sync, so another phone of the same account has them
      // the next time it syncs.
      if (await setWaterButtons(db, userId, next)) void syncProfileNow(userId);
    })();
  };

  const toggleOwn = () => {
    hapticLight();
    setEditing(null);
    if (typed !== null) {
      Keyboard.dismiss();
      setTyped(null);
      return;
    }
    // Open on the amount typed last time, selected, so that the same bottle again is one tap
    // and a different one is typed straight over it.
    setTyped(lastOwn === null ? '' : String(lastOwn));
  };

  const addOwn = () => {
    if (ownAmount === null) return;
    Keyboard.dismiss();
    setTyped(null);
    add(ownAmount);
  };

  const undo = () => {
    hapticLight();
    void (async () => {
      await undoLastWater(await getExecutor(), userId, date);
      await load();
    })();
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Drop size={18} color={colors.info} weight="fill" />
          <Text style={styles.title}>{t('water.title')}</Text>
        </View>
        <View style={styles.headerActions}>
          {total > 0 ? (
            <Pressable
              onPress={undo}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('water.undo')}
              style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
            >
              <ArrowCounterClockwise size={16} color={colors.textMuted} weight="bold" />
            </Pressable>
          ) : null}
          <Pressable
            onPress={toggleEditing}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ expanded: editing !== null }}
            accessibilityLabel={t('water.editButtons')}
            style={({ pressed }) => [
              styles.undo,
              editing !== null && styles.undoOn,
              pressed && styles.pressed,
            ]}
          >
            <PencilSimple
              size={16}
              color={editing ? colors.info : colors.textMuted}
              weight="bold"
            />
          </Pressable>
        </View>
      </View>

      <Text
        style={styles.amount}
        accessibilityLabel={t('water.amountLabel', { drunk: litres(total), goal: litres(goal) })}
      >
        {litres(total)}
        <Text style={styles.amountOf}> / {litres(goal)}</Text>
        <Text style={styles.amountUnit}> {t('water.litres')}</Text>
      </Text>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            reached && styles.fillReached,
            { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
      <Text style={styles.note}>
        {reached
          ? t('water.reached')
          : weighed
            ? t('water.goalNote', { ml: WATER_ML_PER_KG })
            : t('water.goalNoteNoWeight')}
      </Text>

      <View style={styles.buttons}>
        {/* The amount itself on each, not "glass" and "bottle": once someone has set their own,
            the amount is the only name that is true. A long press opens the editor. */}
        {buttons.map((ml, index) => (
          <Pressable
            key={index}
            onPress={() => add(ml)}
            onLongPress={toggleEditing}
            accessibilityRole="button"
            accessibilityLabel={t('water.addAmountLabel', { ml })}
            accessibilityHint={t('water.editHint')}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>+ {ml}</Text>
            <Text style={styles.buttonMeta}>{t('water.ml')}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={toggleOwn}
          accessibilityRole="button"
          accessibilityState={{ expanded: typed !== null }}
          accessibilityLabel={t('water.otherLabel')}
          style={({ pressed }) => [
            styles.button,
            typed !== null && styles.buttonOn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonText}>+ {t('water.other')}</Text>
          <Text style={styles.buttonMeta}>{t('water.otherMeta')}</Text>
        </Pressable>
      </View>

      {/* Any amount at all, typed. Under the buttons, in the page itself and not in a dialog:
          on this build a field inside a Modal does not raise the keyboard (see
          NumberEntryBar). The screen keeps it above the keys — `useFieldAboveKeyboard`. */}
      {typed !== null ? (
        <View style={styles.own}>
          <View style={styles.ownField}>
            <Field
              value={typed}
              onChangeText={(value) => setTyped(value.replace(/[^0-9.,]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder={t('water.otherPlaceholder')}
              trailing={<Text style={styles.buttonMeta}>{t('water.ml')}</Text>}
              returnKeyType="done"
              onSubmitEditing={addOwn}
              selectTextOnFocus
              autoFocus
            />
          </View>
          <Pressable
            onPress={addOwn}
            disabled={ownAmount === null}
            accessibilityRole="button"
            accessibilityLabel={t('water.addOtherLabel')}
            style={({ pressed }) => [
              styles.ownAdd,
              ownAmount === null && styles.ownAddOff,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.ownAddText}>{t('water.addOther')}</Text>
          </Pressable>
        </View>
      ) : null}
      {/* Setting the two buttons. In the card, like the typed amount and for the same reason:
          a field in a Modal does not raise the keyboard on this build. */}
      {editing !== null ? (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>{t('water.buttonsTitle')}</Text>
          <View style={styles.own}>
            {editing.map((value, index) => (
              <View key={index} style={styles.ownField}>
                <Field
                  value={value}
                  onChangeText={(text) => {
                    const clean = text.replace(/[^0-9]/g, '').slice(0, 4);
                    setEditing((current) => {
                      if (!current) return current;
                      return index === 0 ? [clean, current[1]] : [current[0], clean];
                    });
                  }}
                  keyboardType="number-pad"
                  accessibilityLabel={
                    index === 0 ? t('water.firstButton') : t('water.secondButton')
                  }
                  trailing={<Text style={styles.buttonMeta}>{t('water.ml')}</Text>}
                  returnKeyType="done"
                  onSubmitEditing={saveButtons}
                  selectTextOnFocus
                  autoFocus={index === 0}
                />
              </View>
            ))}
          </View>
          <Text style={[styles.editorHint, !editValid && styles.editorHintBad]}>
            {t('water.buttonsHint', { min: MIN_BUTTON_ML, max: MAX_WATER_ML })}
          </Text>
          <View style={styles.own}>
            <Pressable
              onPress={saveButtons}
              disabled={!editValid}
              accessibilityRole="button"
              accessibilityLabel={t('water.saveButtons')}
              style={({ pressed }) => [
                styles.ownAdd,
                styles.editorSave,
                !editValid && styles.ownAddOff,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.ownAddText}>{t('water.saveButtons')}</Text>
            </Pressable>
            {!isDefault([Number(editing[0]), Number(editing[1])]) ? (
              <Pressable
                onPress={() =>
                  setEditing([String(DEFAULT_WATER_BUTTONS[0]), String(DEFAULT_WATER_BUTTONS[1])])
                }
                accessibilityRole="button"
                style={({ pressed }) => [styles.editorReset, pressed && styles.pressed]}
              >
                <Text style={styles.editorResetText}>
                  {t('water.resetButtons', {
                    first: DEFAULT_WATER_BUTTONS[0],
                    second: DEFAULT_WATER_BUTTONS[1],
                  })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {burst > 0 ? (
        <View pointerEvents="none" style={styles.burst}>
          <ConfettiBurst key={burst} />
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadow(colors.shadow).card,
    },
    // Over the whole card, so the burst starts from its middle and is drawn above the buttons.
    burst: { ...StyleSheet.absoluteFillObject },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    // The pencil while the editor is open: pressing it again shuts it.
    undoOn: { borderWidth: 1, borderColor: colors.info },
    editor: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceRaised,
    },
    editorTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    editorHint: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      lineHeight: 18,
      textAlign: 'auto',
    },
    editorHintBad: { color: colors.warning },
    editorSave: { flex: 1 },
    editorReset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
    editorResetText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
    undo: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    pressed: { opacity: 0.6 },

    amount: {
      color: colors.text,
      fontSize: fontSize.xxl,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    amountOf: { color: colors.textMuted, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
    amountUnit: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },

    track: {
      height: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.info },
    fillReached: { backgroundColor: colors.accent },
    note: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },

    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    button: {
      flex: 1,
      minHeight: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.infoSoft,
      paddingVertical: spacing.sm,
    },
    // Marks the third button while its field is open: pressing it again closes the field.
    buttonOn: { borderWidth: 1, borderColor: colors.info },
    buttonText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold },
    buttonMeta: { color: colors.textMuted, fontSize: fontSize.xs },

    own: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    ownField: { flex: 1 },
    ownAdd: {
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.info,
    },
    ownAddOff: { opacity: 0.4 },
    ownAddText: { color: colors.bg, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  });
