/**
 * One trainee's training plans, as their coach sees them.
 *
 * The same shape the trainee has on their own plan screen — groups, and workouts inside each —
 * read from the server every time this screen comes into view. Tapping a workout opens it for
 * editing; a group can be added, renamed or removed, and a workout added to any of them.
 *
 * Nothing here is saved on the coach's phone. These are somebody else's plans: they are read
 * when looked at, changed on the server, and reach the trainee's phone the next time it syncs.
 * If the trainee has ended the link since the list was opened, the next thing tried says so and
 * nothing is changed.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  CalendarBlank,
  ChartLineUp,
  ListChecks,
  PencilSimple,
  Plus,
  Trash,
  UserMinus,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CoachingError } from '../../src/coaching/api.js';
import type { CoachPlan } from '../../src/coaching/planDocument.js';
import { coachingErrorKey, useCoachingApi } from '../../src/coaching/useCoachingApi.js';
import { useActionSheet } from '../../src/components/ActionSheetProvider.js';
import { BrandButton } from '../../src/components/BrandButton.js';
import { Field } from '../../src/components/Field.js';
import { KeyboardSafe } from '../../src/components/KeyboardSafe.js';
import { LinkRow, RowDivider, SettingsSection } from '../../src/components/settings/kit.js';
import { Banner, ScreenHeader } from '../../src/components/ui.js';
import { newId } from '../../src/db/provider.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { fontSize, spacing, type ColorPalette } from '../../src/theme.js';

export default function TraineeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const api = useCoachingApi();
  const { confirm } = useActionSheet();

  const [plans, setPlans] = useState<CoachPlan[] | null>(null);
  const [error, setError] = useState<CoachingError | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the change in flight is the new group, so that only its own button shows it.
  const [adding, setAdding] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  // The group whose name is being edited, and what has been typed for it so far.
  const [renaming, setRenaming] = useState<{ planId: string; draft: string } | null>(null);

  const load = useCallback(async () => {
    if (!api || !id) return;
    const result = await api.plans(id);
    if (result.ok) {
      setPlans(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [api, id]);

  // On every return: coming back from a workout that was just saved should show it saved.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (change: () => Promise<{ ok: boolean; error?: CoachingError }>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await change();
    if (!result.ok && result.error) setError(result.error);
    await load();
    setBusy(false);
    return result.ok;
  };

  const addGroup = async () => {
    const groupName = newGroup.trim();
    if (!api || !id || groupName === '') return;
    setAdding(true);
    if (await run(() => api.savePlan(id, newId(), groupName))) setNewGroup('');
    setAdding(false);
  };

  const rename = async () => {
    if (!api || !id || !renaming) return;
    const groupName = renaming.draft.trim();
    if (groupName === '') {
      setRenaming(null);
      return;
    }
    await run(() => api.savePlan(id, renaming.planId, groupName));
    setRenaming(null);
  };

  const removeGroup = async (plan: CoachPlan) => {
    if (!api || !id) return;
    const sure = await confirm({
      title: t('coaching.deleteGroupTitle'),
      message: t('coaching.deleteGroupBody', { name: plan.name, count: plan.days.length }),
      confirmLabel: t('coaching.deleteGroup'),
    });
    if (sure) await run(() => api.deletePlan(id, plan.id));
  };

  const removeTrainee = async () => {
    if (!api || !id) return;
    const sure = await confirm({
      title: t('coaching.removeTraineeTitle'),
      message: t('coaching.removeTraineeBody', { name: name ?? '' }),
      confirmLabel: t('coaching.removeTrainee'),
    });
    if (!sure) return;
    const result = await api.removeTrainee(id);
    if (result.ok) router.back();
    else setError(result.error);
  };

  const openDay = (planId: string, dayId: string) =>
    router.push({
      pathname: '/trainee-day/[trainee]/[plan]/[day]',
      params: { trainee: id, plan: planId, day: dayId },
    });

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={name ?? t('coaching.trainee')} />
        <Text style={styles.lead}>{t('coaching.traineeLead')}</Text>

        {error ? <Banner tone="warning">{t(coachingErrorKey(error))}</Banner> : null}

        {plans === null && !error ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}

        {/* First, because it is what a coach comes back for week after week: the plans below
            are built once, the calendar is filled in every Saturday. */}
        {plans ? (
          <SettingsSection
            icon={CalendarBlank}
            title={t('coaching.calendar')}
            hint={t('coaching.calendarHint')}
            index={0}
          >
            <LinkRow
              label={t('coaching.open')}
              onPress={() =>
                router.push({
                  pathname: '/trainee-calendar/[id]',
                  params: { id, name: name ?? '' },
                })
              }
            />
          </SettingsSection>
        ) : null}

        {/* Second: what came of the plan. The calendar says what should happen, this says
            whether it did. */}
        {plans ? (
          <SettingsSection
            icon={ChartLineUp}
            title={t('coaching.history')}
            hint={t('coaching.historyHint')}
            index={1}
          >
            <LinkRow
              label={t('coaching.open')}
              onPress={() =>
                router.push({
                  pathname: '/trainee-history/[id]',
                  params: { id, name: name ?? '' },
                })
              }
            />
          </SettingsSection>
        ) : null}

        {plans?.length === 0 ? <Banner tone="info">{t('coaching.noGroups')}</Banner> : null}

        {plans?.map((plan, index) => (
          <SettingsSection
            key={plan.id}
            icon={ListChecks}
            title={plan.name || t('coaching.unnamedGroup')}
            hint={t('coaching.workoutCount', { count: plan.days.length })}
            index={index + 1}
          >
            {renaming?.planId === plan.id ? (
              <Field
                value={renaming.draft}
                onChangeText={(draft) => setRenaming({ planId: plan.id, draft })}
                placeholder={t('coaching.groupNamePlaceholder')}
                autoFocus
                onSubmitEditing={() => void rename()}
                onBlur={() => void rename()}
                returnKeyType="done"
              />
            ) : null}

            {plan.days.map((day, dayIndex) => (
              <View key={day.id} style={styles.rowBlock}>
                {dayIndex > 0 ? <RowDivider /> : null}
                <LinkRow
                  label={day.name ?? t('coaching.workoutNumber', { number: dayIndex + 1 })}
                  hint={t('coaching.exerciseCount', { count: day.exercises.length })}
                  onPress={() => openDay(plan.id, day.id)}
                />
              </View>
            ))}

            {plan.days.length > 0 ? <RowDivider /> : null}
            {/* A new workout is given its id here and opened empty; it reaches the server when
                it is first saved, so one opened and abandoned leaves nothing behind. */}
            <LinkRow
              icon={Plus}
              label={t('coaching.addWorkout')}
              onPress={() => openDay(plan.id, newId())}
              disabled={busy}
            />
            <RowDivider />
            <LinkRow
              icon={PencilSimple}
              label={t('coaching.renameGroup')}
              onPress={() => setRenaming({ planId: plan.id, draft: plan.name })}
              disabled={busy}
              chevron={false}
            />
            <LinkRow
              icon={Trash}
              tone="danger"
              label={t('coaching.deleteGroup')}
              onPress={() => void removeGroup(plan)}
              disabled={busy}
              chevron={false}
            />
          </SettingsSection>
        ))}

        {plans ? (
          <SettingsSection
            icon={Plus}
            title={t('coaching.newGroup')}
            hint={t('coaching.newGroupHint')}
            index={(plans.length || 0) + 1}
          >
            <Field
              value={newGroup}
              onChangeText={setNewGroup}
              placeholder={t('coaching.groupNamePlaceholder')}
              editable={!busy}
              onSubmitEditing={() => void addGroup()}
              returnKeyType="done"
            />
            <BrandButton
              label={t('coaching.addGroup')}
              onPress={() => void addGroup()}
              disabled={newGroup.trim() === '' || (busy && !adding)}
              busy={adding}
            />
          </SettingsSection>
        ) : null}

        {plans ? (
          <LinkRow
            icon={UserMinus}
            tone="danger"
            label={t('coaching.removeTrainee')}
            onPress={() => void removeTrainee()}
            disabled={busy}
            chevron={false}
          />
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    lead: TextStyle;
    loading: ViewStyle;
    rowBlock: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    lead: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    rowBlock: { gap: spacing.md },
  });
