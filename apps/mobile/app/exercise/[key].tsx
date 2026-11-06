/**
 * One exercise's record: what it has been doing, session by session.
 *
 * Mid-set the card shows a single line of what happened last time. This is the rest of it — the
 * shape of the lift over weeks, the best it has ever been, and every session it appeared in.
 * Reached by tapping its name, which is where someone already looks when they want to know
 * whether they are getting stronger at it.
 *
 * Everything here is read-only and derived. It is read the way a lifter reads it — the weight,
 * the reps and the number of sets — never by weight x reps added up: the chart is the heaviest
 * set of each session, and each session in the list shows its sets and how they stood, set by
 * set, against the session before (see `progress/setBySet.ts`).
 */

import { EXERCISE_BY_KEY, EQUIPMENT_SEED } from '@fit/shared/catalog';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { Pressable } from '../../src/components/Pressable.js';
import { Text } from '../../src/components/Text.js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../../src/auth/CurrentUserProvider.js';
import { ExerciseVisual } from '../../src/components/ExerciseVisual.js';
import { Card, EmptyState, Hint, ScreenHeader, SectionTitle, SkeletonScreen } from '../../src/components/ui.js';
import { getExecutor } from '../../src/db/provider.js';
import { listExerciseSessions, type ExerciseSession } from '../../src/db/progression.js';
import { TallyChip, useSetText } from '../../src/components/WorkoutProgressList.js';
import { pairSets, tallyOf, topSet, type WorkingSet } from '../../src/progress/setBySet.js';
import { useTheme } from '../../src/ThemeProvider.js';
import { useUnit } from '../../src/UnitsProvider.js';
import { kgToDisplay, weightUnitKey } from '../../src/units.js';
import { formatDuration } from '../../src/workout/cardioTimer.js';
import { radius, shadow, spacing, type ColorPalette } from '../../src/theme.js';
import { ChartBar } from '../../src/components/ChartBar.js';
import { ChartLineUp } from 'phosphor-react-native';

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

  const [sessions, setSessions] = useState<ExerciseSession[] | null>(null);
  const setText = useSetText();
  /** The session whose bar was touched, by position; null reads the latest. */
  const [chosen, setChosen] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!key) return;
      void (async () => {
        const db = await getExecutor();
        setSessions(await listExerciseSessions(db, userId, key));
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
  // The bar is the session's heaviest set; for an exercise done without weight, its most reps.
  const weighted = sessions.some((session) => topSet(session.sets) !== null);
  const barOf = (session: ExerciseSession) =>
    weighted
      ? (topSet(session.sets)?.weightKg ?? 0)
      : Math.max(0, ...session.sets.map((set) => set.reps ?? 0));
  const bestOf = (session: ExerciseSession): WorkingSet | null =>
    topSet(session.sets) ??
    session.sets.reduce<WorkingSet | null>(
      (best, set) => (best === null || (set.reps ?? 0) > (best.reps ?? 0) ? set : best),
      null,
    );
  const peak = Math.max(...sessions.map(barOf), 1);
  const picked = chosen !== null && chosen < sessions.length ? chosen : null;
  const shownSession = sessions[picked ?? sessions.length - 1];
  /** One session in a line: when, and the set the bar was drawn from. */
  const readout = (session: ExerciseSession) =>
    `${new Date(session.startedAt).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
    })} · ${setText(bestOf(session))}`;
  const heaviest = topSet(sessions.flatMap((session) => session.sets));
  const latest = sessions.at(-1);
  /** A session's sets in a line: "80×8 · 80×8 · 77.5×7 kg", the unit said once. */
  const setsLine = (sets: readonly WorkingSet[]) => {
    const parts = sets.map((set) => {
      if (set.weightKg !== null && set.weightKg > 0) {
        return `${kgToDisplay(set.weightKg, unit)}×${set.reps ?? 0}`;
      }
      if (set.reps !== null) return `×${set.reps}`;
      if (set.durationSeconds !== null) return formatDuration(set.durationSeconds);
      return '—';
    });
    const anyWeight = sets.some((set) => set.weightKg !== null && set.weightKg > 0);
    return `${parts.join(' · ')}${anyWeight ? ` ${unitLabel}` : ''}`;
  };

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
        <EmptyState icon={ChartLineUp} title={t('record.emptyTitle')} hint={t('record.emptyHint')} />
      ) : (
        <>
          <View style={s.tiles}>
            <Tile
              value={latest ? setText(bestOf(latest)) : '—'}
              label={t('record.workingWeight')}
              styles={s}
            />
            <Tile
              value={heaviest ? setText(heaviest) : '—'}
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
            {/* Touching a column reads that session out; untouched, the line is the latest. */}
            {shownSession ? (
              <Text style={[s.readout, picked !== null && s.readoutPicked]}>
                {readout(shownSession)}
              </Text>
            ) : null}
            <View style={[s.chart, { height: CHART_HEIGHT }]}>
              {sessions.map((session, index) => (
                <Pressable
                  key={session.sessionId}
                  onPress={() => setChosen(picked === index ? null : index)}
                  accessibilityRole="button"
                  accessibilityLabel={readout(session)}
                  accessibilityState={{ selected: picked === index }}
                  style={s.barSlot}
                >
                  <View style={s.barTrack} />
                  <ChartBar
                    index={index}
                    dimmed={picked !== null && picked !== index}
                    height={Math.max(6, (barOf(session) / peak) * CHART_HEIGHT)}
                  />
                </Pressable>
              ))}
            </View>
          </Card>

          <SectionTitle>{t('record.sessionList')}</SectionTitle>
          {newestFirst.map((session, index) => {
            // The one before it in time is the next one down the list.
            const before = newestFirst[index + 1];
            return (
            <Pressable
              key={session.sessionId}
              onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.sessionId } })}
              accessibilityRole="button"
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <View style={s.rowMain}>
                <Text style={s.rowDate}>
                  {new Date(session.startedAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>
                <Text style={s.rowMeta}>{setsLine(session.sets)}</Text>
              </View>
              <TallyChip tally={before ? tallyOf(pairSets(session.sets, before.sets)) : null} />
            </Pressable>
            );
          })}
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
    readout: TextStyle;
    readoutPicked: TextStyle;
    row: ViewStyle;
    rowMain: ViewStyle;
    rowDate: TextStyle;
    rowMeta: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: 20, gap: 14 },

    header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    visual: { width: 110 },
    headerText: { flex: 1, gap: 4 },
    name: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'auto' },
    subtitle: { color: colors.textMuted, fontSize: 14, textAlign: 'auto' },

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
      fontSize: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    tileUnit: { color: colors.textMuted, fontSize: 11 },
    tileLabel: { color: colors.textMuted, fontSize: 11, textAlign: 'auto' },

    chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 10 },
    // The full height of the chart, so the whole column answers to a finger.
    barSlot: { flex: 1, alignSelf: 'stretch', justifyContent: 'flex-end' },
    barTrack: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
    },
    readout: {
      color: colors.textSecondary,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
      marginTop: 10,
    },
    readoutPicked: { color: colors.accent, fontWeight: '700' },

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
    rowDate: { color: colors.text, fontSize: 16, fontWeight: '500', textAlign: 'auto' },
    rowMeta: { color: colors.textMuted, fontSize: 12, textAlign: 'auto' },
    pressed: { opacity: 0.7 },
  });
