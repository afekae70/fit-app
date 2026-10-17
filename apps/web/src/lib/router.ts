/**
 * Where the dashboard is, from the part of the address after `#`.
 *
 * Hash addresses because the site is static files on GitHub Pages: there is no server to send
 * `/coach/trainee/123` back to the page, and a refresh there would be a 404. `#/trainee/123` is
 * always the same page, and the browser's back button works with it as with any address.
 */

import { useEffect, useState } from 'react';

export type TraineeTab = 'overview' | 'workouts' | 'plans' | 'calendar';

export type Route =
  { name: 'overview' } | { name: 'trainee'; id: string; tab: TraineeTab } | { name: 'admin' };

const TABS: readonly TraineeTab[] = ['overview', 'workouts', 'plans', 'calendar'];

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'trainee' && parts[1]) {
    const tab = TABS.find((candidate) => candidate === parts[2]) ?? 'overview';
    return { name: 'trainee', id: parts[1], tab };
  }
  if (parts[0] === 'admin') return { name: 'admin' };
  return { name: 'overview' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/';
    case 'admin':
      return '#/admin';
    case 'trainee':
      return `#/trainee/${encodeURIComponent(route.id)}${route.tab === 'overview' ? '' : `/${route.tab}`}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const changed = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return route;
}
