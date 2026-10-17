/**
 * A trainee's eating and drinking, when they share it: the targets the app set them, how the
 * logged days compare with those, and the log itself, day by day.
 *
 * The daily targets are the app's own — worked out on the phone from the profile and the latest
 * weigh-in, exactly as the trainee sees them — so the coach and the trainee are measuring
 * against the same numbers. Averages are over logged days only (see analytics/nutrition.ts),
 * and the share of days logged is the first thing shown, because it decides how much the rest
 * can be trusted.
 */

import { CalendarCheck, CaretDown, CaretUp, Drop, Egg, ForkKnife, Target } from '@phosphor-icons/react';
import type { SharedTargets } from '@fit/shared/coaching';
import { useMemo, useState } from 'react';

import {
  addDays,
  rangeStart,
  weeksBetween,
  type RangeKey,
} from '../../analytics/dates.js';
import { nutritionDays, nutritionSummary, type NutritionDay } from '../../analytics/nutrition.js';
import { useCoach } from '../../coachContext.js';
import { BarChart, ChartFrame, type Bar } from '../../components/charts.js';
import { Card, EmptyState, ErrorBanner, Segmented, Skeleton, StatTile } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import {
  dateBadge,
  formatDayLong,
  formatDayShort,
  formatLitres,
  formatNumber,
} from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { NotShared } from './NotShared.js';

type NutritionRange = Extract<RangeKey, '4w' | '12w' | '26w'>;

const RANGES: { value: NutritionRange; label: string }[] = (['4w', '12w', '26w'] as const).map(
  (value) => ({ value, label: he.range[value] }),
);

/** Days in the log list below the charts; older ones are in the charts. */
const LOG_DAYS = 14;

export function TraineeNutrition({ traineeId, shared }: { traineeId: string; shared: boolean }) {
  if (!shared) return <NotShared />;
  return <SharedNutrition traineeId={traineeId} />;
}

function SharedNutrition({ traineeId }: { traineeId: string }) {
  const { source, today } = useCoach();
  const [range, setRange] = useState<NutritionRange>('4w');
  const [open, setOpen] = useState<string | null>(null);
  const loadFrom = rangeStart('26w', today);
  const loaded = useLoad(
    () => source.nutrition(traineeId, loadFrom, today),
    [source, traineeId, loadFrom, today],
  );

  const from = rangeStart(range, today);
  const days = useMemo(
    () => (loaded.state === 'ready' ? nutritionDays(loaded.value, from, today) : []),
    [loaded, from, today],
  );
  const targets = loaded.state === 'ready' ? loaded.value.targets : null;
  const summary = useMemo(() => nutritionSummary(days, targets, today), [days, targets, today]);

  if (loaded.state === 'loading') return <Skeleton />;
  if (loaded.state === 'failed') return <ErrorBanner error={loaded.error} onRetry={loaded.reload} />;

  // A month is read day by day; longer, week by week, or the bars are slivers.
  const daily = range === '4w';
  const finished = days.filter((day) => day.date < today);
  const calorieBars: Bar[] = daily
    ? finished.map((day) => ({
        key: day.date,
        axisLabel: formatDayShort(day.date),
        value: day.calories,
        title: day.entries.length === 0 ? `${formatDayLong(day.date)} · ${he.nutrition.dayEmpty}` : formatDayLong(day.date),
      }))
    : weekly(finished, from, (day) => day.entries.length > 0, (day) => day.calories);
  const waterBars: Bar[] = daily
    ? finished.map((day) => ({
        key: day.date,
        axisLabel: formatDayShort(day.date),
        value: day.waterMl / 1000,
        title: formatDayLong(day.date),
      }))
    : weekly(finished, from, (day) => day.waterMl > 0, (day) => day.waterMl / 1000);
  const recent = [...days].reverse().slice(0, LOG_DAYS);

  return (
    <>
      <div className="page-head">
        <Segmented
          value={range}
          options={RANGES}
          onChange={setRange}
          label={he.trainee.tabNutrition}
        />
      </div>

      <Targets targets={targets} />

      <div className="grid grid-stats">
        <StatTile
          icon={CalendarCheck}
          label={he.nutrition.logged}
          value={formatNumber(summary.loggedDays)}
          hint={fill(he.nutrition.loggedHint, { n: summary.days })}
        />
        <StatTile
          icon={ForkKnife}
          label={he.nutrition.avgCalories}
          value={summary.avgCalories === null ? '—' : formatNumber(summary.avgCalories)}
          unit={summary.avgCalories === null ? undefined : he.nutrition.kcal}
          hint={
            targets
              ? fill(he.nutrition.vsTarget, { n: formatNumber(targets.calorieTarget) })
              : he.nutrition.avgHint
          }
        />
        {summary.onTargetDays !== null ? (
          <StatTile
            icon={Target}
            label={he.nutrition.onTarget}
            value={`${formatNumber(summary.onTargetDays)}/${formatNumber(summary.loggedDays)}`}
            hint={he.nutrition.onTargetHint}
          />
        ) : null}
        <StatTile
          icon={Egg}
          label={he.nutrition.avgProtein}
          value={summary.avgProteinG === null ? '—' : formatNumber(summary.avgProteinG)}
          unit={summary.avgProteinG === null ? undefined : he.nutrition.grams}
          hint={
            targets
              ? fill(he.nutrition.vsTarget, { n: formatNumber(targets.proteinG) })
              : he.nutrition.avgHint
          }
        />
        <StatTile
          icon={Drop}
          label={he.nutrition.avgWater}
          value={summary.avgWaterMl === null ? '—' : formatLitres(summary.avgWaterMl)}
          unit={summary.avgWaterMl === null ? undefined : he.nutrition.litres}
          hint={fill(he.nutrition.avgWaterHint, { n: summary.waterDays })}
        />
      </div>

      {summary.loggedDays === 0 && summary.waterDays === 0 ? (
        <Card>
          <EmptyState icon={ForkKnife} title={he.nutrition.none} />
        </Card>
      ) : (
        <>
          <div className="grid grid-2">
            <Card title={he.nutrition.caloriesChart} sub={he.nutrition.caloriesChartSub}>
              <ChartFrame
                chart={
                  <BarChart
                    bars={calorieBars}
                    valueLabel={he.nutrition.calories}
                    format={(value) => `${formatNumber(value)} ${he.nutrition.kcal}`}
                    reference={
                      targets
                        ? { value: targets.calorieTarget, label: he.nutrition.targetLine }
                        : undefined
                    }
                  />
                }
                table={<BarTable bars={calorieBars} header={he.nutrition.calories} unit={he.nutrition.kcal} />}
              />
            </Card>
            <Card title={he.nutrition.waterChart}>
              <ChartFrame
                chart={
                  <BarChart
                    bars={waterBars}
                    valueLabel={he.nutrition.water}
                    format={(value) => `${formatLitres(value * 1000)} ${he.nutrition.litres}`}
                  />
                }
                table={<BarTable bars={waterBars} header={he.nutrition.water} unit={he.nutrition.litres} litres />}
              />
            </Card>
          </div>

          {targets && summary.loggedDays > 0 ? (
            <Card title={he.nutrition.macros}>
              <div className="macros">
                {(
                  [
                    [he.nutrition.protein, summary.avgProteinG, targets.proteinG],
                    [he.nutrition.carbs, summary.avgCarbsG, targets.carbsG],
                    [he.nutrition.fat, summary.avgFatG, targets.fatG],
                  ] as const
                ).map(([label, average, target]) => (
                  <MacroRow key={label} label={label} average={average ?? 0} target={target} />
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}

      <Card title={he.nutrition.days} sub={he.nutrition.daysSub}>
        <div className="sessions">
          {recent.map((day) => (
            <FoodDay
              key={day.date}
              day={day}
              today={day.date === today}
              open={open === day.date}
              onToggle={() => setOpen((current) => (current === day.date ? null : day.date))}
            />
          ))}
        </div>
      </Card>
    </>
  );
}

/** Weekly averages over the days that have something, for periods too long for daily bars. */
function weekly(
  days: readonly NutritionDay[],
  from: string,
  counts: (day: NutritionDay) => boolean,
  value: (day: NutritionDay) => number,
): Bar[] {
  const today = days[days.length - 1]?.date ?? from;
  return weeksBetween(from, today).map((start) => {
    const end = addDays(start, 6);
    const inWeek = days.filter((day) => day.date >= start && day.date <= end && counts(day));
    const average =
      inWeek.length === 0 ? 0 : inWeek.reduce((sum, day) => sum + value(day), 0) / inWeek.length;
    return {
      key: start,
      axisLabel: formatDayShort(start),
      value: average,
      title: fill(he.charts.week, { date: formatDayShort(start) }),
    };
  });
}

function Targets({ targets }: { targets: SharedTargets | null }) {
  if (!targets) {
    return (
      <Card title={he.nutrition.targets}>
        <p className="muted">{he.nutrition.targetsNone}</p>
      </Card>
    );
  }
  return (
    <Card
      title={he.nutrition.targets}
      action={
        targets.goal ? <span className="flag neutral">{he.nutrition[`goal_${targets.goal}`]}</span> : null
      }
    >
      <div className="target-row">
        <span>
          <strong>{formatNumber(targets.calorieTarget)}</strong> {he.nutrition.kcal}
        </span>
        <span>
          {he.nutrition.protein} <strong>{formatNumber(targets.proteinG)}</strong> {he.nutrition.grams}
        </span>
        <span>
          {he.nutrition.carbs} <strong>{formatNumber(targets.carbsG)}</strong> {he.nutrition.grams}
        </span>
        <span>
          {he.nutrition.fat} <strong>{formatNumber(targets.fatG)}</strong> {he.nutrition.grams}
        </span>
      </div>
    </Card>
  );
}

/** One macro's average against its target: the bar, a tick where the target is, both numbers. */
function MacroRow({ label, average, target }: { label: string; average: number; target: number }) {
  // The scale runs a third past the target, so being over it shows as being over it.
  const scale = Math.max(target * 1.33, average);
  return (
    <div className="macro">
      <span className="macro-label">{label}</span>
      <span className="macro-track" aria-hidden>
        <span className="macro-fill" style={{ width: `${(average / scale) * 100}%` }} />
        <span className="macro-target" style={{ insetInlineStart: `${(target / scale) * 100}%` }} />
      </span>
      <span className="macro-value">
        <strong>{formatNumber(average)}</strong> / {formatNumber(target)} {he.nutrition.grams}
      </span>
    </div>
  );
}

function BarTable({
  bars,
  header,
  unit,
  litres = false,
}: {
  bars: readonly Bar[];
  header: string;
  unit: string;
  litres?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{he.body.colDate}</th>
            <th className="num">{header}</th>
          </tr>
        </thead>
        <tbody>
          {[...bars].reverse().map((bar) => (
            <tr key={bar.key}>
              <td>{bar.title}</td>
              <td className="num">
                {bar.value === 0
                  ? '—'
                  : `${litres ? formatLitres(bar.value * 1000) : formatNumber(bar.value)} ${unit}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FoodDay({
  day,
  today,
  open,
  onToggle,
}: {
  day: NutritionDay;
  today: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const badge = dateBadge(day.date);
  const logged = day.entries.length > 0;
  return (
    <div className="session">
      <button
        type="button"
        className="session-head"
        onClick={onToggle}
        aria-expanded={open}
        disabled={!logged}
      >
        <span className="session-date" aria-hidden>
          <div className="day">{badge.day}</div>
          <div className="month">{badge.month}</div>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="session-name">
            {logged ? `${formatNumber(day.calories)} ${he.nutrition.kcal}` : he.nutrition.dayEmpty}
            {today ? <span className="muted"> · {he.nutrition.today}</span> : null}
          </span>
          <span className="visually-hidden">{formatDayLong(day.date)}</span>
          <span className="session-meta">
            {logged ? (
              <>
                <span>
                  {he.nutrition.protein} {formatNumber(day.proteinG)}
                  {he.nutrition.grams}
                </span>
                <span>
                  {he.nutrition.carbs} {formatNumber(day.carbsG)}
                  {he.nutrition.grams}
                </span>
                <span>
                  {he.nutrition.fat} {formatNumber(day.fatG)}
                  {he.nutrition.grams}
                </span>
                <span>
                  {day.entries.length === 1
                    ? he.nutrition.itemsOne
                    : fill(he.nutrition.items, { n: day.entries.length })}
                </span>
              </>
            ) : null}
            {day.waterMl > 0 ? (
              <span>
                <Drop size={12} aria-hidden /> {formatLitres(day.waterMl)} {he.nutrition.litres}
              </span>
            ) : null}
          </span>
        </span>
        {logged ? open ? <CaretUp size={18} aria-hidden /> : <CaretDown size={18} aria-hidden /> : null}
      </button>
      {open && logged ? (
        <div className="session-body">
          <table className="table">
            <tbody>
              {day.entries.map((entry, index) => (
                <tr key={`${entry.name}-${index}`}>
                  <td>
                    <span className="person-name">{entry.name}</span>
                    {entry.grams !== null ? (
                      <span className="muted"> · {formatNumber(entry.grams)}{he.nutrition.grams}</span>
                    ) : null}
                  </td>
                  <td className="num">
                    {formatNumber(entry.calories)} {he.nutrition.kcal}
                  </td>
                  <td className="muted">
                    {(
                      [
                        [he.nutrition.protein, entry.proteinG],
                        [he.nutrition.carbs, entry.carbsG],
                        [he.nutrition.fat, entry.fatG],
                      ] as const
                    )
                      .filter(([, grams]) => grams !== null)
                      .map(([name, grams]) => `${name} ${formatNumber(grams!)}${he.nutrition.grams}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
