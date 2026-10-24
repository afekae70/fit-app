/**
 * Flagging what the AI coach wrote: what a report holds, that it agrees with what the server
 * will accept (0020), and what each answer from the server means to the person who flagged it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AI_REPORT_KINDS,
  AI_REPORT_REASONS,
  buildAiReport,
  interpretReportError,
  MAX_REPORT_CONTENT,
} from './aiReport.js';

const SERVER_SQL = readFileSync(
  join(import.meta.dirname, '../../../api/drizzle/0020_ai_reports.sql'),
  'utf8',
);

describe('a report of an AI answer', () => {
  it('carries the answer, its kind and the reason', () => {
    expect(buildAiReport('coach_reply', 'harmful', '  Skip meals for a week.  ')).toEqual({
      kind: 'coach_reply',
      reason: 'harmful',
      content: 'Skip meals for a week.',
    });
  });

  it('is nothing for an empty answer', () => {
    expect(buildAiReport('weekly_review', 'other', '   ')).toBeNull();
  });

  it('cuts a long answer to what the server keeps, rather than losing the report', () => {
    const report = buildAiReport('daily_brief', 'wrong', 'x'.repeat(MAX_REPORT_CONTENT + 500));
    expect(report?.content).toHaveLength(MAX_REPORT_CONTENT);
  });

  it('uses exactly the kinds, reasons and length the server checks', () => {
    expect(SERVER_SQL).toContain(
      `kind IN (${AI_REPORT_KINDS.map((kind) => `'${kind}'`).join(', ')})`,
    );
    expect(SERVER_SQL).toContain(
      `reason IN (${AI_REPORT_REASONS.map((reason) => `'${reason}'`).join(', ')})`,
    );
    expect(SERVER_SQL).toContain(`char_length(content) BETWEEN 1 AND ${MAX_REPORT_CONTENT}`);
  });

  it('never sends who it is from: the server fills that in', () => {
    const report = buildAiReport('coach_reply', 'offensive', 'text');
    expect(Object.keys(report ?? {}).sort()).toEqual(['content', 'kind', 'reason']);
  });
});

describe('what the server said about a report', () => {
  it('is sent when there was no error', () => {
    expect(interpretReportError(null)).toBe('sent');
  });

  it('says so when the day’s reports are used up', () => {
    expect(interpretReportError({ code: '54000', message: 'too_many_reports' })).toBe('too_many');
  });

  it('asks to sign in when the server does not know who is asking', () => {
    expect(
      interpretReportError({ code: '42501', message: 'new row violates row-level security' }),
    ).toBe('sign_in_required');
    expect(interpretReportError({ message: 'JWT expired' })).toBe('sign_in_required');
  });

  it('is a plain failure for anything else, including a server without the table yet', () => {
    expect(interpretReportError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(
      'failed',
    );
  });
});
