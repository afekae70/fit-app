/**
 * What every page of a signed-in dashboard shares: where the data comes from, who the coach
 * is and whom they coach, and what today is.
 */

import { createContext, useContext } from 'react';

import type { CoachingStatus } from '@fit/shared/coaching';

import type { CoachData } from './data/source.js';

export interface CoachSession {
  source: CoachData;
  status: CoachingStatus;
  /** The signed-in email, for the menu; the demonstration's made-up one in demo mode. */
  email: string;
  /** Local `YYYY-MM-DD`, fixed for the life of the page so every figure agrees on it. */
  today: string;
  /** Ask the server again who is coached — after a trainee is removed, say. */
  refreshStatus: () => Promise<void>;
  signOut: () => void;
}

export const CoachContext = createContext<CoachSession | null>(null);

export function useCoach(): CoachSession {
  const session = useContext(CoachContext);
  if (!session) throw new Error('useCoach outside a signed-in dashboard');
  return session;
}
