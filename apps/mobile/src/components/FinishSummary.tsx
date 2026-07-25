/**
 * End-of-workout summary, shown when finishing.
 *
 * This replaces the live elapsed timer. A ticking clock during a workout adds pressure to
 * every set and encourages rushing rest periods — but the total duration is genuinely useful
 * once you are done, so it moves here rather than disappearing.
 *
 * The name field sits in this sheet because finishing is the moment the user actually knows
 * what the session was. Asking up front would mean naming something not yet done.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '../theme.js';
import { Banner, Button, MetricTile } from './ui.js';

export interface FinishSummaryProps {
  visible: boolean;
  durationMinutes: number;
  exerciseCount: number;
  setCount: number;
  volumeKg: number;
  initialName: string | null;
  /** Watch import is only offered when a native health provider is actually available. */
  watchAvailable?: boolean;
  onConfirm: (name: string | null) => void;
  onCancel: () => void;
  onImportFromWatch?: () => void;
}

function formatDuration(minutes: number, hoursLabel: string, minutesLabel: string): string {
  if (minutes < 60) return `${minutes} ${minutesLabel}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}${hoursLabel}` : `${h}${hoursLabel} ${m}${minutesLabel}`;
}

export function FinishSummary({
  visible,
  durationMinutes,
  exerciseCount,
  setCount,
  volumeKg,
  initialName,
  watchAvailable = false,
  onConfirm,
  onCancel,
  onImportFromWatch,
}: FinishSummaryProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName ?? '');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t('workout.summaryTitle')}</Text>

          <View style={styles.tiles}>
            <MetricTile
              value={formatDuration(durationMinutes, 'h', t('history.minutes'))}
              label={t('workout.summaryDuration')}
            />
            <MetricTile value={String(exerciseCount)} label={t('workout.summaryExercises')} />
            <MetricTile value={String(setCount)} label={t('workout.summarySets')} />
            <MetricTile
              value={volumeKg > 0 ? Math.round(volumeKg).toLocaleString() : '—'}
              label={`${t('workout.summaryVolume')} (${t('common.kg')})`}
            />
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('history.namePlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={styles.nameInput}
            returnKeyType="done"
          />
          <Text style={styles.namePrompt}>{t('workout.summaryNamePrompt')}</Text>

          {watchAvailable && onImportFromWatch ? (
            <View style={styles.watchBlock}>
              <Button
                label={t('workout.watchImport')}
                variant="secondary"
                onPress={onImportFromWatch}
              />
            </View>
          ) : (
            <Banner tone="info">{t('workout.watchExplain')}</Banner>
          )}

          <View style={styles.actions}>
            <Button
              label={t('workout.summarySave')}
              onPress={() => onConfirm(name.trim() === '' ? null : name.trim())}
            />
            <Button label={t('workout.summaryDiscard')} variant="ghost" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create<{
  backdrop: ViewStyle;
  sheet: ViewStyle;
  grabber: ViewStyle;
  title: TextStyle;
  tiles: ViewStyle;
  nameInput: TextStyle;
  namePrompt: TextStyle;
  watchBlock: ViewStyle;
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
    marginBottom: spacing.lg,
    textAlign: 'auto',
  },
  tiles: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  nameInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'auto',
  },
  namePrompt: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    textAlign: 'auto',
  },
  watchBlock: { marginTop: spacing.md },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
});
