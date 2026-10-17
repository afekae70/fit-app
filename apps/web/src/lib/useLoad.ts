/**
 * Load something once its inputs are known, and again on request.
 *
 * While it reloads, what was there stays on screen (`refreshing`), held back at reduced opacity
 * by the page, rather than replaced by a spinner — so a change of range does not make the page
 * jump. A load that finishes after a newer one has started is thrown away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CoachingError, CoachingResult } from '@fit/shared/coaching';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T; refreshing: boolean }
  | { state: 'failed'; error: CoachingError };

export function useLoad<T>(
  load: () => Promise<CoachingResult<T>>,
  deps: readonly unknown[],
): Loaded<T> & { reload: () => void } {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' });
  const ticket = useRef(0);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const mine = ++ticket.current;
    setResult((current) =>
      current.state === 'ready' ? { ...current, refreshing: true } : { state: 'loading' },
    );
    void load().then(
      (answer) => {
        if (ticket.current !== mine) return;
        setResult(
          answer.ok
            ? { state: 'ready', value: answer.value, refreshing: false }
            : { state: 'failed', error: answer.error },
        );
      },
      () => {
        if (ticket.current === mine) setResult({ state: 'failed', error: 'failed' });
      },
    );
    // The caller names what the load depends on; `load` itself is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { ...result, reload };
}
