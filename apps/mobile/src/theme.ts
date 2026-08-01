/**
 * Design tokens.
 *
 * Two palettes, dark and light, share one shape (`ColorPalette`) so every screen can be written
 * once against `colors.xxx` and simply receive whichever palette `useTheme()` resolves to.
 *
 * Neither is the other with channels inverted. The dark palette is built on layered neutrals
 * rather than pure black: each surface step is a measured lift, so depth reads through value
 * alone and the UI needs no drop shadows — shadows on Android render as a muddy halo at low
 * elevation and cost a render pass, where borders and surface steps do the same job more
 * cleanly. The light palette keeps the same brand green but pulls it darker and more saturated
 * (`#3DD68C` reads as a pale mint on white with poor contrast; `#1F9D63` holds up), and the same
 * discipline applies to warning/danger/info/macro hues, each re-tuned for legibility on a light
 * ground rather than assumed to survive the swap.
 *
 * The accent is a single colour used sparingly in both palettes: for the primary action, live
 * data, and nothing else. When every card has an accent border, none of them read as important.
 */

export interface ColorPalette {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  protein: string;
  carbs: string;
  fat: string;
}

export const darkColors: ColorPalette = {
  /* Surfaces — each step is a deliberate lift, not an arbitrary shade. */
  bg: '#0B0F14',
  surface: '#141A21',
  surfaceRaised: '#1C242D',
  surfaceHigh: '#25303B',

  /* Borders — hairlines that separate without drawing attention. */
  border: '#232D38',
  borderStrong: '#33404E',

  /* Text — four steps, enough hierarchy without becoming illegible. */
  text: '#EDF2F7',
  textSecondary: '#A8B6C4',
  textMuted: '#6B7C8D',
  textFaint: '#4A5866',

  /* Accent — primary actions and live values only. */
  accent: '#3DD68C',
  accentSoft: '#1A3A2C',
  accentBorder: '#2A6B4D',

  /* Status */
  warning: '#F0B429',
  warningSoft: '#2E2410',
  danger: '#F2686B',
  dangerSoft: '#331A1C',
  info: '#5AA9E6',
  infoSoft: '#152634',

  /* Macro colours — distinct hues that survive a dark background. */
  protein: '#6BA6FF',
  carbs: '#F0B429',
  fat: '#EF7FAE',
};

export const lightColors: ColorPalette = {
  /* Surfaces — off-white rather than pure white, so cards (pure white) still lift off it. */
  bg: '#F5F8F7',
  surface: '#FFFFFF',
  surfaceRaised: '#EEF3F1',
  surfaceHigh: '#E1E9E6',

  /* Borders — visible on a light ground without turning into a harsh outline. */
  border: '#DCE4E1',
  borderStrong: '#BFCBC7',

  /* Text — near-black rather than pure black, matching the dark palette's near-white choice. */
  text: '#0F1513',
  textSecondary: '#3E4B47',
  textMuted: '#6C7A75',
  textFaint: '#96A39E',

  /* Accent — darker and more saturated than the dark palette's; the same hex on white reads
     as a washed-out mint with poor text contrast. */
  accent: '#1E9A62',
  accentSoft: '#E3F4EC',
  accentBorder: '#8FCDAE',

  /* Status — each darkened from its dark-mode counterpart for the same contrast reason. */
  warning: '#A66A00',
  warningSoft: '#FBF0D9',
  danger: '#C93B3E',
  dangerSoft: '#FBE4E4',
  info: '#2B76B8',
  infoSoft: '#E3EFF9',

  /* Macro colours */
  protein: '#3C6CC0',
  carbs: '#A66A00',
  fat: '#BD4A82',
};

/** Default export for the rare theme-agnostic case. Components should use `useTheme()`. */
export const colors = darkColors;

/** 4px rhythm. Every gap in the app is one of these. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  xxs: 11,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 30,
  display: 40,
} as const;

/**
 * Two weights carry the whole interface: 500 for labels, 700 for headings and values.
 * Anything heavier looks shouty at these sizes.
 */
export const fontWeight = {
  regular: '400',
  medium: '500',
  bold: '700',
} as const;

/** Line heights that keep Hebrew and English blocks visually comparable. */
export const lineHeight = {
  tight: 20,
  normal: 22,
  relaxed: 26,
} as const;
