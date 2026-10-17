/**
 * The demonstration: the dashboard's every screen, over made-up trainees held in memory.
 *
 * It answers as the server would, including after a change — plan a workout on the calendar
 * and it is there on the next read — but nothing leaves the page and nothing outlives it. A
 * reload starts the demonstration again from the beginning.
 */

import type {
  AppointedCoach,
  CoachCalendar,
  CoachingResult,
  CoachPlan,
} from '@fit/shared/coaching';

import { localDate } from '../analytics/dates.js';
import { buildDemo, type DemoTrainee } from './demoData.js';
import { demoPhotoUrl } from './demoShared.js';
import type { CoachData } from './source.js';

const ok = <T>(value: T): CoachingResult<T> => ({ ok: true, value });
const done = ok(undefined);

/** A short pause, so the demonstration shows the loading states the real thing has. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 180));

export function demoSource(today: string = localDate(new Date())): CoachData {
  const trainees = buildDemo(today);
  const find = (id: string): DemoTrainee | undefined =>
    trainees.find((trainee) => trainee.person.id === id);
  const gone = { ok: false, error: 'not_your_trainee' } as const;
  const notShared = { ok: false, error: 'not_shared' } as const;

  const coaches: AppointedCoach[] = [
    {
      id: 'demo-coach',
      email: 'coach@example.com',
      name: 'המאמן לדוגמה',
      code: 'DEMO42',
      trainees: trainees.length,
    },
  ];

  return {
    mode: 'demo',

    async status() {
      await pause();
      return ok({
        role: 'coach' as const,
        code: 'DEMO42',
        isAdmin: true,
        coach: null,
        trainees: trainees.map((trainee) => trainee.person),
      });
    },

    async sessions(traineeId, from, to) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      const start = from.toISOString();
      const end = to.toISOString();
      return ok(trainee.sessions.filter((s) => s.startedAt >= start && s.startedAt < end));
    },

    async schedule(traineeId, from, to) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      const slice: CoachCalendar = new Map();
      for (const [date, value] of trainee.calendar) {
        if (date >= from && date <= to) slice.set(date, value === null ? null : [...value]);
      }
      return ok(slice);
    },

    async plans(traineeId) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      // A copy: what the page edits is not the demonstration's own until it is saved.
      return ok(structuredClone(trainee.plans));
    },

    async body(traineeId, from, to) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      if (!trainee.person.sharing.body) return notShared;
      const start = from.toISOString();
      const end = to.toISOString();
      return ok(
        trainee.shared.measurements.filter((m) => m.measuredAt >= start && m.measuredAt <= end),
      );
    },

    async nutrition(traineeId, from, to) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      if (!trainee.person.sharing.nutrition) return notShared;
      const { targets, entries, water } = trainee.shared.nutrition;
      return ok({
        targets,
        entries: entries.filter((e) => e.date >= from && e.date <= to),
        water: water.filter((w) => w.date >= from && w.date <= to),
      });
    },

    async photos(traineeId) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      if (!trainee.person.sharing.photos) return notShared;
      return ok([...trainee.shared.photos]);
    },

    async photoUrls(traineeId, photoIds) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee?.person.sharing.photos) return {};
      const urls: Record<string, string> = {};
      for (const photo of trainee.shared.photos) {
        if (photoIds.includes(photo.id)) {
          urls[photo.id] = demoPhotoUrl(photo, trainee.shared.photoShape[photo.id] ?? 1);
        }
      }
      return urls;
    },

    async setSchedule(traineeId, date, planDayIds, rest) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      if (planDayIds.length > 0) trainee.calendar.set(date, [...planDayIds]);
      else if (rest) trainee.calendar.set(date, null);
      else trainee.calendar.delete(date);
      return done;
    },

    async savePlan(traineeId, planId, name) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      const existing = trainee.plans.find((plan) => plan.id === planId);
      if (existing) existing.name = name.trim();
      else {
        const plan: CoachPlan = {
          id: planId,
          name: name.trim(),
          isActive: trainee.plans.length === 0,
          days: [],
        };
        trainee.plans.push(plan);
      }
      return done;
    },

    async saveDay(traineeId, planId, day) {
      await pause();
      const trainee = find(traineeId);
      const plan = trainee?.plans.find((p) => p.id === planId);
      if (!trainee || !plan) return { ok: false, error: 'gone' };
      const index = plan.days.findIndex((d) => d.id === day.id);
      const copy = structuredClone(day);
      if (index >= 0) plan.days[index] = copy;
      else plan.days.push(copy);
      return done;
    },

    async deletePlan(traineeId, planId) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      trainee.plans = trainee.plans.filter((plan) => plan.id !== planId);
      return done;
    },

    async deleteDay(traineeId, dayId) {
      await pause();
      const trainee = find(traineeId);
      if (!trainee) return gone;
      for (const plan of trainee.plans) plan.days = plan.days.filter((day) => day.id !== dayId);
      for (const [date, value] of trainee.calendar) {
        if (Array.isArray(value) && value.includes(dayId)) {
          const left = value.filter((id) => id !== dayId);
          if (left.length > 0) trainee.calendar.set(date, left);
          else trainee.calendar.delete(date);
        }
      }
      return done;
    },

    async removeTrainee(traineeId) {
      await pause();
      const index = trainees.findIndex((trainee) => trainee.person.id === traineeId);
      if (index >= 0) trainees.splice(index, 1);
      return done;
    },

    async coaches() {
      await pause();
      return ok(coaches.map((coach) => ({ ...coach, trainees: trainees.length })));
    },

    async setCoach(email, on) {
      await pause();
      const trimmed = email.trim().toLowerCase();
      const at = coaches.findIndex((coach) => coach.email === trimmed);
      if (on && at < 0) {
        coaches.push({
          id: `demo-coach-${coaches.length + 1}`,
          email: trimmed,
          name: null,
          code: 'NEW' + String(coaches.length + 1).padStart(3, '0'),
          trainees: 0,
        });
      }
      if (!on && at >= 0) coaches.splice(at, 1);
      return ok(coaches.map((coach) => ({ ...coach })));
    },
  };
}
