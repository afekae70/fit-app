/**
 * The dashboard's words, in Hebrew.
 *
 * One object, so that an English version later is a second object of the same shape and not a
 * search through every page. The coaching vocabulary is the app's own — "מתאמן", "לוח אימונים",
 * "עמידה בתוכנית" — so a coach moving between the two reads one product.
 */

export const he = {
  appName: 'NovaFit',
  appSub: 'למאמנים',

  signIn: {
    title: 'כניסה למאמנים',
    lead: 'התחבר עם האימייל והסיסמה של החשבון שלך באפליקציה.',
    email: 'אימייל',
    password: 'סיסמה',
    submit: 'כניסה',
    signingIn: 'מתחבר…',
    or: 'או',
    demo: 'צפה בהדגמה עם מתאמנים לדוגמה',
    forgot: 'שכחת סיסמה? אפשר לאפס אותה מתוך האפליקציה.',
    errorCredentials: 'האימייל או הסיסמה שגויים.',
    errorUnconfirmed: 'צריך לאשר את האימייל לפני הכניסה הראשונה. בדוק את תיבת הדואר.',
    errorOffline: 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.',
    errorOther: 'הכניסה לא הצליחה. נסה שוב.',
    notConfigured: 'הגרסה הזו של האתר לא מחוברת לשרת.',
  },

  nav: {
    overview: 'לוח בקרה',
    trainees: 'מתאמנים',
    admin: 'ניהול מאמנים',
    signOut: 'יציאה',
    theme: 'מראה',
    themeSystem: 'לפי המערכת',
    themeLight: 'בהיר',
    themeDark: 'כהה',
    yourCode: 'הקוד שלך למתאמנים',
    copyCode: 'העתק',
    copied: 'הועתק',
  },

  demo: {
    banner: 'מצב הדגמה',
    bannerBody: 'כל המתאמנים והנתונים כאן מומצאים. שינויים לא נשמרים.',
    leave: 'יציאה מההדגמה',
  },

  notCoach: {
    title: 'החשבון הזה אינו חשבון מאמן',
    body: 'רק מי שהוגדר כמאמן יכול להשתמש באתר. אם אתה מאמן, בקש ממנהל האפליקציה להוסיף את האימייל שלך.',
    admin: 'לניהול מאמנים',
  },

  overview: {
    title: 'לוח בקרה',
    sub: 'כל המתאמנים שלך במבט אחד',
    trainees: 'מתאמנים',
    activeWeek: 'התאמנו השבוע',
    workoutsWeek: 'אימונים ב־7 הימים האחרונים',
    adherence: 'עמידה בתוכנית',
    adherenceHint: 'אימונים שתוכננו ובוצעו, 14 הימים האחרונים',
    attention: 'דורשים תשומת לב',
    attentionNone: 'אין כרגע מתאמנים שדורשים תשומת לב.',
    table: 'כל המתאמנים',
    colTrainee: 'מתאמן',
    colLast: 'אימון אחרון',
    col7: '7 ימים',
    col28: '28 ימים',
    colAdherence: 'עמידה',
    colTrend: 'מגמת נפח',
    colNext: 'הבא בתוכנית',
    colFlags: 'סימונים',
    noTrainees: 'עוד אין לך מתאמנים',
    noTraineesHint:
      'תן למתאמנים את הקוד שלך. כל מי שיקליד אותו באפליקציה (תפריט ← מאמן אישי) יופיע כאן.',
    loadingTrainee: 'טוען…',
    stallingIn: 'לא התקדם ב:',
    failedTrainee: 'לא נטען',
  },

  flags: {
    inactive: 'לא התאמן שבוע',
    missing: 'מפספס אימונים',
    unplanned: 'אין אימונים מתוכננים',
    stalling: 'תקוע בתרגיל מרכזי',
    inactiveHint: 'אין אימון שהסתיים ב־7 הימים האחרונים',
    missingHint: 'שני אימונים מתוכננים או יותר לא בוצעו בשבועיים האחרונים',
    unplannedHint: 'אין אימונים בלוח לשבוע הקרוב',
    stallingHint: 'אחד התרגילים העיקריים לא שבר שיא כבר 3 אימונים',
  },

  trainee: {
    since: 'מתאמן אצלך מ־{date}',
    back: 'כל המתאמנים',
    tabOverview: 'סקירה',
    tabWorkouts: 'אימונים',
    tabPlans: 'תוכניות',
    tabCalendar: 'לוח אימונים',
    remove: 'נתק מתאמן',
    removeTitle: 'לנתק את {name}?',
    removeBody:
      'לא תוכל יותר לראות או לערוך את התוכניות שלו, ולא תראה את האימונים שלו. התוכניות עצמן נשארות אצלו.',
    notFound: 'המתאמן הזה כבר לא מחובר אליך.',
    privacy:
      'מה שמוצג כאן הוא מה שהמתאמן הסכים לשתף כשהתחבר אליך: תוכניות, לוח אימונים ואימונים שביצע. משקל גוף, מדדים ויומן אכילה אינם משותפים.',
  },

  range: {
    '4w': '4 שבועות',
    '12w': '3 חודשים',
    '26w': 'חצי שנה',
    '52w': 'שנה',
  },

  stats: {
    workouts: 'אימונים',
    perWeek: 'בממוצע לשבוע',
    trainingDays: '{n} ימי אימון בתקופה',
    volume: 'נפח כולל',
    volumeHint: 'משקל × חזרות, בלי סטי חימום',
    minutes: 'משך ממוצע',
    adherence: 'עמידה בתוכנית',
    adherenceNone: 'לא תוכנן',
    streak: 'רצף שבועות',
    streakHint: 'שבועות ברצף עם אימון אחד לפחות',
    records: 'שיאים חדשים',
    rpe: 'מאמץ ממוצע',
    sets: 'סטים',
    kg: 'ק״ג',
    tonnes: 'טון',
    min: 'דק׳',
    previous: 'לעומת התקופה הקודמת',
  },

  charts: {
    weeklyVolume: 'נפח שבועי',
    weeklyVolumeSub: 'סך משקל × חזרות בכל שבוע',
    weeklyWorkouts: 'אימונים בשבוע',
    strength: 'התקדמות בכוח',
    strengthSub: '1RM משוער באימון הטוב של כל תרגיל — נוסחת אפלי, כמו באפליקציה',
    strengthPick: 'בחר עד 3 תרגילים',
    strengthEmpty: 'אין עדיין סטים עם משקל וחזרות בתקופה הזו.',
    activity: 'מפת אימונים',
    activitySub: 'כל ריבוע הוא יום',
    muscles: 'סטים לשריר בשבוע',
    musclesSub: 'סטי עבודה בממוצע לשבוע; שריר עוזר נספר כחצי סט',
    musclesEmpty: 'אין סטים בתקופה הזו.',
    showTable: 'הצג כטבלה',
    hideTable: 'הצג כגרף',
    week: 'שבוע של {date}',
    e1rm: '1RM משוער',
  },

  outcome: {
    done: 'בוצע כמתוכנן',
    missed: 'לא בוצע',
    extra: 'אימון נוסף',
    planned: 'מתוכנן',
    rest: 'מנוחה',
    nothing: 'לא תוכנן',
  },

  exercises: {
    title: 'תרגילים',
    sub: 'כל מה שבוצע בתקופה, מהנפוץ לנדיר',
    colExercise: 'תרגיל',
    colSessions: 'אימונים',
    colSets: 'סטים',
    colBest: 'שיא 1RM',
    colChange: 'שינוי',
    colLast: 'בוצע לאחרונה',
    stalling: 'תקוע',
  },

  records: {
    title: 'שיאים חדשים בתקופה',
    sub: 'אימונים שבהם תרגיל עבר את כל מה שהיה לפניו',
    none: 'אין שיאים חדשים בתקופה הזו.',
    was: 'קודם {value}',
  },

  workouts: {
    title: 'אימונים שבוצעו',
    sub: 'מהחדש לישן. לחץ על אימון כדי לראות את הסטים.',
    none: 'אין אימונים בתקופה הזו.',
    untitled: 'אימון',
    minutes: '{n} דק׳',
    sets: '{n} סטים',
    volume: '{n} ק״ג',
    rpe: 'מאמץ {n}/10',
    note: 'הערת המתאמן',
    warmup: 'חימום',
    drop: 'דרופ',
    failure: 'עד כשל',
    fromPlan: 'מתוך התוכנית',
  },

  plans: {
    title: 'תוכניות האימון',
    sub: 'כל שינוי שתשמור יגיע לטלפון של המתאמן בסנכרון הבא.',
    none: 'למתאמן עוד אין תוכניות.',
    active: 'פעילה',
    sets: '{n} סטים',
    reps: '{min}–{max} חזרות',
    repsOne: '{n} חזרות',
    noExercises: 'אין תרגילים באימון הזה.',
    newPlan: 'קבוצה חדשה',
    newPlanName: 'שם הקבוצה',
    newDay: 'אימון חדש',
    editDay: 'ערוך',
    deleteDay: 'מחק אימון',
    deletePlan: 'מחק קבוצה',
    deleteDayTitle: 'למחוק את האימון "{name}"?',
    deletePlanTitle: 'למחוק את הקבוצה "{name}" ואת כל האימונים שבה?',
    deleteBody: 'האימון יימחק גם מהטלפון של המתאמן. אימונים שכבר בוצעו נשארים בהיסטוריה.',
    dayName: 'שם האימון',
    addExercise: 'הוסף תרגיל',
    searchExercise: 'חפש תרגיל…',
    noMatch: 'לא נמצא תרגיל בשם הזה.',
    setsLabel: 'סטים',
    repsMinLabel: 'מ־',
    repsMaxLabel: 'עד',
    notesLabel: 'הערה למתאמן',
    moveUp: 'הזז למעלה',
    moveDown: 'הזז למטה',
    removeExercise: 'הסר',
    save: 'שמור',
    saving: 'שומר…',
    cancel: 'ביטול',
    rename: 'שנה שם',
  },

  calendar: {
    title: 'לוח אימונים',
    sub: 'לחץ על יום כדי לקבוע מה מתוכנן בו. השינוי מגיע לטלפון של המתאמן בסנכרון הבא.',
    prev: 'החודש הקודם',
    next: 'החודש הבא',
    today: 'היום',
    weekdays: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
    dayTitle: 'מה מתוכנן ב־{date}?',
    workouts: 'אימונים',
    rest: 'יום מנוחה',
    clear: 'לא נקבע',
    noPlans: 'למתאמן אין אימונים בתוכניות. הוסף אימון בלשונית "תוכניות" קודם.',
    trained: 'בוצע ביום הזה',
  },

  admin: {
    title: 'ניהול מאמנים',
    sub: 'רק מי שתוסיף כאן הוא מאמן. הקלד את האימייל שאיתו הוא נרשם לאפליקציה.',
    email: 'אימייל של המשתמש',
    appoint: 'הפוך למאמן',
    none: 'עוד לא הגדרת מאמנים.',
    summary: 'קוד {code} · {count} מתאמנים',
    dismiss: 'הסר מאמן',
    dismissTitle: 'להסיר את {name}?',
    dismissBody: 'הוא יפסיק להיות מאמן, וכל המתאמנים שלו ינותקו ממנו. התוכניות שבנה נשארות אצלם.',
    notAdmin: 'רק מנהל יכול להגדיר מאמנים.',
  },

  errors: {
    not_available: 'השרת עוד לא מוכן לזה. צריך להריץ את קובצי ה־SQL של האימון בפרויקט ב־Supabase.',
    offline: 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.',
    not_signed_in: 'פג תוקף ההתחברות. התחבר מחדש.',
    no_such_code: 'אין מאמן עם הקוד הזה.',
    own_code: 'זה הקוד שלך.',
    not_your_trainee: 'המתאמן הזה כבר לא מחובר אליך.',
    gone: 'האימון או הקבוצה כבר לא קיימים. רענן את הדף.',
    no_such_user: 'אין משתמש שנרשם עם האימייל הזה.',
    not_admin: 'רק מנהל יכול לעשות את זה.',
    invalid: 'השרת לא קיבל את מה שנשלח.',
    failed: 'משהו השתבש. נסה שוב.',
    retry: 'נסה שוב',
  },

  time: {
    today: 'היום',
    yesterday: 'אתמול',
    daysAgo: 'לפני {n} ימים',
    never: 'אף פעם',
    tomorrow: 'מחר',
    inDays: 'בעוד {n} ימים',
  },
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : { [K in keyof T]: Widen<T[K]> };

/** The shape any other language has to match. */
export type Strings = Widen<typeof he>;

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
