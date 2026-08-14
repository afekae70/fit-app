/**
 * Design tokens — the Nocturne design system.
 *
 * Ported from the `FitApp.dc.html` prototype and the `styles.css` of its bundled Nocturne
 * design system. The ground is a deep indigo (`#161826`) and the accent a blurple (`#9184d9`),
 * replacing the earlier near-black-and-mint scheme.
 *
 * Nocturne expresses its derived colours as `color-mix(in srgb, X n%, transparent)` layered over
 * the ground. React Native has no `color-mix` and no alpha compositing against an implicit
 * parent, so every one of those is resolved here to the solid hex it produces **over that
 * palette's own background**. That is why the same conceptual token differs between the two
 * palettes by more than a lightness flip: `--accent-soft` is the accent at 14% over `#161826` in
 * the dark palette and at 12% over `#e4e7f5` in the light one, which are unrelated hex values.
 *
 * Two palettes share one shape (`ColorPalette`) so every screen is written once against
 * `colors.xxx`. `warning`, `info` and the macro hues have no Nocturne token of their own; they
 * are tuned into the same family rather than carried over from the old palette, where saturated
 * primaries would have read as foreign against this ground.
 *
 * The accent stays a single colour used sparingly: the primary action, live data, nothing else.
 * When every card has an accent border, none of them read as important.
 */

export interface ColorPalette {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  border: string;
  borderStrong: string;
  borderSubtle: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  accentLift: string;
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
  /* Surfaces — Nocturne's ground, card, and the neutral ramp above them. */
  bg: '#161826', // --color-bg
  surface: '#232532', // --color-surface
  surfaceRaised: '#292B31', // --color-neutral-900, the prototype's --surface2
  surfaceHigh: '#3F424D', // --color-neutral-800

  /* Borders — the divider token and the prototype's --line2, each flattened over --color-bg. */
  border: '#383946', // text 16% over bg
  borderStrong: '#4D4E5A', // text 26% over bg
  // For a card edge rather than a divider. #232532 on #161826 is already a visible step, so an
  // outline at full `border` strength draws a box around something that did not need one — the
  // effect across a screen of six cards is a grid of boxes competing with their own contents.
  // This is barely above the surface it sits on: enough to catch a corner, not enough to read
  // as a line.
  borderSubtle: '#2C2E3D', // text 7% over surface

  /* Text — the ramp read downward from --color-text. */
  text: '#E9E9ED', // --color-text
  textSecondary: '#B2B6CA', // --color-neutral-400
  textMuted: '#9397AB', // --color-neutral-500, the prototype's --dim
  textFaint: '#75798C', // --color-neutral-600, the prototype's --faint

  /* Accent — the blurple, plus its soft fill and border flattened over bg. */
  accent: '#9184D9', // --color-accent
  accentSoft: '#27273F', // accent 14% over bg
  accentBorder: '#4D4977', // accent 45% over bg
  // --color-accent-400. Used for the numerals inside a completed set: they sit on accentSoft,
  // where the base accent is close enough in tone to read as dimmed rather than confirmed.
  accentLift: '#B5ABFC',

  /* Status — only `danger` has a Nocturne token; the rest are tuned to sit beside it rather
     than carried over, since a saturated amber or sky blue reads as foreign on this ground. */
  warning: '#D9A86A',
  warningSoft: '#2D2830',
  danger: '#D98A8F', // the prototype's --danger
  dangerSoft: '#2D2633',
  info: '#A7A1DB', // --color-accent-2
  infoSoft: '#27283C',

  /* Macro colours — three hues held at the palette's own muted chroma so the row reads as one
     family. Kept clear of `warning` and `info`, which they would otherwise collide with. */
  protein: '#8FA9E8',
  carbs: '#D9C48A',
  fat: '#D98AC0',
};

export const lightColors: ColorPalette = {
  /* Surfaces — Nocturne's light theme reads the neutral ramp from the top: the ground is a step
     down from the card, so cards still lift without needing shadows. */
  bg: '#E4E7F5', // --color-neutral-200
  surface: '#F3F5FE', // --color-neutral-100
  surfaceRaised: '#CFD3E5', // --color-neutral-300
  surfaceHigh: '#B2B6CA', // --color-neutral-400

  /* Borders — neutral-900 at 12% and 26% over this palette's own ground. */
  border: '#CDD0DD',
  borderStrong: '#B3B6C2',
  borderSubtle: '#E5E8F4', // the same idea inverted: a hair darker than the card surface

  /* Text — the same ramp read upward. */
  text: '#292B31', // --color-neutral-900
  textSecondary: '#3F424D', // --color-neutral-800
  textMuted: '#595D6C', // --color-neutral-700
  textFaint: '#75798C', // --color-neutral-600

  /* Accent — the darker rung, because #9184D9 on a near-white ground fails text contrast. */
  accent: '#5D5294', // --color-accent-700
  accentSoft: '#D4D5E9', // accent-700 12% over bg
  accentBorder: '#AEABCE', // accent-700 40% over bg
  // Inverted, as the whole light ramp is: on a pale accentSoft the lift has to be darker than
  // the accent, not lighter, or the completed numerals disappear instead of standing out.
  accentLift: '#453C73',

  /* Status — each pulled darker for contrast, and each soft fill hand-tuned rather than mixed:
     a straight mix over this indigo ground turns every tint the same mauve. */
  warning: '#8A6A2F',
  warningSoft: '#EDE7D8',
  danger: '#A24B50', // the prototype's light --danger
  dangerSoft: '#EDDADC',
  info: '#5C5783', // --color-accent-2-700
  infoSoft: '#DDDCE9',

  /* Macro colours */
  protein: '#47548F',
  carbs: '#8A6A2F',
  fat: '#8F4F74',
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

/**
 * Nocturne's scale is 4 / 8 / 14. Our `sm` stays at 8 because it is what buttons and inputs
 * use, and 8 is exactly what the prototype gives them; `lg` drops 16 → 14 to match its cards.
 */
export const radius = {
  sm: 8, // --radius-md in Nocturne: buttons, inputs, small chips
  md: 12,
  lg: 14, // --radius-lg: cards
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

/**
 * Motion.
 *
 * A scale, for the same reason `spacing` is one: durations picked per component drift apart, and
 * the drift is what makes an interface feel assembled rather than designed. Everything already
 * animating in this app sat between 180ms and 320ms — these are those values, named, so the next
 * one lands on the same grid instead of near it.
 *
 * The ceiling is deliberate. Nothing here is longer than `slow`, because this is an app used
 * between sets with a barbell waiting: an animation the user has to wait out is a worse
 * interface than no animation. Anything longer is ambient (the gradient background) and belongs
 * to the component that owns it, not to this scale.
 */
export const duration = {
  /** Colour and tint changes — fast enough to read as a response, not a transition. */
  instant: 120,
  /** The default. Entrances, exits, most state changes. */
  quick: 180,
  /** Entrances that travel a distance, and anything the eye should follow. */
  normal: 260,
  /** Celebrations and the few moments worth dwelling on. */
  slow: 320,
} as const;

/**
 * Stagger between items in a list.
 *
 * Small on purpose: at 40ms a six-card screen is fully in within a quarter second of the last
 * card starting, and the effect reads as one movement with depth rather than as items queueing.
 * The cap matters more than the step — without it, the twelfth row of a long list would arrive
 * half a second after the first, which is a loading screen pretending to be a flourish.
 */
export const stagger = {
  step: 40,
  maxSteps: 6,
} as const;
