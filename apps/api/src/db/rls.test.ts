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

/**
 * A table's name as either generation of migration writes it: `"plans"` from the generated ones,
 * `public.scheduled_days` from the hand-written ones. Without the schema part this audit read
 * `CREATE TABLE public.coach_links` as a table called `public` — and did not look at
 * `coach_links` at all.
 */
const NAME = String.raw`(?:"?public"?\.)?"?([a-z_]+)"?`;

const tables = [
  ...new Set(
    [...sql.matchAll(new RegExp(String.raw`CREATE TABLE(?: IF NOT EXISTS)?\s+${NAME}`, 'gi'))].map(
      (m) => m[1]!,
    ),
  ),
].sort();

const rlsEnabled = new Set(
  [
    ...sql.matchAll(
      new RegExp(String.raw`ALTER TABLE\s+${NAME}\s+ENABLE ROW LEVEL SECURITY`, 'gi'),
    ),
  ].map((m) => m[1]!),
);

const policies: Policy[] = [
  ...sql.matchAll(
    new RegExp(
      String.raw`CREATE POLICY\s+(?:"([^"]+)"|([a-z_0-9]+))\s+ON\s+${NAME}([\s\S]*?);`,
      'gi',
    ),
  ),
].map((m) => ({ name: (m[1] ?? m[2])!, table: m[3]!, body: m[4]! }));

const policiesFor = (table: string) => policies.filter((p) => p.table === table);

/** Catalogue tables every signed-in user is meant to read. Anything else is private. */
const SHARED_READ_ONLY = new Set(['equipment']);

/**
 * Tables no client may touch directly, in any way: who coaches whom, and who may appoint
 * coaches. They have row level security on and deliberately no policy, which denies everything,
 * and are reached only through the SECURITY DEFINER functions that check the caller first.
 *
 * Named here so that "no policy" is an assertion about these tables rather than an oversight
 * the audit forgives everywhere. A policy on one of them is a door, and fails below.
 */
const FUNCTIONS_ONLY = new Set(['coach_links', 'app_admins']);

/** Every role a table's privileges were taken away from, across all the migrations. */
const revokedFrom = (table: string) =>
  new Set(
    [
      ...sql.matchAll(
        new RegExp(String.raw`REVOKE ALL ON\s+(?:TABLE\s+)?${NAME}\s+FROM\s+([a-z_, ]+);`, 'gi'),
      ),
    ]
      .filter((m) => m[1] === table)
      .flatMap((m) => m[2]!.split(',').map((role) => role.trim().toLowerCase())),
  );

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

  it('reads a schema-qualified name as the table, not as the schema', () => {
    // The mistake this audit made for three migrations: it reported a table called "public" and
    // never examined the ones that were actually created.
    expect(tables).not.toContain('public');
    expect(tables).toEqual(expect.arrayContaining(['coach_links', 'app_admins', 'scheduled_days']));
    expect(policiesFor('scheduled_days').map((p) => p.name)).toEqual(['scheduled_days_own']);
  });

  it.each(tables.filter((table) => !FUNCTIONS_ONLY.has(table)))(
    '%s has at least one policy',
    (table) => {
      // RLS with no policy denies everything, which is safe but is never what anyone meant — it
      // means a feature is silently broken rather than a door is open.
      expect(policiesFor(table).length).toBeGreaterThan(0);
    },
  );

  it.each([...FUNCTIONS_ONLY])('%s is closed to every client', (table) => {
    // Here denying everything is exactly what was meant, so it is asserted both ways: no policy
    // lets a row through, and the table privileges are gone as well, so that a policy added
    // later by mistake still has nothing to grant.
    expect(tables).toContain(table);
    expect(policiesFor(table)).toEqual([]);
    expect([...revokedFrom(table)].sort()).toEqual(['anon', 'authenticated', 'public']);
    expect(sql).not.toMatch(
      new RegExp(String.raw`GRANT[^;]*\bON\s+(?:TABLE\s+)?(?:"?public"?\.)?"?${table}"?[\s;]`, 'i'),
    );
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
