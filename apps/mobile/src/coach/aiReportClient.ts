/**
 * Sending a report of an AI answer: the one call to the server, kept apart from `aiReport.ts`
 * so that file stays free of the Supabase client and can be tested.
 */

import { getSupabaseClient } from '../auth/client.js';
import { interpretReportError, type AiReport, type ReportOutcome } from './aiReport.js';

/** Send one report. Never throws. */
export async function sendAiReport(report: AiReport): Promise<ReportOutcome> {
  const client = getSupabaseClient();
  if (!client) return 'sign_in_required';
  try {
    const { data } = await client.auth.getSession();
    if (!data.session) return 'sign_in_required';
    const { error } = await client.from('ai_reports').insert(report);
    return interpretReportError(error);
  } catch {
    return 'failed';
  }
}
