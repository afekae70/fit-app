/**
 * One exercise's record: what it has been doing, session by session.
 *
 * Mid-set the card shows a single line of what happened last time. This is the rest of it — the
 * shape of the lift over weeks, the best it has ever been, and every session it appeared in.
 * Reached by tapping its name, which is where someone already looks when they want to know
 * whether they are getting stronger at it.
 *
 * Everything here is read-only and derived. The numbers come from `progression.ts`, which the
 * suggestion engine and the progress tab already read, so this page can never disagree with the
 * advice on the workout card.
 */

import { EXERCISE_BY_KEY, EQUIPMENT_SEED } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { ExerciseVisual } from '../../src/components/ExerciseVisual.js';
import { Card, EmptyState, Hint, ScreenHeader, SectionTitle, SkeletonScreen } from '../../src/components/ui.js';
import { getExecutor } from '../../src/db/provider.js';
import {
  getExerciseProgression,
  summariseExerciseProgress,
  type ExerciseProgressSummary,
  type ExerciseSessionBest,
} from '../../src/db/progression.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { useUnit } from '../../src/UnitsProvider.js';
import { formatVolume, kgToDisplay, weightUnitKey } from '../../src/units.js';
import { radius, shadow, spacing, type ColorPalette } from '../../src/theme.js';

const CHART_HEIGHT = 110;

export default function ExerciseRecordScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';
  const userId = useCurrentUserId();
  const unit = useUnit();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [sessions, setSessions] = useState<ExerciseSessionBest[] | null>(null);
  const [summary, setSummary] = useState<ExerciseProgressSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!key) return;
      void (async () => {
        const db = await getExecutor();
        setSessions(await getExerciseProgression(db, userId, key));
        setSummary(await summariseExerciseProgress(db, userId, key));
      })();
    }, [key, userId]),
  );

  const seed = key ? EXERCISE_BY_KEY.get(key) : undefined;
  const name = seed ? (isHebrew ? seed.nameHe : seed.nameEn) : (key ?? '');
  const equipment = seed ? EQUIPMENT_SEED.find((item) => item.slug === seed.equipmentSlug) : undefined;
  const subtitle = seed
    ? [equipment ? (isHebrew ? equipment.nameHe : equipment.nameEn) : null, t(`muscle.${seed.primaryMuscle}`)]
        .filter(Boolean)
        .join(' · ')
    : '';

  if (sessions === null) return <SkeletonScreen paddingTop={spacing.lg} />;

  const unitLabel = t(`common.${weightUnitKey(unit)}`);
  // Newest first for reading, oldest first for the chart — the two want opposite orders, and
  // the query is the one that knows which way it came.
  const newestFirst = [...sessions].reverse();
  const peak = Math.max(...sessions.map((session) => session.best_e1rm_kg), 1);
  const heaviest = sessions.reduce<ExerciseSessionBest | null>(
    (best, session) => (best === null || session.top_weight_kg > best.top_weight_kg ? session : best),
    null,
  );

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.content, { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }]}
    >
      <ScreenHeader title={name} />

      <Card>
        <View style={s.header}>
          {seed ? (
            <View style={s.visual}>
              <ExerciseVisual exercise={seed} height={84} />
            </View>
          ) : null}
          <View style={s.headerText}>
            <Text style={s.name}>{name}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState emoji="📈" title={t('record.emptyTitle')} hint={t('record.emptyHint')} />
      ) : (
        <>
          <View style={s.tiles}>
            <Tile
              value={summary?.bestE1rm ? String(kgToDisplay(summary.bestE1rm, unit)) : '—'}
              unit={unitLabel}
              label={t('record.best')}
              styles={s}
            />
            <Tile
              value={heaviest ? `${kgToDisplay(heaviest.top_weight_kg, unit)}×${heaviest.top_reps}` : '—'}
              label={t('record.heaviestSet')}
              styles={s}
            />
            <Tile value={String(sessions.length)} label={t('record.sessions')} styles={s} />
          </View>

          <Card>
            <SectionTitle>{t('record.trend')}</SectionTitle>
            <Hint>{t('record.trendHint')}</Hint>
            {/* One column per session, oldest at the start: the shape is the point, and the
                numbers themselves are in the list below. */}
            <View style={[s.chart, { height: CHART_HEIGHT }]}>
              {sessions.map((session) => (
                <View key={session.session_id} style={s.barSlot}>
                  <View style={s.barTrack} />
                  <View
                    style={[
                      s.bar,
                      { height: Math.max(6, (session.best_e1rm_kg / peak) * CHART_HEIGHT) },
                    ]}
                  />
                </View>
              ))}
            </View>
          </Card>

          <SectionTitle>{t('record.sessionList')}</SectionTitle>
          {newestFirst.map((session) => (
            <Pressable
              key={session.session_id}
              onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.session_id } })}
              accessibilityRole="button"
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <View style={s.rowMain}>
                <Text style={s.rowDate}>
                  {new Date(session.started_at).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>
                <Text style={s.rowMeta}>
                  {t('record.topSet')}: {kgToDisplay(session.top_weight_kg, unit)} {unitLabel} ×{' '}
                  {session.top_reps} · {session.working_sets} {t('history.sets')}
                </Text>
              </View>
              <Text style={s.rowVolume}>
                {formatVolume(session.total_volume_load, unit)} {unitLabel}
              </Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Tile({
  value,
  unit,
  label,
  styles: s,
}: {
  value: string;
  unit?: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={s.tile}>
      <View style={s.tileValueRow}>
        <Text style={s.tileValue}>{value}</Text>
        {unit ? <Text style={s.tileUnit}>{unit}</Text> : null}
      </View>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    header: ViewStyle;
    visual: ViewStyle;
    headerText: ViewStyle;
    name: TextStyle;
    subtitle: TextStyle;
    tiles: ViewStyle;
    tile: ViewStyle;
    tileValueRow: ViewStyle;
    tileValue: TextStyle;
    tileUnit: TextStyle;
    tileLabel: TextStyle;
    chart: ViewStyle;
    barSlot: ViewStyle;
    barTrack: ViewStyle;
    bar: ViewStyle;
    row: ViewStyle;
    rowMain: ViewStyle;
    rowDate: TextStyle;
    rowMeta: TextStyle;
    rowVolume: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: 20, gap: 14 },

    header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    visual: { width: 110 },
    headerText: { flex: 1, gap: 4 },
    name: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'auto' },
    subtitle: { color: colors.textMuted, fontSize: 13, textAlign: 'auto' },

    tiles: { flexDirection: 'row', gap: 10 },
    tile: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 16,
      paddingHorizontal: 12,
      gap: 4,
      ...shadow(colors.shadow).card,
    },
    tileValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
    tileValue: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    tileUnit: { color: colors.textFaint, fontSize: 11 },
    tileLabel: { color: colors.textFaint, fontSize: 11, textAlign: 'auto' },

    chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 10 },
    barSlot: { flex: 1, justifyContent: 'flex-end' },
    barTrack: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
    },
    bar: { borderRadius: radius.pill, backgroundColor: colors.accent },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 14,
      paddingHorizontal: 16,
      ...shadow(colors.shadow).card,
    },
    rowMain: { flex: 1, gap: 3 },
    rowDate: { color: colors.text, fontSize: 15, fontWeight: '500', textAlign: 'auto' },
    rowMeta: { color: colors.textMuted, fontSize: 12, textAlign: 'auto' },
    rowVolume: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
    pressed: { opacity: 0.7 },
  });
