/**
 * The trainee's calendar, a month at a time: what was planned, what was done, and the coach's
 * way of planning the days ahead.
 *
 * A date holds what the trainee's own calendar holds — one or more workouts, a rest day, or
 * nothing decided — and is set the same way, whole (`coach_set_schedule`). Past days show how
 * they went, by the app's own rule (`dayOutcome`): a planned day trained on is done whichever
 * workout was done, today is never missed.
 */

import { CalendarPlus, CaretLeft, CaretRight, Check, X } from '@phosphor-icons/react';
import type { CoachCalendar, CoachingError, CoachPlan, CoachSession } from '@fit/shared/coaching';
import { dayOutcome, sessionsByDay } from '@fit/shared/coaching';
import { useMemo, useState } from 'react';

import { addDays, daysBetween, localDate, parseDay, weekStart } from '../../analytics/dates.js';
import { useCoach } from '../../coachContext.js';
import { Button, Card, Dialog, ErrorBanner, Loading } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import { formatDayLong, formatMonth } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';

type Choice = { workouts: string[]; rest: boolean };

export function TraineeCalendar({
  traineeId,
  sessions,
  plans,
  onChanged,
}: {
  traineeId: string;
  sessions: readonly CoachSession[];
  calendar: CoachCalendar;
  plans: readonly CoachPlan[];
  onChanged: () => void;
}) {
  const { source, today } = useCoach();
  const [month, setMonth] = useState(() => `${today.slice(0, 7)}-01`);
  const [editing, setEditing] = useState<{ date: string; choice: Choice } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CoachingError | null>(null);

  // Six rows from the Sunday on or before the 1st: every month fits, and the grid never jumps.
  const gridStart = weekStart(month);
  const gridEnd = addDays(gridStart, 41);
  const schedule = useLoad(
    () => source.schedule(traineeId, gridStart, gridEnd),
    [source, traineeId, gridStart, gridEnd],
  );

  const byDay = useMemo(() => sessionsByDay(sessions), [sessions]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const plan of plans) {
      plan.days.forEach((day, index) =>
        map.set(day.id, day.name?.trim() || `${plan.name} ${index + 1}`),
      );
    }
    return map;
  }, [plans]);

  const shiftMonth = (by: number) => {
    const date = parseDay(month);
    date.setMonth(date.getMonth() + by, 1);
    setMonth(localDate(date));
  };

  const openDay = (date: string, calendar: CoachCalendar) => {
    const planned = calendar.get(date);
    setError(null);
    setEditing({
      date,
      choice: {
        workouts: Array.isArray(planned) ? [...planned] : [],
        rest: planned === null,
      },
    });
  };

  const save = (choice: Choice) => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    void source
      .setSchedule(
        traineeId,
        editing.date,
        choice.workouts,
        choice.workouts.length === 0 && choice.rest,
      )
      .then((answer) => {
        setSaving(false);
        if (!answer.ok) {
          setError(answer.error);
          return;
        }
        setEditing(null);
        schedule.reload();
        onChanged();
      });
  };

  const thisMonth = month.slice(0, 7);

  return (
    <Card
      title={he.calendar.title}
      sub={he.calendar.sub}
      action={
        <div className="month-head">
          <button
            type="button"
            className="icon-button"
            aria-label={he.calendar.prev}
            title={he.calendar.prev}
            onClick={() => shiftMonth(-1)}
          >
            <CaretRight size={18} />
          </button>
          <strong style={{ minWidth: 120, textAlign: 'center' }}>{formatMonth(month)}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={he.calendar.next}
            title={he.calendar.next}
            onClick={() => shiftMonth(1)}
          >
            <CaretLeft size={18} />
          </button>
          <Button small variant="ghost" onClick={() => setMonth(`${today.slice(0, 7)}-01`)}>
            {he.calendar.today}
          </Button>
        </div>
      }
    >
      {schedule.state === 'failed' ? (
        <ErrorBanner error={schedule.error} onRetry={schedule.reload} />
      ) : schedule.state === 'loading' ? (
        <Loading />
      ) : (
        <div className={schedule.refreshing ? 'refreshing' : undefined}>
          <div className="month-grid" style={{ marginBlockEnd: 'var(--space-2)' }}>
            {he.calendar.weekdays.map((day) => (
              <span className="weekday" key={day}>
                {day}
              </span>
            ))}
          </div>
          <div className="month-grid">
            {daysBetween(gridStart, gridEnd).map((date) => {
              const planned = schedule.value.get(date);
              const done = byDay.get(date) ?? [];
              const outcome = dayOutcome({ date, today, planned, trained: done.length > 0 });
              const classes = [
                'date-cell',
                date.slice(0, 7) !== thisMonth ? 'other-month' : '',
                date === today ? 'today' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  type="button"
                  key={date}
                  className={classes}
                  onClick={() => openDay(date, schedule.value)}
                  aria-label={`${formatDayLong(date)}: ${he.outcome[outcome]}`}
                >
                  <span className="date-num">{parseDay(date).getDate()}</span>
                  {Array.isArray(planned)
                    ? planned.map((id) => (
                        <span
                          key={id}
                          className={`date-entry${outcome === 'done' ? ' done' : outcome === 'missed' ? ' missed' : ''}`}
                        >
                          {/* Said with a mark as well as a colour: done, or not done. */}
                          {outcome === 'done' ? (
                            <Check size={10} weight="bold" aria-hidden />
                          ) : null}
                          {outcome === 'missed' ? <X size={10} weight="bold" aria-hidden /> : null}{' '}
                          {names.get(id) ?? '—'}
                        </span>
                      ))
                    : null}
                  {planned === null ? (
                    <span className="date-entry rest">{he.calendar.rest}</span>
                  ) : null}
                  {!Array.isArray(planned) && done.length > 0
                    ? done.map((session) => (
                        <span key={session.id} className="date-entry extra">
                          {session.name ?? he.workouts.untitled}
                        </span>
                      ))
                    : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editing ? (
        <DayDialog
          date={editing.date}
          initial={editing.choice}
          plans={plans}
          trained={(byDay.get(editing.date) ?? []).map(
            (session) => session.name ?? he.workouts.untitled,
          )}
          saving={saving}
          error={error}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

function DayDialog({
  date,
  initial,
  plans,
  trained,
  saving,
  error,
  onSave,
  onClose,
}: {
  date: string;
  initial: Choice;
  plans: readonly CoachPlan[];
  trained: string[];
  saving: boolean;
  error: CoachingError | null;
  onSave: (choice: Choice) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice>(initial);
  const hasDays = plans.some((plan) => plan.days.length > 0);

  const toggle = (id: string) =>
    setChoice((current) => ({
      rest: false,
      workouts: current.workouts.includes(id)
        ? current.workouts.filter((other) => other !== id)
        : [...current.workouts, id],
    }));

  return (
    <Dialog
      title={fill(he.calendar.dayTitle, { date: formatDayLong(date) })}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {he.plans.cancel}
          </Button>
          <Button variant="primary" onClick={() => onSave(choice)} disabled={saving}>
            {saving ? he.plans.saving : he.plans.save}
          </Button>
        </>
      }
    >
      {trained.length > 0 ? (
        <div className="banner info">
          {he.calendar.trained}: {trained.join(', ')}
        </div>
      ) : null}

      {hasDays ? (
        plans.map((plan) =>
          plan.days.length === 0 ? null : (
            <div
              key={plan.id}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              <span className="card-sub">{plan.name}</span>
              {plan.days.map((day, index) => (
                <label className="check-row" key={day.id}>
                  <input
                    type="checkbox"
                    checked={choice.workouts.includes(day.id)}
                    onChange={() => toggle(day.id)}
                  />
                  <span>{day.name?.trim() || `${plan.name} ${index + 1}`}</span>
                  <span
                    className="muted"
                    style={{ marginInlineStart: 'auto', fontSize: 'var(--text-xs)' }}
                  >
                    {day.exercises.length}
                  </span>
                </label>
              ))}
            </div>
          ),
        )
      ) : (
        <p className="muted">
          <CalendarPlus size={16} aria-hidden /> {he.calendar.noPlans}
        </p>
      )}

      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={choice.workouts.length === 0 && choice.rest}
          onClick={() => setChoice({ workouts: [], rest: true })}
        >
          {he.calendar.rest}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={choice.workouts.length === 0 && !choice.rest}
          onClick={() => setChoice({ workouts: [], rest: false })}
        >
          {he.calendar.clear}
        </button>
      </div>

      {error ? <ErrorBanner error={error} /> : null}
    </Dialog>
  );
}
