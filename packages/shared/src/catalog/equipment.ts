/**
 * Global equipment catalogue.
 *
 * `slug` is the stable identifier — seeds are idempotent on it, so re-running the seed
 * updates names rather than creating duplicates. Never change a slug once shipped; a
 * location's equipment list references these rows.
 *
 * Hebrew names are included because the app is Hebrew-first.
 */

export interface EquipmentSeed {
  slug: string;
  nameEn: string;
  nameHe: string;
}

export const EQUIPMENT_SEED: readonly EquipmentSeed[] = [
  // Free weights
  { slug: 'barbell', nameEn: 'Barbell', nameHe: 'מוט' },
  { slug: 'dumbbell', nameEn: 'Dumbbell', nameHe: 'משקולת יד' },
  { slug: 'kettlebell', nameEn: 'Kettlebell', nameHe: 'קטלבל' },
  { slug: 'ez_bar', nameEn: 'EZ Bar', nameHe: 'מוט EZ' },
  { slug: 'trap_bar', nameEn: 'Trap Bar', nameHe: 'מוט טראפ' },
  { slug: 'weight_plate', nameEn: 'Weight Plate', nameHe: 'צלחת משקל' },

  // Benches and racks
  { slug: 'flat_bench', nameEn: 'Flat Bench', nameHe: 'ספסל שטוח' },
  { slug: 'adjustable_bench', nameEn: 'Adjustable Bench', nameHe: 'ספסל מתכוונן' },
  { slug: 'squat_rack', nameEn: 'Squat Rack', nameHe: 'כלוב סקוואט' },
  { slug: 'power_cage', nameEn: 'Power Cage', nameHe: 'כלוב כוח' },
  { slug: 'preacher_bench', nameEn: 'Preacher Bench', nameHe: 'כיסא כומר' },

  // Cables and machines
  { slug: 'cable_machine', nameEn: 'Cable Machine', nameHe: 'מכונת כבלים' },
  { slug: 'lat_pulldown', nameEn: 'Lat Pulldown Machine', nameHe: 'מכונת מותחים' },
  { slug: 'seated_row_machine', nameEn: 'Seated Row Machine', nameHe: 'מכונת חתירה בישיבה' },
  { slug: 'chest_press_machine', nameEn: 'Chest Press Machine', nameHe: 'מכונת לחיצת חזה' },
  { slug: 'shoulder_press_machine', nameEn: 'Shoulder Press Machine', nameHe: 'מכונת לחיצת כתפיים' },
  { slug: 'pec_deck', nameEn: 'Pec Deck', nameHe: 'מכונת פרפר' },
  { slug: 'leg_press', nameEn: 'Leg Press', nameHe: 'מכונת לחיצת רגליים' },
  { slug: 'leg_extension', nameEn: 'Leg Extension Machine', nameHe: 'מכונת פשיטת רגליים' },
  { slug: 'leg_curl', nameEn: 'Leg Curl Machine', nameHe: 'מכונת כפיפת רגליים' },
  { slug: 'calf_raise_machine', nameEn: 'Calf Raise Machine', nameHe: 'מכונת שוקיים' },
  { slug: 'hack_squat', nameEn: 'Hack Squat Machine', nameHe: 'מכונת האק סקוואט' },
  { slug: 'smith_machine', nameEn: 'Smith Machine', nameHe: 'מכונת סמית' },
  { slug: 'hip_thrust_machine', nameEn: 'Hip Thrust Machine', nameHe: 'מכונת היפ תראסט' },

  // Bodyweight — the equipment a military base actually has
  { slug: 'pullup_bar', nameEn: 'Pull-up Bar', nameHe: 'מתח' },
  { slug: 'dip_bars', nameEn: 'Dip Bars / Parallel Bars', nameHe: 'מקבילים' },
  { slug: 'gymnastic_rings', nameEn: 'Gymnastic Rings', nameHe: 'טבעות' },
  { slug: 'ab_wheel', nameEn: 'Ab Wheel', nameHe: 'גלגל בטן' },
  { slug: 'plyo_box', nameEn: 'Plyo Box', nameHe: 'קופסת קפיצה' },
  { slug: 'gh_bench', nameEn: 'Glute-Ham / Roman Chair', nameHe: 'ספסל גב רומי' },

  // Accessories
  { slug: 'resistance_band', nameEn: 'Resistance Band', nameHe: 'גומיית התנגדות' },
  { slug: 'suspension_trainer', nameEn: 'Suspension Trainer (TRX)', nameHe: 'רצועות TRX' },
  { slug: 'jump_rope', nameEn: 'Jump Rope', nameHe: 'חבל קפיצה' },
  { slug: 'medicine_ball', nameEn: 'Medicine Ball', nameHe: 'כדור כוח' },
  { slug: 'dip_belt', nameEn: 'Dip Belt', nameHe: 'חגורת תוספת משקל' },

  // Cardio
  { slug: 'treadmill', nameEn: 'Treadmill', nameHe: 'הליכון' },
  { slug: 'stationary_bike', nameEn: 'Stationary Bike', nameHe: 'אופני כושר' },
  { slug: 'rowing_machine', nameEn: 'Rowing Machine', nameHe: 'מכונת חתירה' },
  { slug: 'elliptical', nameEn: 'Elliptical', nameHe: 'אליפטי' },
  { slug: 'assault_bike', nameEn: 'Assault Bike', nameHe: 'אופני אוויר' },

  /**
   * Sentinel for exercises needing nothing at all. Having an explicit row (rather than a NULL
   * equipment_id) lets a location declare "bodyweight only" and still match those exercises
   * when substituting for unavailable equipment.
   */
  { slug: 'none', nameEn: 'No Equipment', nameHe: 'ללא ציוד' },
] as const;
