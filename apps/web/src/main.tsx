import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { applyTheme, readThemeChoice } from './theme/theme.js';
import './theme/global.css';

// Before the first paint, so a dark-scheme computer never sees a flash of the light one.
applyTheme(readThemeChoice());

/**
 * Never inside someone else's page. Framed, a button here could be lined up under a decoy and
 * clicked without the coach knowing what they pressed. A header would forbid it, but GitHub Pages
 * sets none, so the page itself declines and offers to open properly instead.
 */
const framed = (() => {
  try {
    return window.top !== window.self;
  } catch {
    // A frame on another site cannot even be asked: that is itself the answer.
    return true;
  }
})();

const root = document.getElementById('root');
if (root && framed) {
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = 'JustFit למאמנים נפתח רק בחלון משלו — לחץ כאן';
  root.replaceChildren(link);
} else if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
