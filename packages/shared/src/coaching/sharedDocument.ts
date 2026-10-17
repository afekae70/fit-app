/**
 * What a trainee may choose to share with their coach beyond their training, and the shape it
 * arrives in (apps/api/drizzle/0018).
 *
 * Three switches, each off until the trainee turns it on, each on the link to one coach:
 * weigh-ins (`body`), the food log with water and the app's daily targets (`nutrition`), and
 * progress photos (`photos`). The readers below are as forgiving as the others in this folder:
 * a field missing or of the wrong type is left out, never a crash.
 */

export interface Sharing {
  body: boolean;
  nutrition: boolean;
  photos: boolean;
}

export const NOTHING_SHARED: Sharing = { body: false, nutrition: false, photos: false };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A number from JSON, where Postgres `numeric` may arrive as text. Null for anything else. */
const asNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export function parseSharing(raw: unknown): Sharing {
  const sharing = asRecord(raw);
  return {
    body: sharing?.body === true,
    nutrition: sharing?.nutrition === true,
    photos: sharing?.photos === true,
  };
}

/* -------------------------------------------------------------------------- */
/* Body                                                                         */
/* -------------------------------------------------------------------------- */

export interface CoachMeasurement {
  /** The moment it was taken, ISO. */
  measuredAt: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  waterPct: number | null;
}

/** `coach_get_body`'s answer, newest first. A row with no moment, or no reading at all, is left out. */
export function parseMeasurements(raw: unknown): CoachMeasurement[] {
  if (!Array.isArray(raw)) return [];
  const rows: CoachMeasurement[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    const measuredAt = asText(row?.measured_at);
    if (!row || !measuredAt || Number.isNaN(Date.parse(measuredAt))) continue;
    const measurement: CoachMeasurement = {
      measuredAt,
      weightKg: asNumber(row.weight_kg),
      bodyFatPct: asNumber(row.body_fat_pct),
      muscleMassKg: asNumber(row.muscle_mass_kg),
      waterPct: asNumber(row.water_pct),
    };
    if (
      measurement.weightKg === null &&
      measurement.bodyFatPct === null &&
      measurement.muscleMassKg === null
    ) {
      continue;
    }
    rows.push(measurement);
  }
  return rows.sort((a, b) =>
    a.measuredAt < b.measuredAt ? 1 : a.measuredAt > b.measuredAt ? -1 : 0,
  );
}

/* -------------------------------------------------------------------------- */
/* Nutrition                                                                    */
/* -------------------------------------------------------------------------- */

export interface SharedTargets {
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  goal: 'cut' | 'maintain' | 'bulk' | null;
}

export interface CoachFoodEntry {
  /** Local day, `YYYY-MM-DD`. */
  date: string;
  name: string;
  grams: number | null;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface CoachNutrition {
  /** The app's own daily targets, as last sent; null when it has sent none. */
  targets: SharedTargets | null;
  entries: CoachFoodEntry[];
  /** Millilitres per day, oldest first; days with none are absent. */
  water: { date: string; ml: number }[];
}

const isDay = (value: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function parseTargets(raw: unknown): SharedTargets | null {
  const targets = asRecord(raw);
  if (!targets) return null;
  const calorieTarget = asNumber(targets.calorieTarget);
  const proteinG = asNumber(targets.proteinG);
  const carbsG = asNumber(targets.carbsG);
  const fatG = asNumber(targets.fatG);
  if (calorieTarget === null || proteinG === null || carbsG === null || fatG === null) return null;
  const goal = targets.goal;
  return {
    calorieTarget,
    proteinG,
    carbsG,
    fatG,
    goal: goal === 'cut' || goal === 'maintain' || goal === 'bulk' ? goal : null,
  };
}

/** `coach_get_nutrition`'s answer. */
export function parseNutrition(raw: unknown): CoachNutrition {
  const answer = asRecord(raw) ?? {};
  const entries: CoachFoodEntry[] = [];
  for (const item of Array.isArray(answer.entries) ? answer.entries : []) {
    const row = asRecord(item);
    const date = asText(row?.date);
    const name = asText(row?.name);
    const calories = asNumber(row?.calories);
    if (!row || !isDay(date) || !name || calories === null) continue;
    entries.push({
      date,
      name,
      grams: asNumber(row.grams),
      calories,
      proteinG: asNumber(row.protein_g),
      carbsG: asNumber(row.carbs_g),
      fatG: asNumber(row.fat_g),
    });
  }
  const water: { date: string; ml: number }[] = [];
  for (const item of Array.isArray(answer.water) ? answer.water : []) {
    const row = asRecord(item);
    const date = asText(row?.date);
    const ml = asNumber(row?.ml);
    if (isDay(date) && ml !== null && ml >= 0) water.push({ date, ml });
  }
  water.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { targets: parseTargets(answer.targets), entries, water };
}

/* -------------------------------------------------------------------------- */
/* Photos                                                                       */
/* -------------------------------------------------------------------------- */

export type PhotoPose = 'front' | 'side' | 'back';

export interface CoachPhoto {
  id: string;
  /** Local day, `YYYY-MM-DD`. */
  takenOn: string;
  pose: PhotoPose | null;
  note: string | null;
}

export const PHOTO_BUCKET = 'progress-photos';

/** Where a photo's file is, in the bucket: one folder per account, the photo's id as its name. */
export function photoObjectPath(ownerId: string, photoId: string): string {
  return `${ownerId}/${photoId}.jpg`;
}

export function parsePhotos(raw: unknown): CoachPhoto[] {
  if (!Array.isArray(raw)) return [];
  const photos: CoachPhoto[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    const id = asText(row?.id);
    const takenOn = asText(row?.taken_on);
    if (!row || !id || !isDay(takenOn)) continue;
    const pose = row.pose;
    photos.push({
      id,
      takenOn,
      pose: pose === 'front' || pose === 'side' || pose === 'back' ? pose : null,
      note: asText(row.note),
    });
  }
  return photos;
}
