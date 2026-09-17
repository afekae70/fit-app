/**
 * A number typed into a set's weight or reps field that has not been saved yet.
 *
 * The fields are uncontrolled and save when the field reports the end of editing. That event is
 * not guaranteed to arrive: tapping the done tick straight after typing does not end the edit
 * (the list lets the tap through without dismissing the keyboard), and ticking the last set of an
 * exercise in focus mode moves on to the next exercise and removes the card — field and all —
 * before the edit ever ends. The reps typed into every exercise's last set were lost that way.
 *
 * So the row keeps what was typed, and saves it itself before the tick and when it goes away.
 * This decides whether there is anything to save.
 */

/**
 * A typed number, or null for an empty field or something that is not a usable number.
 *
 * Null rather than 0 matters: clearing the field and tapping away should leave the saved value
 * alone, not silently record a set lifted with no weight.
 */
export function parseTyped(raw: string): number | null {
  const normalised = raw.replace(',', '.').trim();
  if (normalised === '') return null;
  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The value to save for a field, or null when there is nothing new.
 *
 * `toStored` turns what was typed into what is stored — pounds into kilograms, reps into a whole
 * number — so the comparison with the saved value is like for like. Equal means already saved,
 * which is what keeps a flush that races the field's own save from writing twice.
 */
export function valueToCommit(
  typed: string | null,
  committed: number | null,
  toStored: (value: number) => number = (value) => value,
): number | null {
  if (typed === null) return null;
  const parsed = parseTyped(typed);
  if (parsed === null) return null;
  const stored = toStored(parsed);
  return stored === committed ? null : stored;
}

/**
 * The same decision for a field where clearing means something.
 *
 * A set's weight is never deliberately blanked, so `valueToCommit` leaves an empty field alone.
 * A plan's target and a finished workout's fields are different: emptying one is how the target
 * or the value is removed. So an empty field here commits null rather than being ignored.
 *
 * Returns `undefined` when there is nothing to do — nothing typed, or typed the value already
 * saved — and otherwise the value to save, which may be null for "cleared".
 */
export function valueOrClearToCommit(
  typed: string | null,
  committed: number | null,
  toStored: (value: number) => number = (value) => value,
): number | null | undefined {
  if (typed === null) return undefined;
  const parsed = parseTyped(typed);
  const next = parsed === null ? null : toStored(parsed);
  return next === committed ? undefined : next;
}
