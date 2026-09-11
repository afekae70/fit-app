/**
 * A month at a glance, and a workout for any day of it.
 *
 * The week editor answers "what does the coming week look like"; this answers the same question
 * a month out, as an ordinary calendar grid. Both read and write the same `scheduled_days` rows,
 * so a day planned here shows in the week editor, drives the home card on the day, and outranks
 * the rotation exactly as a weekly decision does. There is one calendar, seen two ways.
 *
 * A workout type is a day of the active plan. Adding one here is `addPlanDay` with a name, which
 * means it is immediately a real workout everywhere else too — it can be filled with exercises on
 * the plan screen, started from the home card, and rotated. A separate list of "types" that were
 * not plan days would be a second vocabulary for the same thing, and the two would drift.
 *
 * Tapping a day opens the app's action sheet with every type, a rest day, and — only when the day
 * already has a decision — clearing it back to the rotation. Rest and undecided are different
 * facts and the grid keeps them visibly different: a rest day says so, an undecided day is blank.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import {
  Card,
  EmptyState,
  Hint,
  ScreenHeader,
  SectionTitle,
  SkeletonScreen,
} from '../src/components/ui.js';
import { addPlanDay, getActivePlan, listPlanDays } from '../src/db/plans.js';
import { getExecutor, newId } from '../src/db/provider.js';
import {
  addMonths,
  clearScheduledDay,
  getRange,
  localDate,
  monthGrid,
  monthKey,
  repeatWeekAcrossMonth,
  setScheduledDay,
  weekDates,
  weekStart,
} from '../src/db/schedule.js';
import { hapticLight } from '../src/haptics.js';
import { isRtlLanguage, type Language } from '../src/i18n/index.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../src/theme.js';

/**
 * The hues a workout type can wear, cycled in plan order.
 *
 * Palette tokens rather than hex values, so a type is repainted with the theme. `danger` is left
 * out on purpose: in this app red means "this deletes something", and a leg day coloured like a
 * delete button would be read as a warning.
 */
const HUES = ['accent', 'info', 'warning', 'protein', 'carbs', 'fat'] as const;

type Hue = (typeof HUES)[number];

interface WorkoutType {
  id: string;
  label: string;
  hue: Hue;
}

export default function PlanMonthScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useCurrentUserId();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { ask, notify } = useActionSheet();

  const today = localDate(new Date());
  const [month, setMonth] = useState(() => monthKey(today));
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Map<string, string | null>>(new Map());
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const grid = useMemo(() => monthGrid(month), [month]);
  const rtl = isRtlLanguage(i18n.language as Language);

  const load = useCallback(
    async (forMonth: string) => {
      const db = await getExecutor();
      const plan = await getActivePlan(db, userId);
      setPlanId(plan?.id ?? null);

      if (plan) {
        const days = await listPlanDays(db, plan.id);
        setTypes(
          days.map((day, index) => ({
            id: day.id,
            label: day.name?.trim() || `${t('plan.day')} ${day.day_index}`,
            hue: HUES[index % HUES.length] ?? 'accent',
          })),
        );
      } else {
        setTypes([]);
      }

      // The whole grid, borrowed days included, so a decision on the 31st of last month still
      // shows in the first row rather than as a blank that contradicts the week editor.
      const rows = monthGrid(forMonth);
      const lastRow = rows[rows.length - 1];
      const first = rows[0]?.[0]?.date ?? `${forMonth}-01`;
      const last = lastRow?.[lastRow.length - 1]?.date ?? `${forMonth}-28`;
      setDecisions(await getRange(db, userId, first, last));
      setLoading(false);
    },
    [userId, t],
  );

  // On focus, not only on mount: a type renamed or removed on the plan screen should not be
  // shown under its old name when the user comes back.
  useFocusEffect(
    useCallback(() => {
      void load(month);
    }, [load, month]),
  );

  const switchTo = (next: string) => {
    void hapticLight();
    setMonth(next);
    void load(next);
  };

  const longDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  const chooseFor = useCallback(
    (date: string) => {
      void (async () => {
        const decided = decisions.has(date);
        const choice = await ask({
          title: longDate(date),
          actions: [
            ...types.map((type) => ({ label: type.label })),
            { label: t('week.rest') },
            // Offered only when there is something to clear. On an undecided day it would be a
            // button that changes nothing, which reads as broken.
            ...(decided ? [{ label: t('week.clear') }] : []),
          ],
        });
        if (choice === null) return;

        const db = await getExecutor();
        const type = types[choice];
        if (type) await setScheduledDay(db, userId, newId, date, type.id);
        else if (choice === types.length) await setScheduledDay(db, userId, newId, date, null);
        else await clearScheduledDay(db, userId, date);

        void hapticLight();
        await load(month);
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- longDate only reads i18n.language
    [decisions, types, ask, t, i18n.language, userId, load, month],
  );

  const repeat = useCallback(() => {
    void hapticLight();
    void (async () => {
      const db = await getExecutor();
      const written = await repeatWeekAcrossMonth(db, userId, newId, month, localDate(new Date()));
      await load(month);
      // Always says what happened. A fill that found nothing to copy and stayed silent would be
      // indistinguishable from a button that does not work.
      await notify({
        message:
          written > 0 ? t('month.repeated', { count: written }) : t('month.nothingToRepeat'),
      });
    })();
  }, [userId, month, load, notify, t]);

  const addType = useCallback(() => {
    const name = draft.trim();
    if (name.length === 0 || !planId) return;
    void hapticLight();
    void (async () => {
      const db = await getExecutor();
      await addPlanDay(db, newId, planId, name);
      // Cleared only after the write, so a failed insert leaves the typing recoverable.
      setDraft('');
      await load(month);
    })();
  }, [draft, planId, load, month]);

  if (loading) return <SkeletonScreen paddingTop={insets.top + spacing.xxl} />;

  const monthTitle = new Date(`${month}-01T00:00:00`).toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  });
  const weekdayNames = weekDates(weekStart(today)).map((date) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'narrow' }),
  );
  const typeById = new Map(types.map((type) => [type.id, type]));

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={t('month.title')} back />

        {!planId ? (
          <EmptyState emoji="📅" title={t('week.noPlan')} hint={t('week.noPlanHint')} />
        ) : (
          <>
            <Card>
              {/* Previous first: in a right-to-left row it sits on the right, which is where the
                  past is when a Hebrew reader moves through months. The glyphs flip with it. */}
              <View style={styles.monthNav}>
                <Pressable
                  onPress={() => switchTo(addMonths(month, -1))}
                  accessibilityRole="button"
                  accessibilityLabel={t('month.prev')}
                  hitSlop={8}
                  style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
                >
                  <Text style={styles.navGlyph}>{rtl ? '›' : '‹'}</Text>
                </Pressable>

                <Pressable
                  onPress={() => switchTo(monthKey(today))}
                  disabled={month === monthKey(today)}
                  accessibilityRole="button"
                  style={styles.monthTitleWrap}
                >
                  <Text style={styles.monthTitle}>{monthTitle}</Text>
                  {month !== monthKey(today) ? (
                    <Text style={styles.backToToday}>{t('week.today')}</Text>
                  ) : null}
                </Pressable>

                <Pressable
                  onPress={() => switchTo(addMonths(month, 1))}
                  accessibilityRole="button"
                  accessibilityLabel={t('month.next')}
                  hitSlop={8}
                  style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
                >
                  <Text style={styles.navGlyph}>{rtl ? '‹' : '›'}</Text>
                </Pressable>
              </View>

              <View style={styles.row}>
                {weekdayNames.map((name, index) => (
                  <Text key={index} style={styles.weekday}>
                    {name}
                  </Text>
                ))}
              </View>

              <View style={styles.grid}>
                {grid.map((week) => (
                  <View key={week[0]?.date} style={styles.row}>
                    {week.map((cell) => {
                      const decided = decisions.has(cell.date);
                      const planDayId = decisions.get(cell.date) ?? null;
                      const type = planDayId ? typeById.get(planDayId) : undefined;
                      const isToday = cell.date === today;

                      return (
                        <Pressable
                          key={cell.date}
                          onPress={() => chooseFor(cell.date)}
                          // Borrowed days belong to the neighbouring months and are edited there;
                          // tapping one here would change a month the user is not looking at.
                          disabled={!cell.inMonth}
                          accessibilityRole="button"
                          accessibilityLabel={`${longDate(cell.date)}: ${
                            type?.label ?? (decided ? t('week.rest') : t('week.undecided'))
                          }`}
                          style={({ pressed }) => [
                            styles.cell,
                            !cell.inMonth && styles.cellOutside,
                            cell.inMonth && cell.date < today && styles.cellPast,
                            isToday && styles.cellToday,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={[styles.cellNumber, isToday && styles.cellNumberToday]}>
                            {Number(cell.date.slice(8))}
                          </Text>

                          {cell.inMonth && type ? (
                            <View style={[styles.tag, { backgroundColor: colors[type.hue] }]}>
                              <Text style={styles.tagText} numberOfLines={1}>
                                {type.label}
                              </Text>
                            </View>
                          ) : cell.inMonth && decided && planDayId === null ? (
                            <Text style={styles.rest} numberOfLines={1}>
                              {t('week.rest')}
                            </Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>

              <Hint>{t('month.hint')}</Hint>
            </Card>

            <Card>
              <SectionTitle>{t('month.repeat')}</SectionTitle>
              <Hint>{t('month.repeatHint')}</Hint>
              <Pressable
                onPress={repeat}
                disabled={types.length === 0}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  types.length === 0 && styles.buttonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonText}>{t('month.repeat')}</Text>
              </Pressable>
            </Card>

            {/* Doubles as the legend: the colour beside each name is the colour it wears in the
                grid, so the calendar never needs a second key to be read. */}
            <Card>
              <SectionTitle>{t('month.types')}</SectionTitle>
              <Hint>{t('month.typesHint')}</Hint>

              {types.map((type) => (
                <View key={type.id} style={styles.typeRow}>
                  <View style={[styles.typeDot, { backgroundColor: colors[type.hue] }]} />
                  <Text style={styles.typeLabel} numberOfLines={1}>
                    {type.label}
                  </Text>
                </View>
              ))}

              <View style={styles.addRow}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={addType}
                  placeholder={t('month.typePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  returnKeyType="done"
                />
                <Pressable
                  onPress={addType}
                  disabled={draft.trim().length === 0}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.addButton,
                    draft.trim().length === 0 && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.buttonText}>{t('month.addType')}</Text>
                </Pressable>
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },

    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    navButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navGlyph: { color: colors.text, fontSize: 24, lineHeight: 26 },
    monthTitleWrap: { alignItems: 'center', flex: 1 },
    monthTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
    backToToday: { color: colors.accent, fontSize: fontSize.xs, marginTop: 2 },

    grid: { gap: 4, marginTop: 4 },
    row: { flexDirection: 'row', gap: 4 },
    weekday: {
      flex: 1,
      textAlign: 'center',
      color: colors.textFaint,
      fontSize: fontSize.xs,
      fontWeight: '600',
    },

    cell: {
      flex: 1,
      minHeight: 58,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
      paddingVertical: 4,
      paddingHorizontal: 2,
      alignItems: 'center',
      gap: 3,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    // Borrowed days stay visible so the grid reads as whole weeks, but faint and inert.
    cellOutside: { backgroundColor: 'transparent', opacity: 0.35 },
    // The past is still editable — correcting a plan is allowed — but it should not compete
    // with the days still ahead for attention.
    cellPast: { opacity: 0.6 },
    cellToday: { borderColor: colors.accent },
    cellNumber: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
    },
    cellNumberToday: { color: colors.accent, fontWeight: '700' },

    tag: {
      alignSelf: 'stretch',
      borderRadius: 4,
      paddingHorizontal: 2,
      paddingVertical: 1,
    },
    // The background's text colour on a hue: dark on the light hues of the dark theme, light on
    // the deeper hues of the light theme, which is readable both ways without a per-hue table.
    tagText: { color: colors.bg, fontSize: 9, fontWeight: '700', textAlign: 'center' },
    rest: { color: colors.textFaint, fontSize: 9, textAlign: 'center' },

    button: {
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },

    typeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    typeDot: { width: 12, height: 12, borderRadius: radius.pill },
    typeLabel: { color: colors.text, fontSize: fontSize.sm, flex: 1, textAlign: 'auto' },

    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    input: {
      flex: 1,
      height: 44,
      backgroundColor: colors.bg,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.sm,
      paddingHorizontal: spacing.md,
      textAlign: 'auto',
    },
    addButton: {
      height: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },

    pressed: { opacity: 0.7 },
  });
