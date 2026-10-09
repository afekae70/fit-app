/**
 * Settings for the workout-day reminder: whether it is on, and when it fires.
 *
 * One time for every day, or a time of each weekday's own — morning training on some days and
 * evening on others is common, and a single hour would be wrong for half the week. The per-day
 * rows start from the shared time, so turning them on changes nothing until a row is moved.
 *
 * Times move in quarter hours with − and +. A native time picker is another native module, and
 * quarter-hour steps cover every time anyone sets a training reminder for.
 *
 * Every change is saved and the reminders re-laid at once, so what the card shows is what is
 * scheduled — there is no Save button to forget.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { CalendarCheck } from 'phosphor-react-native';

import { getExecutor } from '../db/provider.js';
import { hapticLight } from '../haptics.js';
import { loadReminderSettings, saveReminderSettings, syncWorkoutReminders } from '../reminders/sync.js';
import {
  formatTime,
  shiftTime,
  type ReminderTime,
  type WorkoutReminderSettings,
} from '../reminders/workoutDays.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../theme.js';
import { Choice, RowDivider, SettingRow, SettingsSection, ToggleRow } from './settings/kit.js';
import { Banner } from './ui.js';

const STEP_MINUTES = 15;
/** September 20th 2026 is a Sunday; the week from it gives weekday names in the app's language. */
const A_SUNDAY = new Date(2026, 8, 20);

export function WorkoutReminderCard({ userId, index }: { userId: string; index?: number }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [settings, setSettings] = useState<WorkoutReminderSettings | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void loadReminderSettings().then(setSettings);
  }, []);

  const apply = (next: WorkoutReminderSettings) => {
    setSettings(next);
    void (async () => {
      await saveReminderSettings(next);
      const db = await getExecutor();
      const ok = await syncWorkoutReminders(db, userId, {
        title: t('settings.workoutReminderNotification'),
        channel: t('settings.workoutReminderTitle'),
      });
      setDenied(next.enabled && !ok);
    })();
  };

  if (!settings) return null;

  const perDay = settings.perWeekday.some((time) => time !== null);
  const weekdays = Array.from({ length: 7 }, (_, weekday) =>
    new Date(A_SUNDAY.getFullYear(), A_SUNDAY.getMonth(), A_SUNDAY.getDate() + weekday).toLocaleDateString(
      i18n.language,
      { weekday: 'long' },
    ),
  );

  const stepper = (time: ReminderTime, onChange: (next: ReminderTime) => void, label: string) => (
    <View style={s.stepper}>
      <Pressable
        onPress={() => {
          void hapticLight();
          onChange(shiftTime(time, -STEP_MINUTES));
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${t('settings.earlier')}`}
        hitSlop={6}
        style={({ pressed }) => [s.stepButton, pressed && s.pressed]}
      >
        <Text style={s.stepGlyph}>−</Text>
      </Pressable>
      <Text style={s.time}>{formatTime(time)}</Text>
      <Pressable
        onPress={() => {
          void hapticLight();
          onChange(shiftTime(time, STEP_MINUTES));
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${t('settings.later')}`}
        hitSlop={6}
        style={({ pressed }) => [s.stepButton, pressed && s.pressed]}
      >
        <Text style={s.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <SettingsSection
      icon={CalendarCheck}
      title={t('settings.workoutReminderTitle')}
      hint={t('settings.workoutReminderHint')}
      index={index}
    >
      <ToggleRow
        label={settings.enabled ? t('settings.reminderOn') : t('settings.reminderOff')}
        value={settings.enabled}
        onChange={(enabled) => apply({ ...settings, enabled })}
      />

      {settings.enabled ? (
        <View style={s.body}>
          <RowDivider />
          {!perDay ? (
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('settings.workoutReminderTime')}</Text>
              {stepper(settings.time, (time) => apply({ ...settings, time }), t('settings.workoutReminderTime'))}
            </View>
          ) : (
            weekdays.map((name, weekday) => (
              <View key={name} style={s.row}>
                <Text style={s.rowLabel}>{name}</Text>
                {stepper(
                  settings.perWeekday[weekday] ?? settings.time,
                  (time) => {
                    const perWeekday = [...settings.perWeekday];
                    perWeekday[weekday] = time;
                    apply({ ...settings, perWeekday });
                  },
                  name,
                )}
              </View>
            ))
          )}

          <SettingRow label={t('settings.workoutReminderPerDay')} stacked>
            <Choice<'same' | 'each'>
              selected={perDay ? 'each' : 'same'}
              onSelect={(next) =>
                apply({
                  ...settings,
                  // Every weekday starts from the shared time, so switching changes nothing until
                  // a row is moved; switching back drops the per-day times entirely.
                  perWeekday:
                    next === 'each'
                      ? settings.perWeekday.map((time) => time ?? settings.time)
                      : [null, null, null, null, null, null, null],
                })
              }
              options={[
                { value: 'same', label: t('settings.workoutReminderSame') },
                { value: 'each', label: t('settings.workoutReminderEach') },
              ]}
            />
          </SettingRow>
        </View>
      ) : null}

      {denied ? <Banner tone="warning">{t('settings.reminderDenied')}</Banner> : null}
    </SettingsSection>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    body: ViewStyle;
    row: ViewStyle;
    rowLabel: TextStyle;
    stepper: ViewStyle;
    stepButton: ViewStyle;
    stepGlyph: TextStyle;
    time: TextStyle;
    pressed: ViewStyle;
  }>({
    body: { gap: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLabel: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepButton: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepGlyph: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    // Always left to right: a time is read "07:30" in Hebrew too, and a mirrored row would turn it
    // around.
    time: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      minWidth: 64,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
      writingDirection: 'ltr',
    },
    pressed: { opacity: 0.7 },
  });
