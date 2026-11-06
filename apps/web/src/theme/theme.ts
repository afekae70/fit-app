/**
 * The app's palette, as CSS custom properties.
 *
 * The colours are not written here. They come from `@fit/shared/design` — the same objects the
 * app's screens are styled from — and are turned into `--token` variables, one set for each
 * scheme. A colour changed for the app is changed for the dashboard by the same commit.
 *
 * The scheme follows the system's, as the app does, and can be set to light or dark by hand
 * from the menu; that choice is remembered in this browser only.
 */

import { darkColors, lightColors, type ColorPalette } from '@fit/shared/design';

export type ThemeChoice = 'system' | 'light' | 'dark';

// The app's first name, kept: a new key would forget every coach's chosen theme.
const STORAGE_KEY = 'novafit-coach-theme';

/** `surfaceRaised` → `--surface-raised`. */
const cssName = (token: string) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function declarations(palette: ColorPalette): string {
  return Object.entries(palette)
    .map(([token, value]) => `${cssName(token)}: ${value};`)
    .join(' ');
}

/**
 * The colours a chart tells its lines apart by, in this order and never cycled.
 *
 * The app's own violet, amber and pink — the family its macros are drawn in — each nudged until
 * the three pass the colour-vision checks (the dataviz validator: lightness band, chroma, and
 * separation under protanopia, deuteranopia and tritanopia) against that scheme's card colour.
 * They are a step apart from the palette's tokens because the tokens were chosen to be read as
 * text and buttons, and a line on a chart has other work to do.
 */
export const SERIES = {
  light: ['#7C5CD6', '#A8811A', '#C2457F'],
  dark: ['#8F70EE', '#B98A35', '#CF5E8C'],
} as const;

const seriesDeclarations = (colours: readonly string[]) =>
  colours.map((colour, index) => `--series-${index + 1}: ${colour};`).join(' ');

/** The stylesheet that defines both schemes. Exported for its test. */
export function paletteStylesheet(): string {
  return [
    `:root, :root[data-theme='light'] { ${declarations(lightColors)} ${seriesDeclarations(SERIES.light)} color-scheme: light; }`,
    `:root[data-theme='dark'] { ${declarations(darkColors)} ${seriesDeclarations(SERIES.dark)} color-scheme: dark; }`,
  ].join('\n');
}

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private windows and blocked storage: the choice simply does not outlive the page.
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Puts the scheme on the page: the variables once, and which set applies. */
export function applyTheme(choice: ThemeChoice): void {
  if (!document.getElementById('palette')) {
    const style = document.createElement('style');
    style.id = 'palette';
    style.textContent = paletteStylesheet();
    document.head.prepend(style);
  }
  const dark = choice === 'dark' || (choice === 'system' && systemDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Follows the system's scheme while the choice is "system". Returns the unsubscribe. */
export function followSystem(getChoice: () => ThemeChoice): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const changed = () => {
    if (getChoice() === 'system') applyTheme('system');
  };
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}
