/**
 * Every workout the trainee finished, newest first, each opening onto its exercises and sets.
 *
 * Each carries its summary (`reviewSession` in `@fit/shared/progress`, the trainee's app reads
 * the same): which exercises got better than the last time they were done, which stayed and which
 * went down — on the row as a count, and inside it by name, so a coach sees how the trainee moved
 * from one workout to the next without opening the sets.
 *
 * Twenty at a time, with a button for more: a year and a half of training is a long page, and
 * the ones a coach opens are nearly always the last few.
 */

import {
  CaretDown,
  CaretUp,
  ChatText,
  Clock,
  Gauge,
  ListChecks,
  Barbell,
} from '@phosphor-icons/react';
import type { CoachPlan, CoachSession } from '@fit/shared/coaching';
import { sessionMinutes, sessionVolumeKg, workingSetCount } from '@fit/shared/coaching';
import {
  reviewSession,
  SESSION_VERDICT_ORDER,
  type SessionReview,
  type SessionVerdict,
} from '@fit/shared/progress';
import { useMemo, useState } from 'react';

import { localDate } from '../../analytics/dates.js';
import { exerciseName } from '../../analytics/lifts.js';
import { sessionsByExercise } from '../../analytics/monthly.js';
import { Button, Card, EmptyState } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import { dateBadge, formatDayLong, formatKg, formatNumber } from '../../lib/format.js';

const PAGE = 20;

/** The flag each verdict wears; the word beside it carries the meaning, not the colour. */
const FLAG: Record<SessionVerdict, string> = {
  improved: 'ok',
  same: 'neutral',
  declined: 'warning',
  new: 'info',
};

export function TraineeWorkouts({
  sessions,
  plans,
}: {
  sessions: readonly CoachSession[];
  plans: readonly CoachPlan[];
}) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(sessions[0]?.id ?? null);

  // Every exercise's sessions in order, once: each row's summary reads its own from this.
  const history = useMemo(() => sessionsByExercise(sessions), [sessions]);

  const planned = useMemo(() => {
    const names = new Map<string, string>();
    for (const plan of plans) for (const day of plan.days) names.set(day.id, day.name ?? plan.name);
    return names;
  }, [plans]);

  if (sessions.length === 0) {
    return (
      <Card>
        <EmptyState icon={Barbell} title={he.workouts.none} />
      </Card>
    );
  }

  return (
    <Card title={he.workouts.title} sub={he.workouts.sub}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {sessions.slice(0, shown).map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            plannedName={session.planDayId ? (planned.get(session.planDayId) ?? null) : null}
            review={reviewSession(
              history,
              session.id,
              session.exercises.flatMap((exercise) =>
                exercise.exerciseKey ? [exercise.exerciseKey] : [],
              ),
            )}
            open={open === session.id}
            onToggle={() => setOpen((current) => (current === session.id ? null : session.id))}
          />
        ))}
      </div>
      {shown < sessions.length ? (
        <Button onClick={() => setShown((n) => n + PAGE)}>
          {formatNumber(Math.min(PAGE, sessions.length - shown))} +
        </Button>
      ) : null}
    </Card>
  );
}

function SessionRow({
  session,
  plannedName,
  review,
  open,
  onToggle,
}: {
  session: CoachSession;
  plannedName: string | null;
  review: SessionReview;
  open: boolean;
  onToggle: () => void;
}) {
  const verdicts = SESSION_VERDICT_ORDER.filter((status) => review.counts[status] > 0);
  const byKey = new Map(review.exercises.map((exercise) => [exercise.exerciseKey, exercise]));
  const flagged = new Set<string>();
  const day = localDate(new Date(session.startedAt));
  const badge = dateBadge(day);
  const minutes = sessionMinutes(session);
  const sets = workingSetCount(session);
  const volume = Math.round(sessionVolumeKg(session));

  return (
    <div className="session">
      <button type="button" className="session-head" onClick={onToggle} aria-expanded={open}>
        <span className="session-date" aria-hidden>
          <div className="day">{badge.day}</div>
          <div className="month">{badge.month}</div>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="session-name">
            {session.name ?? plannedName ?? he.workouts.untitled}
          </span>
          <span className="visually-hidden">{formatDayLong(day)}</span>
          <span className="session-meta">
            {minutes !== null ? (
              <span>
                <Clock size={12} aria-hidden /> {fill(he.workouts.minutes, { n: minutes })}
              </span>
            ) : null}
            <span>
              <ListChecks size={12} aria-hidden /> {fill(he.workouts.sets, { n: sets })}
            </span>
            {volume > 0 ? (
              <span>
                <Barbell size={12} aria-hidden />{' '}
                {fill(he.workouts.volume, { n: formatNumber(volume) })}
              </span>
            ) : null}
            {session.rpe !== null ? (
              <span>
                <Gauge size={12} aria-hidden /> {fill(he.workouts.rpe, { n: session.rpe })}
              </span>
            ) : null}
            {session.planDayId ? <span>{he.workouts.fromPlan}</span> : null}
            {session.note ? (
              <span>
                <ChatText size={12} aria-hidden /> {he.workouts.note}
              </span>
            ) : null}
            {verdicts.map((status) => (
              <span key={status} className={`flag ${FLAG[status]}`}>
                {he.workouts[`summary_${status}`]} {formatNumber(review.counts[status])}
              </span>
            ))}
          </span>
        </span>
        {open ? <CaretUp size={18} aria-hidden /> : <CaretDown size={18} aria-hidden />}
      </button>

      {open ? (
        <div className="session-body">
          {session.note ? (
            <div className="note">
              <ChatText size={18} weight="duotone" aria-hidden style={{ flex: '0 0 auto' }} />
              <span>
                <strong>{he.workouts.note}: </strong>
                {session.note}
              </span>
            </div>
          ) : null}
          {verdicts.length > 0 ? (
            <div className="session-summary">
              <strong>{he.workouts.summaryTitle}</strong>
              <span className="muted">{he.workouts.summaryHint}</span>
              {verdicts.map((status) => (
                <span key={status} className="session-summary-line">
                  <span className={`flag ${FLAG[status]}`}>{he.workouts[`summary_${status}`]}</span>{' '}
                  {review.exercises
                    .filter((exercise) => exercise.status === status)
                    .map((exercise) => exerciseName(exercise.exerciseKey))
                    .join(' · ')}
                </span>
              ))}
            </div>
          ) : null}
          <table className="table">
            <tbody>
              {session.exercises.map((exercise, index) => {
                // An exercise entered twice in one workout is one line of the summary: flag it once.
                const change =
                  exercise.exerciseKey && !flagged.has(exercise.exerciseKey)
                    ? byKey.get(exercise.exerciseKey)
                    : undefined;
                if (change) flagged.add(change.exerciseKey);
                return (
                  <tr key={`${exercise.exerciseKey ?? 'x'}-${index}`}>
                    <td style={{ width: '38%' }}>
                      <span className="person-name">{exerciseName(exercise.exerciseKey)}</span>
                      {change ? (
                        <span
                          className="session-change"
                          title={
                            change.previous
                              ? fill(he.workouts.vsDate, {
                                  date: formatDayLong(
                                    localDate(new Date(change.previous.startedAt)),
                                  ),
                                })
                              : undefined
                          }
                        >
                          <span className={`flag ${FLAG[change.status]}`}>
                            {he.workouts[`summary_${change.status}`]}
                          </span>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <div className="chips">
                        {exercise.sets.map((set) => (
                          <span
                            key={set.id}
                            className={`set-pill${set.is_warmup === 1 ? ' warmup' : ''}`}
                            title={[
                              set.is_warmup === 1 ? he.workouts.warmup : null,
                              set.is_drop === 1 ? he.workouts.drop : null,
                              set.to_failure === 1 ? he.workouts.failure : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            {describeSet(set)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** A set in a few characters: 80×8, 12 reps, 30:00, 5 km. */
function describeSet(set: CoachSession['exercises'][number]['sets'][number]): string {
  const parts: string[] = [];
  if (set.weight_kg !== null && set.reps !== null)
    parts.push(`${formatKg(set.weight_kg)}×${set.reps}`);
  else if (set.reps !== null) parts.push(`×${set.reps}`);
  if (set.duration_seconds !== null) {
    const minutes = Math.floor(set.duration_seconds / 60);
    const seconds = String(set.duration_seconds % 60).padStart(2, '0');
    parts.push(`${minutes}:${seconds}`);
  }
  if (set.distance_m !== null) parts.push(`${formatKg(set.distance_m / 1000)} km`);
  if (set.rpe !== null) parts.push(`@${set.rpe}`);
  if (set.is_drop === 1) parts.push('↓');
  if (set.to_failure === 1) parts.push('!');
  return parts.join(' ') || '—';
}
