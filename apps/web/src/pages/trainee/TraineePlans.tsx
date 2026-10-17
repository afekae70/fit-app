/**
 * The trainee's plans, and the coach's way of changing them.
 *
 * The same edits the app's coach screens make, through the same server functions — a group
 * created or renamed (`coach_save_plan`), a workout written whole (`coach_save_day`), either one
 * deleted (`coach_delete`) — so what a coach does here reaches the trainee's phone on its next
 * sync exactly as it would from the coach's own phone.
 *
 * A workout is edited in a dialog and saved whole, as the server takes it. Nothing is written
 * until Save, and Save is offered only once something has changed.
 */

import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  ListPlus,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import {
  addExercise,
  describeTargets,
  moveExercise,
  newExercise,
  removeExercise,
  replaceExercise,
  REPS,
  sameDay,
  SETS,
  type CoachDay,
  type CoachExercise,
  type CoachingError,
  type CoachPlan,
} from '@fit/shared/coaching';
import { useMemo, useState } from 'react';

import { exerciseName } from '../../analytics/lifts.js';
import { searchExercises } from '../../lib/exerciseSearch.js';
import { useCoach } from '../../coachContext.js';
import { Button, Card, Dialog, EmptyState, ErrorBanner } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';

const newId = () => crypto.randomUUID();

type Editing =
  | { kind: 'day'; planId: string; original: CoachDay; draft: CoachDay }
  | { kind: 'plan'; planId: string; name: string; isNew: boolean }
  | { kind: 'delete'; what: 'plan' | 'day'; id: string; name: string };

export function TraineePlans({
  traineeId,
  plans,
  onChanged,
}: {
  traineeId: string;
  plans: readonly CoachPlan[];
  onChanged: () => void;
}) {
  const { source } = useCoach();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CoachingError | null>(null);

  const finish = async (work: () => Promise<{ ok: boolean; error?: CoachingError }>) => {
    setSaving(true);
    setError(null);
    const answer = await work();
    setSaving(false);
    if (answer.ok) {
      setEditing(null);
      onChanged();
    } else {
      setError(answer.error ?? 'failed');
    }
  };

  const save = () => {
    if (!editing) return;
    if (editing.kind === 'day') {
      void finish(() => source.saveDay(traineeId, editing.planId, editing.draft));
    } else if (editing.kind === 'plan') {
      const name = editing.name.trim();
      if (name) void finish(() => source.savePlan(traineeId, editing.planId, name));
    } else {
      void finish(() =>
        editing.what === 'plan'
          ? source.deletePlan(traineeId, editing.id)
          : source.deleteDay(traineeId, editing.id),
      );
    }
  };

  const open = (next: Editing) => {
    setError(null);
    setEditing(next);
  };

  return (
    <>
      <Card
        title={he.plans.title}
        sub={he.plans.sub}
        action={
          <Button onClick={() => open({ kind: 'plan', planId: newId(), name: '', isNew: true })}>
            <Plus size={16} aria-hidden /> {he.plans.newPlan}
          </Button>
        }
      >
        {plans.length === 0 ? <EmptyState icon={ListPlus} title={he.plans.none} /> : null}
      </Card>

      {plans.map((plan) => (
        <Card
          key={plan.id}
          title={plan.name}
          action={
            <div className="chips">
              {plan.isActive ? (
                <span className="flag ok">
                  <CheckCircle size={12} weight="bold" aria-hidden /> {he.plans.active}
                </span>
              ) : null}
              <Button
                small
                variant="ghost"
                onClick={() =>
                  open({ kind: 'plan', planId: plan.id, name: plan.name, isNew: false })
                }
              >
                {he.plans.rename}
              </Button>
              <Button
                small
                variant="ghost"
                onClick={() => open({ kind: 'delete', what: 'plan', id: plan.id, name: plan.name })}
              >
                <Trash size={14} aria-hidden /> {he.plans.deletePlan}
              </Button>
              <Button
                small
                onClick={() => {
                  const day: CoachDay = {
                    id: newId(),
                    name: '',
                    exercises: [],
                    workSeconds: null,
                    restSeconds: null,
                    rounds: null,
                  };
                  open({ kind: 'day', planId: plan.id, original: day, draft: day });
                }}
              >
                <Plus size={14} aria-hidden /> {he.plans.newDay}
              </Button>
            </div>
          }
        >
          <div className="grid grid-2">
            {plan.days.map((day, index) => (
              <div className="plan-day" key={day.id}>
                <div className="plan-day-head">
                  <span className="plan-day-name">
                    {day.name?.trim() || `${plan.name} ${index + 1}`}
                  </span>
                  <span className="chips">
                    <Button
                      small
                      variant="ghost"
                      onClick={() =>
                        open({ kind: 'day', planId: plan.id, original: day, draft: day })
                      }
                    >
                      <NotePencil size={14} aria-hidden /> {he.plans.editDay}
                    </Button>
                    <button
                      type="button"
                      className="icon-button"
                      title={he.plans.deleteDay}
                      aria-label={he.plans.deleteDay}
                      onClick={() =>
                        open({
                          kind: 'delete',
                          what: 'day',
                          id: day.id,
                          name: day.name?.trim() || `${plan.name} ${index + 1}`,
                        })
                      }
                    >
                      <Trash size={16} />
                    </button>
                  </span>
                </div>
                {day.exercises.length === 0 ? (
                  <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                    {he.plans.noExercises}
                  </p>
                ) : (
                  <div>
                    {day.exercises.map((exercise, position) => (
                      <div className="exercise-row" key={exercise.id}>
                        <span className="exercise-index">{position + 1}</span>
                        <span style={{ minWidth: 0 }}>
                          <div>{exerciseName(exercise.exerciseKey)}</div>
                          {exercise.notes ? (
                            <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                              {exercise.notes}
                            </div>
                          ) : null}
                        </span>
                        <span className="targets" dir="ltr">
                          {describeTargets(exercise)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      {editing?.kind === 'plan' ? (
        <Dialog
          title={editing.isNew ? he.plans.newPlan : he.plans.rename}
          onClose={() => setEditing(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {he.plans.cancel}
              </Button>
              <Button
                variant="primary"
                onClick={save}
                disabled={saving || editing.name.trim() === ''}
              >
                {saving ? he.plans.saving : he.plans.save}
              </Button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="plan-name">{he.plans.newPlanName}</label>
            <input
              id="plan-name"
              className="input"
              value={editing.name}
              maxLength={80}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
              }}
            />
          </div>
          {error ? <ErrorBanner error={error} /> : null}
        </Dialog>
      ) : null}

      {editing?.kind === 'delete' ? (
        <Dialog
          title={fill(
            editing.what === 'plan' ? he.plans.deletePlanTitle : he.plans.deleteDayTitle,
            {
              name: editing.name,
            },
          )}
          onClose={() => setEditing(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {he.plans.cancel}
              </Button>
              <Button variant="danger" onClick={save} disabled={saving}>
                <Trash size={16} aria-hidden />
                {editing.what === 'plan' ? he.plans.deletePlan : he.plans.deleteDay}
              </Button>
            </>
          }
        >
          <p>{he.plans.deleteBody}</p>
          {error ? <ErrorBanner error={error} /> : null}
        </Dialog>
      ) : null}

      {editing?.kind === 'day' ? (
        <DayEditor
          draft={editing.draft}
          changed={!sameDay(editing.original, editing.draft)}
          saving={saving}
          error={error}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function DayEditor({
  draft,
  changed,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  draft: CoachDay;
  changed: boolean;
  saving: boolean;
  error: CoachingError | null;
  onChange: (day: CoachDay) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchExercises(query), [query]);

  const update = (exercise: CoachExercise) => onChange(replaceExercise(draft, exercise));

  return (
    <Dialog
      title={draft.name?.trim() || he.plans.newDay}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {he.plans.cancel}
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving || !changed}>
            {saving ? he.plans.saving : he.plans.save}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="day-name">{he.plans.dayName}</label>
        <input
          id="day-name"
          className="input"
          value={draft.name ?? ''}
          maxLength={60}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>

      {draft.exercises.map((exercise, index) => (
        <div className="plan-day" key={exercise.id} style={{ padding: 'var(--space-3)' }}>
          <div className="plan-day-head">
            <span className="plan-day-name">
              {index + 1}. {exerciseName(exercise.exerciseKey)}
            </span>
            <span className="chips">
              <button
                type="button"
                className="icon-button"
                aria-label={he.plans.moveUp}
                title={he.plans.moveUp}
                disabled={index === 0}
                onClick={() => onChange(moveExercise(draft, exercise.id, -1))}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={he.plans.moveDown}
                title={he.plans.moveDown}
                disabled={index === draft.exercises.length - 1}
                onClick={() => onChange(moveExercise(draft, exercise.id, 1))}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={he.plans.removeExercise}
                title={he.plans.removeExercise}
                onClick={() => onChange(removeExercise(draft, exercise.id))}
              >
                <Trash size={16} />
              </button>
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <NumberField
              label={he.plans.setsLabel}
              value={exercise.targetSets}
              limits={SETS}
              onChange={(value) => update({ ...exercise, targetSets: value })}
            />
            <NumberField
              label={he.plans.repsMinLabel}
              value={exercise.targetRepsMin}
              limits={REPS}
              onChange={(value) =>
                update({
                  ...exercise,
                  targetRepsMin: value,
                  // A range stays a range: the top comes up with the bottom.
                  targetRepsMax:
                    value !== null &&
                    exercise.targetRepsMax !== null &&
                    exercise.targetRepsMax < value
                      ? value
                      : exercise.targetRepsMax,
                })
              }
            />
            <NumberField
              label={he.plans.repsMaxLabel}
              value={exercise.targetRepsMax}
              limits={REPS}
              onChange={(value) =>
                update({
                  ...exercise,
                  targetRepsMax: value,
                  targetRepsMin:
                    value !== null &&
                    exercise.targetRepsMin !== null &&
                    exercise.targetRepsMin > value
                      ? value
                      : exercise.targetRepsMin,
                })
              }
            />
          </div>
          <input
            className="input"
            placeholder={he.plans.notesLabel}
            aria-label={he.plans.notesLabel}
            value={exercise.notes ?? ''}
            maxLength={200}
            onChange={(event) => update({ ...exercise, notes: event.target.value || null })}
          />
        </div>
      ))}

      <div className="field">
        <label htmlFor="exercise-search">{he.plans.addExercise}</label>
        <div style={{ position: 'relative' }}>
          <input
            id="exercise-search"
            className="input"
            style={{ width: '100%', paddingInlineStart: 40 }}
            placeholder={he.plans.searchExercise}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <MagnifyingGlass
            size={18}
            aria-hidden
            style={{
              position: 'absolute',
              insetInlineStart: 12,
              top: 13,
              color: 'var(--text-muted)',
            }}
          />
        </div>
        {query.trim() !== '' ? (
          matches.length === 0 ? (
            <p className="muted">{he.plans.noMatch}</p>
          ) : (
            <div className="chips" style={{ marginBlockStart: 'var(--space-2)' }}>
              {matches.map((seed) => (
                <button
                  key={seed.nameEn}
                  type="button"
                  className="chip"
                  onClick={() => {
                    onChange(addExercise(draft, newExercise(newId(), seed.nameEn)));
                    setQuery('');
                  }}
                >
                  <Plus size={12} aria-hidden /> {seed.nameHe}
                </button>
              ))}
            </div>
          )
        ) : null}
      </div>

      {error ? <ErrorBanner error={error} /> : null}
    </Dialog>
  );
}

function NumberField({
  label,
  value,
  limits,
  onChange,
}: {
  label: string;
  value: number | null;
  limits: { min: number; max: number };
  onChange: (value: number | null) => void;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {label}
      <input
        className="number-input"
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        value={value ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const parsed = Math.round(Number(raw));
          if (Number.isFinite(parsed)) onChange(Math.max(limits.min, Math.min(limits.max, parsed)));
        }}
      />
    </label>
  );
}
