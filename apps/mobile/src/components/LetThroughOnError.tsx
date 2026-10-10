/**
 * For a screen that stands between the user and the app: if it cannot be drawn, get out of the
 * way.
 *
 * The app's own error boundary sits inside what these gates let through, so a fault while a
 * gate's screen is up would have nothing above it to catch it — and the result would be a blank
 * screen in front of someone's training log. A gate that will not draw must cost the gate, not
 * the app: `onError` is where the caller opens it.
 */

import { Component, type ReactNode } from 'react';

export class LetThroughOnError extends Component<
  { onError: () => void; what: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`${this.props.what} could not be shown, so it was skipped:`, error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
