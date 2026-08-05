/**
 * Exercise photo lookup — generated, do not hand-edit.
 *
 * Maps a catalogue key (the exercise's English name) to a path in the free-exercise-db image
 * set, which is dedicated to the public domain under The Unlicense:
 * https://github.com/yuhonas/free-exercise-db
 *
 * Only matches confident enough to show are listed. The matcher required every word of our
 * name to appear in theirs, allowed at most one extra word, and only when that word named an
 * implement or a posture ("dumbbell", "seated") rather than a movement — "Barbell Row" and
 * "Upright Barbell Row" differ by one word and are entirely different lifts. An exercise
 * missing here is not a gap to fill in later: it means no image could be trusted, and the
 * muscle map is shown in its place.
 *
 * Covers 89 of the catalogue.
 */

const IMAGE_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

const EXERCISE_IMAGE_PATHS: Readonly<Record<string, string>> = {
  'Arnold Press': 'Arnold_Dumbbell_Press/0.jpg',
  'Back Extension': 'Hyperextensions_Back_Extensions/0.jpg',
  'Band Lateral Raise': 'Lateral_Raise_-_With_Bands/0.jpg',
  'Band Pull-Apart': 'Band_Pull_Apart/0.jpg',
  'Barbell Bench Press': 'Barbell_Bench_Press_-_Medium_Grip/0.jpg',
  'Barbell Curl': 'Barbell_Curl/0.jpg',
  'Barbell Shrug': 'Barbell_Shrug/0.jpg',
  'Bench Dip': 'Bench_Dips/0.jpg',
  'Bodyweight Squat': 'Bodyweight_Squat/0.jpg',
  'Cable Crunch': 'Cable_Crunch/0.jpg',
  'Cable Curl': 'Lying_Cable_Curl/0.jpg',
  'Cable Lateral Raise': 'Cable_Seated_Lateral_Raise/0.jpg',
  'Cable Rear Delt Fly': 'Cable_Rear_Delt_Fly/0.jpg',
  'Cable Rear Delt Row': 'Cable_Rope_Rear-Delt_Rows/0.jpg',
  'Cable Shrug': 'Cable_Shrugs/0.jpg',
  'Chin-up': 'Chin-Up/0.jpg',
  'Close-Grip Barbell Curl': 'Close-Grip_Standing_Barbell_Curl/0.jpg',
  'Close-Grip Bench Press': 'Close-Grip_Barbell_Bench_Press/0.jpg',
  'Close-Grip Lat Pulldown': 'Close-Grip_Front_Lat_Pulldown/0.jpg',
  'Concentration Curl': 'Concentration_Curls/0.jpg',
  'Cross-Body Hammer Curl': 'Cross_Body_Hammer_Curl/0.jpg',
  'Dead Bug': 'Dead_Bug/0.jpg',
  'Decline Barbell Bench Press': 'Decline_Barbell_Bench_Press/0.jpg',
  'Decline Push-up': 'Decline_Push-Up/0.jpg',
  'Donkey Calf Raise': 'Donkey_Calf_Raises/0.jpg',
  'Drag Curl': 'Drag_Curl/0.jpg',
  'Dumbbell Bench Press': 'Dumbbell_Bench_Press/0.jpg',
  'Dumbbell Curl': 'Dumbbell_Bicep_Curl/0.jpg',
  'Dumbbell Shrug': 'Dumbbell_Shrug/0.jpg',
  'EZ Bar Curl': 'EZ-Bar_Curl/0.jpg',
  'Face Pull': 'Face_Pull/0.jpg',
  'Front Raise': 'Front_Cable_Raise/0.jpg',
  'Front Squat': 'Front_Barbell_Squat/0.jpg',
  'Glute Bridge': 'Barbell_Glute_Bridge/0.jpg',
  'Goblet Squat': 'Goblet_Squat/0.jpg',
  'Good Morning': 'Good_Morning/0.jpg',
  'Hack Squat': 'Hack_Squat/0.jpg',
  'Hammer Curl': 'Hammer_Curls/0.jpg',
  'Hanging Leg Raise': 'Hanging_Leg_Raise/0.jpg',
  'High Cable Curl': 'High_Cable_Curls/0.jpg',
  'Hip Thrust': 'Barbell_Hip_Thrust/0.jpg',
  'Incline Barbell Bench Press': 'Barbell_Incline_Bench_Press_-_Medium_Grip/0.jpg',
  'Incline Dumbbell Curl': 'Incline_Dumbbell_Curl/0.jpg',
  'Incline Dumbbell Press': 'Incline_Dumbbell_Press/0.jpg',
  'Incline Hammer Curl': 'Incline_Hammer_Curls/0.jpg',
  'Inverted Row': 'Inverted_Row/0.jpg',
  'Jump Squat': 'Freehand_Jump_Squat/0.jpg',
  'Lat Pulldown': 'Wide-Grip_Lat_Pulldown/0.jpg',
  'Leg Extension': 'Leg_Extensions/0.jpg',
  'Leg Press': 'Leg_Press/0.jpg',
  'Lying Leg Curl': 'Lying_Leg_Curls/0.jpg',
  'Machine Bicep Curl': 'Machine_Bicep_Curl/0.jpg',
  'Machine Preacher Curl': 'Machine_Preacher_Curls/0.jpg',
  'Machine Shoulder Press': 'Machine_Shoulder_Military_Press/0.jpg',
  'Mountain Climber': 'Mountain_Climbers/0.jpg',
  'Overhead Tricep Extension': 'Standing_Overhead_Barbell_Triceps_Extension/0.jpg',
  'Pallof Press': 'Pallof_Press/0.jpg',
  'Pistol Squat': 'Kettlebell_Pistol_Squat/0.jpg',
  'Plank': 'Plank/0.jpg',
  'Preacher Curl': 'Preacher_Curl/0.jpg',
  'Pull-up': 'Pullups/0.jpg',
  'Push Press': 'Push_Press/0.jpg',
  'Push-up': 'Pushups/0.jpg',
  'Rack Pull': 'Rack_Pulls/0.jpg',
  'Rear Delt Row': 'Barbell_Rear_Delt_Row/0.jpg',
  'Reverse Curl': 'Reverse_Barbell_Curl/0.jpg',
  'Reverse Hyperextension': 'Reverse_Hyperextension/0.jpg',
  'Ring Dip': 'Ring_Dips/0.jpg',
  'Romanian Deadlift': 'Romanian_Deadlift/0.jpg',
  'Rope Tricep Pushdown': 'Triceps_Pushdown_-_Rope_Attachment/0.jpg',
  'Russian Twist': 'Russian_Twist/0.jpg',
  'Seated Cable Row': 'Seated_Cable_Rows/0.jpg',
  'Seated Calf Raise': 'Seated_Calf_Raise/0.jpg',
  'Seated Leg Curl': 'Seated_Leg_Curl/0.jpg',
  'Skull Crusher': 'Band_Skull_Crusher/0.jpg',
  'Smith Machine Bench Press': 'Smith_Machine_Bench_Press/0.jpg',
  'Smith Machine Squat': 'Smith_Machine_Squat/0.jpg',
  'Spider Curl': 'Spider_Curl/0.jpg',
  'Standing Calf Raise': 'Standing_Calf_Raises/0.jpg',
  'Straight-Arm Pulldown': 'Straight-Arm_Pulldown/0.jpg',
  'Sumo Deadlift': 'Sumo_Deadlift/0.jpg',
  'Superman': 'Superman/0.jpg',
  'T-Bar Row': 'Lying_T-Bar_Row/0.jpg',
  'Trap Bar Deadlift': 'Trap_Bar_Deadlift/0.jpg',
  'Upright Row': 'Standing_Dumbbell_Upright_Row/0.jpg',
  'Walking Lunge': 'Barbell_Walking_Lunge/0.jpg',
  'Wide-Grip Barbell Curl': 'Wide-Grip_Standing_Barbell_Curl/0.jpg',
  'Wrist Curl': 'Cable_Wrist_Curl/0.jpg',
  'Zottman Curl': 'Zottman_Curl/0.jpg',
};

/** Absolute URL of a photo for this exercise, or null when none could be matched. */
export function exerciseImageUrl(exerciseKey: string): string | null {
  const path = EXERCISE_IMAGE_PATHS[exerciseKey];
  return path ? `${IMAGE_BASE}/${path}` : null;
}

/** Whether a photo exists, without building the URL. */
export function hasExerciseImage(exerciseKey: string): boolean {
  return exerciseKey in EXERCISE_IMAGE_PATHS;
}

/**
 * Every catalogue key this map claims to cover. Exported so a test can prove none of them has
 * been renamed out from under it — a stale key fails silently, dropping the photo with no
 * error to notice.
 */
export const EXERCISE_IMAGE_KEYS: readonly string[] = Object.keys(EXERCISE_IMAGE_PATHS);
