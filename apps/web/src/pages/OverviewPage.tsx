/**
 * The front page: every trainee on one screen, and the ones who need a word at the top.
 *
 * Each trainee's line is worked out from their last eight weeks of workouts and their calendar
 * a fortnight either side of today (`traineeOverview`). They load a few at a time and fill in
 * as they arrive, so twenty trainees do not mean twenty seconds of a blank page.
 */

import {
  ArrowLeft,
  Barbell,
  CalendarCheck,
  Lightning,
  UserPlus,
  Users,
} from '@phosphor-icons/react';
import type { CoachingError, CoachingPerson } from '@fit/shared/coaching';
import { personLabel } from '@fit/shared/coaching';
import { useEffect, useMemo, useState } from 'react';

import { addDays, localDate, parseDay } from '../analytics/dates.js';
import { exerciseName } from '../analytics/lifts.js';
import { traineeOverview, type TraineeOverview } from '../analytics/overview.js';
import { useCoach } from '../coachContext.js';
import { DemoBar } from '../components/DemoBar.js';
import { Avatar, Card, EmptyState, FlagChip, Loading, StatTile } from '../components/ui.js';
import { he } from '../i18n/he.js';
import {
  formatDayShort,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  formatVolume,
  relativeDay,
} from '../lib/format.js';
import { hrefFor, navigate } from '../lib/router.js';

type Line =
  | { state: 'loading' }
  | { state: 'ready'; line: TraineeOverview }
  | { state: 'failed'; error: CoachingError };

/** At most this many trainees are asked about at once. */
const AT_ONCE = 4;

export function OverviewPage() {
  const { source, status, today } = useCoach();
  const [lines, setLines] = useState<Record<string, Line>>({});

  useEffect(() => {
    let cancelled = false;
    const queue = [...status.trainees];
    setLines(Object.fromEntries(queue.map((person) => [person.id, { state: 'loading' }])));

    const from = parseDay(addDays(today, -55));
    const to = parseDay(addDays(today, 1));
    const work = async () => {
      for (let person = queue.shift(); person; person = queue.shift()) {
        const id = person.id;
        const [sessions, calendar, plans] = await Promise.all([
          source.sessions(id, from, to),
          source.schedule(id, addDays(today, -14), addDays(today, 14)),
          source.plans(id),
        ]);
        if (cancelled) return;
        const failed = [sessions, calendar, plans].find((answer) => !answer.ok);
        setLines((current) => ({
          ...current,
          [id]:
            failed && !failed.ok
              ? { state: 'failed', error: failed.error }
              : {
                  state: 'ready',
                  line: traineeOverview({
                    sessions: sessions.ok ? sessions.value : [],
                    calendar: calendar.ok ? calendar.value : new Map<string, string[] | null>(),
                    plans: plans.ok ? plans.value : [],
                    today,
                  }),
                },
        }));
      }
    };
    void Promise.all(Array.from({ length: AT_ONCE }, work));
    return () => {
      cancelled = true;
    };
  }, [source, status.trainees, today]);

  const ready = useMemo(
    () =>
      status.trainees.flatMap((person) => {
        const line = lines[person.id];
        return line?.state === 'ready' ? [{ person, line: line.line }] : [];
      }),
    [lines, status.trainees],
  );

  const totals = useMemo(() => {
    let active = 0;
    let workouts = 0;
    let due = 0;
    let doneShare = 0;
    for (const { line } of ready) {
      if (line.workouts7 > 0) active += 1;
      workouts += line.workouts7;
      if (line.adherence14 !== null) {
        due += 1;
        doneShare += line.adherence14;
      }
    }
    return { active, workouts, adherence: due > 0 ? doneShare / due : null };
  }, [ready]);

  const needing = ready.filter(({ line }) => line.flags.length > 0);

  return (
    <div className="page">
      <DemoBar />
      <header className="page-head">
        <div>
          <h1 className="page-title">{he.overview.title}</h1>
          <p className="page-sub">{he.overview.sub}</p>
        </div>
      </header>

      {status.trainees.length === 0 ? (
        <Card>
          <EmptyState icon={UserPlus} title={he.overview.noTrainees}>
            <p>{he.overview.noTraineesHint}</p>
            {status.code ? (
              <p className="code-card" style={{ display: 'inline-block' }}>
                <span className="code">{status.code}</span>
              </p>
            ) : null}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-stats">
            <StatTile
              icon={Users}
              label={he.overview.trainees}
              value={formatNumber(status.trainees.length)}
            />
            <StatTile
              icon={Lightning}
              label={he.overview.activeWeek}
              value={`${formatNumber(totals.active)}`}
              unit={`/ ${formatNumber(status.trainees.length)}`}
            />
            <StatTile
              icon={Barbell}
              label={he.overview.workoutsWeek}
              value={formatNumber(totals.workouts)}
            />
            <StatTile
              icon={CalendarCheck}
              label={he.overview.adherence}
              value={formatPercent(totals.adherence)}
              hint={he.overview.adherenceHint}
            />
          </div>

          <Card title={he.overview.attention}>
            {ready.length < status.trainees.length && needing.length === 0 ? (
              <Loading />
            ) : needing.length === 0 ? (
              <p className="muted">{he.overview.attentionNone}</p>
            ) : (
              <div className="grid grid-2">
                {needing.map(({ person, line }) => (
                  <AttentionCard key={person.id} person={person} line={line} today={today} />
                ))}
              </div>
            )}
          </Card>

          <Card title={he.overview.table}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{he.overview.colTrainee}</th>
                    <th>{he.overview.colLast}</th>
                    <th className="num">{he.overview.col7}</th>
                    <th className="num">{he.overview.col28}</th>
                    <th className="num">{he.overview.colAdherence}</th>
                    <th className="num">{he.overview.colTrend}</th>
                    <th>{he.overview.colNext}</th>
                    <th>{he.overview.colFlags}</th>
                    <th aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {status.trainees.map((person) => (
                    <TraineeRow
                      key={person.id}
                      person={person}
                      line={lines[person.id]}
                      today={today}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function TraineeRow({
  person,
  line,
  today,
}: {
  person: CoachingPerson;
  line: Line | undefined;
  today: string;
}) {
  const open = () => navigate({ name: 'trainee', id: person.id, tab: 'overview' });
  const name = personLabel(person);
  const ready = line?.state === 'ready' ? line.line : null;
  const volume = ready ? formatVolume(ready.volume28) : null;
  return (
    <tr
      className="clickable"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open();
      }}
      tabIndex={0}
    >
      <td>
        <div className="person">
          <Avatar name={name} />
          <div style={{ minWidth: 0 }}>
            <div className="person-name">{name}</div>
            <div className="person-sub" dir="ltr" style={{ textAlign: 'end' }}>
              {person.email}
            </div>
          </div>
        </div>
      </td>
      {ready ? (
        <>
          <td>
            {relativeDay(
              ready.lastWorkoutAt ? localDate(new Date(ready.lastWorkoutAt)) : null,
              today,
            )}
          </td>
          <td className="num">{formatNumber(ready.workouts7)}</td>
          <td className="num" title={volume ? `${volume.value} ${volume.unit}` : undefined}>
            {formatNumber(ready.workouts28)}
          </td>
          <td className="num">{formatPercent(ready.adherence14)}</td>
          <td className="num">{formatSignedPercent(ready.volumeTrend)}</td>
          <td>
            {ready.next ? (
              <span>
                {relativeDay(ready.next.date, today)}
                <span className="muted"> · {ready.next.names.join(', ')}</span>
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
          <td>
            <div className="chips">
              {ready.flags.map((flag) => (
                <FlagChip key={flag} flag={flag} />
              ))}
            </div>
          </td>
        </>
      ) : (
        <td colSpan={7} className="muted">
          {line?.state === 'failed' ? he.overview.failedTrainee : he.overview.loadingTrainee}
        </td>
      )}
      <td>
        <a
          href={hrefFor({ name: 'trainee', id: person.id, tab: 'overview' })}
          aria-label={name}
          className="icon-button"
        >
          <ArrowLeft size={18} aria-hidden />
        </a>
      </td>
    </tr>
  );
}

function AttentionCard({
  person,
  line,
  today,
}: {
  person: CoachingPerson;
  line: TraineeOverview;
  today: string;
}) {
  const name = personLabel(person);
  return (
    <a
      className="card"
      href={hrefFor({ name: 'trainee', id: person.id, tab: 'overview' })}
      style={{
        padding: 'var(--space-4)',
        gap: 'var(--space-3)',
        color: 'inherit',
        boxShadow: 'none',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="person">
        <Avatar name={name} />
        <div>
          <div className="person-name">{name}</div>
          <div className="person-sub">
            {he.overview.colLast}:{' '}
            {relativeDay(
              line.lastWorkoutAt ? localDate(new Date(line.lastWorkoutAt)) : null,
              today,
            )}
            {line.next ? ` · ${he.overview.colNext}: ${formatDayShort(line.next.date)}` : ''}
          </div>
        </div>
      </div>
      <div className="chips">
        {line.flags.map((flag) => (
          <FlagChip key={flag} flag={flag} />
        ))}
      </div>
      {line.stalling.length > 0 ? (
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {he.overview.stallingIn} {line.stalling.map(exerciseName).join(', ')}
        </p>
      ) : null}
    </a>
  );
}
