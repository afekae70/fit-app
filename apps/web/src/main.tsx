import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { applyTheme, readThemeChoice } from './theme/theme.js';
import './theme/global.css';

// Before the first paint, so a dark-scheme computer never sees a flash of the light one.
applyTheme(readThemeChoice());

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
