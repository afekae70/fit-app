/**
 * The prescription editor for one exercise in a plan.
 *
 * Every field is optional and every field clears to null when emptied — a plan with "4 sets"
 * and nothing else is a legitimate plan, and forcing a rep range and an RPE onto it would just
 * mean the user types numbers they do not mean.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { PlanDayExerciseRow, PlanTargets } from '../db/plans.js';
import { useSettings } from '../settings.js';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme.js';
import { displayWeightToKg, kgToDisplay, weightUnitKey } from '../units.js';
import { Button, Hint, NumberField } from './ui.js';

export interface TargetEditorProps {
  /** The row being edited, or null when the sheet is closed. */
  exercise: PlanDayExerciseRow | null;
  /** Localised exercise name — the catalogue lookup belongs to the screen, not this sheet. */
  exerciseName: string;
  onSave: (targets: PlanTargets) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/** Empty means "no target", which is null in the database — not 0, which would mean zero sets. */
function parseOptional(raw: string): number | null {
  const normalised = raw.replace(',', '.').trim();
  if (normalised === '') return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const show = (value: number | null): string => (value === null ? '' : String(value));

export function TargetEditor({
  exercise,
  exerciseName,
  onSave,
  onRemove,
  onCancel,
}: TargetEditorProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const unitSystem = settings.unitSystem;

  const [sets, setSets] = useState('');
  const [repsMin, setRepsMin] = useState('');
  const [repsMax, setRepsMax] = useState('');
  const [rest, setRest] = useState('');
  const [load, setLoad] = useState('');
  const [rpe, setRpe] = useState('');

  // Reload from the row each time a different exercise opens the sheet — it stays mounted
  // between opens, so stale fields would otherwise carry across.
  useEffect(() => {
    if (!exercise) return;
    setSets(show(exercise.target_sets));
    setRepsMin(show(exercise.target_reps_min));
    setRepsMax(show(exercise.target_reps_max));
    // An exercise with no rest of its own shows the profile default, so the field states what
    // will actually happen rather than sitting empty next to a timer that is in fact running.
    setRest(show(exercise.rest_seconds ?? settings.defaultRestSeconds));
    setLoad(show(exercise.target_load_kg === null ? null : kgToDisplay(exercise.target_load_kg, unitSystem)));
    setRpe(show(exercise.target_rpe));
  }, [exercise, settings.defaultRestSeconds, unitSystem]);

  const save = () => {
    const min = parseOptional(repsMin);
    const max = parseOptional(repsMax);
    // A range entered backwards is shorthand, not an error worth a dialog — 12 down to 8 is
    // stored as 8–12 rather than rejected.
    const lo = min !== null && max !== null ? Math.min(min, max) : min;
    const hi = min !== null && max !== null ? Math.max(min, max) : max;

    onSave({
      targetSets: parseOptional(sets),
      targetRepsMin: lo,
      targetRepsMax: hi,
      restSeconds: parseOptional(rest),
      targetLoadKg: (() => {
        const typed = parseOptional(load);
        return typed === null ? null : displayWeightToKg(typed, unitSystem);
      })(),
      targetRpe: parseOptional(rpe),
    });
  };

  return (
    <Modal
      visible={exercise !== null}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{exerciseName}</Text>
          <Hint>{t('plan.prefillNote')}</Hint>

          <ScrollView keyboardShouldPersistTaps="handled">
            <NumberField label={t('plan.sets')} value={sets} onChangeText={setSets} />
            <NumberField label={t('plan.repsMin')} value={repsMin} onChangeText={setRepsMin} />
            <NumberField label={t('plan.repsMax')} value={repsMax} onChangeText={setRepsMax} />
            <NumberField
              label={t('plan.rest')}
              value={rest}
              suffix={t('plan.restSeconds')}
              onChangeText={setRest}
            />
            <NumberField
              label={t('plan.load')}
              value={load}
              suffix={t(`common.${weightUnitKey(unitSystem)}`)}
              onChangeText={setLoad}
            />
            <NumberField label={t('plan.rpe')} value={rpe} onChangeText={setRpe} />
          </ScrollView>

          <View style={styles.actions}>
            <Button label={t('common.save')} onPress={save} />
            <Button label={t('plan.removeExercise')} variant="danger" onPress={onRemove} />
            <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create<{
  backdrop: ViewStyle;
  sheet: ViewStyle;
  grabber: ViewStyle;
  title: TextStyle;
  actions: ViewStyle;
}>({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '85%',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'auto',
  },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
});
