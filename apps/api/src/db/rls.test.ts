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
 * A table's name as any migration writes it: `"plans"` from the generated ones,
 * `public.scheduled_days` from the hand-written ones, `storage.objects` for a file policy.
 * Without the schema part this audit read `CREATE TABLE public.coach_links` as a table called
 * `public` — and did not look at `coach_links` at all.
 */
const NAME = String.raw`(?:"?[a-z_]+"?\.)?"?([a-z_]+)"?`;

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

/**
 * `profiles` is the one table where owning the row is not the whole question.
 *
 * It holds what a person says about themselves, and since 0007 it also holds whether they are
 * a coach — which is not theirs to say. Row level security cannot tell those apart: a policy
 * decides which rows, never which columns. For three migrations any signed-in account could
 * make itself a coach with one request to its own row, and every assertion above passed.
 *
 * So the columns are audited here, by name.
 */
describe('what a client may write on its own profile', () => {
  const granted = (privilege: 'INSERT' | 'UPDATE') => {
    const match = new RegExp(
      String.raw`GRANT ${privilege}\s*\(([^)]+)\)\s+ON\s+public\.profiles\s+TO\s+authenticated;`,
      'i',
    ).exec(sql);
    return (match?.[1] ?? '').split(',').map((column) => column.trim());
  };

  /** Decided by the owner or by the server, never by the account itself. */
  const NOT_THE_CLIENTS = ['role', 'coach_code', 'created_at', 'updated_at'];

  it('takes the whole-table right to write away from every client role', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toMatch(
        new RegExp(String.raw`REVOKE INSERT, UPDATE ON public\.profiles FROM ${role};`),
      );
    }
  });

  it.each(['INSERT', 'UPDATE'] as const)('grants %s on named columns only', (privilege) => {
    const columns = granted(privilege);
    expect(columns.length).toBeGreaterThan(5);
    for (const column of NOT_THE_CLIENTS) expect(columns).not.toContain(column);
    // What a person does fill in is still theirs to save.
    for (const column of ['display_name', 'height_cm', 'goal', 'avatar_version']) {
      expect(columns).toContain(column);
    }
  });

  it('lets a client name its own row when creating it, and never rename it afterwards', () => {
    expect(granted('INSERT')).toContain('id');
    expect(granted('UPDATE')).not.toContain('id');
  });

  it('never hands the whole table back', () => {
    // A later `GRANT ALL` or column-less `GRANT UPDATE` would undo all of the above in one
    // line, and would look like routine housekeeping in a review.
    const after = sql.slice(
      sql.indexOf('REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;'),
    );
    expect(after).not.toMatch(
      /GRANT\s+(ALL|[A-Z, ]*\b(INSERT|UPDATE)\b(?!\s*\())[^;]*ON\s+(TABLE\s+)?(public\.)?"?profiles"?\s/i,
    );
  });

  it('refuses to commit unless Postgres agrees the two columns are closed', () => {
    // The revokes only remove grants made by the role running the script. The migration asks
    // the catalogue instead of assuming, and this keeps that question from being deleted.
    expect(sql).toMatch(
      /has_column_privilege\(client::name, 'public\.profiles'::text, col, 'UPDATE'::text\)/,
    );
    expect(sql).toMatch(/ARRAY\['role', 'coach_code'\]/);
    expect(sql).toMatch(/RAISE EXCEPTION\s+'profiles\.% can still be written/);
  });

  it('also holds the two columns still with a trigger, whoever granted what', () => {
    const body =
      /CREATE OR REPLACE FUNCTION public\.profiles_keep_role\(\)([\s\S]*?)\$\$;/.exec(sql)?.[1] ??
      '';
    expect(body).toMatch(/current_user IN \('authenticated', 'anon'\)/);
    expect(body).toMatch(/NEW\.role := OLD\.role/);
    expect(body).toMatch(/NEW\.coach_code := OLD\.coach_code/);
    expect(body).toMatch(/NEW\.role := 'trainee'/);
    // It must see the caller, so it must not run as its owner.
    expect(body).not.toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(
      /CREATE TRIGGER profiles_keep_role\s+BEFORE INSERT OR UPDATE ON public\.profiles/,
    );
  });
});

describe('profile pictures in file storage', () => {
  const filePolicies = policies.filter((p) => p.table === 'objects');

  it('finds the four things that can be done to a file', () => {
    expect(filePolicies.map((p) => p.name).sort()).toEqual([
      'avatars_own_delete',
      'avatars_own_insert',
      'avatars_own_select',
      'avatars_own_update',
    ]);
  });

  it.each(filePolicies.map((p): [string, Policy] => [p.name, p]))(
    '%s reaches only this bucket, and only the folder named after the caller',
    (_name, policy) => {
      // `storage.objects` holds every file in the project. A policy that left out the bucket
      // would apply to all of them; one that left out the folder would open every picture to
      // every signed-in account.
      const conditions = policy.body.match(/\((bucket_id[^;]*?::text)\)/g) ?? [];
      expect(conditions.length).toBeGreaterThan(0);
      for (const condition of conditions) {
        expect(condition).toContain("bucket_id = 'avatars'");
        expect(condition).toContain('(storage.foldername(name))[1] = (SELECT auth.uid())::text');
      }
      expect(policy.body).not.toMatch(/\bOR\b/);
    },
  );

  it('keeps the bucket private, on first run and on every run after', () => {
    expect(sql).toMatch(/VALUES \('avatars', 'avatars', false,/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE\s+SET public = false/);
  });
});

/**
 * The functions a coach reaches a trainee's data through.
 *
 * These run with their owner's rights and step around row level security entirely — that is
 * what lets one account read another's rows at all. So the whole of the protection is a single
 * line at the top of each: `coach_require_link`, which refuses anyone who is not, right now,
 * the coach that trainee connected to. A function that took a trainee's id and forgot that
 * line would hand any signed-in account any other account's data, and nothing would look
 * wrong: it would work perfectly for every real coach.
 */
describe('functions that act on a trainee', () => {
  interface Fn {
    name: string;
    params: string;
    /** From the parameter list to the end of the body: the attributes and the code. */
    rest: string;
  }

  /** The definition in force: a function replaced by a later migration is read as replaced. */
  const functions = new Map<string, Fn>();
  for (const m of sql.matchAll(
    /CREATE OR REPLACE FUNCTION public\.([a-z_]+)\s*\(([^)]*)\)([\s\S]*?)\n\$\$;/g,
  )) {
    functions.set(m[1]!, { name: m[1]!, params: m[2]!, rest: m[3]! });
  }
  // Removed by 0008, which made being a coach the owner's decision.
  for (const m of sql.matchAll(/DROP FUNCTION IF EXISTS public\.([a-z_]+)/g))
    functions.delete(m[1]!);

  const onTrainee = [...functions.values()].filter((fn) => /\bp_trainee\s+uuid\b/.test(fn.params));

  it('finds them', () => {
    expect(onTrainee.map((fn) => fn.name).sort()).toEqual([
      'coach_delete',
      'coach_get_plans',
      'coach_get_schedule',
      'coach_get_sessions',
      'coach_remove_trainee',
      'coach_require_link',
      'coach_save_day',
      'coach_save_plan',
      'coach_set_schedule',
    ]);
  });

  it.each(
    onTrainee
      // The check itself, and the one function whose whole job is to delete the caller's own
      // link, which it finds by the caller's id.
      .filter((fn) => fn.name !== 'coach_require_link' && fn.name !== 'coach_remove_trainee')
      .map((fn): [string, Fn] => [fn.name, fn]),
  )('%s checks the link before it does anything else', (_name, fn) => {
    expect(fn.rest).toMatch(/\nBEGIN\s+PERFORM public\.coach_require_link\(p_trainee\);/);
  });

  it('removes a trainee only from the caller', () => {
    const body = functions.get('coach_remove_trainee')?.rest ?? '';
    expect(body).toMatch(/DELETE FROM public\.coach_links/);
    expect(body).toMatch(/coach_id = me/);
    expect(body).toMatch(/trainee_id = p_trainee/);
  });

  it.each(onTrainee.map((fn): [string, Fn] => [fn.name, fn]))(
    '%s runs with a fixed search path',
    (_name, fn) => {
      // A SECURITY DEFINER function that resolves names through the caller's search path can be
      // made to run the caller's own function in place of the one it meant.
      expect(fn.rest).toMatch(/SECURITY DEFINER/);
      expect(fn.rest).toMatch(/SET search_path = ''/);
    },
  );

  describe('reading finished workouts', () => {
    const fn = functions.get('coach_get_sessions');

    it('only reads', () => {
      expect(fn?.rest).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    });

    it('does not send the body weight', () => {
      // The app tells a trainee their coach does not see it. `bodyweight_kg` is a column of
      // the very table this reads, one word away from being included.
      expect(fn?.rest).toMatch(/public\.workout_sessions/);
      expect(fn?.rest).not.toMatch(/bodyweight/i);
      expect(fn?.rest).not.toMatch(/ws\.\*|\bst\.\*|\be\.\*/);
    });

    it('sends the note on the workout itself, and no other note', () => {
      // Since 0013 a trainee can write a note on a finished workout, on a screen that says
      // their coach will read it. That one column, read once, under a name of its own — and
      // not the notes on an exercise or a set, which nobody has been told a coach can see.
      expect(fn?.rest.match(/\bnotes\b/gi)).toEqual(['notes']);
      expect(fn?.rest).toMatch(/ws\.notes AS session_note/);
      expect(fn?.rest).toMatch(/'note', s\.session_note/);
      expect(fn?.rest).not.toMatch(/\b(e|st)\.notes\b/);
    });

    it('sends only this trainee’s, only finished, only sets that were done, and not without limit', () => {
      expect(fn?.rest).toMatch(/ws\.user_id = p_trainee/);
      expect(fn?.rest).toMatch(/ws\.ended_at IS NOT NULL/);
      expect(fn?.rest).toMatch(/st\.done_at IS NOT NULL/);
      expect(fn?.rest).toMatch(/LIMIT \d+/);
    });

    it('is closed to anyone not signed in', () => {
      const signature = String.raw`public\.coach_get_sessions\(uuid, timestamptz, timestamptz\)`;
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`));
    });
  });
});
