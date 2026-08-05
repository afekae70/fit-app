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
  { nameEn: 'Single-Arm Dumbbell Row', nameHe: 'חתירה עם משקולת יד', primaryMuscle: 'lats', secondaryMuscles: ['mid_back', 'biceps'], movementPattern: 'horizontal_pull', equipmentSlug: 'dumbbell', isUnilateral: true },
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
  { nameEn: 'Single-Arm Preacher Curl', nameHe: 'כפיפת מרפקים בכיסא כומר ביד אחת', primaryMuscle: 'biceps', movementPattern: 'isolation', equipmentSlug: 'preacher_bench', isUnilateral: true },
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
  { nameEn: 'Hanging Knee Raise', nameHe: 'הרמת ברכיים בתלייה', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Ab Wheel Rollout', nameHe: 'גלגל בטן', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'ab_wheel', loadType: 'bodyweight_plus' },
  { nameEn: 'Cable Crunch', nameHe: 'כפיפת בטן בכבל', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'cable_machine' },
  { nameEn: 'Crunch', nameHe: 'כפיפת בטן', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight_plus' },
  { nameEn: 'Russian Twist', nameHe: 'סיבוב רוסי', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'medicine_ball' },
  { nameEn: 'Dead Bug', nameHe: 'חיפושית מתה', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight' },
  { nameEn: 'Hollow Body Hold', nameHe: 'החזקת גוף חלול', primaryMuscle: 'core', movementPattern: 'core', equipmentSlug: 'none', loadType: 'time' },
  { nameEn: 'Pallof Press', nameHe: 'לחיצת פאלוף', primaryMuscle: 'obliques', movementPattern: 'core', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Cable Woodchopper', nameHe: 'חוטב עצים בכבל', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'cable_machine', isUnilateral: true },
  { nameEn: 'Hanging Oblique Raise', nameHe: 'הרמת רגליים אלכסונית בתלייה', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'pullup_bar', loadType: 'bodyweight_plus' },
  { nameEn: 'Bicycle Crunch', nameHe: 'כפיפת בטן אופניים', primaryMuscle: 'obliques', secondaryMuscles: ['core'], movementPattern: 'core', equipmentSlug: 'none', loadType: 'bodyweight_plus' },

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
] as const;

/**
 * Muscle groups referenced above. Kept as a list so the seed can assert that every
 * `primaryMuscle` / `secondaryMuscles` entry is a known value — a typo would otherwise
 * silently break muscle-group filtering and the AI's volume-per-muscle analysis.
 */
export const MUSCLE_GROUPS = [
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
