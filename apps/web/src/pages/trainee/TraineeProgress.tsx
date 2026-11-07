/**
 * A trainee's monthly progress: where they progress and where they are stuck, by part of the
 * body and exercise by exercise — the coach's copy of the review the trainee sees on the
 * phone's Progress screen, judged by the same shared code (`analytics/monthly.ts`).
 *
 * Opens on the last whole month and moves through every month the loaded workouts can judge.
 * The shortcuts and a click on an area narrow the exercise list, and combine; each exercise
 * opens in place to its best sets of the month against the sets before, and the tip.
 */

import { CalendarBlank, CaretDown, CaretLeft, CaretRight, CaretUp, Lightbulb } from '@phosphor-icons/react';
import { EXERCISE_BY_KEY } from '@fit/shared/catalog';
import type { CoachSession } from '@fit/shared/coaching';
import {
  areaOfExercise,
  defaultMonth,
  monthOf,
  nextWeightKg,
  reviewableMonths,
  STATUS_ORDER,
  topSet,
  type AreaStatus,
  type BodyArea,
  type ExerciseMonth,
  type MonthStatus,
  type SetChange,
  type SetPair,
  type Tip,
  type WorkingSet,
} from '@fit/shared/progress';
import { useMemo, useState } from 'react';

import { historyStart, monthlyProgress, trainingMonths } from '../../analytics/monthly.js';
import { localDate, parseDay } from '../../analytics/dates.js';
import { Card, EmptyState } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import { formatDayShort, formatKg, formatNumber } from '../../lib/format.js';

const SHORTCUTS: readonly MonthStatus[] = ['improved', 'same', 'declined', 'new'];

/** The flag tone each verdict is drawn in, beside its words — never colour alone. */
export const STATUS_TONE: Record<AreaStatus, string> = {
  improved: 'ok',
  same: 'neutral',
  declined: 'warning',
  new: 'info',
  skipped: 'neutral',
};

const CHANGE_MARK: Record<SetChange, string> = {
  up: '↑',
  down: '↓',
  same: '=',
  added: '+',
  dropped: '−',
};

export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Date(year, index - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

export function exerciseLabel(key: string): string {
  return EXERCISE_BY_KEY.get(key)?.nameHe ?? key;
}

/** A working set in a few characters: 80×8, ×12, 30:00, 5 km. */
function describe(set: WorkingSet | null): string {
  if (!set) return '—';
  const parts: string[] = [];
  if (set.weightKg !== null && set.reps !== null) parts.push(`${formatKg(set.weightKg)}×${set.reps}`);
  else if (set.reps !== null) parts.push(`×${set.reps}`);
  if (set.durationSeconds !== null) {
    parts.push(`${Math.floor(set.durationSeconds / 60)}:${String(set.durationSeconds % 60).padStart(2, '0')}`);
  }
  if (set.distanceM !== null) parts.push(`${formatKg(set.distanceM / 1000)} km`);
  return parts.join(' ') || '—';
}

/** The set a row shows: the heaviest, or without a weight the one with the most reps. */
function topOf(sets: readonly WorkingSet[]): WorkingSet | null {
  return (
    topSet(sets) ??
    sets.reduce<WorkingSet | null>((best, set) => (!best || (set.reps ?? 0) > (best.reps ?? 0) ? set : best), null)
  );
}

function tipText(tip: Tip): string {
  switch (tip.kind) {
    case 'fadingSets':
      return fill(he.monthly.tip_fadingSets, { first: tip.firstReps, last: tip.lastReps });
    case 'lighter':
      return fill(he.monthly.tip_lighter, { from: formatKg(tip.fromKg), to: formatKg(tip.toKg) });
    case 'fewerSets':
      return fill(he.monthly.tip_fewerSets, { from: tip.from, to: tip.to });
    case 'lowFrequency':
      return tip.sessions === 1
        ? he.monthly.tip_lowFrequencyOne
        : fill(he.monthly.tip_lowFrequency, { n: tip.sessions });
    case 'twoMonths':
      return he.monthly.tip_twoMonths;
    case 'addRep':
      // Coaches read kilograms here: the website has no unit setting of its own.
      return fill(he.monthly.tip_addRep, {
        target: tip.targetReps,
        next: formatKg(nextWeightKg(tip.weightKg, 'metric')),
      });
    case 'addRepBodyweight':
      return fill(he.monthly.tip_addRepBodyweight, { target: tip.targetReps });
  }
}

function detailOf(exercise: ExerciseMonth): string {
  const parts: string[] = [];
  const gain = exercise.gain;
  if (exercise.status === 'improved' && gain) {
    if (gain.weightKg > 0) parts.push(fill(he.monthly.gainWeight, { value: formatKg(gain.weightKg) }));
    if (gain.reps > 0) parts.push(fill(he.monthly.gainReps, { n: gain.reps }));
    if (gain.sets > 0) parts.push(fill(he.monthly.gainSets, { n: gain.sets }));
  }
  if (parts.length === 0) {
    parts.push(
      exercise.sessions === 1 ? he.monthly.sessionsOne : fill(he.monthly.sessions, { n: exercise.sessions }),
    );
  }
  return parts.join(' · ');
}

export function TraineeProgress({
  sessions,
  today,
  historyFrom,
}: {
  sessions: readonly CoachSession[];
  today: string;
  /** The first day the loaded workouts cover: a month needs its look-back inside it. */
  historyFrom: string;
}) {
  const trained = useMemo(() => trainingMonths(sessions), [sessions]);
  const months = useMemo(
    () =>
      reviewableMonths(trained, parseDay(today)).filter(
        (month) => historyStart(month).getTime() >= parseDay(historyFrom).getTime(),
      ),
    [trained, today, historyFrom],
  );
  const [month, setMonth] = useState(() => defaultMonth(trained, parseDay(today)));
  const [status, setStatus] = useState<MonthStatus | null>(null);
  const [area, setArea] = useState<BodyArea | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const { review, areas } = useMemo(() => monthlyProgress(sessions, month), [sessions, month]);

  const position = months.indexOf(month);
  const earlier = position > 0 ? months[position - 1] : undefined;
  const later = position >= 0 && position < months.length - 1 ? months[position + 1] : undefined;
  const isCurrent = month === monthOf(parseDay(today));
  const move = (to: string | undefined) => {
    if (!to) return;
    setOpen(null);
    setMonth(to);
  };

  const visible = review.exercises.filter(
    (exercise) =>
      (status === null || exercise.status === status) &&
      (area === null || areaOfExercise(exercise.exerciseKey) === area),
  );
  const filterWords: string[] = [];
  if (area) filterWords.push(he.bodyArea[area]);
  if (status) filterWords.push(he.monthly[`shortcut_${status}`]);

  return (
    <>
      <Card
        title={he.monthly.title}
        sub={he.monthly.sub}
        action={
          <div className="month-nav">
            {/* Right to left: the earlier month is on the right. */}
            <button
              type="button"
              className="icon-button"
              onClick={() => move(earlier)}
              disabled={!earlier}
              aria-label={he.monthly.previousMonth}
            >
              <CaretRight size={18} aria-hidden />
            </button>
            <span className="month-nav-label">
              {isCurrent ? fill(he.monthly.monthSoFar, { month: monthLabel(month) }) : monthLabel(month)}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => move(later)}
              disabled={!later}
              aria-label={he.monthly.nextMonth}
            >
              <CaretLeft size={18} aria-hidden />
            </button>
          </div>
        }
      >
        {review.exercises.length === 0 ? (
          <EmptyState icon={CalendarBlank} title={he.monthly.empty} />
        ) : (
          <>
            <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
              {fill(he.monthly.totals, {
                sessions: formatNumber(review.totals.sessions),
                sets: formatNumber(review.totals.sets),
              })}
              {' · '}
              {review.previous.sessions > 0
                ? fill(he.monthly.previous, {
                    sessions: formatNumber(review.previous.sessions),
                    sets: formatNumber(review.previous.sets),
                  })
                : he.monthly.previousNone}
            </p>

            <div className="shortcut-row" role="group" aria-label={he.monthly.shortcutsLabel}>
              {SHORTCUTS.filter((s) => s !== 'new' || review.counts.new > 0).map((s) => {
                const count = review.counts[s];
                return (
                  <button
                    key={s}
                    type="button"
                    className={`shortcut tone-${STATUS_TONE[s]}`}
                    aria-pressed={status === s}
                    disabled={count === 0 && status !== s}
                    onClick={() => {
                      setOpen(null);
                      setStatus((current) => (current === s ? null : s));
                    }}
                  >
                    <span className="shortcut-count">{formatNumber(count)}</span>
                    <span>{he.monthly[`shortcut_${s}`]}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {review.exercises.length > 0 ? (
        <>
          <Card title={he.monthly.areasTitle} sub={he.monthly.areasSub}>
            <div className="area-grid">
              {areas.map((entry) => {
                const skipped = entry.status === 'skipped';
                const counts = STATUS_ORDER.filter((s) => entry.counts[s] > 0)
                  .map((s) => fill(he.monthly[`count_${s}`], { n: entry.counts[s] }))
                  .join(' · ');
                return (
                  <button
                    key={entry.area}
                    type="button"
                    className="area-card"
                    aria-pressed={area === entry.area}
                    disabled={skipped}
                    onClick={() => {
                      setOpen(null);
                      setArea((current) => (current === entry.area ? null : entry.area));
                    }}
                  >
                    <span className="area-card-head">
                      <span className="area-card-name">{he.bodyArea[entry.area]}</span>
                      <span className={`flag ${STATUS_TONE[entry.status]}`}>
                        {he.monthly[`areaStatus_${entry.status}`]}
                      </span>
                    </span>
                    {counts ? <span className="area-card-line">{counts}</span> : null}
                    <span className="area-card-line">
                      {[
                        entry.sets > 0 ? fill(he.monthly.areaSets, { n: formatNumber(entry.sets) }) : null,
                        entry.previousSets > 0
                          ? fill(he.monthly.areaSetsBefore, { n: formatNumber(entry.previousSets) })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card
            title={he.monthly.exercisesTitle}
            action={
              filterWords.length > 0 ? (
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => {
                    setStatus(null);
                    setArea(null);
                  }}
                >
                  {he.monthly.clearFilter}
                </button>
              ) : undefined
            }
          >
            {filterWords.length > 0 ? (
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {fill(he.monthly.showing, { what: filterWords.join(' · ') })}
              </p>
            ) : null}
            {visible.length === 0 ? <p className="muted">{he.monthly.filteredEmpty}</p> : null}

            {STATUS_ORDER.filter((s) => visible.some((e) => e.status === s)).map((s) => (
              <section key={s} className="review-group">
                <h3 className={`review-group-title tone-${STATUS_TONE[s]}`}>{he.monthly[`group_${s}`]}</h3>
                {visible
                  .filter((exercise) => exercise.status === s)
                  .map((exercise) => (
                    <ExerciseRow
                      key={exercise.exerciseKey}
                      exercise={exercise}
                      open={open === exercise.exerciseKey}
                      onToggle={() => setOpen(open === exercise.exerciseKey ? null : exercise.exerciseKey)}
                    />
                  ))}
              </section>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

function ExerciseRow({
  exercise,
  open,
  onToggle,
}: {
  exercise: ExerciseMonth;
  open: boolean;
  onToggle: () => void;
}) {
  const best = exercise.best.map((b) => b.set);
  const before = exercise.from?.sets ?? null;
  // A new exercise has nothing before it: its sets are listed on their own.
  const pairs: SetPair[] =
    exercise.pairs.length > 0
      ? exercise.pairs
      : best.map((set, i) => ({ position: i + 1, now: set, then: null, change: 'added' }));
  return (
    <div className="session">
      <button type="button" className="session-head" onClick={onToggle} aria-expanded={open}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="session-name">{exerciseLabel(exercise.exerciseKey)}</span>
          <span className="session-meta">
            <span>{he.bodyArea[areaOfExercise(exercise.exerciseKey)]}</span>
            <span>{detailOf(exercise)}</span>
          </span>
        </span>
        <span className="review-top">
          <span className="set-pill">{describe(topOf(best))}</span>
          {before ? <span className="muted review-was">{describe(topOf(before))}</span> : null}
        </span>
        {open ? <CaretUp size={18} aria-hidden /> : <CaretDown size={18} aria-hidden />}
      </button>

      {open ? (
        <div className="session-body">
          {exercise.from ? (
            <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              {fill(exercise.fromBeforeMonth ? he.monthly.compareBest : he.monthly.compareBestFirst, {
                date: formatDayShort(localDate(new Date(exercise.from.startedAt))),
              })}
            </p>
          ) : null}
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>{he.monthly.best}</th>
                {exercise.from ? <th>{he.monthly.before}</th> : null}
                {exercise.from ? <th aria-hidden /> : null}
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <tr key={pair.position}>
                  <td className="muted">{fill(he.monthly.setN, { n: pair.position })}</td>
                  <td>
                    {pair.now ? (
                      <span className="set-pill">{describe(pair.now)}</span>
                    ) : (
                      <span className="muted">{he.monthly.dropped}</span>
                    )}
                  </td>
                  {exercise.from ? (
                    <td>{pair.then ? <span className="set-pill">{describe(pair.then)}</span> : '—'}</td>
                  ) : null}
                  {exercise.from ? (
                    <td className={`change-mark change-${pair.change}`} aria-hidden>
                      {CHANGE_MARK[pair.change]}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {exercise.tip ? (
            <div className="note">
              <Lightbulb size={18} weight="duotone" aria-hidden style={{ flex: '0 0 auto' }} />
              <span>
                <strong>{he.monthly.tipTitle}: </strong>
                {tipText(exercise.tip)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
