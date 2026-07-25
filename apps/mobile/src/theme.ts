/**
 * Design tokens.
 *
 * A dark palette built on layered neutrals rather than pure black: each surface step is a
 * measured lift, so depth reads through value alone and the UI needs no drop shadows. Shadows
 * on Android render as a muddy halo at low elevation and cost a render pass — borders and
 * surface steps do the same job more cleanly.
 *
 * The accent is a single desaturated green used sparingly: for the primary action, live data,
 * and nothing else. When every card has an accent border, none of them read as important.
 */

export const colors = {
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
} as const;

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
 * Anything heavier looks shouty at these sizes on a dark background.
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
