/**
 * A packaged food by its barcode: is this a product code, and what does the database say is
 * in the packet.
 *
 * The numbers come from Open Food Facts, a public, volunteer-maintained database of what is
 * printed on food packaging. It is free to ask and needs no key, which is why a barcode costs
 * nothing where a photograph spends an allowance — and what it returns is the label, not an
 * estimate. What it does not have, it does not have: coverage of what is sold in Israel is
 * partial, and a product that is missing is offered the by-hand route instead.
 *
 * Nothing here touches the network or the camera, so that the parts that can be silently
 * wrong — a misread digit, a label in kilojoules, a product with a name and no numbers — are
 * plain functions with tests. `barcodeClient.ts` does the asking.
 */

import { MAX_GRAMS } from './foodMath.js';

/**
 * The digits of a product barcode, or null if this is not one.
 *
 * EAN-13, EAN-8 and UPC-A, which are what is printed on food. Each ends in a check digit, and
 * it is checked: a camera reading a curved, shiny packet gets a digit wrong now and then, and
 * a wrong digit is otherwise a different product — somebody's biscuits logged as somebody
 * else's yoghurt, with nothing to suggest it.
 */
export function productCode(raw: string): string | null {
  const digits = raw.trim();
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(digits)) return null;

  // GS1: from the right, the check digit aside, digits weigh 3, 1, 3, 1…
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = 4 - weight) {
    sum += Number(digits[index]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]) ? digits : null;
}

/**
 * Every way a lookup can fail to produce something to log. Each has a sentence of its own in
 * both languages (`barcode.failed_<name>`), which the test for this file checks.
 */
export const BARCODE_FAILURES = [
  // Not a product barcode, or a digit was misread.
  'not_a_code',
  // The database has no such product.
  'not_found',
  // It has the product, and no name or no calories for it.
  'no_values',
  // No network, or no answer in time.
  'offline',
] as const;
export type BarcodeFailure = (typeof BARCODE_FAILURES)[number];

export interface Product {
  code: string;
  name: string;
  /** Who makes it, when the database says. Shown beside the name; not part of it. */
  brand: string | null;
  /** Per 100 g (or 100 ml), as the label has it. Calories are always there; the rest may not be. */
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The packet's own serving, in grams, where it declares one. */
  servingGrams: number | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** A label figure: a number, or a number as text, that is not negative. Otherwise null. */
const figure = (value: unknown, max: number): number | null => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : null;
};

/** Pure fat is 900 kcal per 100 g. More than that on a label is a mistake in the database. */
const MAX_KCAL_PER_100 = 900;
const KJ_PER_KCAL = 4.184;

export type ProductReading =
  | { ok: true; product: Product }
  /** The database has no such product. */
  | { ok: false; why: 'not_found' }
  /** It has the product, and not enough about it to log: no name, or no calories. */
  | { ok: false; why: 'no_values' };

/**
 * What the database's answer says about a product.
 *
 * The answer is somebody else's JSON, entered by volunteers, and is read as that: every field
 * may be missing, a number may arrive as text, energy may be given only in kilojoules.
 */
export function readProduct(code: string, body: unknown): ProductReading {
  if (typeof body !== 'object' || body === null) return { ok: false, why: 'not_found' };
  const answer = body as { status?: unknown; product?: unknown };
  if (answer.status !== 1 || typeof answer.product !== 'object' || answer.product === null) {
    return { ok: false, why: 'not_found' };
  }
  const product = answer.product as Record<string, unknown>;
  const nutriments =
    typeof product.nutriments === 'object' && product.nutriments !== null
      ? (product.nutriments as Record<string, unknown>)
      : {};

  // The Hebrew name first: it is what is printed on the packet in the person's hand.
  const name =
    text(product.product_name_he) ?? text(product.product_name) ?? text(product.product_name_en);

  const kilojoules = figure(nutriments.energy_100g, MAX_KCAL_PER_100 * KJ_PER_KCAL);
  const kcal =
    figure(nutriments['energy-kcal_100g'], MAX_KCAL_PER_100) ??
    (kilojoules === null ? null : Math.round(kilojoules / KJ_PER_KCAL));

  if (name === null || kcal === null) return { ok: false, why: 'no_values' };

  // A serving is only usable as a weight when it is one. Millilitres are taken as grams, as
  // the per-100 figures of a drink are per 100 ml.
  const unit = text(product.serving_quantity_unit)?.toLowerCase() ?? 'g';
  const serving =
    unit === 'g' || unit === 'ml' ? figure(product.serving_quantity, MAX_GRAMS) : null;

  return {
    ok: true,
    product: {
      code,
      name: name.slice(0, 100),
      // "Nutella, Ferrero" is a list; the first is the brand on the front of the packet.
      brand: text(product.brands)?.split(',')[0]?.trim().slice(0, 60) || null,
      kcal,
      protein: figure(nutriments.proteins_100g, 100),
      carbs: figure(nutriments.carbohydrates_100g, 100),
      fat: figure(nutriments.fat_100g, 100),
      servingGrams: serving !== null && serving > 0 ? serving : null,
    },
  };
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/** What `grams` of a product holds. A figure the label did not give stays not given. */
export function productMacros(
  product: Product,
  grams: number,
): { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null } {
  const share = grams / 100;
  const of = (per100: number | null) => (per100 === null ? null : tenth(per100 * share));
  return {
    calories: Math.round(product.kcal * share),
    proteinG: of(product.protein),
    carbsG: of(product.carbs),
    fatG: of(product.fat),
  };
}

/** The name an entry is logged under: the product, and whose it is. */
export function productLabel(product: Product): string {
  return product.brand && !product.name.includes(product.brand)
    ? `${product.name} (${product.brand})`
    : product.name;
}

/** Where a product is asked for. Only the fields that are read are requested. */
export function productUrl(code: string): string {
  const fields = [
    'product_name',
    'product_name_he',
    'product_name_en',
    'brands',
    'nutriments',
    'serving_quantity',
    'serving_quantity_unit',
  ].join(',');
  return `https://world.openfoodfacts.org/api/v2/product/${code}?fields=${fields}`;
}
