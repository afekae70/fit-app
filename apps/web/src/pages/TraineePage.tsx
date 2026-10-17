/**
 * One trainee: who they are, and four views of their training — an overview with the charts,
 * the workouts they did, their plans, and their calendar.
 *
 * Everything is loaded once, when the page opens: a year and a half of workouts (so that a
 * record in the last year can be measured against what came before it), the calendar from a
 * year back to six weeks ahead, and the plans. The tabs and the period filter then work on that
 * without asking the server again; a change to the plans or the calendar reloads only what it
 * changed.
 */

import {
  ArrowRight,
  Camera,
  ForkKnife,
  Scales,
  ShieldCheck,
  UserMinus,
} from '@phosphor-icons/react';
import { personLabel, type Sharing } from '@fit/shared/coaching';
import { useEffect, useRef, useState } from 'react';

import { addDays, localDate, parseDay, rangeStart } from '../analytics/dates.js';
import { useCoach } from '../coachContext.js';
import { DemoBar } from '../components/DemoBar.js';
import { Avatar, Button, Card, Dialog, ErrorBanner, Loading } from '../components/ui.js';
import { fill, he } from '../i18n/he.js';
import { formatDayLong } from '../lib/format.js';
import { hrefFor, navigate, type TraineeTab } from '../lib/router.js';
import { useLoad } from '../lib/useLoad.js';
import { TraineeBody } from './trainee/TraineeBody.js';
import { TraineeCalendar } from './trainee/TraineeCalendar.js';
import { TraineeNutrition } from './trainee/TraineeNutrition.js';
import { TraineeOverview } from './trainee/TraineeOverview.js';
import { TraineePhotos } from './trainee/TraineePhotos.js';
import { TraineePlans } from './trainee/TraineePlans.js';
import { TraineeWorkouts } from './trainee/TraineeWorkouts.js';

const TABS: { tab: TraineeTab; label: string }[] = [
  { tab: 'overview', label: he.trainee.tabOverview },
  { tab: 'workouts', label: he.trainee.tabWorkouts },
  { tab: 'plans', label: he.trainee.tabPlans },
  { tab: 'calendar', label: he.trainee.tabCalendar },
  { tab: 'body', label: he.trainee.tabBody },
  { tab: 'nutrition', label: he.trainee.tabNutrition },
  { tab: 'photos', label: he.trainee.tabPhotos },
];

/** The tabs that are about what a trainee chooses to share, and the switch each needs. */
const SHARED_TAB: Partial<Record<TraineeTab, keyof Sharing>> = {
  body: 'body',
  nutrition: 'nutrition',
  photos: 'photos',
};

/** How far back workouts are read: the longest period, and half a year before it for records. */
const HISTORY_WEEKS = 78;

export function TraineePage({ traineeId, tab }: { traineeId: string; tab: TraineeTab }) {
  const { source, status, today, refreshStatus } = useCoach();
  const person = status.trainees.find((candidate) => candidate.id === traineeId);
  const [removing, setRemoving] = useState(false);
  const tabStrip = useRef<HTMLElement>(null);

  // Seven tabs do not fit a phone's width: the strip scrolls, and the open one is brought into it.
  useEffect(() => {
    tabStrip.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const historyFrom = addDays(today, -7 * HISTORY_WEEKS);
  const calendarFrom = rangeStart('52w', today);
  const calendarTo = addDays(today, 42);

  const sessions = useLoad(
    () => source.sessions(traineeId, parseDay(historyFrom), parseDay(addDays(today, 1))),
    [source, traineeId, historyFrom, today],
  );
  const calendar = useLoad(
    () => source.schedule(traineeId, calendarFrom, calendarTo),
    [source, traineeId, calendarFrom, calendarTo],
  );
  const plans = useLoad(() => source.plans(traineeId), [source, traineeId]);

  if (!person) {
    return (
      <div className="page">
        <a className="button ghost small" href={hrefFor({ name: 'overview' })}>
          <ArrowRight size={16} aria-hidden /> {he.trainee.back}
        </a>
        <ErrorBanner error="not_your_trainee" />
      </div>
    );
  }

  const name = personLabel(person);
  const remove = () => {
    void source.removeTrainee(traineeId).then(async (answer) => {
      setRemoving(false);
      if (answer.ok) {
        await refreshStatus();
        navigate({ name: 'overview' });
      }
    });
  };

  const failed = [sessions, calendar, plans].find((load) => load.state === 'failed');

  return (
    <div className="page">
      <DemoBar />
      <a
        className="button ghost small"
        href={hrefFor({ name: 'overview' })}
        style={{ alignSelf: 'flex-start' }}
      >
        <ArrowRight size={16} aria-hidden /> {he.trainee.back}
      </a>

      <header className="page-head">
        <div className="person">
          <Avatar name={name} large />
          <div>
            <h1 className="page-title">{name}</h1>
            <p className="page-sub">
              <span dir="ltr">{person.email}</span>
              {person.since
                ? ` · ${fill(he.trainee.since, { date: formatDayLong(localDate(new Date(person.since))) })}`
                : ''}
            </p>
            <SharingLine sharing={person.sharing} />
          </div>
        </div>
        <Button variant="ghost" small onClick={() => setRemoving(true)}>
          <UserMinus size={16} aria-hidden /> {he.trainee.remove}
        </Button>
      </header>

      <nav className="tabs" aria-label={name} ref={tabStrip}>
        {TABS.map((entry) => {
          const needs = SHARED_TAB[entry.tab];
          return (
            <a
              key={entry.tab}
              className={`tab${needs && !person.sharing[needs] ? ' tab-closed' : ''}`}
              href={hrefFor({ name: 'trainee', id: traineeId, tab: entry.tab })}
              aria-current={entry.tab === tab ? 'page' : undefined}
            >
              {entry.label}
            </a>
          );
        })}
      </nav>

      {tab === 'body' || tab === 'nutrition' || tab === 'photos' ? (
        // Loaded by the tab itself, and only when shared: the workouts below are not needed.
        tab === 'body' ? (
          <TraineeBody traineeId={traineeId} shared={person.sharing.body} />
        ) : tab === 'nutrition' ? (
          <TraineeNutrition traineeId={traineeId} shared={person.sharing.nutrition} />
        ) : (
          <TraineePhotos traineeId={traineeId} shared={person.sharing.photos} />
        )
      ) : failed && failed.state === 'failed' ? (
        <ErrorBanner
          error={failed.error}
          onRetry={() => {
            sessions.reload();
            calendar.reload();
            plans.reload();
          }}
        />
      ) : sessions.state !== 'ready' || calendar.state !== 'ready' || plans.state !== 'ready' ? (
        <Loading />
      ) : tab === 'overview' ? (
        <TraineeOverview sessions={sessions.value} calendar={calendar.value} plans={plans.value} />
      ) : tab === 'workouts' ? (
        <TraineeWorkouts sessions={sessions.value} plans={plans.value} />
      ) : tab === 'plans' ? (
        <TraineePlans traineeId={traineeId} plans={plans.value} onChanged={plans.reload} />
      ) : (
        <TraineeCalendar
          traineeId={traineeId}
          sessions={sessions.value}
          calendar={calendar.value}
          plans={plans.value}
          onChanged={calendar.reload}
        />
      )}

      <Card>
        <p className="muted" style={{ display: 'flex', gap: 8, fontSize: 'var(--text-xs)' }}>
          <ShieldCheck size={16} weight="duotone" aria-hidden style={{ flex: '0 0 auto' }} />
          {he.trainee.privacy}
        </p>
      </Card>

      {removing ? (
        <Dialog
          title={fill(he.trainee.removeTitle, { name })}
          onClose={() => setRemoving(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setRemoving(false)}>
                {he.plans.cancel}
              </Button>
              <Button variant="danger" onClick={remove}>
                {he.trainee.remove}
              </Button>
            </>
          }
        >
          <p>{he.trainee.removeBody}</p>
        </Dialog>
      ) : null}
    </div>
  );
}

/** What this trainee shares beyond training, in words and icons — never colour alone. */
function SharingLine({ sharing }: { sharing: Sharing }) {
  const shared = (
    [
      ['body', Scales, he.sharing.body],
      ['nutrition', ForkKnife, he.sharing.nutrition],
      ['photos', Camera, he.sharing.photos],
    ] as const
  ).filter(([key]) => sharing[key]);
  return (
    <p className="shares">
      <span>{he.sharing.label}:</span>
      {shared.length === 0 ? (
        <span>{he.sharing.nothing}</span>
      ) : (
        shared.map(([key, IconComponent, label]) => (
          <span className="flag neutral" key={key}>
            <IconComponent size={12} weight="bold" aria-hidden />
            {label}
          </span>
        ))
      )}
    </p>
  );
}
