/**
 * Flagging something the AI coach wrote — from inside the app, as Google Play's AI-generated
 * content policy asks of any app in which people get text from a model.
 *
 * A report is the text itself, what kind of text it was and why it was flagged; it goes to a
 * table that clients can add to and never read (0020), and is read in the Supabase dashboard.
 * This file is the part that decides — what a report may hold, and what an answer from the
 * server means — and is pure and tested; `aiReportClient.ts` is the one call to the server.
 */

export const AI_REPORT_KINDS = ['coach_reply', 'weekly_review', 'daily_brief'] as const;
export type AiReportKind = (typeof AI_REPORT_KINDS)[number];

/** In the order they are offered. The server holds the same list (0020). */
export const AI_REPORT_REASONS = ['offensive', 'harmful', 'wrong', 'other'] as const;
export type AiReportReason = (typeof AI_REPORT_REASONS)[number];

/** The server's bound on the reported text. A longer answer is cut, not refused. */
export const MAX_REPORT_CONTENT = 4000;

export interface AiReport {
  kind: AiReportKind;
  reason: AiReportReason;
  content: string;
}

/** The row to send, or null when there is nothing to report: an empty answer. */
export function buildAiReport(
  kind: AiReportKind,
  reason: AiReportReason,
  text: string,
): AiReport | null {
  const content = text.trim().slice(0, MAX_REPORT_CONTENT);
  if (content === '') return null;
  return { kind, reason, content };
}

export type ReportOutcome = 'sent' | 'sign_in_required' | 'too_many' | 'failed';

/** What the server's answer means for the person who pressed the button. */
export function interpretReportError(
  error: { code?: string; message?: string } | null,
): ReportOutcome {
  if (!error) return 'sent';
  if (error.code === '54000' || /too_many_reports/.test(error.message ?? '')) return 'too_many';
  if (error.code === '42501' || /JWT|not authenticated/i.test(error.message ?? '')) {
    return 'sign_in_required';
  }
  return 'failed';
}
