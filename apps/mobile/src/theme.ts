/**
 * Design tokens — Aurora.
 *
 * Taken from the app's own logo: the violet of the figure, the pink it fades into, and the pale
 * lavender it sits on. A daylight scheme — a lavender ground, white cards that lift off it with a
 * wide, faint shadow, and the violet reserved for anything live or actionable. The night palette
 * is the same scheme after dark, the same accent and the same rhythm, rather than a second design.
 *
 * Cards lift by shadow here rather than by outline. On a coloured ground a white card is already
 * a clear step, and six outlined boxes down a screen read as a grid competing with its contents;
 * `shadow` below carries that weight instead, and borders are kept for the few things that are
 * genuinely edges.
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
  /**
   * The two warm tiles. A screen of one hue is a screen where nothing stands out, and these are
   * where a number is allowed to sit on colour — calories burned, time spent — without borrowing
   * the accent, which means "live or actionable" and nothing else.
   */
  tileSun: string;
  tileCoral: string;
  /** What a shadow is cast in. Tinted toward the ground rather than pure black. */
  shadow: string;
  /**
   * The wash over a frosted bar, and the hairline at its edge.
   *
   * A blur alone inherits the contrast of whatever is behind it, and a label over a photograph is
   * not the same label as one over a white card. These carry the text; the blur carries the
   * depth. Deliberately translucent — the one place in this palette where a colour is not a solid
   * hex, because seeing through them is the entire point.
   */
  glass: string;
  glassEdge: string;
}

export const darkColors: ColorPalette = {
  /* Surfaces — a violet-black ground, with the card a clear step above it. */
  bg: '#161226',
  surface: '#201A38',
  surfaceRaised: '#2A2246',
  surfaceHigh: '#382E5C',

  /* Borders — kept quiet; depth is the shadow's job, not an outline's. */
  border: '#332B52',
  borderStrong: '#4A3F72',
  borderSubtle: '#282145',

  /* Text — the ramp read downward from the brightest. */
  text: '#EEEAFB',
  textSecondary: '#C6BDE4',
  textMuted: '#9A8FBE',
  textFaint: '#776C99',

  /* Accent — the logo's violet, lifted to hold its own on a dark ground. */
  accent: '#A78BFA',
  accentSoft: '#2A2150',
  accentBorder: '#4B3E87',
  accentLift: '#C7B4FF',

  /* Status — `info` is the pink the logo fades into, which keeps the pair on brand. */
  warning: '#E0B45F',
  warningSoft: '#33301F',
  danger: '#E88A90',
  dangerSoft: '#3A2530',
  info: '#DD93CE',
  infoSoft: '#33213A',

  /* Macro colours — one family, clear of the accent and of each other. */
  protein: '#A78BFA',
  carbs: '#E0B45F',
  fat: '#DD93CE',

  tileSun: '#3B331F',
  tileCoral: '#3A2442',
  shadow: '#000000',
  glass: 'rgba(32, 26, 56, 0.62)',
  glassEdge: 'rgba(167, 139, 250, 0.22)',
};

export const lightColors: ColorPalette = {
  /* Surfaces — the lavender the logo sits on, with white cards on it. */
  bg: '#EFEBFA',
  surface: '#FFFFFF',
  surfaceRaised: '#F6F3FE',
  surfaceHigh: '#E6DFFA',

  /* Borders — a hair, for the few things that are genuinely edges. */
  border: '#E3DCF5',
  borderStrong: '#CCC2EA',
  borderSubtle: '#F0ECFB',

  /* Text — deep violet-navy rather than black, so it belongs to the same family as the ground. */
  text: '#241C3D',
  textSecondary: '#473A6B',
  textMuted: '#7A6E9B',
  textFaint: '#A79BC4',

  /* Accent — the logo's violet, one rung darker so white type on it holds contrast. */
  accent: '#7C5CD6',
  accentSoft: '#EDE7FB',
  accentBorder: '#C9B8F2',
  accentLift: '#5B3FB0',

  /* Status */
  warning: '#B07C1C',
  warningSoft: '#FBEFC9',
  danger: '#C8484E',
  dangerSoft: '#FBDEDF',
  info: '#B4559E',
  infoSoft: '#F8E6F4',

  /* Macro colours */
  protein: '#7C5CD6',
  carbs: '#C09524',
  fat: '#B4559E',

  tileSun: '#F7E9B8',
  tileCoral: '#F4DDF1',
  shadow: '#2A1B57',
  glass: 'rgba(255, 255, 255, 0.66)',
  glassEdge: 'rgba(124, 92, 214, 0.18)',
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
  sm: 10, // buttons, inputs, small chips
  md: 14,
  lg: 20, // cards
  xl: 28, // the big cards: the hero, the tiles
  pill: 999,
} as const;

/**
 * Depth.
 *
 * Three steps and no more: a card resting on the ground, something floating over it (the tab
 * bar, a sheet), and the one card on a screen that is the thing to press. Written as a whole
 * style object per step because iOS wants four properties and Android wants one — spreading a
 * named step keeps every surface at the same height as the others at that step.
 */
export const shadow = (color: string) =>
  ({
    card: {
      shadowColor: color,
      shadowOpacity: 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    floating: {
      shadowColor: color,
      shadowOpacity: 0.14,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 10,
    },
    hero: {
      shadowColor: color,
      shadowOpacity: 0.16,
      shadowRadius: 26,
      shadowOffset: { width: 0, height: 12 },
      elevation: 6,
    },
  }) as const;

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
