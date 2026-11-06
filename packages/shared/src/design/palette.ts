/**
 * The colour palette — Forest. Shared by the app and the coach's web dashboard, so the two
 * are one product to look at.
 *
 * Three colours, in the proportions the user asked for (2026-11-06): forest green for about 60%
 * of what is seen, sand beige for about 30%, and electric purple for the last 10%.
 *
 * - **Forest green** is the ground. At night it is the page and every card on it; by day it is
 *   the page and all of the type, so the screen still reads as green around light cards.
 * - **Sand beige** is the second colour. At night it is the type, the hairlines and the warm tile;
 *   by day it is the cards, the inputs and the tracks.
 * - **Electric purple** is the accent and nothing else: the primary action, live data, the
 *   selected tab. It is the only purple, which is what keeps it at a tenth of the screen.
 *
 * A screen cannot be 60% forest green and still be a light screen, because the page and the card
 * have to be on the same side of light and dark for one `text` token to read on both. So the day
 * scheme gets its green from a sage tint of the forest on the page and forest-green type, and the
 * night scheme is the one where the ratio is literal.
 *
 * Cards lift by shadow here rather than by outline. On a coloured ground a sand card is already
 * a clear step, and six outlined boxes down a screen read as a grid competing with its contents;
 * `shadow` below carries that weight instead, and borders are kept for the few things that are
 * genuinely edges.
 *
 * Every colour is a solid hex, the soft tints included. React Native has no `color-mix` and no
 * alpha compositing against an implicit parent, so a tint is written as the colour it comes to
 * over that palette's own ground — which is why `accentSoft` is a deep plum at night and a pale
 * lilac by day rather than one purple at two opacities.
 *
 * Two palettes share one shape (`ColorPalette`) so every screen is written once against
 * `colors.xxx`. `warning` and `danger` sit outside the three colours on purpose: a warning has to
 * look like one. They are tuned warm and muted so they do not read as a fourth brand colour.
 *
 * The accent stays a single colour used sparingly: the primary action, live data, nothing else.
 * When every card has an accent border, none of them read as important.
 *
 * **Contrast is a rule here, not a taste** (WCAG AA, checked in `palette.test.ts`). Everything a
 * person reads — `text`, `textSecondary`, `textMuted`, and the accent and status colours used as
 * words — holds 4.5:1 on every ground it can sit on. `textFaint` is the one exception, at 3:1:
 * it is for what is meant to recede — a drag handle, a ghost value in an empty field, a disabled
 * label, an unticked mark — and never for a label, a unit or a hint someone needs to read.
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
  /* Surfaces — forest green, deepest at the page, each card a clear step lighter. */
  bg: '#102419',
  surface: '#173123',
  surfaceRaised: '#1E3B2B',
  surfaceHigh: '#274736',

  /* Borders — forest a step up; depth is the shadow's job, not an outline's. */
  border: '#2A4838',
  borderStrong: '#3B5E4A',
  borderSubtle: '#1C3629',

  /* Text — sand beige, the ramp read downward from the palest. */
  text: '#F5ECDC',
  textSecondary: '#E2D4B8',
  textMuted: '#C2B396',
  textFaint: '#968C74',

  /* Accent — electric purple, light enough to hold its own on the forest. */
  accent: '#C77DFF',
  accentSoft: '#2C2545',
  accentBorder: '#5C428F',
  accentLift: '#DDAAFF',

  /* Status — `info` is the sand itself, so a second colour on screen is still the palette's. */
  warning: '#F3A257',
  warningSoft: '#3A2D1C',
  danger: '#F4928C',
  dangerSoft: '#3D2527',
  info: '#E3C994',
  infoSoft: '#35311F',

  /* Macro colours — purple, sand and a leaf green, clear of each other. */
  protein: '#C77DFF',
  carbs: '#E3C994',
  fat: '#86D7A8',

  tileSun: '#3A3322',
  tileCoral: '#2C2643',
  shadow: '#000000',
  glass: 'rgba(23, 49, 35, 0.86)',
  glassEdge: 'rgba(227, 201, 148, 0.2)',
};

export const lightColors: ColorPalette = {
  /* Surfaces — a sage tint of the forest for the page, sand cards on it. */
  bg: '#C4D6C8',
  surface: '#FBF7EE',
  surfaceRaised: '#F3EBDB',
  surfaceHigh: '#E8DCC3',

  /* Borders — sand, a hair darker than the card. */
  border: '#DDD2BC',
  borderStrong: '#C6B89B',
  borderSubtle: '#EEE6D6',

  /* Text — forest green rather than black: by day, the type is where the green lives. */
  text: '#15301F',
  textSecondary: '#2C4A39',
  textMuted: '#435C4D',
  textFaint: '#5F7568',

  /* Accent — electric purple, one rung deeper so it reads on sand and under white type. */
  accent: '#7422DE',
  accentSoft: '#EEE4FB',
  accentBorder: '#C9AEF3',
  accentLift: '#5A14B5',

  /* Status — `info` is the forest green, the day scheme's second voice. */
  warning: '#86420B',
  warningSoft: '#F6E2C8',
  danger: '#9E2730',
  dangerSoft: '#F7DCDA',
  info: '#255E40',
  infoSoft: '#DCEBDD',

  /* Macro colours */
  protein: '#7422DE',
  carbs: '#87672A',
  fat: '#255E40',

  tileSun: '#F2E3C1',
  tileCoral: '#E8DEF9',
  shadow: '#1D3B2A',
  glass: 'rgba(251, 247, 238, 0.9)',
  glassEdge: 'rgba(116, 34, 222, 0.16)',
};

/**
 * One solid colour laid over another at `strength` (0 = all ground, 1 = all colour), as the hex
 * it comes to. React Native has no `color-mix`, and a translucent fill on a card shows whatever
 * is under the card too; this is how a chart gets the steps between a data colour and its card.
 * Both inputs must be `#RRGGBB`.
 */
export function mix(colour: string, ground: string, strength: number): string {
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  const amount = Math.min(1, Math.max(0, strength));
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(channel(colour, offset) * amount + channel(ground, offset) * (1 - amount))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}
