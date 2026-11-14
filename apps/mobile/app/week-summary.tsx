/**
 * The week in full: the coach's review, the training, the records, where it moved, and food,
 * water and the scale.
 *
 * Asked for by the owner (2026-11-14) and built up over the day: workouts and where they moved,
 * then food, water, weight and personal records, then the AI coach's own review at the top — which
 * the coach writes by itself each Saturday at 19:00 (`CoachWeekNote`). Kept in full here: it was
 * the shared picture that was to be short, and that is `WeekShareCard`. Opened by the Saturday
 * reminder and from the top of the Progress tab; the reading is `db/weekSummary.ts`.
 *
 * Opens on the week under way and moves back through earlier weeks, never past this one.
 */

import { EXERCISE_BY_KEY } from '@fit/shared';
import { router, useFocusEffect } from 'expo-router';
import { CalendarCheck, CaretLeft, CaretRight, ShareNetwork, Trophy } from 'phosphor-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { parseReview } from '../src/coach/weeklyReview.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { CoachWeekNote } from '../src/components/CoachWeekNote.js';
import { IconText } from '../src/components/Glyph.js';
import { Pressable } from '../src/components/Pressable.js';
import { Text } from '../src/components/Text.js';
import { Card, EmptyState, ScreenHeader, SectionTitle } from '../src/components/ui.js';
import { ShareCardModal } from '../src/components/workout/ShareCardModal.js';
import { WeekShareCard } from '../src/components/workout/WeekShareCard.js';
import type { WeeklyReview } from '../src/db/coachBriefs.js';
import { getExecutor } from '../src/db/provider.js';
import { addDays, localDate, parseLocalDate } from '../src/db/schedule.js';
import { loadWeekSummary, type WeekSummary } from '../src/db/weekSummary.js';
import { hapticLight } from '../src/haptics.js';
import { isRtlLanguage, type Language } from '../src/i18n/index.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';
import { kgToDisplay, weightUnitKey } from '../src/units.js';
import { useUnit } from '../src/UnitsProvider.js';
import { weekShareModel } from '../src/workout/weekShareCard.js';

/** One number on the screen: what it is, and a line under it when there is something to add. */
interface Tile {
  key: string;
  value: string;
  label: string;
  sub?: string;
}

const ltr = (text: string) => `${String.fromCharCode(0x2066)}${text}${String.fromCharCode(0x2069)}`;

export default function WeekSummaryScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const unit = useUnit();
  const isHebrew = i18n.language === 'he';
  const rtl = isRtlLanguage(i18n.language as Language);

  /** Any day of the week shown; today until moved. */
  const [day, setDay] = useState(() => localDate(new Date()));
  const [week, setWeek] = useState<WeekSummary | null>(null);
  /** The coach's review of the week shown, for the tip on the shared picture. */
  const [coach, setCoach] = useState<WeeklyReview | null>(null);
  const [sharing, setSharing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const summary = await loadWeekSummary(await getExecutor(), userId, day, localDate(new Date()));
        if (live) setWeek(summary);
      })();
      return () => {
        live = false;
      };
    }, [userId, day]),
  );

  const onReview = useCallback((review: WeeklyReview | null) => setCoach(review), []);

  const move = (weeks: number) => {
    hapticLight();
    setCoach(null);
    setDay((current) => addDays(current, weeks * 7));
  };

  const name = (key: string) => {
    const seed = EXERCISE_BY_KEY.get(key);
    return seed ? (isHebrew ? seed.nameHe : seed.nameEn) : key;
  };
  const range = (start: string, end: string) => {
    const a = parseLocalDate(start);
    const b = parseLocalDate(end);
    const dayOf = (d: Date) => d.toLocaleDateString(i18n.language, { day: 'numeric' });
    return `${dayOf(a)}–${dayOf(b)} ${b.toLocaleDateString(i18n.language, { month: 'short' })}`;
  };
  const number = (n: number) => n.toLocaleString(i18n.language);
  const weightUnit = t(`common.${weightUnitKey(unit)}`);
  const weight = (kg: number) => `${kgToDisplay(kg, unit)}`;
  const weightChange = (kg: number) => `${kg > 0 ? '↑' : '↓'} ${weight(Math.abs(kg))}`;

  // The arrow back in time points the way the language reads backwards.
  const Back = rtl ? CaretRight : CaretLeft;
  const Forward = rtl ? CaretLeft : CaretRight;

  const workoutTiles: Tile[] = week
    ? [
        {
          key: 'workouts',
          value: String(week.workouts),
          label: t('weekSummary.workouts'),
          sub: t('weekSummary.lastWeek', { count: week.previousWorkouts }),
        },
        { key: 'sets', value: String(week.sets), label: t('weekSummary.sets') },
        ...(week.satisfaction !== null
          ? [{ key: 'satisfaction', value: `${week.satisfaction}/10`, label: t('weekSummary.satisfaction') }]
          : []),
        { key: 'records', value: String(week.records.length), label: t('weekSummary.recordsCount') },
      ]
    : [];

  // Food, water and the scale: each tile says only what was written down, and says so when
  // nothing was — a blank is not a zero.
  const bodyTiles: Tile[] = week
    ? [
        {
          key: 'calories',
          value: week.food.caloriesPerDay === null ? '—' : number(week.food.caloriesPerDay),
          label: t('weekSummary.caloriesPerDay'),
          sub:
            week.food.calorieTarget === null
              ? undefined
              : t('weekSummary.target', { value: number(week.food.calorieTarget) }),
        },
        {
          key: 'protein',
          value:
            week.food.proteinPerDay === null
              ? '—'
              : t('weekSummary.grams', { value: number(week.food.proteinPerDay) }),
          label: t('weekSummary.proteinPerDay'),
          sub:
            week.food.proteinTarget === null
              ? undefined
              : t('weekSummary.target', {
                  value: t('weekSummary.grams', { value: number(week.food.proteinTarget) }),
                }),
        },
        {
          key: 'water',
          value: ltr(`${week.water.reached}/${week.water.counted}`),
          label: t('weekSummary.waterDays'),
          sub:
            week.waterLitresPerDay === null
              ? undefined
              : t('weekSummary.litresPerDay', { value: week.waterLitresPerDay }),
        },
        {
          key: 'weight',
          value: week.weight.latestKg === null ? '—' : weight(week.weight.latestKg),
          label: t('weekSummary.weight', { unit: weightUnit }),
          sub:
            week.weight.changeKg === null
              ? week.weight.latestKg === null
                ? t('weekSummary.noWeighIn')
                : undefined
              : week.weight.changeKg === 0
                ? t('weekSummary.weightSame')
                : t('weekSummary.weightChange', { value: weightChange(week.weight.changeKg) }),
        },
      ]
    : [];
  const compared = week ? week.counts.up + week.counts.same + week.counts.down : 0;

  const renderTiles = (tiles: Tile[]) => (
    <View style={styles.tiles}>
      {tiles.map((tile) => (
        <View key={tile.key} style={styles.tile}>
          <Text style={styles.tileValue}>{tile.value}</Text>
          <Text style={styles.tileLabel}>{tile.label}</Text>
          {tile.sub ? <Text style={styles.tileSub}>{tile.sub}</Text> : null}
        </View>
      ))}
    </View>
  );

  // The shared picture is the short one (see workout/weekShareCard.ts): four numbers, the
  // counters and the coach's tip. Built only while it is up.
  const shareModel =
    week && sharing
      ? weekShareModel(week, {
          title: t('weekSummary.title'),
          range: range(week.start, week.end),
          tip: coach ? (parseReview(coach.text)?.tip ?? null) : null,
          tipTitle: t('weekSummary.part_tip'),
          workouts: t('weekSummary.workouts'),
          records: t('weekSummary.recordsCount'),
          waterDays: t('weekSummary.waterDays'),
          weight: t('weekSummary.weight', { unit: weightUnit }),
          lastWeek: (count) => t('weekSummary.lastWeek', { count }),
          recordSet: (record) => `${weight(record.weightKg)}×${record.reps}`,
          weightChange,
          weightValue: weight,
          litres: (value) => t('weekSummary.litresPerDay', { value }),
          exercise: name,
        })
      : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title={t('weekSummary.title')} />

      {week ? (
        <>
          <View style={styles.weekRow}>
            <Pressable
              onPress={() => move(-1)}
              accessibilityRole="button"
              accessibilityLabel={t('weekSummary.previousWeek')}
              hitSlop={8}
              style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
            >
              <Back size={20} color={colors.text} weight="bold" />
            </Pressable>
            <Text style={styles.weekName}>
              {week.isCurrent
                ? t('weekSummary.thisWeek', { range: range(week.start, week.end) })
                : range(week.start, week.end)}
            </Text>
            <Pressable
              onPress={() => move(1)}
              disabled={week.isCurrent}
              accessibilityRole="button"
              accessibilityLabel={t('weekSummary.nextWeek')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.arrow,
                week.isCurrent && styles.arrowOff,
                pressed && styles.pressed,
              ]}
            >
              <Forward size={20} color={colors.text} weight="bold" />
            </Pressable>
          </View>

          {/* Shared like a workout: the same window, a short card in the same language. */}
          <Pressable
            onPress={() => {
              hapticLight();
              setSharing(true);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
          >
            <IconText icon={ShareNetwork} style={styles.shareText}>
              {t('weekSummary.share')}
            </IconText>
          </Pressable>

          <CoachWeekNote
            key={week.start}
            start={week.start}
            end={week.end}
            isCurrent={week.isCurrent}
            onReview={onReview}
          />

          <Text style={styles.sectionHeading}>{t('weekSummary.trainingTitle')}</Text>
          {renderTiles(workoutTiles)}

          {/* Records first among the details: the best thing a week can say. */}
          {week.records.length > 0 ? (
            <Card index={0}>
              <SectionTitle>{t('weekSummary.records')}</SectionTitle>
              {week.records.map((record, index) => (
                <View key={record.exerciseKey} style={[styles.row, index > 0 && styles.rowDivided]}>
                  <Trophy size={18} color={colors.accent} weight="fill" />
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {name(record.exerciseKey)}
                    </Text>
                    <Text style={styles.rowSub}>
                      {record.previousKg === null
                        ? t('weekSummary.recordFirst')
                        : t('weekSummary.recordBefore', {
                            value: `${weight(record.previousKg)} ${weightUnit}`,
                          })}
                    </Text>
                  </View>
                  <Text style={[styles.recordSet, { color: colors.accent }]}>
                    {ltr(`${weight(record.weightKg)}×${record.reps}`)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}

          {week.workouts === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title={t(week.isCurrent ? 'weekSummary.emptyNow' : 'weekSummary.empty')}
            />
          ) : compared > 0 ? (
            <>
              {/* The whole week in three marks, then the two lists that say where to look. */}
              <View style={styles.counts}>
                <Text style={[styles.count, { color: colors.accent }]}>▲ {week.counts.up}</Text>
                <Text style={[styles.count, { color: colors.textMuted }]}>＝ {week.counts.same}</Text>
                <Text style={[styles.count, { color: colors.warning }]}>▼ {week.counts.down}</Text>
              </View>
              <Text style={styles.caption}>{t('weekSummary.comparedHint')}</Text>

              {week.progressed.length > 0 ? (
                <Card index={1}>
                  <SectionTitle>{t('weekSummary.progressed')}</SectionTitle>
                  {week.progressed.map((key, index) => (
                    <View key={key} style={[styles.row, index > 0 && styles.rowDivided]}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {name(key)}
                      </Text>
                      <Text style={[styles.mark, { color: colors.accent }]}>▲</Text>
                    </View>
                  ))}
                </Card>
              ) : null}

              {week.toPush.length > 0 ? (
                <Card index={2}>
                  <SectionTitle>{t('weekSummary.toPush')}</SectionTitle>
                  {week.toPush.map((key, index) => {
                    const down = index < week.counts.down;
                    return (
                      <View key={key} style={[styles.row, index > 0 && styles.rowDivided]}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {name(key)}
                        </Text>
                        <Text
                          style={[styles.mark, { color: down ? colors.warning : colors.textMuted }]}
                        >
                          {down ? '▼' : '＝'}
                        </Text>
                      </View>
                    );
                  })}
                </Card>
              ) : null}
            </>
          ) : (
            <Text style={styles.caption}>{t('weekSummary.nothingCompared')}</Text>
          )}

          <Text style={styles.sectionHeading}>{t('weekSummary.bodyTitle')}</Text>
          {renderTiles(bodyTiles)}
          <Text style={styles.caption}>
            {week.food.daysLogged === 0
              ? t('weekSummary.noFood')
              : t('weekSummary.foodDays', { count: week.food.daysLogged })}
          </Text>

          <BrandButton label={t('weekSummary.planNext')} onPress={() => router.push('/plan-week')} />
        </>
      ) : null}

      <ShareCardModal
        visible={shareModel !== null}
        renderCard={(ref) =>
          shareModel ? (
            <WeekShareCard ref={ref} model={shareModel} footer={t('history.shareFooter')} />
          ) : null
        }
        onClose={() => setSharing(false)}
      />
    </ScrollView>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    weekRow: ViewStyle;
    arrow: ViewStyle;
    arrowOff: ViewStyle;
    pressed: ViewStyle;
    weekName: TextStyle;
    shareButton: ViewStyle;
    shareText: TextStyle;
    sectionHeading: TextStyle;
    tiles: ViewStyle;
    tile: ViewStyle;
    tileValue: TextStyle;
    tileLabel: TextStyle;
    tileSub: TextStyle;
    counts: ViewStyle;
    count: TextStyle;
    caption: TextStyle;
    row: ViewStyle;
    rowDivided: ViewStyle;
    rowText: ViewStyle;
    rowName: TextStyle;
    rowSub: TextStyle;
    recordSet: TextStyle;
    mark: TextStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    weekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    arrow: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    arrowOff: { opacity: 0.3 },
    pressed: { opacity: 0.6 },
    weekName: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    shareButton: {
      alignItems: 'center',
      paddingVertical: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    shareText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700' },
    sectionHeading: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
      marginBottom: -spacing.sm,
    },
    // Two to a row: four numbers at a glance, not a column to scroll.
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: {
      flexGrow: 1,
      flexBasis: '45%',
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 2,
    },
    tileValue: {
      color: colors.text,
      fontSize: 28,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    tileLabel: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    tileSub: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    counts: { flexDirection: 'row', gap: spacing.sm },
    count: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      overflow: 'hidden',
      backgroundColor: colors.surfaceRaised,
    },
    caption: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      textAlign: 'center',
      marginTop: -spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: 40,
    },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowText: { flex: 1, gap: 1, paddingVertical: spacing.xs },
    rowName: { flex: 1, color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
    rowSub: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'auto' },
    recordSet: { fontSize: fontSize.md, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
    mark: { fontSize: fontSize.md, fontWeight: fontWeight.bold },
  });
