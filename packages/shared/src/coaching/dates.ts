/**
 * A moment as the calendar date it falls on where the reader is.
 *
 * The coaching documents group workouts by day and compare them with a calendar of dates, and
 * both sides of that comparison have to mean the same day. `toISOString` would not do: it
 * converts to UTC first, and a workout at 01:00 in Israel would land on the day before.
 *
 * The same function the app's own database code uses (`apps/mobile/src/db/schedule.ts`), so
 * the phone and the coach's web page agree on which day a workout belongs to.
 */
export function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
