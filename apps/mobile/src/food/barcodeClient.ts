/**
 * Asking Open Food Facts what a barcode is.
 *
 * Straight from the phone, to a public database, with nothing about the person in the request:
 * no token, no account, only the digits of the barcode. It does not go through our function —
 * there is no key to protect and nothing to limit, and a hop through the function would spend
 * its time for nothing.
 *
 * The digits themselves are checked before anything is asked (`productCode`), so a misread
 * never leaves the phone.
 */

import Constants from 'expo-constants';

import {
  productCode,
  productUrl,
  readProduct,
  type BarcodeFailure,
  type Product,
} from './barcode.js';

export type BarcodeOutcome = { ok: true; product: Product } | { ok: false; error: BarcodeFailure };

const TIMEOUT_MS = 12_000;

/**
 * Who is asking, which the database asks every client to say. The app and where its source
 * is — nothing about the person or the phone.
 */
const USER_AGENT = `NovaFit/${Constants.expoConfig?.version ?? '0'} (https://github.com/afekae70/fit-app)`;

/** Look a barcode up. Never throws: every way it can go wrong is a reason. */
export async function lookUpBarcode(raw: string): Promise<BarcodeOutcome> {
  const code = productCode(raw);
  if (code === null) return { ok: false, error: 'not_a_code' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(productUrl(code), {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    // Read as text and parsed by hand: an error page is not JSON, and a product that is not
    // there is sometimes a 404 with a body and sometimes a 200 that says so.
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (body === null)
      return { ok: false, error: response.status === 404 ? 'not_found' : 'offline' };

    const reading = readProduct(code, body);
    return reading.ok ? reading : { ok: false, error: reading.why };
  } catch {
    return { ok: false, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
