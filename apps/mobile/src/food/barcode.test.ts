import { describe, expect, it } from 'vitest';

import { en } from '../i18n/locales/en.js';
import { he } from '../i18n/locales/he.js';
import {
  BARCODE_FAILURES,
  productCode,
  productLabel,
  productMacros,
  productUrl,
  readProduct,
} from './barcode.js';

/** What Open Food Facts answered for a real packet, cut down to the fields that are asked for. */
const BAMBA = {
  code: '7290000066318',
  status: 1,
  status_verbose: 'product found',
  product: {
    product_name: 'במבה',
    product_name_he: 'במבה',
    product_name_en: 'חטיף במבה',
    brands: 'אסם',
    serving_quantity: 80,
    serving_quantity_unit: 'g',
    nutriments: {
      'energy-kcal_100g': 535,
      energy_100g: 2232,
      proteins_100g: 17,
      carbohydrates_100g: 49,
      fat_100g: 30,
    },
  },
};

const found = (body: unknown) => {
  const reading = readProduct('7290000066318', body);
  if (!reading.ok) throw new Error(`expected a product, got ${reading.why}`);
  return reading.product;
};

describe('telling a product barcode from anything else', () => {
  it('accepts the three kinds printed on food', () => {
    expect(productCode('7290000066318')).toBe('7290000066318'); // EAN-13
    expect(productCode('3017620422003')).toBe('3017620422003');
    expect(productCode('96385074')).toBe('96385074'); // EAN-8
    expect(productCode('036000291452')).toBe('036000291452'); // UPC-A
    expect(productCode('  7290000066318\n')).toBe('7290000066318');
  });

  it('refuses a code with one digit misread', () => {
    // A different product, were it accepted. Every single-digit error fails the check digit.
    for (let position = 0; position < 13; position += 1) {
      const digits = [...'7290000066318'];
      digits[position] = String((Number(digits[position]) + 1) % 10);
      expect(productCode(digits.join('')), digits.join('')).toBeNull();
    }
  });

  it('refuses what is not a product code at all', () => {
    for (const raw of [
      '',
      '12345',
      '72900000663180', // fourteen digits
      '729000006631a',
      'https://example.com/7290000066318',
      '7290 0000 66318',
    ]) {
      expect(productCode(raw), raw).toBeNull();
    }
  });
});

describe('reading what the database says', () => {
  it('reads the name, the brand, the label per 100 g and the serving', () => {
    expect(found(BAMBA)).toEqual({
      code: '7290000066318',
      name: 'במבה',
      brand: 'אסם',
      kcal: 535,
      protein: 17,
      carbs: 49,
      fat: 30,
      servingGrams: 80,
    });
  });

  it('prefers the Hebrew name, then the plain one, then the English', () => {
    const named = (names: Record<string, unknown>) =>
      found({ ...BAMBA, product: { nutriments: BAMBA.product.nutriments, ...names } }).name;
    expect(named({ product_name_he: 'עברית', product_name: 'plain', product_name_en: 'en' })).toBe(
      'עברית',
    );
    expect(named({ product_name_he: '', product_name: 'plain', product_name_en: 'en' })).toBe(
      'plain',
    );
    expect(named({ product_name: '   ', product_name_en: 'en' })).toBe('en');
  });

  it('takes the first of several brands', () => {
    expect(
      found({ ...BAMBA, product: { ...BAMBA.product, brands: 'Nutella, Ferrero' } }).brand,
    ).toBe('Nutella');
    expect(found({ ...BAMBA, product: { ...BAMBA.product, brands: undefined } }).brand).toBeNull();
  });

  it('works calories out from kilojoules when that is all the label gave', () => {
    const product = found({
      ...BAMBA,
      product: { ...BAMBA.product, nutriments: { energy_100g: 2232, proteins_100g: 17 } },
    });
    expect(product.kcal).toBe(533);
    expect(product.protein).toBe(17);
    expect(product.carbs).toBeNull();
    expect(product.fat).toBeNull();
  });

  it('reads figures that arrive as text', () => {
    const product = found({
      ...BAMBA,
      product: {
        ...BAMBA.product,
        serving_quantity: '30',
        nutriments: { 'energy-kcal_100g': '535', proteins_100g: '17.5' },
      },
    });
    expect([product.kcal, product.protein, product.servingGrams]).toEqual([535, 17.5, 30]);
  });

  it('does not take a figure that cannot be true', () => {
    const product = found({
      ...BAMBA,
      product: {
        ...BAMBA.product,
        serving_quantity: -80,
        nutriments: {
          'energy-kcal_100g': 535,
          proteins_100g: 170,
          carbohydrates_100g: -1,
          fat_100g: 'lots',
        },
      },
    });
    expect([product.protein, product.carbs, product.fat, product.servingGrams]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('ignores a serving that is not a weight', () => {
    const product = found({
      ...BAMBA,
      product: { ...BAMBA.product, serving_quantity: 2, serving_quantity_unit: 'pieces' },
    });
    expect(product.servingGrams).toBeNull();
  });

  it('says so when the product is not in the database', () => {
    for (const body of [
      { status: 0, status_verbose: 'product not found' },
      { status: 1 },
      { status: 1, product: null },
      null,
      'text',
      [],
    ]) {
      expect(readProduct('7290000066318', body)).toEqual({ ok: false, why: 'not_found' });
    }
  });

  it('says so when the product is there with nothing to log', () => {
    expect(
      readProduct('7290000066318', {
        status: 1,
        product: { product_name: 'במבה', nutriments: {} },
      }),
    ).toEqual({ ok: false, why: 'no_values' });
    expect(
      readProduct('7290000066318', {
        status: 1,
        product: { nutriments: { 'energy-kcal_100g': 535 } },
      }),
    ).toEqual({ ok: false, why: 'no_values' });
    // More than pure fat holds: a mistake in the database, not a food.
    expect(
      readProduct('7290000066318', {
        status: 1,
        product: { product_name: 'x', nutriments: { 'energy-kcal_100g': 5350 } },
      }),
    ).toEqual({ ok: false, why: 'no_values' });
  });
});

describe('what an amount of a product holds', () => {
  const bamba = found(BAMBA);

  it('scales the label to the amount eaten', () => {
    expect(productMacros(bamba, 80)).toEqual({
      calories: 428,
      proteinG: 13.6,
      carbsG: 39.2,
      fatG: 24,
    });
    expect(productMacros(bamba, 100)).toEqual({
      calories: 535,
      proteinG: 17,
      carbsG: 49,
      fatG: 30,
    });
  });

  it('leaves a figure the label did not give as not given, rather than as zero', () => {
    expect(productMacros({ ...bamba, protein: null, fat: null }, 50)).toEqual({
      calories: 268,
      proteinG: null,
      carbsG: 24.5,
      fatG: null,
    });
  });
});

describe('what it is logged as, and where it is asked for', () => {
  it('names the product and whose it is, once', () => {
    const bamba = found(BAMBA);
    expect(productLabel(bamba)).toBe('במבה (אסם)');
    expect(productLabel({ ...bamba, brand: null })).toBe('במבה');
    expect(productLabel({ ...bamba, name: 'במבה אסם' })).toBe('במבה אסם');
  });

  it('asks the public database for that code and only the fields it reads', () => {
    const url = new URL(productUrl('7290000066318'));
    expect(url.origin).toBe('https://world.openfoodfacts.org');
    expect(url.pathname).toBe('/api/v2/product/7290000066318');
    expect(url.searchParams.get('fields')?.split(',')).toEqual(
      expect.arrayContaining(['product_name_he', 'nutriments', 'serving_quantity']),
    );
    // Nothing about the person goes with it.
    expect([...url.searchParams.keys()]).toEqual(['fields']);
  });
});

describe('saying why a lookup failed', () => {
  // The key is built at runtime (`barcode.failed_<reason>`), so the check that every literal
  // `t('…')` exists cannot see these. A missing one would put the key itself on screen.
  it.each(BARCODE_FAILURES)('%s, in both languages', (failure) => {
    const key = `failed_${failure}` as keyof typeof he.barcode;
    expect(he.barcode[key]).toEqual(expect.any(String));
    expect((en.barcode as Record<string, string>)[key]).toEqual(expect.any(String));
  });
});
