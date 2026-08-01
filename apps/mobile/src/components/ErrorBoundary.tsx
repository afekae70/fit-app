/**
 * Last line of defence against a render crash anywhere below it.
 *
 * Motivated directly by a real incident this app hit: a crash in one screen used to take the
 * whole app down (in the worst observed case, to a permanently blank screen with no way back
 * but a force-quit). React error boundaries can only be class components — there is no hook
 * equivalent — so this class does only the minimum the API requires (catch, hold the error,
 * offer a reset) and hands the actual UI to a normal function component below, which is free
 * to use `useTheme`/`useTranslation` like everything else.
 *
 * Placed once, around the whole navigator inside AppGate (see app/_layout.tsx) rather than
 * per-screen: simpler, and "back to a working screen" matters more here than "which exact
 * screen crashed" — reset re-mounts the stack fresh, landing wherever the app normally opens.
 */

import { Component, type ReactNode } from 'react';

import { ErrorFallback } from './ErrorFallback.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // No crash-reporting service wired up yet — this is at least visible in `adb logcat` /
    // Metro, which is what actually caught the bug this component exists to guard against.
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}
