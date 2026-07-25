#!/usr/bin/env node
/**
 * Insert Drizzle `--> statement-breakpoint` markers into a hand-written SQL migration.
 *
 * Drizzle's migrator splits a migration file on those markers and runs each chunk as its own
 * query. Hand-placing them is easy to get wrong, and naive splitting on `;` corrupts plpgsql
 * function bodies — a `$$ ... $$` block legitimately contains semicolons that must NOT become
 * statement boundaries.
 *
 * This walks the file tracking whether it is inside a dollar-quoted block, a line comment, a
 * block comment, or a string literal, and only treats a `;` at depth zero as a boundary.
 *
 * Usage: node scripts/add-statement-breakpoints.mjs drizzle/0001_platform_objects.sql
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = '--> statement-breakpoint';

/** Split SQL into statements, ignoring semicolons inside quotes, comments and $$ blocks. */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    // Line comment — copy verbatim to end of line.
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment.
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Dollar-quoted block: $tag$ ... $tag$ (tag may be empty, as in $$).
    const dollarOpen = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollarOpen) {
      const tag = dollarOpen[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Single-quoted string, honouring '' escaping.
    if (rest.startsWith("'")) {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Double-quoted identifier.
    if (rest.startsWith('"')) {
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // A semicolon out here really does end a statement.
    if (sql[i] === ';') {
      current += ';';
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }

    current += sql[i];
    i += 1;
  }

  if (current.trim().length > 0) statements.push(current);
  return statements;
}

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/add-statement-breakpoints.mjs <file.sql>');
  process.exit(1);
}

const original = readFileSync(path, 'utf8');
if (original.includes(MARKER)) {
  console.log(`${path}: already has breakpoints, leaving unchanged.`);
  process.exit(0);
}

const statements = splitStatements(original);
// Keep only chunks that contain actual SQL, not trailing comment-only fragments.
const executable = statements.filter((s) => stripComments(s).trim().length > 0);

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

const output = executable.map((s) => s.trimEnd()).join(`\n${MARKER}\n`) + '\n';
writeFileSync(path, output, 'utf8');
console.log(`${path}: inserted ${executable.length - 1} breakpoints across ${executable.length} statements.`);
