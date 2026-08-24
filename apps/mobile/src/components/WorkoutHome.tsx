/**
 * The workouts tab when nothing is in progress: start fresh, repeat a saved template, or
 * browse history.
 *
 * Templates sit above history deliberately. Re-entering eight exercises and their weights is
 * the most tedious part of logging, and repeating last week's session removes it entirely —
 * so it gets the prominent position, not a menu somewhere.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { SessionSummaryRow } from '../db/workouts.js';
import { useTheme } from '../ThemeProvider.js';
import { useUnit } from '../UnitsProvider.js';
import { formatVolume, weightUnitKey } from '../units.js';
import { fontSize, radius, spacing, type ColorPalette } from '../theme.js';
import { EmptyState, ScreenHeader } from './ui.js';

export interface TemplateEntry {
  id: string;
  name: string;
  started_at: string;
  exercise_count: number;
}

export interface WorkoutHomeProps {
  templates: TemplateEntry[];
  history: SessionSummaryRow[];
  onStartEmpty: () => void;
  onUseTemplate: (sessionId: string) => void;
  onOpenSession: (sessionId: string) => void;
  contentPadding: { paddingTop: number; paddingBottom: number };
  refreshing: boolean;
  onRefresh: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function durationMinutes(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null;
  return Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000),
  );
}

export function WorkoutHome({
  templates,
  history,
  onStartEmpty,
  onUseTemplate,
  onOpenSession,
  contentPadding,
  refreshing,
  onRefresh,
}: WorkoutHomeProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unit = useUnit();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, contentPadding]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      <ScreenHeader title={t('tabs.workout')} back />

      <Pressable onPress={onStartEmpty} style={styles.primaryButton} accessibilityRole="button">
        <Text style={styles.primaryButtonText}>{t('workout.startButton')}</Text>
      </Pressable>

      {templates.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('history.templates')}</Text>
          <Text style={styles.sectionHint}>{t('history.templatesHint')}</Text>

          {templates.map((template) => (
            <Pressable
              key={template.id}
              onPress={() => onUseTemplate(template.id)}
              style={styles.templateRow}
              accessibilityRole="button"
            >
              <View style={styles.rowMain}>
                <Text style={styles.templateName}>{template.name}</Text>
                <Text style={styles.rowMeta}>
                  {template.exercise_count} {t('history.exercises')} ·{' '}
                  {formatDate(template.started_at)}
                </Text>
              </View>
              <Text style={styles.repeatIcon}>↻</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('history.title')}</Text>

        {history.length === 0 ? (
          <EmptyState emoji="🏋️" title={t('history.empty')} hint={t('history.emptyHint')} />
        ) : (
          history.map((session) => {
            const minutes = durationMinutes(session.started_at, session.ended_at);
            return (
              <Pressable
                key={session.id}
                onPress={() => onOpenSession(session.id)}
                style={styles.historyRow}
                accessibilityRole="button"
              >
                <View style={styles.rowMain}>
                  <Text style={styles.historyName}>
                    {session.name ?? t('history.unnamed')}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(session.started_at)}
                    {session.ended_at === null ? ` · ${t('history.inProgress')}` : ''}
                    {minutes !== null ? ` · ${minutes} ${t('history.minutes')}` : ''}
                  </Text>
                  <Text style={styles.rowStats}>
                    {session.exercise_count} {t('history.exercises')} · {session.set_count}{' '}
                    {t('history.sets')}
                    {session.volume_load > 0
                      ? ` · ${formatVolume(session.volume_load, unit)} ${t(`common.${weightUnitKey(unit)}`)}`
                      : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    primaryButton: ViewStyle;
    primaryButtonText: TextStyle;
    section: ViewStyle;
    sectionTitle: TextStyle;
    sectionHint: TextStyle;
    templateRow: ViewStyle;
    templateName: TextStyle;
    repeatIcon: TextStyle;
    historyRow: ViewStyle;
    historyName: TextStyle;
    rowMain: ViewStyle;
    rowMeta: TextStyle;
    rowStats: TextStyle;
  }>({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  primaryButton: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'auto',
  },
  sectionHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
    marginBottom: spacing.sm,
    textAlign: 'auto',
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  templateName: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700', textAlign: 'auto' },
  repeatIcon: { color: colors.accent, fontSize: fontSize.lg, marginStart: spacing.sm },
  historyRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  historyName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'auto' },
  rowMain: { flex: 1 },
  rowMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2, textAlign: 'auto' },
  rowStats: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4, textAlign: 'auto' },
});
