/**
 * The colour palette — Aurora. Shared by the app and the coach's web dashboard, so the two
 * are one product to look at.
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
  glass: 'rgba(32, 26, 56, 0.86)',
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
  glass: 'rgba(255, 255, 255, 0.88)',
  glassEdge: 'rgba(124, 92, 214, 0.18)',
};
