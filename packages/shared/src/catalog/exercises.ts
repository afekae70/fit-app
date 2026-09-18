/**
 * Global exercise catalogue (user_id = NULL).
 *
 * Two fields carry real weight beyond labelling:
 *
 *  - `movementPattern` is what makes location-adapted plan variants work. When cloning
 *    "Plan A — Kfar Saba" into "Plan B — Base", any exercise whose equipment is missing at
 *    the base is matched against the same pattern + primary muscle to offer a substitute.
 *    A cable row, a barbell row and an inverted row are all `horizontal_pull`.
 *
 *  - `loadType` determines which columns on `sets` are meaningful and which inputs the
 *    logging UI renders. A plank has a duration and no reps; a pull-up may carry added
 *    weight on a dip belt; a farmer's carry has a distance.
 *
 * `equipmentSlug` references EQUIPMENT_SEED. Use 'none' rather than null for exercises that
 * genuinely need nothing, so bodyweight-only locations match them during substitution.
 */

export type MovementPattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'carry'
  | 'isolation'
  | 'core'
  | 'cardio';

export type LoadType =
  | 'weight_reps'
  | 'bodyweight'
  | 'bodyweight_plus'
  | 'time'
  | 'distance';

export interface ExerciseSeed {
  nameEn: string;
  nameHe: string;
  primaryMuscle: string;
  secondaryMuscles?: string[];
  movementPattern: MovementPattern;
  equipmentSlug: string;
  loadType?: LoadType; // defaults to 'weight_reps'
  isUnilateral?: boolean;
}

export const EXERCISE_SEED: readonly ExerciseSeed[] = [
  /* ---------------------------------------------------------------- push: horizontal */
  { nameEn: 'Barbell Bench Press', nameHe: 'לחיצת חזה במוט', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'front_delts'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Incline Barbell Bench Press', nameHe: 'לחיצת חזה בשיפוע במוט', primaryMuscle: 'chest', secondaryMuscles: ['front_delts', 'triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Decline Barbell Bench Press', nameHe: 'לחיצת חזה בשיפוע שלילי', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Dumbbell Bench Press', nameHe: 'לחיצת חזה במשקולות', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'front_delts'], movementPattern: 'horizontal_push', equipmentSlug: 'dumbbell' },
  { nameEn: 'Incline Dumbbell Press', nameHe: 'לחיצת חזה בשיפוע במשקולות', primaryMuscle: 'chest', secondaryMuscles: ['front_delts', 'triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'dumbbell' },
  { nameEn: 'Machine Chest Press', nameHe: 'לחיצת חזה במכונה', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'chest_press_machine' },
  { nameEn: 'Smith Machine Bench Press', nameHe: 'לחיצת חזה בסמית', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'smith_machine' },
  { nameEn: 'Push-up', nameHe: 'שכיבות סמיכה', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'front_delts', 'core'], movementPattern: 'horizontal_push', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Diamond Push-up', nameHe: 'שכיבות סמיכה צרות', primaryMuscle: 'triceps', secondaryMuscles: ['chest'], movementPattern: 'horizontal_push', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Decline Push-up', nameHe: 'שכיבות סמיכה בשיפוע', primaryMuscle: 'chest', secondaryMuscles: ['front_delts', 'triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'plyo_box', loadType: 'bodyweight_plus' },
  { nameEn: 'Ring Push-up', nameHe: 'שכיבות סמיכה בטבעות', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'core'], movementPattern: 'horizontal_push', equipmentSlug: 'gymnastic_rings', loadType: 'bodyweight_plus' },
  { nameEn: 'Cable Chest Fly', nameHe: 'פרפר בכבלים', primaryMuscle: 'chest', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Pec Deck Fly', nameHe: 'פרפר במכונה', primaryMuscle: 'chest', movementPattern: 'isolation', equipmentSlug: 'pec_deck' },
  { nameEn: 'Dumbbell Fly', nameHe: 'פרפר במשקולות', primaryMuscle: 'chest', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Band Chest Press', nameHe: 'לחיצת חזה בגומייה', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'resistance_band' },

  /* ------------------------------------------------------------------ push: vertical */
  { nameEn: 'Overhead Barbell Press', nameHe: 'לחיצת כתפיים במוט', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps', 'core'], movementPattern: 'vertical_push', equipmentSlug: 'barbell' },
  { nameEn: 'Seated Dumbbell Shoulder Press', nameHe: 'לחיצת כתפיים בישיבה', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps'], movementPattern: 'vertical_push', equipmentSlug: 'dumbbell' },
  { nameEn: 'Arnold Press', nameHe: 'לחיצת ארנולד', primaryMuscle: 'front_delts', secondaryMuscles: ['side_delts', 'triceps'], movementPattern: 'vertical_push', equipmentSlug: 'dumbbell' },
  { nameEn: 'Machine Shoulder Press', nameHe: 'לחיצת כתפיים במכונה', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps'], movementPattern: 'vertical_push', equipmentSlug: 'shoulder_press_machine' },
  { nameEn: 'Push Press', nameHe: 'פוש פרס', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps', 'quads'], movementPattern: 'vertical_push', equipmentSlug: 'barbell' },
  { nameEn: 'Pike Push-up', nameHe: 'שכיבות סמיכה פייק', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps'], movementPattern: 'vertical_push', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Handstand Push-up', nameHe: 'שכיבות סמיכה בעמידת ידיים', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps', 'core'], movementPattern: 'vertical_push', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Dip', nameHe: 'מקבילים', primaryMuscle: 'triceps', secondaryMuscles: ['chest', 'front_delts'], movementPattern: 'vertical_push', equipmentSlug: 'dip_bars', loadType: 'bodyweight_plus' },
  { nameEn: 'Ring Dip', nameHe: 'מקבילים בטבעות', primaryMuscle: 'triceps', secondaryMuscles: ['chest'], movementPattern: 'vertical_push', equipmentSlug: 'gymnastic_rings', loadType: 'bodyweight_plus' },

  /* ---------------------------------------------------------------- pull: horizontal */
  { nameEn: 'Barbell Row', nameHe: 'חתירה במוט', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps', 'rear_delts'], movementPattern: 'horizontal_pull', equipmentSlug: 'barbell' },
  { nameEn: 'Pendlay Row', nameHe: 'חתירת פנדליי', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'barbell' },
  { nameEn: 'Single-Arm Dumbbell Row', nameHe: 'חתירה עם דמבל יד יד', primaryMuscle: 'lats', secondaryMuscles: ['mid_back', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Seated Cable Row', nameHe: 'חתירה בכבל בישיבה', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'seated_row_machine' },
  { nameEn: 'Chest-Supported Row', nameHe: 'חתירה בתמיכת חזה', primaryMuscle: 'mid_back', secondaryMuscles: ['rear_delts', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'T-Bar Row', nameHe: 'חתירת T', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'barbell' },
  { nameEn: 'Inverted Row', nameHe: 'חתירה הפוכה', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps', 'core'], movementPattern: 'horizontal_pull', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Ring Row', nameHe: 'חתירה בטבעות', primaryMuscle: 'mid_back', secondaryMuscles: ['biceps', 'core'], movementPattern: 'horizontal_pull', equipmentSlug: 'gymnastic_rings', loadType: 'bodyweight_plus' },
  { nameEn: 'TRX Row', nameHe: 'חתירה ב-TRX', primaryMuscle: 'mid_back', secondaryMuscles: ['biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'suspension_trainer', loadType: 'bodyweight_plus' },
  { nameEn: 'Band Row', nameHe: 'חתירה בגומייה', primaryMuscle: 'mid_back', secondaryMuscles: ['biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'resistance_band' },

  /* ------------------------------------------------------------------ pull: vertical */
  { nameEn: 'Pull-up', nameHe: 'מתח באחיזה רחבה', primaryMuscle: 'lats', secondaryMuscles: ['biceps', 'mid_back'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Chin-up', nameHe: 'מתח באחיזה הפוכה', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Neutral-Grip Pull-up', nameHe: 'מתח באחיזה ניטרלית', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Lat Pulldown', nameHe: 'מותחים בכבל', primaryMuscle: 'lats', secondaryMuscles: ['biceps', 'mid_back'], movementPattern: 'vertical_pull', equipmentSlug: 'lat_pulldown' },
  { nameEn: 'Close-Grip Lat Pulldown', nameHe: 'מותחים באחיזה צרה', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'lat_pulldown' },
  { nameEn: 'Straight-Arm Pulldown', nameHe: 'מותחים בזרוע ישרה', primaryMuscle: 'lats', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Band Pulldown', nameHe: 'מותחים בגומייה', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'resistance_band' },

  /* ------------------------------------------------------------------------ squat */
  { nameEn: 'Back Squat', nameHe: 'סקוואט אחורי', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'core', 'hamstrings'], movementPattern: 'squat', equipmentSlug: 'barbell' },
  { nameEn: 'Front Squat', nameHe: 'סקוואט קדמי', primaryMuscle: 'quads', secondaryMuscles: ['core', 'glutes'], movementPattern: 'squat', equipmentSlug: 'barbell' },
  { nameEn: 'Goblet Squat', nameHe: 'סקוואט גובלט', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'core'], movementPattern: 'squat', equipmentSlug: 'kettlebell' },
  { nameEn: 'Hack Squat', nameHe: 'האק סקוואט', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'hack_squat' },
  { nameEn: 'Leg Press', nameHe: 'לחיצת רגליים', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'leg_press' },
  { nameEn: 'Smith Machine Squat', nameHe: 'סקוואט בסמית', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'smith_machine' },
  { nameEn: 'Bodyweight Squat', nameHe: 'סקוואט משקל גוף', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Pistol Squat', nameHe: 'סקוואט על רגל אחת', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'core'], movementPattern: 'squat', equipmentSlug: 'none', loadType: 'bodyweight_plus', isUnilateral: true },
  { nameEn: 'Jump Squat', nameHe: 'סקוואט קפיצה', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'calves'], movementPattern: 'squat', equipmentSlug: 'none', loadType: 'bodyweight_plus' },

  /* ------------------------------------------------------------------------- hinge */
  { nameEn: 'Conventional Deadlift', nameHe: 'דדליפט קונבנציונלי', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'lower_back', 'lats', 'traps'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Sumo Deadlift', nameHe: 'דדליפט סומו', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'quads', 'lower_back'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Romanian Deadlift', nameHe: 'דדליפט רומני', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'lower_back'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Dumbbell Romanian Deadlift', nameHe: 'דדליפט רומני במשקולות', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes'], movementPattern: 'hinge', equipmentSlug: 'dumbbell' },
  { nameEn: 'Trap Bar Deadlift', nameHe: 'דדליפט מוט טראפ', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'quads', 'traps'], movementPattern: 'hinge', equipmentSlug: 'trap_bar' },
  { nameEn: 'Single-Leg Romanian Deadlift', nameHe: 'דדליפט רומני על רגל אחת', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'core'], movementPattern: 'hinge', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Kettlebell Swing', nameHe: 'סווינג קטלבל', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'lower_back'], movementPattern: 'hinge', equipmentSlug: 'kettlebell' },
  { nameEn: 'Hip Thrust', nameHe: 'היפ תראסט', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Machine Hip Thrust', nameHe: 'היפ תראסט במכונה', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'hip_thrust_machine' },
  { nameEn: 'Glute Bridge', nameHe: 'גשר ירכיים', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Nordic Hamstring Curl', nameHe: 'כפיפת ירך נורדית', primaryMuscle: 'hamstrings', movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Back Extension', nameHe: 'פשיטת גב', primaryMuscle: 'lower_back', secondaryMuscles: ['glutes', 'hamstrings'], movementPattern: 'hinge', equipmentSlug: 'gh_bench', loadType: 'bodyweight_plus' },
  { nameEn: 'Good Morning', nameHe: 'גוד מורנינג', primaryMuscle: 'hamstrings', secondaryMuscles: ['lower_back', 'glutes'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Superman', nameHe: 'סופרמן', primaryMuscle: 'lower_back', secondaryMuscles: ['glutes'], movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Reverse Hyperextension', nameHe: 'פשיטת גב הפוכה', primaryMuscle: 'lower_back', secondaryMuscles: ['glutes', 'hamstrings'], movementPattern: 'hinge', equipmentSlug: 'gh_bench', loadType: 'bodyweight_plus' },
  { nameEn: 'Bird Dog', nameHe: 'כלב-ציפור', primaryMuscle: 'lower_back', secondaryMuscles: ['core', 'glutes'], movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight', isUnilateral: true },
  { nameEn: 'Rack Pull', nameHe: 'משיכת מדף', primaryMuscle: 'traps', secondaryMuscles: ['lats', 'lower_back', 'hamstrings'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Cable Kickback', nameHe: 'בעיטה אחורית בכבל', primaryMuscle: 'glutes', movementPattern: 'hinge', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Single-Leg Hip Thrust', nameHe: 'היפ תראסט על רגל אחת', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight_plus', isUnilateral: true },

  /* ------------------------------------------------------------------------- lunge */
  { nameEn: 'Walking Lunge', nameHe: 'מספריים בהליכה', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'hamstrings'], movementPattern: 'lunge', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Reverse Lunge', nameHe: 'מספריים לאחור', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Bulgarian Split Squat', nameHe: 'סקוואט בולגרי', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Step-up', nameHe: 'עליית מדרגה', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'plyo_box', isUnilateral: true },
  { nameEn: 'Bodyweight Lunge', nameHe: 'מספריים משקל גוף', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'none', loadType: 'bodyweight_plus', isUnilateral: true },

  /* ------------------------------------------------------------------------- carry */
  { nameEn: "Farmer's Carry", nameHe: 'הליכת החקלאי', primaryMuscle: 'traps', secondaryMuscles: ['forearms', 'core'], movementPattern: 'carry', equipmentSlug: 'dumbbell', loadType: 'distance' },
  { nameEn: 'Suitcase Carry', nameHe: 'הליכת מזוודה', primaryMuscle: 'core', secondaryMuscles: ['forearms', 'traps'], movementPattern: 'carry', equipmentSlug: 'kettlebell', loadType: 'distance', isUnilateral: true },
  { nameEn: 'Plate Pinch Carry', nameHe: 'הליכה עם צביטת צלחת', primaryMuscle: 'forearms', secondaryMuscles: ['core'], movementPattern: 'carry', equipmentSlug: 'weight_plate', loadType: 'distance' },

  /* ------------------------------------------------------------- isolation: shoulders */
  { nameEn: 'Dumbbell Lateral Raise', nameHe: 'הרחקת כתפיים במשקולות', primaryMuscle: 'side_delts', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Cable Lateral Raise', nameHe: 'הרחקת כתפיים בכבל', primaryMuscle: 'side_delts', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Seated Dumbbell Lateral Raise', nameHe: 'הרחקת כתפיים במשקולות בישיבה', primaryMuscle: 'side_delts', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'Band Lateral Raise', nameHe: 'הרחקת כתפיים בגומייה', primaryMuscle: 'side_delts', movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Cable Y-Raise', nameHe: 'הרמת Y בכבל', primaryMuscle: 'side_delts', secondaryMuscles: ['rear_delts', 'traps'], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Upright Row', nameHe: 'חתירה זקופה', primaryMuscle: 'side_delts', secondaryMuscles: ['traps'], movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Face Pull', nameHe: 'פייס פול', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back', 'traps'], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Band Face Pull', nameHe: 'פייס פול בגומייה', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back'], movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Reverse Pec Deck', nameHe: 'פרפר הפוך במכונה', primaryMuscle: 'rear_delts', movementPattern: 'isolation', equipmentSlug: 'pec_deck' },
  { nameEn: 'Bent-Over Dumbbell Rear Delt Raise', nameHe: 'הרחקה אחורית בהטיה', primaryMuscle: 'rear_delts', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Cable Rear Delt Fly', nameHe: 'פרפר אחורי בכבל', primaryMuscle: 'rear_delts', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Incline Rear Delt Raise', nameHe: 'הרחקה אחורית בשיפוע', primaryMuscle: 'rear_delts', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'Band Pull-Apart', nameHe: 'פתיחת גומייה', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back', 'traps'], movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Prone Y-Raise', nameHe: 'הרמת Y בשכיבה על ספסל', primaryMuscle: 'rear_delts', secondaryMuscles: ['traps', 'mid_back'], movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'Seated Rear Delt Raise', nameHe: 'הרחקה אחורית בישיבה', primaryMuscle: 'rear_delts', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  // Rowing patterns, but with the elbows flared high so the rear delt leads rather than the lats.
  { nameEn: 'Rear Delt Row', nameHe: 'חתירה לכתף אחורית במוט', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back', 'traps'], movementPattern: 'horizontal_pull', equipmentSlug: 'barbell' },
  { nameEn: 'Dumbbell Rear Delt Row', nameHe: 'חתירה לכתף אחורית במשקולות', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell' },
  { nameEn: 'Cable Rear Delt Row', nameHe: 'חתירה לכתף אחורית בכבל', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back', 'traps'], movementPattern: 'horizontal_pull', equipmentSlug: 'cable_machine' },
  { nameEn: 'Front Raise', nameHe: 'הרמה קדמית', primaryMuscle: 'front_delts', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Barbell Shrug', nameHe: 'כיווץ כתפיים במוט', primaryMuscle: 'traps', movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Dumbbell Shrug', nameHe: 'כיווץ כתפיים במשקולות', primaryMuscle: 'traps', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Cable Shrug', nameHe: 'כיווץ כתפיים בכבל', primaryMuscle: 'traps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Trap Bar Shrug', nameHe: 'כיווץ כתפיים במוט טראפ', primaryMuscle: 'traps', movementPattern: 'isolation', equipmentSlug: 'trap_bar' },

  /* ------------------------------------------------------------------ isolation: arms */
  // Biceps. Hebrew names follow Israeli gym vernacular rather than literal translation —
  // "כיסא כומר" is what lifters actually say for a preacher bench, so a literal "כוהן" would
  // fail the search box for the term people type.
  { nameEn: 'Barbell Curl', nameHe: 'כפיפת מרפקים במוט', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'EZ Bar Curl', nameHe: 'כפיפת מרפקים במוט EZ', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'ez_bar' },
  { nameEn: 'Wide-Grip Barbell Curl', nameHe: 'כפיפת מרפקים באחיזה רחבה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Close-Grip Barbell Curl', nameHe: 'כפיפת מרפקים באחיזה צרה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Dumbbell Curl', nameHe: 'כפיפת מרפקים במשקולות', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Alternating Dumbbell Curl', nameHe: 'כפיפת מרפקים לסירוגין', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Hammer Curl', nameHe: 'כפיפת פטיש', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Cross-Body Hammer Curl', nameHe: 'כפיפת פטיש חוצה גוף', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Incline Dumbbell Curl', nameHe: 'כפיפת מרפקים בשיפוע', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'Incline Hammer Curl', nameHe: 'כפיפת פטיש בשיפוע', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },

  { nameEn: 'Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },
  { nameEn: 'EZ Bar Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר במוט EZ', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },
  { nameEn: 'Single-Arm Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר עם דמבל יד יד', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench', isUnilateral: true },
  { nameEn: 'Machine Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר במכונה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },

  { nameEn: 'Concentration Curl', nameHe: 'כפיפת ריכוז', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Spider Curl', nameHe: 'כפיפת עכביש', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'Drag Curl', nameHe: 'כפיפת גרירה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Zottman Curl', nameHe: 'כפיפת זוטמן', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Reverse Curl', nameHe: 'כפיפת מרפקים באחיזה הפוכה', primaryMuscle: 'forearms', secondaryMuscles: ['biceps'], movementPattern: 'isolation', equipmentSlug: 'ez_bar' },

  { nameEn: 'Cable Curl', nameHe: 'כפיפת מרפקים בכבל', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'High Cable Curl', nameHe: 'כפיפת מרפקים בכבל עליון', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Bayesian Cable Curl', nameHe: 'כפיפת מרפקים בכבל מאחורי הגוף', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Rope Hammer Curl', nameHe: 'כפיפת פטיש בחבל', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Machine Bicep Curl', nameHe: 'כפיפת מרפקים במכונה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Band Curl', nameHe: 'כפיפת מרפקים בגומייה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Cable Tricep Pushdown', nameHe: 'פשיטת מרפקים בכבל', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Rope Tricep Pushdown', nameHe: 'פשיטת מרפקים בחבל', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Overhead Tricep Extension', nameHe: 'פשיטת מרפקים מעל הראש', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Skull Crusher', nameHe: 'סקול קראשר', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'ez_bar' },
  { nameEn: 'Close-Grip Bench Press', nameHe: 'לחיצת חזה באחיזה צרה', primaryMuscle: 'triceps', secondaryMuscles: ['chest'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Bench Dip', nameHe: 'מקבילים על ספסל', primaryMuscle: 'triceps', movementPattern: 'vertical_push', equipmentSlug: 'flat_bench', loadType: 'bodyweight_plus' },
  { nameEn: 'Wrist Curl', nameHe: 'כפיפת שורש כף יד', primaryMuscle: 'forearms', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Reverse Wrist Curl', nameHe: 'פשיטת שורש כף יד', primaryMuscle: 'forearms', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Dead Hang', nameHe: 'תלייה סטטית', primaryMuscle: 'forearms', secondaryMuscles: ['lats'], movementPattern: 'isolation', equipmentSlug: 'pullup_bar', loadType: 'time' },

  /* ------------------------------------------------------------------ isolation: legs */
  { nameEn: 'Leg Extension', nameHe: 'פשיטת רגליים', primaryMuscle: 'quads', movementPattern: 'isolation', equipmentSlug: 'leg_extension' },
  { nameEn: 'Seated Leg Curl', nameHe: 'כפיפת רגליים בישיבה', primaryMuscle: 'hamstrings', movementPattern: 'isolation', equipmentSlug: 'leg_curl' },
  { nameEn: 'Lying Leg Curl', nameHe: 'כפיפת רגליים בשכיבה', primaryMuscle: 'hamstrings', movementPattern: 'isolation', equipmentSlug: 'leg_curl' },
  { nameEn: 'Standing Calf Raise', nameHe: 'הרמת עקבים בעמידה', primaryMuscle: 'calves', movementPattern: 'isolation', equipmentSlug: 'calf_raise_machine' },
  { nameEn: 'Seated Calf Raise', nameHe: 'הרמת עקבים בישיבה', primaryMuscle: 'calves', movementPattern: 'isolation', equipmentSlug: 'calf_raise_machine' },
  { nameEn: 'Bodyweight Calf Raise', nameHe: 'הרמת עקבים משקל גוף', primaryMuscle: 'calves', movementPattern: 'isolation', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Leg Press Calf Raise', nameHe: 'הרמת עקבים במכונת רגליים', primaryMuscle: 'calves', movementPattern: 'isolation', equipmentSlug: 'leg_press' },
  { nameEn: 'Donkey Calf Raise', nameHe: 'הרמת עקבים בהטיה', primaryMuscle: 'calves', movementPattern: 'isolation', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Single-Leg Calf Raise', nameHe: 'הרמת עקבים על רגל אחת', primaryMuscle: 'calves', movementPattern: 'isolation', equipmentSlug: 'none', loadType: 'bodyweight_plus', isUnilateral: true },
  { nameEn: 'Cable Hip Abduction', nameHe: 'הרחקת ירך בכבל', primaryMuscle: 'glutes', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },

  /* -------------------------------------------------------------------------- core */
  { nameEn: 'Plank', nameHe: 'פלאנק', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'time' },
  { nameEn: 'Side Plank', nameHe: 'פלאנק צידי', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'none', loadType: 'time', isUnilateral: true },
  { nameEn: 'Hanging Leg Raise', nameHe: 'הרמת רגליים בתלייה', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Lying Leg Raise', nameHe: 'אלים (הרמת רגליים)', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Hanging Knee Raise', nameHe: 'הרמת ברכיים בתלייה', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Ab Wheel Rollout', nameHe: 'גלגל בטן', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'ab_wheel', loadType: 'bodyweight_plus' },
  { nameEn: 'Cable Crunch', nameHe: 'כפיפת בטן בכבל', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'cable_machine' },
  { nameEn: 'Crunch', nameHe: 'כפיפות בטן', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Russian Twist', nameHe: 'ישיבה ומצד לצד (סיבוב רוסי)', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'medicine_ball' },
  { nameEn: 'Dead Bug', nameHe: 'חיפושית מתה', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Hollow Body Hold', nameHe: 'החזקת גוף חלול', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'time' },
  { nameEn: 'Pallof Press', nameHe: 'לחיצת פאלוף', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Cable Woodchopper', nameHe: 'חוטב עצים בכבל', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Hanging Oblique Raise', nameHe: 'הרמת רגליים אלכסונית בתלייה', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Bicycle Crunch', nameHe: 'אופניים (כפיפות בטן)', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Heel Touch', nameHe: 'פינגווינים', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Alternating Toe Touch', nameHe: 'יד נגדית לרגל', primaryMuscle: 'core', secondaryMuscles: ['obliques'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Side Plank (Other Side)', nameHe: 'פלאנק לצד השני', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'none', loadType: 'time', isUnilateral: true },

  /* ------------------------------------------------------------------------ cardio */
  { nameEn: 'Treadmill Run', nameHe: 'ריצה על הליכון', primaryMuscle: 'cardio', movementPattern: 'cardio', equipmentSlug: 'treadmill', loadType: 'distance' },
  { nameEn: 'Outdoor Run', nameHe: 'ריצה בחוץ', primaryMuscle: 'cardio', movementPattern: 'cardio', equipmentSlug: 'none', loadType: 'distance' },
  { nameEn: 'Ruck March', nameHe: 'מסע עם משקל', primaryMuscle: 'cardio', secondaryMuscles: ['core', 'quads'], movementPattern: 'cardio', equipmentSlug: 'none', loadType: 'distance' },
  { nameEn: 'Stationary Bike', nameHe: 'אופני כושר', primaryMuscle: 'cardio', movementPattern: 'cardio', equipmentSlug: 'stationary_bike', loadType: 'time' },
  { nameEn: 'Rowing Machine', nameHe: 'מכונת חתירה', primaryMuscle: 'cardio', secondaryMuscles: ['mid_back'], movementPattern: 'cardio', equipmentSlug: 'rowing_machine', loadType: 'distance' },
  { nameEn: 'Assault Bike', nameHe: 'אופני אוויר', primaryMuscle: 'cardio', movementPattern: 'cardio', equipmentSlug: 'assault_bike', loadType: 'time' },
  { nameEn: 'Jump Rope', nameHe: 'חבל קפיצה', primaryMuscle: 'cardio', secondaryMuscles: ['calves'], movementPattern: 'cardio', equipmentSlug: 'jump_rope', loadType: 'time' },
  { nameEn: 'Burpee', nameHe: 'ברפי', primaryMuscle: 'cardio', secondaryMuscles: ['chest', 'quads', 'core'], movementPattern: 'cardio', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Mountain Climber', nameHe: 'מטפס הרים', primaryMuscle: 'core', secondaryMuscles: ['cardio'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'time' },

  /* ------------------------------------------------------- expansion: depth per muscle */
  /* Added because several groups had too few options to build a real session around — the
     leg groups worst of all. Anything already in the catalogue above is skipped rather than
     repeated, matched on both names, so this block can be re-run without creating twins. */
  { nameEn: 'High-Bar Back Squat', nameHe: 'סקוואט מוט גבוה', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'barbell' },
  { nameEn: 'Pause Squat', nameHe: 'סקוואט עם עצירה', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'barbell' },
  { nameEn: 'Zercher Squat', nameHe: 'סקוואט זרשר', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'core'], movementPattern: 'squat', equipmentSlug: 'barbell' },
  { nameEn: 'Belt Squat', nameHe: 'סקוואט חגורה', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'hack_squat' },
  { nameEn: 'Sissy Squat', nameHe: 'סקוואט סיסי', primaryMuscle: 'quads', secondaryMuscles: [], movementPattern: 'squat', equipmentSlug: 'none' },
  { nameEn: 'Cyclist Squat', nameHe: 'סקוואט רוכבים', primaryMuscle: 'quads', secondaryMuscles: [], movementPattern: 'squat', equipmentSlug: 'barbell' },
  { nameEn: 'Step-Up', nameHe: 'עלייה על מדרגה', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'dumbbell' },
  { nameEn: 'Single-Leg Leg Press', nameHe: 'לחיצת רגליים ברגל אחת', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'leg_press' },
  { nameEn: 'Wall Sit', nameHe: 'ישיבת קיר', primaryMuscle: 'quads', secondaryMuscles: [], movementPattern: 'squat', equipmentSlug: 'none', loadType: 'time' },
  { nameEn: 'Stiff-Leg Deadlift', nameHe: 'דדליפט רגל ישרה', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'lower_back'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Standing Leg Curl', nameHe: 'כפיפת ברך בעמידה', primaryMuscle: 'hamstrings', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'leg_curl' },
  { nameEn: 'Glute-Ham Raise', nameHe: 'הרמת ירך-שוק', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes'], movementPattern: 'hinge', equipmentSlug: 'gh_bench' },
  { nameEn: 'Cable Pull-Through', nameHe: 'משיכה בין הרגליים בפולי', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes'], movementPattern: 'hinge', equipmentSlug: 'cable_machine' },
  { nameEn: 'Barbell Hip Thrust', nameHe: 'היפ תראסט במוט', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'hip_thrust_machine' },
  { nameEn: 'Frog Pump', nameHe: 'פראג פאמפ', primaryMuscle: 'glutes', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'none' },
  { nameEn: 'Banded Lateral Walk', nameHe: 'הליכה צידית עם גומייה', primaryMuscle: 'glutes', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Wide-Grip Pull-Up', nameHe: 'מתח אחיזה רחבה', primaryMuscle: 'lats', secondaryMuscles: ['mid_back', 'biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar' },
  { nameEn: 'Neutral-Grip Pull-Up', nameHe: 'מתח אחיזה ניטרלית', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar' },
  { nameEn: 'Single-Arm Lat Pulldown', nameHe: 'פולי עליון יד יד', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'lat_pulldown' },
  { nameEn: 'Chin-Up', nameHe: 'מתח אחיזה תחתונה', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar' },
  { nameEn: 'Machine Pullover', nameHe: 'פולאובר במכונה', primaryMuscle: 'lats', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Kneeling Lat Pulldown', nameHe: 'פולי עליון בכריעה', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'cable_machine' },
  { nameEn: 'Meadows Row', nameHe: 'חתירת מדווס', primaryMuscle: 'mid_back', secondaryMuscles: ['lats'], movementPattern: 'horizontal_pull', equipmentSlug: 'barbell' },
  { nameEn: 'Decline Bench Press', nameHe: 'לחיצת חזה בירידה', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Low-to-High Cable Fly', nameHe: 'פרפר בפולי מלמטה', primaryMuscle: 'chest', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'High-to-Low Cable Fly', nameHe: 'פרפר בפולי מלמעלה', primaryMuscle: 'chest', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Deficit Push-Up', nameHe: 'שכיבות סמיכה בגובה', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'weight_plate' },
  { nameEn: 'Landmine Press', nameHe: 'לחיצת לנדמיין', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps'], movementPattern: 'vertical_push', equipmentSlug: 'barbell' },
  { nameEn: 'Machine Lateral Raise', nameHe: 'הרחקה במכונה', primaryMuscle: 'side_delts', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'shoulder_press_machine' },
  { nameEn: 'Lean-Away Lateral Raise', nameHe: 'הרחקה בנטייה', primaryMuscle: 'side_delts', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Overhead Cable Extension', nameHe: 'פשיטת מרפקים מעל הראש בפולי', primaryMuscle: 'triceps', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Rope Pushdown', nameHe: 'דחיפת חבל', primaryMuscle: 'triceps', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Dumbbell Kickback', nameHe: 'בעיטת טרייספס', primaryMuscle: 'triceps', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Farmer Carry', nameHe: 'נשיאת חקלאי', primaryMuscle: 'traps', secondaryMuscles: ['forearms', 'core'], movementPattern: 'carry', equipmentSlug: 'dumbbell', loadType: 'distance' },
  { nameEn: 'Plate Pinch', nameHe: 'צביטת צלחת', primaryMuscle: 'forearms', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'weight_plate' },
  { nameEn: 'Cable Woodchop', nameHe: 'חיתוך עץ בפולי', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'cable_machine' },
  { nameEn: 'Bent-Over Reverse Fly', nameHe: 'פרפר הפוך בהטיה', primaryMuscle: 'rear_delts', secondaryMuscles: ['mid_back'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell' },
  { nameEn: 'Jefferson Curl', nameHe: 'ג׳פרסון קרל', primaryMuscle: 'lower_back', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'dumbbell' },
  { nameEn: 'Seated Good Morning', nameHe: 'גוד מורנינג בישיבה', primaryMuscle: 'lower_back', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Bird Dog Row', nameHe: 'ציפור-כלב עם חתירה', primaryMuscle: 'lower_back', secondaryMuscles: ['mid_back', 'core'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell' },
  { nameEn: 'Banded Back Extension', nameHe: 'פשיטת גב עם גומייה', primaryMuscle: 'lower_back', secondaryMuscles: ['glutes'], movementPattern: 'hinge', equipmentSlug: 'resistance_band' },
  { nameEn: 'Smith Machine Calf Raise', nameHe: 'הרמת עקבים בסמית', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'smith_machine' },
  { nameEn: 'Tibialis Raise', nameHe: 'הרמת טיביאליס', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'none' },
  { nameEn: 'Jump Rope Calf Bounce', nameHe: 'קפיצות חבל על קצות האצבעות', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'cardio', equipmentSlug: 'jump_rope' },
  { nameEn: 'Farmer Walk on Toes', nameHe: 'הליכה על קצות האצבעות', primaryMuscle: 'calves', secondaryMuscles: ['forearms'], movementPattern: 'carry', equipmentSlug: 'dumbbell', loadType: 'distance' },
  { nameEn: 'Behind-the-Back Wrist Curl', nameHe: 'כפיפת שורש מאחורי הגב', primaryMuscle: 'forearms', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Wrist Roller', nameHe: 'גלגלת שורש כף היד', primaryMuscle: 'forearms', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'weight_plate' },
  { nameEn: 'Towel Pull-Up Hang', nameHe: 'תלייה על מגבת', primaryMuscle: 'forearms', secondaryMuscles: ['lats'], movementPattern: 'isolation', equipmentSlug: 'pullup_bar', loadType: 'time' },
  { nameEn: 'Landmine Rotation', nameHe: 'סיבוב לנדמיין', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'barbell' },
  { nameEn: 'Side Bend', nameHe: 'כפיפה צידית', primaryMuscle: 'obliques', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Copenhagen Plank', nameHe: 'פלאנק קופנהגן', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'flat_bench', loadType: 'time' },
  { nameEn: 'Overhead Shrug', nameHe: 'משיכת כתפיים מעל הראש', primaryMuscle: 'traps', secondaryMuscles: ['side_delts'], movementPattern: 'isolation', equipmentSlug: 'barbell' },
  { nameEn: 'Prone Y Raise', nameHe: 'הרמת Y בשכיבה', primaryMuscle: 'traps', secondaryMuscles: ['rear_delts'], movementPattern: 'isolation', equipmentSlug: 'adjustable_bench' },
  { nameEn: 'Cable Y Raise', nameHe: 'הרמת Y בפולי', primaryMuscle: 'side_delts', secondaryMuscles: ['rear_delts'], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Behind-the-Back Cable Raise', nameHe: 'הרחקה בפולי מאחורי הגב', primaryMuscle: 'side_delts', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Plate Front Raise', nameHe: 'הרמה קדמית עם צלחת', primaryMuscle: 'side_delts', secondaryMuscles: ['front_delts'], movementPattern: 'isolation', equipmentSlug: 'weight_plate' },
  { nameEn: 'Banded Lateral Raise', nameHe: 'הרחקה עם גומייה', primaryMuscle: 'side_delts', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Z Press', nameHe: 'זד פרס', primaryMuscle: 'front_delts', secondaryMuscles: ['core', 'triceps'], movementPattern: 'vertical_push', equipmentSlug: 'barbell' },
  { nameEn: 'Seal Row', nameHe: 'חתירת סיל', primaryMuscle: 'mid_back', secondaryMuscles: ['lats'], movementPattern: 'horizontal_pull', equipmentSlug: 'flat_bench' },
  { nameEn: 'Kroc Row', nameHe: 'חתירת קרוק', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'forearms'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell' },
  { nameEn: 'Toes to Bar', nameHe: 'רגליים למוט', primaryMuscle: 'core', secondaryMuscles: ['lats'], movementPattern: 'core', equipmentSlug: 'pullup_bar' },
  { nameEn: 'V-Up', nameHe: 'חץ (וי-אפ)', primaryMuscle: 'core', secondaryMuscles: ['obliques'], movementPattern: 'core', equipmentSlug: 'none' },
  { nameEn: 'Weighted Sit-Up', nameHe: 'כפיפת בטן עם משקל', primaryMuscle: 'core', secondaryMuscles: [], movementPattern: 'core', equipmentSlug: 'weight_plate' },
  { nameEn: 'Hip Abduction Machine', nameHe: 'הרחקת ירך במכונה', primaryMuscle: 'abductors', secondaryMuscles: ['glutes'], movementPattern: 'isolation', equipmentSlug: 'hip_thrust_machine' },
  { nameEn: 'Banded Hip Abduction', nameHe: 'הרחקת ירך עם גומייה', primaryMuscle: 'abductors', secondaryMuscles: ['glutes'], movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Side-Lying Leg Raise', nameHe: 'הרמת רגל בשכיבה צידית', primaryMuscle: 'abductors', secondaryMuscles: ['glutes'], movementPattern: 'isolation', equipmentSlug: 'none' },
  { nameEn: 'Clamshell', nameHe: 'צדפה', primaryMuscle: 'abductors', secondaryMuscles: ['glutes'], movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Hip Adduction Machine', nameHe: 'קירוב ירך במכונה', primaryMuscle: 'adductors', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'hip_thrust_machine' },
  { nameEn: 'Cable Hip Adduction', nameHe: 'קירוב ירך בפולי', primaryMuscle: 'adductors', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Copenhagen Adduction', nameHe: 'קירוב קופנהגן', primaryMuscle: 'adductors', secondaryMuscles: ['core'], movementPattern: 'isolation', equipmentSlug: 'flat_bench' },
  { nameEn: 'Sumo Squat', nameHe: 'סקוואט סומו', primaryMuscle: 'adductors', secondaryMuscles: ['quads', 'glutes'], movementPattern: 'squat', equipmentSlug: 'dumbbell' },
  { nameEn: 'Wide-Stance Leg Press', nameHe: 'לחיצת רגליים ברגליים רחבות', primaryMuscle: 'adductors', secondaryMuscles: ['glutes', 'quads'], movementPattern: 'squat', equipmentSlug: 'leg_press' },
  { nameEn: 'Calf Raise on Leg Press', nameHe: 'הרמת עקבים במכונת לחיצת רגליים', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'leg_press' },
  { nameEn: 'Hack Squat Calf Raise', nameHe: 'הרמת עקבים בהאק סקוואט', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'hack_squat' },
  { nameEn: 'Bent-Knee Calf Raise', nameHe: 'הרמת עקבים בברך כפופה', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'calf_raise_machine' },
  { nameEn: 'Weighted Calf Raise', nameHe: 'הרמת עקבים עם משקולת', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Calf Press', nameHe: 'לחיצת תאומים', primaryMuscle: 'calves', secondaryMuscles: [], movementPattern: 'isolation', equipmentSlug: 'leg_press' },

  /* --------------------------------------------------- expansion: one side at a time and more */
  /* Single-arm and single-leg work first — "יד יד" is how it is asked for, so the Hebrew names
     say it that way and the search box finds it — then more depth for every group. Each one was
     picked because the public-domain photo set has a picture of exactly that movement. */
  { nameEn: 'Single-Arm Seated Cable Row', nameHe: 'חתירה בכבל יד יד', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Kneeling Single-Arm High Cable Row', nameHe: 'חתירה מכבל עליון יד יד בכריעה', primaryMuscle: 'lats', secondaryMuscles: ['mid_back', 'biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Single-Arm Kettlebell Row', nameHe: 'חתירה בקטלבל יד יד', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'kettlebell', isUnilateral: true },
  { nameEn: 'Single-Arm Landmine Row', nameHe: 'חתירה במוט לנדמיין יד יד', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'barbell', isUnilateral: true },
  { nameEn: 'Renegade Row', nameHe: 'חתירת רנגייד', primaryMuscle: 'mid_back', secondaryMuscles: ['core', 'lats'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Cable Curl', nameHe: 'כפיפת מרפקים בכבל יד יד', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Alternating Hammer Curl', nameHe: 'כפיפת פטיש לסירוגין', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Alternating Incline Dumbbell Curl', nameHe: 'כפיפת מרפקים בשיפוע לסירוגין', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench', isUnilateral: true },
  { nameEn: 'Single-Arm Cable Pushdown', nameHe: 'פשיטת מרפקים בכבל יד יד', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Single-Arm Overhead Dumbbell Extension', nameHe: 'פשיטת מרפקים מעל הראש עם דמבל יד יד', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Cable Overhead Extension', nameHe: 'פשיטת מרפקים מעל הראש בכבל יד יד', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Single-Arm Lying Dumbbell Extension', nameHe: 'פשיטת מרפקים בשכיבה עם דמבל יד יד', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Dumbbell Kickback', nameHe: 'בעיטת טרייספס יד יד', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Dumbbell Shoulder Press', nameHe: 'לחיצת כתפיים עם דמבל יד יד', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps', 'core'], movementPattern: 'vertical_push', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Standing Alternating Dumbbell Press', nameHe: 'לחיצת כתפיים לסירוגין בעמידה', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps', 'core'], movementPattern: 'vertical_push', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Dumbbell Lateral Raise', nameHe: 'הרחקת כתפיים עם דמבל יד יד', primaryMuscle: 'side_delts', movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Incline Lateral Raise', nameHe: 'הרחקת כתפיים בשיפוע יד יד', primaryMuscle: 'side_delts', movementPattern: 'isolation', equipmentSlug: 'adjustable_bench', isUnilateral: true },
  { nameEn: 'Single-Arm Dumbbell Upright Row', nameHe: 'חתירה זקופה עם דמבל יד יד', primaryMuscle: 'side_delts', secondaryMuscles: ['traps'], movementPattern: 'isolation', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Dumbbell Bench Press', nameHe: 'לחיצת חזה עם דמבל יד יד', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'core'], movementPattern: 'horizontal_push', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Single-Arm Cable Crossover', nameHe: 'פרפר בכבל יד יד', primaryMuscle: 'chest', movementPattern: 'isolation', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'One-Arm Push-up', nameHe: 'שכיבות סמיכה ביד אחת', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'core'], movementPattern: 'horizontal_push', equipmentSlug: 'none', loadType: 'bodyweight_plus', isUnilateral: true },
  { nameEn: 'Single-Arm Kettlebell Swing', nameHe: 'סווינג קטלבל יד יד', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'core'], movementPattern: 'hinge', equipmentSlug: 'kettlebell', isUnilateral: true },
  { nameEn: 'Single-Leg Leg Extension', nameHe: 'פשיטת רגליים ברגל אחת', primaryMuscle: 'quads', movementPattern: 'isolation', equipmentSlug: 'leg_extension', isUnilateral: true },
  { nameEn: 'Single-Leg Glute Bridge', nameHe: 'גשר ירכיים על רגל אחת', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight_plus', isUnilateral: true },
  { nameEn: 'Cable Side Bend', nameHe: 'כפיפה צידית בכבל', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Dumbbell Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר עם דמבלים', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },
  { nameEn: 'Preacher Hammer Curl', nameHe: 'כפיפת פטיש בכיסא כומר', primaryMuscle: 'biceps', secondaryMuscles: ['forearms'], movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },
  { nameEn: 'Cable Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר בכבל', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },
  { nameEn: 'Reverse Preacher Curl', nameHe: 'כפיפת מרפקים הפוכה בכיסא כומר', primaryMuscle: 'forearms', secondaryMuscles: ['biceps'], movementPattern: 'isolation', equipmentSlug: 'preacher_bench' },
  { nameEn: 'Seated Dumbbell Curl', nameHe: 'כפיפת מרפקים בישיבה', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Reverse-Grip Tricep Pushdown', nameHe: 'פשיטת מרפקים בכבל באחיזה הפוכה', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'V-Bar Pushdown', nameHe: 'פשיטת מרפקים במוט V', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Lying Dumbbell Tricep Extension', nameHe: 'פשיטת מרפקים בשכיבה עם משקולות', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Tate Press', nameHe: 'לחיצת טייט', primaryMuscle: 'triceps', movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'JM Press', nameHe: 'לחיצת JM', primaryMuscle: 'triceps', secondaryMuscles: ['chest'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Incline Dumbbell Fly', nameHe: 'פרפר בשיפוע עם משקולות', primaryMuscle: 'chest', secondaryMuscles: ['front_delts'], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Cable Crossover', nameHe: 'קרוס אובר בכבלים', primaryMuscle: 'chest', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Svend Press', nameHe: 'לחיצת סבנד', primaryMuscle: 'chest', secondaryMuscles: ['front_delts'], movementPattern: 'isolation', equipmentSlug: 'weight_plate' },
  { nameEn: 'Floor Press', nameHe: 'לחיצה מהרצפה', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'barbell' },
  { nameEn: 'Incline Push-up', nameHe: 'שכיבות סמיכה בשיפוע חיובי', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'flat_bench', loadType: 'bodyweight_plus' },
  { nameEn: 'Clap Push-up', nameHe: 'שכיבות סמיכה עם מחיאה', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Machine Incline Chest Press', nameHe: 'לחיצת חזה בשיפוע במכונה', primaryMuscle: 'chest', secondaryMuscles: ['front_delts', 'triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'chest_press_machine' },
  { nameEn: 'Smith Machine Incline Press', nameHe: 'לחיצת חזה בשיפוע בסמית', primaryMuscle: 'chest', secondaryMuscles: ['front_delts', 'triceps'], movementPattern: 'horizontal_push', equipmentSlug: 'smith_machine' },
  { nameEn: 'Smith Machine Shoulder Press', nameHe: 'לחיצת כתפיים בסמית', primaryMuscle: 'front_delts', secondaryMuscles: ['triceps'], movementPattern: 'vertical_push', equipmentSlug: 'smith_machine' },
  { nameEn: 'Cable Front Raise', nameHe: 'הרמה קדמית בכבל', primaryMuscle: 'front_delts', movementPattern: 'isolation', equipmentSlug: 'cable_machine' },
  { nameEn: 'Dumbbell Pullover', nameHe: 'פולאובר עם משקולת', primaryMuscle: 'lats', secondaryMuscles: ['chest'], movementPattern: 'isolation', equipmentSlug: 'dumbbell' },
  { nameEn: 'Reverse-Grip Lat Pulldown', nameHe: 'מותחים באחיזה הפוכה', primaryMuscle: 'lats', secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'lat_pulldown' },
  { nameEn: 'Machine Row', nameHe: 'חתירה במכונה', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'seated_row_machine' },
  { nameEn: 'Machine High Row', nameHe: 'חתירה גבוהה במכונה', primaryMuscle: 'lats', secondaryMuscles: ['mid_back', 'biceps'], movementPattern: 'vertical_pull', equipmentSlug: 'seated_row_machine' },
  { nameEn: 'Bent-Over Dumbbell Row', nameHe: 'חתירה בהטיה עם משקולות', primaryMuscle: 'mid_back', secondaryMuscles: ['lats', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell' },
  { nameEn: 'Muscle-Up', nameHe: 'מאסל אפ', primaryMuscle: 'lats', secondaryMuscles: ['triceps', 'chest'], movementPattern: 'vertical_pull', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Barbell Lunge', nameHe: 'מספריים עם מוט', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'barbell', isUnilateral: true },
  { nameEn: 'Dumbbell Lunge', nameHe: 'מספריים עם משקולות', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'dumbbell', isUnilateral: true },
  { nameEn: 'Barbell Step-Up', nameHe: 'עלייה על מדרגה עם מוט', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'lunge', equipmentSlug: 'barbell', isUnilateral: true },
  { nameEn: 'Dumbbell Squat', nameHe: 'סקוואט עם משקולות', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], movementPattern: 'squat', equipmentSlug: 'dumbbell' },
  { nameEn: 'Box Jump', nameHe: 'קפיצה על ארגז', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'calves'], movementPattern: 'squat', equipmentSlug: 'plyo_box', loadType: 'bodyweight' },
  { nameEn: 'Kettlebell Thruster', nameHe: 'תראסטר עם קטלבל', primaryMuscle: 'quads', secondaryMuscles: ['front_delts', 'glutes'], movementPattern: 'squat', equipmentSlug: 'kettlebell' },
  { nameEn: 'Barbell Glute Bridge', nameHe: 'גשר ירכיים עם מוט', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Donkey Kick', nameHe: 'בעיטת חמור', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], movementPattern: 'hinge', equipmentSlug: 'none', loadType: 'bodyweight', isUnilateral: true },
  { nameEn: 'Band Hip Adduction', nameHe: 'קירוב ירך עם גומייה', primaryMuscle: 'adductors', movementPattern: 'isolation', equipmentSlug: 'resistance_band' },
  { nameEn: 'Power Clean', nameHe: 'פאוור קלין', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'quads', 'traps'], movementPattern: 'hinge', equipmentSlug: 'barbell' },
  { nameEn: 'Sit-Up', nameHe: 'סיט אפ (כפיפות בטן מלאות)', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Reverse Crunch', nameHe: 'כפיפות בטן הפוכות', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Decline Crunch', nameHe: 'כפיפות בטן בספסל שיפוע', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'adjustable_bench', loadType: 'bodyweight_plus' },
  { nameEn: 'Oblique Crunch', nameHe: 'כפיפות בטן אלכסוניות', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Flutter Kicks', nameHe: 'בעיטות רגליים (פלאטר קיקס)', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Scissor Kicks', nameHe: 'מספריים לבטן', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Push-up to Side Plank', nameHe: 'שכיבת סמיכה לפלאנק צידי', primaryMuscle: 'core', secondaryMuscles: ['chest', 'obliques'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Kneeling Cable Oblique Crunch', nameHe: 'כפיפת בטן בכבל עם סיבוב', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'cable_machine' },
  { nameEn: 'Turkish Get-Up', nameHe: 'טורקיש גט אפ', primaryMuscle: 'core', secondaryMuscles: ['front_delts', 'glutes'], movementPattern: 'core', equipmentSlug: 'kettlebell' },
  { nameEn: 'Medicine Ball Slam', nameHe: 'הטחת כדור כוח', primaryMuscle: 'core', secondaryMuscles: ['lats', 'front_delts'], movementPattern: 'core', equipmentSlug: 'medicine_ball' },
  { nameEn: 'Elliptical', nameHe: 'אליפטיקל', primaryMuscle: 'cardio', movementPattern: 'cardio', equipmentSlug: 'elliptical', loadType: 'time' },
  { nameEn: 'Jumping Jacks', nameHe: 'קפיצות פיסוק', primaryMuscle: 'cardio', movementPattern: 'cardio', equipmentSlug: 'none', loadType: 'time' },
  { nameEn: 'High Knees', nameHe: 'ריצה במקום עם הרמת ברכיים', primaryMuscle: 'cardio', secondaryMuscles: ['quads'], movementPattern: 'cardio', equipmentSlug: 'none', loadType: 'time' },
] as const;

/**
 * Muscle groups offered as filters, in the order they should appear.
 *
 * **Derived, not hand-listed.** A hardcoded list was the original bug: the catalogue grew twice
 * and the filters did not, leaving 33 exercises across five groups — rear delts, traps,
 * obliques, forearms, lower back — with no way to reach them by filter at all. Anything with at
 * least one exercise now gets a chip automatically, so adding an exercise can never again
 * silently hide a whole muscle group.
 *
 * `PRIORITY` only fixes the order of the groups that usually head a session, so the chips do
 * not reshuffle as the catalogue grows. Everything else follows, most-covered first.
 */
const PRIORITY: readonly string[] = [
  'chest', 'lats', 'mid_back', 'quads', 'hamstrings', 'glutes',
  'abductors', 'adductors',
  'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'core', 'calves', 'cardio',
];

export const FILTERABLE_MUSCLES: readonly string[] = (() => {
  const counts = new Map<string, number>();
  for (const exercise of EXERCISE_SEED) {
    counts.set(exercise.primaryMuscle, (counts.get(exercise.primaryMuscle) ?? 0) + 1);
  }
  const ranked = PRIORITY.filter((m) => counts.has(m));
  const rest = [...counts.keys()]
    .filter((m) => !PRIORITY.includes(m))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
  return [...ranked, ...rest];
})();

/**
 * Muscle groups referenced above. Kept as a list so the seed can assert that every
 * `primaryMuscle` / `secondaryMuscles` entry is a known value — a typo would otherwise
 * silently break muscle-group filtering and the AI's volume-per-muscle analysis.
 */
export const MUSCLE_GROUPS = [
  // The two hip machines every gym has and this list did not: without them the catalogue could
  // not name what a hip abduction actually trains, so the movement had nowhere to live at all.
  'abductors',
  'adductors',
  'chest',
  'lats',
  'mid_back',
  'lower_back',
  'traps',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'obliques',
  'cardio',
] as const;

/**
 * The catalogue keyed by `nameEn`, which is what `session_exercises.exercise_key` stores.
 *
 * Built once here because four call sites were each building their own copy of this exact map —
 * three screens and a card — and four copies of one lookup is four chances for them to disagree
 * about what a key is.
 */
export const EXERCISE_BY_KEY: ReadonlyMap<string, ExerciseSeed> = new Map(
  EXERCISE_SEED.map((seed) => [seed.nameEn, seed]),
);
