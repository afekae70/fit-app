/**
 * Whether sync has something to tell the user, and what.
 *
 * Almost always it has not. A sync that worked says nothing, and neither does one that could
 * not reach the server — no signal in a gym basement is routine, nothing was lost, and the next
 * time the app is opened it goes again. Those two are every sync most people will ever have.
 *
 * What is worth a line on screen is the other kind: the server answered and something was
 * wrong. That used to be visible only on a settings card, and then, once the card was removed,
 * nowhere at all — a failure could repeat for weeks while the app looked fine, which is exactly
 * how the real account's history once stopped reaching the cloud without anybody noticing.
 *
 * The part with no React in it, so that "when does the warning show" can be tested.
 */

import type { SyncStatus } from './SyncProvider.js';

export type SyncTroubleKind =
  /** The run failed outright. Nothing was lost; nothing new reached the cloud either. */
  | { kind: 'failed' }
  /** The run finished, and the server would not take `count` rows. The rest went up. */
  | { kind: 'refused'; count: number };

/** What to warn about, or null — which is the answer for every status but two. */
export function syncTroubleOf(status: SyncStatus): SyncTroubleKind | null {
  if (status.kind === 'error') return { kind: 'failed' };
  if (status.kind === 'partial' && status.refused > 0) {
    return { kind: 'refused', count: status.refused };
  }
  return null;
}
