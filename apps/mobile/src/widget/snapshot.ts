/**
 * What the home-screen widgets show, written where they can read it.
 *
 * A widget is a native `RemoteViews` layout rendered by the launcher in its own process. It cannot
 * run any of this app's JavaScript and must not open the database — the app keeps that file open,
 * and all of this is for a couple of labels and a ring. So the app leaves a small JSON file in its
 * own documents directory whenever the home screen loads, and both widgets read that.
 *
 * Writing is best-effort by design: a phone with no widget placed still writes the file, and a
 * failure here must never be allowed to disturb the screen that triggered it.
 *
 * The shape of the file, and the arithmetic in it, live in payload.ts — tested, because nothing on
 * screen ever shows this and a wrong number here is only visible on a home screen.
 */

import { File, Paths } from 'expo-file-system';

import { widgetPayload, type WidgetSnapshot } from './payload.js';

export type { WidgetSnapshot, WidgetToday, WidgetWeek } from './payload.js';
export { weekForWidget } from './payload.js';

/** The file name the native providers look for. Changing it means changing the Kotlin too. */
const FILE = 'widget.json';

export function writeWidgetSnapshot(snapshot: WidgetSnapshot): void {
  try {
    // Written whole, every time. The providers treat a missing field as "nothing to show", which
    // is why there is no need to merge with what was there before — and why a rest day must still
    // write the week, rather than the empty object this used to leave behind.
    new File(Paths.document, FILE).write(JSON.stringify(widgetPayload(snapshot)));
  } catch {
    // A widget nobody placed is the common case; a write that failed is not worth a word.
  }
}
