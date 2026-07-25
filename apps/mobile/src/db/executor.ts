/**
 * Minimal async SQL interface the repository is written against.
 *
 * The repository does not import expo-sqlite directly. expo-sqlite is a native module and
 * cannot load under vitest, so depending on it directly would leave the set-numbering logic —
 * the single most important invariant in the app — untestable off-device.
 *
 * With this seam, the app injects expo-sqlite and the tests inject Node's built-in
 * `node:sqlite`, so the tests exercise the REAL SQL against a REAL SQLite engine rather than a
 * hand-written mock that can only ever agree with the code under test.
 */

export interface SqlExecutor {
  /** Run a statement that returns no rows. */
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Run a query and return all rows. */
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a query and return the first row, or null. */
  get<T>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Execute a batch of statements (no parameters). */
  exec(sql: string): Promise<void>;
}

// The expo-sqlite adapter deliberately lives in provider.ts, not here: this module must stay
// free of anything native so the repository and its tests can import it under vitest.
