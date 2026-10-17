/**
 * Every migration, read by PostgreSQL's own parser before anyone pastes it into the SQL editor.
 *
 * The audits next to this file read the migrations as text, which cannot tell valid SQL from
 * something that only looks like it. 0018 shipped with `IF NOT CASE … WHEN … THEN … END THEN`
 * inside a function: PL/pgSQL ends an IF's condition at its first THEN, so the server refused
 * the whole file — and the first anyone heard of it was the error in the SQL editor.
 *
 * So each file is parsed as SQL, and then — because a function's body is only a string to the
 * SQL parser — every PL/pgSQL body and DO block is parsed as PL/pgSQL, and every SQL-language
 * body as SQL. This is libpg_query, the parser from the PostgreSQL source, compiled to
 * WebAssembly: nothing to install on the machine and no database needed.
 *
 * What it cannot catch: a column or table that does not exist, a wrong type, a function called
 * with the wrong arguments. Those are only known to a database that has the schema.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadModule, parse, parsePlPgSQL } from '@libpg-query/parser';
import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS = join(import.meta.dirname, '../../drizzle');
const FILES = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort();

interface Statement {
  stmt: Record<string, unknown>;
  stmt_location?: number;
  stmt_len?: number;
}

interface DefElem {
  DefElem?: { defname?: string; arg?: { String?: { sval?: string } } };
}

interface FunctionNode {
  funcname: { String: { sval: string } }[];
  options?: DefElem[];
}

const option = (options: DefElem[] | undefined, name: string): string | undefined =>
  options?.find((o) => o.DefElem?.defname === name)?.DefElem?.arg?.String?.sval;

/** The text of each statement, cut by byte offsets — which is what the parser reports. */
function statementText(bytes: Buffer, entry: Statement): string {
  const start = entry.stmt_location ?? 0;
  const end = entry.stmt_len ? start + entry.stmt_len : bytes.length;
  return bytes.subarray(start, end).toString('utf8');
}

/** A PL/pgSQL body, or the reason it does not parse. */
async function plpgsqlError(createFunction: string): Promise<string | null> {
  try {
    await parsePlPgSQL(createFunction);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function sqlError(text: string): Promise<string | null> {
  try {
    await parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

beforeAll(async () => {
  await loadModule();
});

describe('every migration parses as PostgreSQL', () => {
  it('has migrations to read', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(18);
  });

  it.each(FILES)('%s', async (file) => {
    const bytes = readFileSync(join(MIGRATIONS, file));
    const text = bytes.toString('utf8');

    const whole = await sqlError(text);
    expect(whole, `${file} does not parse`).toBeNull();
    const tree = (await parse(text)) as { stmts: Statement[] };

    const failures: string[] = [];
    for (const entry of tree.stmts) {
      const kind = Object.keys(entry.stmt)[0];

      if (kind === 'CreateFunctionStmt') {
        const node = entry.stmt.CreateFunctionStmt as FunctionNode;
        const name = node.funcname.map((part) => part.String.sval).join('.');
        const language = option(node.options, 'language');
        if (language === 'plpgsql') {
          const error = await plpgsqlError(statementText(bytes, entry));
          if (error) failures.push(`${name}: ${error}`);
        } else if (language === 'sql') {
          const body = option(node.options, 'as');
          const error = body === undefined ? null : await sqlError(body);
          if (error) failures.push(`${name}: ${error}`);
        }
      } else if (kind === 'DoStmt') {
        // An anonymous block is a function with no name: parsed as one.
        const node = entry.stmt.DoStmt as { args: DefElem[] };
        const body = option(node.args, 'as') ?? '';
        const error = await plpgsqlError(
          `CREATE FUNCTION pg_temp.do_block() RETURNS void LANGUAGE plpgsql AS $do_block$${body}$do_block$;`,
        );
        if (error) failures.push(`DO block at byte ${entry.stmt_location ?? 0}: ${error}`);
      }
    }
    expect(failures, file).toEqual([]);
  });
});

describe('the parser itself', () => {
  // A check that cannot fail is not a check. The mistake 0018 shipped with, kept here.
  it('refuses a CASE inside an IF condition, as the server did', async () => {
    const broken = `CREATE FUNCTION f(p text) RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT CASE p WHEN 'a' THEN true ELSE false END THEN
          RAISE EXCEPTION 'no';
        END IF;
      END;
    $$;`;
    expect(await plpgsqlError(broken)).toMatch(/syntax error/);
  });

  it('reads past text that is several bytes a character', async () => {
    const text = `-- תגובה — with a dash\nSELECT 1;\nCREATE FUNCTION g() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;`;
    const bytes = Buffer.from(text, 'utf8');
    const tree = (await parse(text)) as { stmts: Statement[] };
    const fn = tree.stmts[1]!;
    expect(statementText(bytes, fn).trim().startsWith('CREATE FUNCTION g()')).toBe(true);
    expect(await plpgsqlError(statementText(bytes, fn))).toBeNull();
  });
});
