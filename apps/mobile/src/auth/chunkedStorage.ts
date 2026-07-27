/**
 * Splits an arbitrarily long string across multiple `expo-secure-store` keys.
 *
 * `SecureStore.setItemAsync` throws once a value exceeds roughly 2048 bytes on Android — it is
 * backed by `SharedPreferences`, which has that ceiling. Supabase's persisted session is a JSON
 * blob containing an access token, a refresh token, and the user object; in practice that
 * routinely exceeds 2048 bytes. Without chunking, sign-in appears to work and then silently
 * fails to persist — the user is signed out the next time the app opens, with no error to
 * explain why.
 *
 * The chunking itself is pure string manipulation, so it is tested here without touching
 * `expo-secure-store` at all. `storage.ts` wraps this with the actual native calls.
 */

const CHUNK_SIZE = 1800;

/** `${key}__chunks` stores the count; `${key}__0`, `${key}__1`, … store the pieces. */
export function chunkKeys(key: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${key}__${i}`);
}

export function metaKey(key: string): string {
  return `${key}__chunks`;
}

/** Split a value into chunk strings and the count to store under the meta key. */
export function splitIntoChunks(value: string): { chunks: string[]; count: number } {
  if (value.length === 0) return { chunks: [''], count: 1 };

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  return { chunks, count: chunks.length };
}

/**
 * Reassemble a value from its chunks.
 *
 * Returns null when any chunk is missing rather than joining the ones present — a partial
 * reassembly would hand `JSON.parse` a truncated Supabase session, which is a worse failure
 * mode than "no session": it looks like real data and then fails deep inside the SDK.
 */
export function joinChunks(chunks: (string | null)[]): string | null {
  if (chunks.some((chunk) => chunk === null)) return null;
  return (chunks as string[]).join('');
}
