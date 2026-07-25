/**
 * English strings.
 *
 * Typed against the Hebrew bundle (see index.ts), so removing a key here — or forgetting to
 * add one that Hebrew has — is a compile error rather than a missing-string bug found at
 * runtime in whichever screen happened to use it.
 */

export const en = {
  common: {
    appName: 'Fit',
    save: 'Save',
    cancel: 'Cancel',
    add: 'Add',
    remove: 'Remove',
    edit: 'Edit',
    done: 'Done',
    loading: 'Loading…',
    error: 'Error',
    retry: 'Retry',
    kg: 'kg',
    cm: 'cm',
    kcal: 'kcal',
    grams: 'g',
    reps: 'reps',
    sets: 'sets',
  },
  tabs: {
    today: 'Today',
    workouts: 'Workouts',
    metrics: 'Metrics',
    coach: 'Coach',
  },
  profile: {
    title: 'My Profile',
    subtitle: 'These values feed your calorie calculations',
    weight: 'Weight',
    height: 'Height',
    age: 'Age',
    sex: 'Sex',
    male: 'Male',
    female: 'Female',
    other: 'Other',
    activityLevel: 'Activity level',
    goal: 'Goal',
    years: 'years',
  },
  activity: {
    sedentary: 'Sedentary',
    light: 'Light',
    moderate: 'Moderate',
    active: 'Active',
    very_active: 'Very active',
  },
  goal: {
    cut: 'Cut',
    maintain: 'Maintain',
    bulk: 'Bulk',
  },
  targets: {
    title: 'Your Targets',
    bmr: 'Basal Metabolic Rate',
    bmrHint: 'Calories your body burns at complete rest',
    tdee: 'Total Daily Energy Expenditure',
    tdeeHint: 'Total calories you burn per day',
    bmi: 'Body Mass Index',
    calorieTarget: 'Daily calorie target',
    protein: 'Protein',
    carbs: 'Carbs',
    fat: 'Fat',
    clampedWarning:
      'Target raised to your BMR. A deficit larger than this is unsafe to sustain.',
    bmiMuscleCaveat: 'BMI cannot tell muscle from fat — it is often misleading for lifters.',
    needSexForBmr: 'Choose which formula to use (male/female) to see your targets.',
  },
  dev: {
    statusTitle: 'Development status',
    calculationsLive: 'Calculation engine is live',
    calculationsHint:
      'The numbers below come from the code shared with the server — not placeholder data.',
    noBackend: 'Not connected to Supabase yet',
    noBackendHint: 'Sign-in, saving workouts, and the AI coach all need the backend.',
    languageToggle: 'עברית',
  },
} as const;
