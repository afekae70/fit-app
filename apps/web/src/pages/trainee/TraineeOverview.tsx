/**
 * A trainee's period at a glance: the numbers, then the charts that explain them.
 *
 * One filter, the period, above everything, and everything below it follows it — the tiles, the
 * charts, the records and the table agree because they are cut from the same slice. Each tile
 * that can be compared with the period before it is, so "14 workouts" arrives with whether that
 * is more or fewer than last time.
 */

import {
  Barbell,
  CalendarCheck,
  Clock,
  Fire,
  Gauge,
  Lightning,
  Medal,
  TrendDown,
} from '@phosphor-icons/react';
import type { CoachCalendar, CoachPlan, CoachSession } from '@fit/shared/coaching';
import { dayOutcome, sessionsByDay } from '@fit/shared/coaching';
import { useMemo, useState } from 'react';

import {
  addDays,
  daysBetween,
  parseDay,
  RANGE_WEEKS,
  rangeStart,
  weeksBetween,
  type RangeKey,
} from '../../analytics/dates.js';
import {
  changePercent,
  exerciseName,
  exerciseSummaries,
  liftSeries,
  recordsSince,
} from '../../analytics/lifts.js';
import {
  adherenceOver,
  adherenceRate,
  muscleSetsPerWeek,
  periodTotals,
  sessionsWithin,
  weeklyBuckets,
  weekStreak,
} from '../../analytics/training.js';
import { useCoach } from '../../coachContext.js';
import {
  ActivityGrid,
  BarChart,
  ChartFrame,
  HorizontalBars,
  LineChart,
  type DayCell,
  type LineSeries,
} from '../../components/charts.js';
import { Card, Segmented, StatTile } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import { MUSCLE_NAMES } from '../../i18n/muscles.js';
import {
  formatDayShort,
  formatKg,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  formatVolume,
  relativeDay,
} from '../../lib/format.js';

const RANGES: { value: RangeKey; label: string }[] = (['4w', '12w', '26w', '52w'] as const).map(
  (value) => ({ value, label: he.range[value] }),
);

/** The order lines are coloured in, and never cycled: three at most. */
const SERIES_COLOURS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

/** How far back workouts were loaded, in weeks — see TraineePage. */
const LOADED_WEEKS = 78;

export function TraineeOverview({
  sessions,
  calendar,
  plans,
}: {
  sessions: readonly CoachSession[];
  calendar: CoachCalendar;
  plans: readonly CoachPlan[];
}) {
  const { today } = useCoach();
  const [range, setRange] = useState<RangeKey>('12w');
  const [picked, setPicked] = useState<string[] | null>(null);

  const weeks = RANGE_WEEKS[range];
  const from = rangeStart(range, today);
  const inRange = useMemo(() => sessionsWithin(sessions, from, today), [sessions, from, today]);

  // The period before, of the same length — only when all of it was loaded.
  const previous = useMemo(() => {
    if (weeks * 2 > LOADED_WEEKS) return null;
    const previousFrom = addDays(from, -7 * weeks);
    return periodTotals(sessionsWithin(sessions, previousFrom, addDays(from, -1)));
  }, [sessions, from, weeks]);

  const totals = useMemo(() => periodTotals(inRange), [inRange]);
  const counts = useMemo(
    () => adherenceOver(sessions, calendar, from, addDays(today, -1), today),
    [sessions, calendar, from, today],
  );
  const records = useMemo(() => recordsSince(sessions, from), [sessions, from]);
  const streak = useMemo(() => weekStreak(sessions, today), [sessions, today]);
  const summaries = useMemo(() => exerciseSummaries(inRange), [inRange]);
  const weekStarts = useMemo(() => weeksBetween(from, today), [from, today]);
  const buckets = useMemo(() => weeklyBuckets(inRange, weekStarts), [inRange, weekStarts]);
  const muscles = useMemo(() => muscleSetsPerWeek(inRange, weeks), [inRange, weeks]);

  const withStrength = summaries.filter((summary) => summary.bestE1rm !== null);
  const chosen = (picked ?? withStrength.slice(0, 3).map((summary) => summary.exerciseKey)).filter(
    (key) => withStrength.some((summary) => summary.exerciseKey === key),
  );
  const lines: LineSeries[] = chosen.map((key, index) => ({
    key,
    label: exerciseName(key),
    colour: SERIES_COLOURS[index] ?? 'var(--series-1)',
    points: liftSeries(inRange, key).map((point) => ({
      t: new Date(point.startedAt).getTime(),
      value: point.e1rm,
      day: point.date,
      detail: `${formatKg(point.weightKg)}×${point.reps}`,
    })),
  }));

  const toggle = (key: string) => {
    const current = chosen;
    if (current.includes(key)) setPicked(current.filter((k) => k !== key));
    else if (current.length < 3) setPicked([...current, key]);
  };

  const volume = formatVolume(totals.volumeKg);
  const delta = (now: number, before: number | undefined) => {
    if (before === undefined || before === 0) return null;
    const change = Math.round(((now - before) / before) * 100);
    return {
      text: `${formatSignedPercent(change)} ${he.stats.previous}`,
      direction: change > 0 ? ('up' as const) : change < 0 ? ('down' as const) : ('flat' as const),
    };
  };

  return (
    <>
      <div className="page-head">
        <Segmented
          value={range}
          options={RANGES}
          onChange={setRange}
          label={he.trainee.tabOverview}
        />
      </div>

      <div className="grid grid-stats">
        <StatTile
          icon={Barbell}
          label={he.stats.workouts}
          value={formatNumber(totals.workouts)}
          delta={delta(totals.workouts, previous?.workouts)}
        />
        <StatTile
          icon={Lightning}
          label={he.stats.perWeek}
          value={formatKg(totals.workouts / weeks)}
          hint={fill(he.stats.trainingDays, { n: formatNumber(totals.trainingDays) })}
        />
        <StatTile
          icon={Gauge}
          label={he.stats.volume}
          value={volume.value}
          unit={volume.unit}
          hint={he.stats.volumeHint}
          delta={delta(totals.volumeKg, previous?.volumeKg)}
        />
        <StatTile
          icon={CalendarCheck}
          label={he.stats.adherence}
          value={
            adherenceRate(counts) === null
              ? he.stats.adherenceNone
              : formatPercent(adherenceRate(counts))
          }
          hint={`${counts.done}/${counts.done + counts.missed}`}
        />
        <StatTile
          icon={Clock}
          label={he.stats.minutes}
          value={totals.averageMinutes === null ? '—' : formatNumber(totals.averageMinutes)}
          unit={totals.averageMinutes === null ? undefined : he.stats.min}
        />
        <StatTile
          icon={Fire}
          label={he.stats.streak}
          value={formatNumber(streak)}
          hint={he.stats.streakHint}
        />
        <StatTile icon={Medal} label={he.stats.records} value={formatNumber(records.length)} />
        <StatTile
          icon={Gauge}
          label={he.stats.rpe}
          value={totals.averageRpe === null ? '—' : formatKg(totals.averageRpe)}
          unit={totals.averageRpe === null ? undefined : '/10'}
        />
      </div>

      <div className="grid grid-2">
        <Card title={he.charts.weeklyVolume} sub={he.charts.weeklyVolumeSub}>
          <ChartFrame
            chart={
              <BarChart
                valueLabel={he.stats.volume}
                format={(value) => {
                  const v = formatVolume(value);
                  return `${v.value} ${v.unit}`;
                }}
                bars={buckets.map((bucket) => ({
                  key: bucket.weekStart,
                  axisLabel: formatDayShort(bucket.weekStart),
                  value: bucket.volumeKg,
                  title: fill(he.charts.week, { date: formatDayShort(bucket.weekStart) }),
                }))}
              />
            }
            table={
              <WeekTable
                rows={buckets.map((bucket) => [
                  formatDayShort(bucket.weekStart),
                  `${formatNumber(bucket.volumeKg)} ${he.stats.kg}`,
                ])}
                header={he.stats.volume}
              />
            }
          />
        </Card>
        <Card title={he.charts.weeklyWorkouts}>
          <ChartFrame
            chart={
              <BarChart
                valueLabel={he.stats.workouts}
                whole
                format={(value) => formatNumber(value)}
                bars={buckets.map((bucket) => ({
                  key: bucket.weekStart,
                  axisLabel: formatDayShort(bucket.weekStart),
                  value: bucket.workouts,
                  title: fill(he.charts.week, { date: formatDayShort(bucket.weekStart) }),
                }))}
              />
            }
            table={
              <WeekTable
                rows={buckets.map((bucket) => [
                  formatDayShort(bucket.weekStart),
                  formatNumber(bucket.workouts),
                ])}
                header={he.stats.workouts}
              />
            }
          />
        </Card>
      </div>

      <Card title={he.charts.strength} sub={he.charts.strengthSub}>
        {withStrength.length === 0 ? (
          <p className="muted">{he.charts.strengthEmpty}</p>
        ) : (
          <>
            <div className="chips" role="group" aria-label={he.charts.strengthPick}>
              {withStrength.slice(0, 12).map((summary) => {
                const index = chosen.indexOf(summary.exerciseKey);
                return (
                  <button
                    key={summary.exerciseKey}
                    type="button"
                    className="chip"
                    aria-pressed={index >= 0}
                    disabled={index < 0 && chosen.length >= 3}
                    onClick={() => toggle(summary.exerciseKey)}
                  >
                    {index >= 0 ? (
                      <span className="swatch" style={{ background: SERIES_COLOURS[index] }} />
                    ) : null}
                    {exerciseName(summary.exerciseKey)}
                  </button>
                );
              })}
            </div>
            <ChartFrame
              chart={
                <LineChart
                  series={lines}
                  from={parseDay(from).getTime()}
                  to={parseDay(today).getTime() + 86_400_000}
                  format={(value) => `${formatKg(value)} ${he.stats.kg}`}
                />
              }
              table={
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{he.exercises.colExercise}</th>
                        <th>{he.overview.colLast}</th>
                        <th className="num">{he.charts.e1rm}</th>
                        <th className="num">{he.stats.kg}×</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.flatMap((line) =>
                        line.points.map((point) => (
                          <tr key={`${line.key}-${point.t}`}>
                            <td>{line.label}</td>
                            <td>{formatDayShort(point.day)}</td>
                            <td className="num">{formatKg(point.value)}</td>
                            <td className="num" dir="ltr">
                              {point.detail}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              }
            />
          </>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title={he.charts.activity} sub={he.charts.activitySub}>
          <ActivityGrid weeks={activityWeeks(sessions, calendar, plans, from, today)} />
        </Card>
        <Card title={he.charts.muscles} sub={he.charts.musclesSub}>
          {muscles.length === 0 ? (
            <p className="muted">{he.charts.musclesEmpty}</p>
          ) : (
            <HorizontalBars
              format={(value) => formatKg(value)}
              rows={muscles.slice(0, 12).map((muscle) => ({
                key: muscle.muscle,
                label: MUSCLE_NAMES[muscle.muscle] ?? muscle.muscle,
                value: muscle.total,
              }))}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title={he.records.title} sub={he.records.sub}>
          {records.length === 0 ? (
            <p className="muted">{he.records.none}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {records.slice(0, 10).map((record) => (
                    <tr key={`${record.exerciseKey}-${record.date}`}>
                      <td>
                        <div className="person-name">{exerciseName(record.exerciseKey)}</div>
                        <div className="person-sub">{relativeDay(record.date, today)}</div>
                      </td>
                      <td className="num" dir="ltr">
                        {formatKg(record.weightKg)}×{record.reps}
                      </td>
                      <td className="num">
                        <strong>{formatKg(record.e1rm)}</strong>
                        <div className="person-sub">
                          {record.previousE1rm === null
                            ? ''
                            : fill(he.records.was, { value: formatKg(record.previousE1rm) })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={he.exercises.title} sub={he.exercises.sub}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{he.exercises.colExercise}</th>
                  <th className="num">{he.exercises.colSessions}</th>
                  <th className="num">{he.exercises.colSets}</th>
                  <th className="num">{he.exercises.colBest}</th>
                  <th className="num">{he.exercises.colChange}</th>
                </tr>
              </thead>
              <tbody>
                {summaries.slice(0, 15).map((summary) => (
                  <tr key={summary.exerciseKey}>
                    <td>
                      <div className="person-name">{exerciseName(summary.exerciseKey)}</div>
                      <div className="person-sub">
                        {he.exercises.colLast}: {relativeDay(summary.lastDone, today)}
                      </div>
                      {summary.stall.isStalling ? (
                        <span className="flag info" style={{ marginBlockStart: 4 }}>
                          <TrendDown size={12} weight="bold" aria-hidden />
                          {he.exercises.stalling}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{formatNumber(summary.sessions)}</td>
                    <td className="num">{formatNumber(summary.workingSets)}</td>
                    <td className="num">
                      {summary.bestE1rm === null ? '—' : formatKg(summary.bestE1rm)}
                    </td>
                    <td className="num">{formatSignedPercent(changePercent(summary))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function WeekTable({ rows, header }: { rows: string[][]; header: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{he.charts.week.replace(' {date}', '')}</th>
            <th className="num">{header}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([week, value]) => (
            <tr key={week}>
              <td>{week}</td>
              <td className="num">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The activity grid's columns: one per week of the period, a cell per day. */
function activityWeeks(
  sessions: readonly CoachSession[],
  calendar: CoachCalendar,
  plans: readonly CoachPlan[],
  from: string,
  today: string,
): DayCell[][] {
  const byDay = sessionsByDay(sessions);
  const names = new Map<string, string>();
  for (const plan of plans) for (const day of plan.days) names.set(day.id, day.name ?? plan.name);

  const weeks: DayCell[][] = [];
  for (const week of weeksBetween(from, today)) {
    weeks.push(
      daysBetween(week, addDays(week, 6)).map((day) => {
        if (day < from || day > today) return { day, outcome: 'outside' as const };
        const planned = calendar.get(day);
        const done = byDay.get(day) ?? [];
        const outcome = dayOutcome({ date: day, today, planned, trained: done.length > 0 });
        const detail =
          done.length > 0
            ? done.map((session) => session.name ?? he.workouts.untitled).join(', ')
            : Array.isArray(planned)
              ? planned.map((id) => names.get(id) ?? '—').join(', ')
              : '';
        return { day, outcome, detail };
      }),
    );
  }
  return weeks;
}
