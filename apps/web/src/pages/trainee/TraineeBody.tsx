/**
 * A trainee's weight, when they share it: the last figure, the trend under the daily noise,
 * and how fast it is moving — the numbers that say whether the plan and the eating are doing
 * what they were meant to.
 *
 * Read once, a year back, and cut by the period filter on the page, as the overview tab does.
 */

import { ChartLine, Drop, Gauge, Scales } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';

import { bodyDays, bodySummary, weeklyAverage } from '../../analytics/body.js';
import { addDays, parseDay, rangeStart, type RangeKey } from '../../analytics/dates.js';
import { useCoach } from '../../coachContext.js';
import { ChartFrame, LineChart, type LineSeries } from '../../components/charts.js';
import { Card, EmptyState, ErrorBanner, Segmented, Skeleton, StatTile } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import { formatDayShort, formatKg, formatNumber, formatSigned, relativeDay } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { NotShared } from './NotShared.js';

const RANGES: { value: RangeKey; label: string }[] = (['4w', '12w', '26w', '52w'] as const).map(
  (value) => ({ value, label: he.range[value] }),
);

export function TraineeBody({ traineeId, shared }: { traineeId: string; shared: boolean }) {
  if (!shared) return <NotShared />;
  return <SharedBody traineeId={traineeId} />;
}

function SharedBody({ traineeId }: { traineeId: string }) {
  const { source, today } = useCoach();
  const [range, setRange] = useState<RangeKey>('12w');
  const loadFrom = rangeStart('52w', today);
  const loaded = useLoad(
    () => source.body(traineeId, parseDay(loadFrom), parseDay(addDays(today, 1))),
    [source, traineeId, loadFrom, today],
  );

  const from = rangeStart(range, today);
  const days = useMemo(
    () => (loaded.state === 'ready' ? bodyDays(loaded.value, from, today) : []),
    [loaded, from, today],
  );
  const summary = useMemo(() => bodySummary(days), [days]);

  if (loaded.state === 'loading') return <Skeleton />;
  if (loaded.state === 'failed') return <ErrorBanner error={loaded.error} onRetry={loaded.reload} />;

  const toT = (day: string) => parseDay(day).getTime() + 12 * 3_600_000;
  const weighed = days.filter((day) => day.weightKg !== null);
  const weightSeries: LineSeries[] = [
    {
      key: 'daily',
      label: he.body.daily,
      colour: 'var(--series-1)',
      kind: 'dots',
      points: weighed.map((day) => ({ t: toT(day.date), value: day.weightKg!, day: day.date })),
    },
    {
      key: 'trend',
      label: he.body.trend,
      colour: 'var(--series-1)',
      points: weeklyAverage(days).map((point) => ({
        t: toT(point.date),
        value: point.weightKg,
        day: point.date,
      })),
    },
  ];
  const fats = days.filter((day) => day.bodyFatPct !== null);
  const axis = { from: parseDay(from).getTime(), to: parseDay(today).getTime() + 86_400_000 };

  return (
    <>
      <div className="page-head">
        <Segmented value={range} options={RANGES} onChange={setRange} label={he.trainee.tabBody} />
      </div>

      {weighed.length === 0 ? (
        <Card>
          <EmptyState icon={Scales} title={he.body.none} />
        </Card>
      ) : (
        <>
          <div className="grid grid-stats">
            <StatTile
              icon={Scales}
              label={he.body.latest}
              value={summary.latest ? formatKg(summary.latest.weightKg) : '—'}
              unit={he.stats.kg}
              hint={summary.latest ? relativeDay(summary.latest.date, today) : undefined}
            />
            <StatTile
              icon={ChartLine}
              label={he.body.change}
              value={formatSigned(summary.changeKg)}
              unit={summary.changeKg === null ? undefined : he.stats.kg}
              hint={he.body.changeHint}
            />
            <StatTile
              icon={Gauge}
              label={he.body.rate}
              value={summary.weeklyRateKg === null ? '—' : formatSigned(summary.weeklyRateKg)}
              unit={summary.weeklyRateKg === null ? undefined : `${he.stats.kg} ${he.body.perWeek}`}
              hint={summary.weeklyRateKg === null ? he.body.rateNone : he.body.rateHint}
            />
            {summary.latestBodyFat !== null ? (
              <StatTile
                icon={Drop}
                label={he.body.fat}
                value={`${formatKg(summary.latestBodyFat)}%`}
                hint={
                  summary.bodyFatChange === null
                    ? undefined
                    : fill(he.body.fatChange, { change: formatSigned(summary.bodyFatChange) })
                }
              />
            ) : null}
            <StatTile
              icon={Scales}
              label={he.body.weighIns}
              value={formatNumber(summary.weighIns)}
              hint={he.body.weighInsHint}
            />
          </div>

          <Card title={he.body.chart} sub={he.body.chartSub}>
            <ChartFrame
              chart={
                <LineChart
                  series={weightSeries}
                  {...axis}
                  label={he.body.chart}
                  format={(value) => `${formatKg(value)} ${he.stats.kg}`}
                />
              }
              table={<WeighInTable days={[...days].reverse()} />}
            />
          </Card>

          {fats.length >= 2 ? (
            <Card title={he.body.fatChart} sub={he.body.fatChartSub}>
              <ChartFrame
                chart={
                  <LineChart
                    series={[
                      {
                        key: 'fat',
                        label: he.body.fatChart,
                        colour: 'var(--series-2)',
                        points: fats.map((day) => ({
                          t: toT(day.date),
                          value: day.bodyFatPct!,
                          day: day.date,
                        })),
                      },
                    ]}
                    {...axis}
                    height={200}
                    label={he.body.fatChart}
                    format={(value) => `${formatKg(value)}%`}
                  />
                }
                table={<WeighInTable days={[...fats].reverse()} />}
              />
            </Card>
          ) : null}

          <Card title={he.body.table}>
            <WeighInTable days={[...days].reverse().slice(0, 14)} />
          </Card>
        </>
      )}
    </>
  );
}

function WeighInTable({ days }: { days: ReturnType<typeof bodyDays> }) {
  const withFat = days.some((day) => day.bodyFatPct !== null);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{he.body.colDate}</th>
            <th className="num">{he.body.colWeight}</th>
            {withFat ? <th className="num">{he.body.colFat}</th> : null}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{formatDayShort(day.date)}</td>
              <td className="num">
                {day.weightKg === null ? '—' : `${formatKg(day.weightKg)} ${he.stats.kg}`}
              </td>
              {withFat ? (
                <td className="num">
                  {day.bodyFatPct === null ? '—' : `${formatKg(day.bodyFatPct)}%`}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
