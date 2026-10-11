/**
 * Which font file a piece of text is drawn with.
 *
 * The app is set in Rubik: a typeface drawn for Hebrew and Latin together, so a Hebrew label
 * and the number beside it look like they belong to one design rather than to two system fonts
 * that happen to be the same size.
 *
 * ## Why this is a function and not a font name
 *
 * React Native has no "use this font everywhere". And a font loaded at runtime is one *file*
 * under one name — it is not a family with weights. Asking for `fontWeight: '700'` on the
 * regular file does not find the bold one; Android fattens the regular outlines instead, which
 * is the smeared look of a font that was never drawn bold.
 *
 * So each weight is its own name, and the weight a style asks for picks the name. The styles
 * across the app keep saying `fontWeight: '700'`, exactly as they did on the system font, and
 * `components/Text.tsx` turns that into the right file.
 *
 * Pure, so the mapping can be tested without a device: `loadFonts.ts` holds the files, which
 * vitest cannot import.
 */

export const FONT_FAMILIES = {
  regular: 'Rubik-Regular',
  medium: 'Rubik-Medium',
  semibold: 'Rubik-SemiBold',
  bold: 'Rubik-Bold',
  extrabold: 'Rubik-ExtraBold',
} as const;

export type FontFamilyName = (typeof FONT_FAMILIES)[keyof typeof FONT_FAMILIES];

/** The weights React Native accepts by name, as the numbers they stand for. */
const NAMED_WEIGHTS: Record<string, number> = {
  ultralight: 200,
  thin: 100,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  condensedBold: 700,
  condensed: 400,
  heavy: 800,
  black: 900,
};

/**
 * The file for a weight.
 *
 * Nothing lighter than regular and nothing heavier than extra-bold is bundled — the app uses
 * neither — so those ends are answered by the nearest weight there is. A weight that is not
 * given, or is not a weight at all, is regular: the same answer the system gives.
 */
export function familyFor(weight: string | number | null | undefined): FontFamilyName {
  const asNumber =
    typeof weight === 'number'
      ? weight
      : weight === null || weight === undefined
        ? 400
        : (NAMED_WEIGHTS[weight] ?? Number(weight));
  const value = Number.isFinite(asNumber) ? asNumber : 400;

  if (value >= 750) return FONT_FAMILIES.extrabold;
  if (value >= 650) return FONT_FAMILIES.bold;
  if (value >= 550) return FONT_FAMILIES.semibold;
  if (value >= 450) return FONT_FAMILIES.medium;
  return FONT_FAMILIES.regular;
}

/**
 * The font a text style should be given, or null to leave it alone.
 *
 *  - A style that names its own font keeps it. `monospace` on the scale's diagnostic screen is
 *    a choice, and overriding it would be this module deciding it knew better.
 *  - Text inside other text inherits its parent's font, the way it inherits its colour. It is
 *    given one of its own only when it asks for a weight of its own — a bold word in a regular
 *    sentence — because otherwise every nested run would be reset to regular, undoing the bold
 *    line it sits in.
 */
export function fontFor(
  style: { fontFamily?: string | undefined; fontWeight?: string | number | undefined } | undefined,
  { nested = false }: { nested?: boolean } = {},
): FontFamilyName | null {
  if (style?.fontFamily) return null;
  if (nested && (style?.fontWeight === undefined || style.fontWeight === null)) return null;
  return familyFor(style?.fontWeight);
}
