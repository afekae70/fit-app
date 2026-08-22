/**
 * An audit of the migrations, not of the running database.
 *
 * Row Level Security is the only thing standing between one user's training data and every
 * other authenticated user, and it fails silently: a table shipped without it is readable by
 * anyone holding any valid token, and nothing in the app looks different. The failure has no
 * symptom until someone goes looking.
 *
 * So the shape of the protection is asserted here, statically, against the SQL that will
 * actually run. The point is not to prove today's policies are right — they are, and the tests
 * below would have passed yesterday. The point is that the next migration to add a table cannot
 * quietly leave it open: this file fails, by name, in CI, before it reaches anyone's phone.
 *
 * What this cannot check, and what still needs a human: whether a policy's USING expression
 * names the correct owner. `USING (true)` on a private table would pass every assertion here
 * except the one that looks for it. Read new policies.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(import.meta.dirname, '../../drizzle');

const sql = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
  .join('\n');

interface Policy {
  name: string;
  table: string;
  body: string;
}

const tables = [
  ...new Set(
    [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "?([a-z_]+)"?/gi)].map((m) => m[1]!),
  ),
].sort();

const rlsEnabled = new Set(
  [...sql.matchAll(/ALTER TABLE\s+"?([a-z_]+)"?\s+ENABLE ROW LEVEL SECURITY/gi)].map((m) => m[1]!),
);

const policies: Policy[] = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON "?([a-z_]+)"?([\s\S]*?);/gi)].map(
  (m) => ({ name: m[1]!, table: m[2]!, body: m[3]! }),
);

const policiesFor = (table: string) => policies.filter((p) => p.table === table);

/** Catalogue tables every signed-in user is meant to read. Anything else is private. */
const SHARED_READ_ONLY = new Set(['equipment']);

describe('row level security, as written in the migrations', () => {
  it('finds the migrations at all', () => {
    // Guards the audit itself. Every assertion below iterates over what the regexes found, so a
    // moved directory or a renamed file would turn this whole file into a green no-op — a
    // security test that passes because it checked nothing.
    expect(tables.length).toBeGreaterThan(10);
    expect(policies.length).toBeGreaterThan(10);
  });

  it.each(tables)('%s has row level security enabled', (table) => {
    expect(rlsEnabled.has(table)).toBe(true);
  });

  it.each(tables)('%s has at least one policy', (table) => {
    // RLS with no policy denies everything, which is safe but is never what anyone meant — it
    // means a feature is silently broken rather than a door is open.
    expect(policiesFor(table).length).toBeGreaterThan(0);
  });

  it.each(policies.map((p): [string, Policy] => [`${p.table}.${p.name}`, p]))(
    '%s is granted only to authenticated users',
    (_label, policy) => {
      // `TO public` or `TO anon` on a private table hands it to anyone holding the anon key,
      // which ships inside the app bundle and is therefore not a secret at all.
      expect(policy.body).toMatch(/\bTO\s+authenticated\b/i);
      expect(policy.body).not.toMatch(/\bTO\s+(public|anon)\b/i);
    },
  );

  it.each(
    policies
      .filter((p) => /FOR\s+(ALL|INSERT|UPDATE)/i.test(p.body))
      .map((p): [string, Policy] => [`${p.table}.${p.name}`, p]),
  )('%s constrains what it writes with WITH CHECK', (_label, policy) => {
    // The single most common way RLS is got wrong. `USING` alone decides which rows you may
    // see and change; without `WITH CHECK`, nothing stops an UPDATE that rewrites a row's
    // owner, or an INSERT that files a new row under somebody else's id.
    expect(policy.body).toMatch(/WITH CHECK/i);
  });

  it.each(
    policies
      .filter((p) => !SHARED_READ_ONLY.has(p.table))
      .map((p): [string, Policy] => [`${p.table}.${p.name}`, p]),
  )('%s ties rows to an owner rather than allowing everything', (_label, policy) => {
    // `USING (true)` is correct for a shared catalogue and catastrophic anywhere else, so the
    // tables where it is allowed are named above and everything else must reach an owner —
    // directly through auth.uid(), or through a parent that does.
    expect(policy.body).toMatch(/auth\.uid\(\)/);
    expect(policy.body).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  it('reaches an owner for tables that have no user_id of their own', () => {
    // sets, session_exercises and the plan children hold the actual training data and carry no
    // user_id; they are owned through their parent. A policy that forgot the join would either
    // fail closed or, worse, match rows it should not.
    for (const table of ['sets', 'session_exercises', 'plan_days', 'plan_day_exercises']) {
      const owned = policiesFor(table);
      expect(owned.length).toBeGreaterThan(0);
      for (const policy of owned) {
        expect(policy.body).toMatch(/EXISTS|IN\s*\(/i);
      }
    }
  });
});
