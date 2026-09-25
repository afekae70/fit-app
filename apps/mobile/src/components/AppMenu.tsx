/**
 * The way to everything that is not a tab.
 *
 * Before this, the screens outside the tab bar were reached by knowing where they were hidden:
 * the coach and the nutrition screen only through the profile, and the profile only through the
 * initials bubble on the home screen. Three taps deep, on a control that looked like decoration,
 * and invisible from any other page. Two of those screens are among the most expensive things in
 * the app and were the hardest to find.
 *
 * So: one button, the same place on every screen that has a header, opening the same list. The
 * tab bar keeps the four things done while training; this holds everything done occasionally.
 *
 * Built on the action sheet rather than a drawer. A drawer means a navigation library with a
 * gesture that competes with the horizontal swipe in the workout screen, and the sheet is already
 * themed, already right-to-left, and already scrolls when the list outgrows the screen.
 */

import { router, usePathname, type Href } from 'expo-router';
import { List } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { useTheme } from '../ThemeProvider.js';
import { radius } from '../theme.js';
import { useActionSheet } from './ActionSheetProvider.js';

/**
 * Everything reachable from the menu, in the order it is offered.
 *
 * Ordered by how close each one is to training: the profile and the coach shape what the plan
 * says, measurements and gyms are recorded alongside it, and backup and settings are maintenance.
 *
 * Nothing here is a tab, with one exception added at the top when it applies: the way home. The
 * screens in this list are pushed over the tabs, and from one of them the bar is out of reach —
 * so the menu that got you there is also the way back. On the home screen itself it is left out,
 * because an entry that goes where you already are is an entry that does nothing.
 */
const DESTINATIONS: readonly { route: Href; label: string }[] = [
  { route: '/profile', label: 'menu.profile' },
  { route: '/coach', label: 'menu.coach' },
  { route: '/nutrition', label: 'menu.nutrition' },
  { route: '/metrics', label: 'menu.metrics' },
  { route: '/gyms', label: 'menu.gyms' },
  { route: '/restore', label: 'menu.backup' },
  { route: '/settings', label: 'menu.settings' },
];

/** The home tab's own path, as `usePathname` reports it. */
const HOME: Href = '/';

export function MenuButton({ pushToEnd = false }: { pushToEnd?: boolean }) {
  const { t } = useTranslation();
  const { ask } = useActionSheet();
  const { colors } = useTheme();
  const pathname = usePathname();

  const open = () => {
    void (async () => {
      const destinations =
        pathname === HOME ? DESTINATIONS : [{ route: HOME, label: 'menu.home' }, ...DESTINATIONS];

      const choice = await ask({
        title: t('menu.title'),
        actions: destinations.map((entry) => ({ label: t(entry.label) })),
      });
      const target = choice === null ? null : destinations[choice];
      if (!target) return;

      // Going to where you already are would push a second copy onto the stack, and the only
      // sign of it would be a back button that has to be pressed twice to leave.
      if (target.route === pathname) return;
      // The tabs are navigated to, not pushed: pushing the home tab would stack it on top of
      // the screen you came from instead of returning to it.
      if (target.route === HOME) router.navigate(HOME);
      else router.push(target.route);
    })();
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={t('menu.open')}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pushToEnd && styles.pushToEnd, pressed && styles.pressed]}
    >
      <List size={22} color={colors.text} weight="regular" />
    </Pressable>
  );
}

/* Nothing here is tinted — the icon takes its colour from the theme at the call site — so these
   can be built once rather than per palette. */
const styles = StyleSheet.create<{ button: ViewStyle; pushToEnd: ViewStyle; pressed: ViewStyle }>({
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sends itself to the end of whatever row it is dropped into, so a header does not have to be
  // rebuilt around it. `marginStart` is logical, so it mirrors with the layout.
  pushToEnd: { marginStart: 'auto' },
  pressed: { opacity: 0.6 },
});
