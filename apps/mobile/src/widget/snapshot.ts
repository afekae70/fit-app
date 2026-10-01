/**
 * What the home-screen widget shows, written where the widget can read it.
 *
 * The widget is a native `RemoteViews` layout rendered by the launcher in its own process. It
 * cannot run any of this app's JavaScript and must not open the database — the app keeps that
 * file open, and all of this is for a label that changes once a day. So the app leaves a small
 * JSON file in its own documents directory whenever the home screen loads, and the widget reads
 * that.
 *
 * Writing is best-effort by design: a phone with no widget placed still writes the file, and a
 * failure here must never be allowed to disturb the screen that triggered it.
 */

import { File, Paths } from 'expo-file-system';

/** The file name the native provider looks for. Changing it means changing the Kotlin too. */
const FILE = 'widget.json';

export interface WidgetSnapshot {
  /** The workout's name, or the rest-day line. */
  title: string;
  /** What is in it — exercises and sets, or why there is nothing. */
  detail: string;
  /** What the button says. */
  action: string;
}

export function writeWidgetSnapshot(snapshot: WidgetSnapshot | null): void {
  try {
    const file = new File(Paths.document, FILE);
    if (snapshot === null) {
      // An empty file rather than a deleted one: the provider treats both as "nothing today",
      // and writing is the operation that cannot race with the launcher reading.
      file.write('{}');
      return;
    }
    file.write(JSON.stringify(snapshot));
  } catch {
    // A widget nobody placed is the common case; a write that failed is not worth a word.
  }
}
