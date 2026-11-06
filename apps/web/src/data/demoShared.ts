/**
 * The demonstration's trainees beyond their training: what each chose to share, and made-up
 * weigh-ins, food logs, water and progress photos for whatever they did share.
 *
 * Each one tells a story the new tabs are there to show. Noa is cutting and on target, and the
 * photos show it. Yoav's bench press has stalled — and he eats well under his bulking target,
 * which is the answer. Shira only shares her weight, and weighs in rarely. Omer shares nothing,
 * which is what a coach sees most often at first. Michal logs food on about half her days.
 *
 * Deterministic, like the rest of the demonstration. The photos are drawn, not photographed: a
 * plain figure labelled as an example, whose outline follows the made-up weight.
 */

import type {
  CoachFoodEntry,
  CoachMeasurement,
  CoachNutrition,
  CoachPhoto,
  PhotoPose,
  SharedTargets,
  Sharing,
} from '@fit/shared/coaching';

import { addDays, daysApart, parseDay } from '../analytics/dates.js';

/** Mulberry32, as in demoData.ts: the same numbers for the same seed. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SharedSpec {
  sharing: Sharing;
  body?: {
    startKg: number;
    /** Kilograms per week; negative is losing. */
    weeklyKg: number;
    /** Weigh-ins a week, on average. */
    perWeek: number;
    /** A smart scale also reports body fat, from this, changing by `weeklyFat`. */
    startFat?: number;
    weeklyFat?: number;
  };
  nutrition?: {
    targets: SharedTargets;
    /** The share of days anything is logged. */
    logRate: number;
    /** How far from the target a logged day lands on average: -0.12 is 12% under. */
    bias: number;
    waterMl: number;
  };
  /** A progress photo every this many days. */
  photoEvery?: number;
}

const SPECS: Record<string, SharedSpec> = {
  'demo-noa': {
    sharing: { body: true, nutrition: true, photos: true },
    body: { startKg: 66.5, weeklyKg: -0.22, perWeek: 5, startFat: 28.5, weeklyFat: -0.14 },
    nutrition: {
      targets: { calorieTarget: 1750, proteinG: 125, carbsG: 180, fatG: 58, goal: 'cut' },
      logRate: 0.92,
      bias: -0.02,
      waterMl: 2700,
    },
    photoEvery: 14,
  },
  'demo-yoav': {
    sharing: { body: true, nutrition: true, photos: false },
    body: { startKg: 77, weeklyKg: 0.03, perWeek: 3 },
    nutrition: {
      targets: { calorieTarget: 3100, proteinG: 160, carbsG: 390, fatG: 95, goal: 'bulk' },
      logRate: 0.7,
      bias: -0.17,
      waterMl: 2100,
    },
  },
  'demo-shira': {
    sharing: { body: true, nutrition: false, photos: false },
    body: { startKg: 70.5, weeklyKg: 0.05, perWeek: 1.2 },
  },
  'demo-omer': {
    sharing: { body: false, nutrition: false, photos: false },
  },
  'demo-michal': {
    sharing: { body: false, nutrition: true, photos: true },
    nutrition: {
      targets: { calorieTarget: 2000, proteinG: 110, carbsG: 235, fatG: 66, goal: 'maintain' },
      logRate: 0.55,
      bias: 0.04,
      waterMl: 1800,
    },
    photoEvery: 21,
  },
};

export interface DemoShared {
  sharing: Sharing;
  measurements: CoachMeasurement[];
  nutrition: CoachNutrition;
  photos: CoachPhoto[];
  /** For drawing each demonstration photo: the made-up weight against the first. */
  photoShape: Record<string, number>;
}

/** Foods with their numbers per portion, in the order a day is eaten. */
interface Food {
  name: string;
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}
const food = (name: string, grams: number, calories: number, p: number, c: number, f: number) =>
  ({ name, grams, calories, proteinG: p, carbsG: c, fatG: f }) satisfies Food;

const MEALS: Food[][] = [
  [
    food('יוגורט עם גרנולה', 250, 320, 18, 40, 9),
    food('חביתה ולחם מלא', 200, 380, 22, 30, 18),
    food('שיבולת שועל עם בננה', 300, 350, 12, 62, 7),
  ],
  [
    food('חזה עוף עם אורז', 400, 620, 48, 70, 12),
    food('סלט טונה', 350, 450, 35, 20, 24),
    food('פסטה ברוטב עגבניות', 380, 580, 18, 95, 12),
  ],
  [
    food('סלמון עם בטטה', 380, 640, 40, 48, 28),
    food('שקשוקה', 350, 420, 24, 22, 26),
    food('קציצות ופירה', 400, 600, 34, 50, 26),
  ],
];
const SNACKS: Food[] = [
  food('תפוח', 180, 90, 0, 23, 0),
  food('חטיף חלבון', 60, 200, 20, 18, 7),
  food('שקדים', 30, 170, 6, 6, 15),
  food('קוטג׳ 5%', 200, 190, 22, 6, 9),
];

const round = (value: number, step = 1) => Math.round(value / step) * step;

/** How far back the food log goes: the longest period the nutrition tab offers. */
const FOOD_DAYS = 190;

export function buildShared(
  id: string,
  seed: number,
  startDay: string,
  today: string,
): DemoShared {
  const spec = SPECS[id] ?? { sharing: { body: false, nutrition: false, photos: false } };
  const random = generator(seed);
  const noise = (size: number) => (random() + random() + random() - 1.5) * (size / 1.5);

  /* ------------------------------------------------------------- weigh-ins */
  const measurements: CoachMeasurement[] = [];
  const weightOn = (day: string) => {
    const body = spec.body;
    if (!body) return null;
    return body.startKg + (body.weeklyKg * daysApart(startDay, day)) / 7;
  };
  if (spec.body) {
    const body = spec.body;
    for (let day = startDay; day <= today; day = addDays(day, 1)) {
      if (random() > body.perWeek / 7) continue;
      const at = parseDay(day);
      at.setHours(6 + Math.floor(random() * 3), Math.floor(random() * 60));
      const weeks = daysApart(startDay, day) / 7;
      measurements.push({
        measuredAt: at.toISOString(),
        weightKg: round(weightOn(day)! + noise(0.9), 0.1),
        bodyFatPct:
          body.startFat === undefined
            ? null
            : round(body.startFat + (body.weeklyFat ?? 0) * weeks + noise(0.6), 0.1),
        muscleMassKg: null,
        waterPct: null,
      });
    }
    measurements.reverse();
  }

  /* ------------------------------------------------------------- food and water */
  const entries: CoachFoodEntry[] = [];
  const water: { date: string; ml: number }[] = [];
  if (spec.nutrition) {
    const plan = spec.nutrition;
    const firstDay = addDays(today, -FOOD_DAYS) > startDay ? addDays(today, -FOOD_DAYS) : startDay;
    for (let day = firstDay; day <= today; day = addDays(day, 1)) {
      if (random() < plan.logRate) {
        const goal = plan.targets.calorieTarget * (1 + plan.bias + noise(0.2));
        // Today is still being eaten: breakfast only.
        const meals = day === today ? MEALS.slice(0, 1) : MEALS;
        const chosen = meals.map((options) => options[Math.floor(random() * options.length)]!);
        const base = chosen.reduce((sum, item) => sum + item.calories, 0);
        if (day !== today) {
          while (base + chosen.slice(3).reduce((s, i) => s + i.calories, 0) < goal * 0.8) {
            chosen.push(SNACKS[Math.floor(random() * SNACKS.length)]!);
            if (chosen.length > 7) break;
          }
        }
        const total = chosen.reduce((sum, item) => sum + item.calories, 0);
        const scale = day === today ? 1 : Math.min(1.6, Math.max(0.6, goal / total));
        for (const item of chosen) {
          entries.push({
            date: day,
            name: item.name,
            grams: round(item.grams * scale, 5),
            calories: round(item.calories * scale),
            proteinG: round(item.proteinG * scale),
            carbsG: round(item.carbsG * scale),
            fatG: round(item.fatG * scale),
          });
        }
      }
      if (random() < plan.logRate + 0.1) {
        const ml = round(plan.waterMl * (day === today ? 0.35 : 1) + noise(700), 50);
        if (ml > 0) water.push({ date: day, ml });
      }
    }
    entries.reverse();
  }

  /* ------------------------------------------------------------- photos */
  const photos: CoachPhoto[] = [];
  const photoShape: Record<string, number> = {};
  if (spec.photoEvery) {
    const poses: PhotoPose[] = ['front', 'side'];
    let index = 0;
    for (let day = startDay; day <= today; day = addDays(day, spec.photoEvery)) {
      const photoId = `${id}-photo-${index}`;
      photos.push({
        id: photoId,
        takenOn: day,
        pose: poses[index % poses.length]!,
        note: index === 0 ? 'תמונה ראשונה' : null,
      });
      const kg = weightOn(day);
      photoShape[photoId] = kg !== null && spec.body ? kg / spec.body.startKg : 1;
      index += 1;
    }
    photos.reverse();
  }

  return {
    sharing: spec.sharing,
    measurements,
    nutrition: { targets: spec.nutrition?.targets ?? null, entries, water },
    photos,
    photoShape,
  };
}

/**
 * A demonstration photo: a plain figure on a soft background, labelled as an example, wider or
 * narrower with the made-up weight. Never anybody's picture.
 */
export function demoPhotoUrl(photo: CoachPhoto, shape: number): string {
  const side = photo.pose === 'side';
  const w = (side ? 0.62 : 1) * shape;
  const torso = 70 * w;
  const waist = 52 * w * shape;
  const hips = 64 * w;
  const cx = 150;
  const body = [
    `M${cx - torso},150`,
    `C${cx - torso - 6},200 ${cx - waist},230 ${cx - waist},260`,
    `C${cx - waist},290 ${cx - hips},310 ${cx - hips},340`,
    `L${cx - hips + 8},400 L${cx + hips - 8},400 L${cx + hips},340`,
    `C${cx + hips},310 ${cx + waist},290 ${cx + waist},260`,
    `C${cx + waist},230 ${cx + torso + 6},200 ${cx + torso},150`,
    `Q${cx},120 ${cx - torso},150 Z`,
  ].join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EDE7FB"/><stop offset="1" stop-color="#D9CEF6"/></linearGradient></defs>
<rect width="300" height="400" fill="url(#g)"/>
<circle cx="${cx}" cy="92" r="34" fill="#9C86DE"/>
<path d="${body}" fill="#9C86DE"/>
<rect x="0" y="362" width="300" height="38" fill="#ffffff" fill-opacity="0.72"/>
<text x="150" y="387" font-family="Rubik, Arial, sans-serif" font-size="16" fill="#4B3A8C" text-anchor="middle" direction="rtl">תמונה לדוגמה</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
