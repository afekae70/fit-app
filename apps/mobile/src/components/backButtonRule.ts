/**
 * When the floating back button (`FloatingBack.tsx`) belongs on a screen. Pure, so it is tested
 * without a router or a screen.
 */

/**
 * Routes that keep their own way out and would only be crowded by this one: the sign-in screens,
 * the exercise picker (a sheet over the workout with its own close), and the landing screen of an
 * app-icon shortcut, which replaces itself before anyone could press anything on it.
 */
const OWN_EXIT = new Set(['auth', 'exercise-picker', 'shortcut']);

/**
 * Whether the back button belongs on the route these segments name: anywhere outside the tabs,
 * except where the screen has its own way out.
 *
 * Not "and the router can go back". That was the first version, and on the phone the button
 * never showed (2026-11-13). One suspect is exactly that: the root layout re-renders because the
 * segments changed, and asking the router whether it can go back from inside that render may read
 * the navigation state from before the push. (The other suspect, the stack drawing over the
 * button, is answered in FloatingBack's styles.) A screen outside the tabs is always somewhere a
 * person wants to leave; when there is no history behind it (opened from a link), the button goes
 * to the home screen instead.
 */
export function showsBackButton(segments: readonly string[]): boolean {
  const first = segments[0];
  return Boolean(first) && first !== '(tabs)' && !OWN_EXIT.has(first!);
}
