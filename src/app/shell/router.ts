import { useSyncExternalStore } from 'react';

/**
 * Three places to be: the Projects home, the Vocabulary page, or one project
 * open in the editor.
 *
 * The route lives in the URL hash so a reload (or a teammate opening a shared
 * link on the LAN) lands in the same place, and the browser's Back button
 * returns from the editor to the projects grid. A hash needs nothing from the
 * server, which also serves the built app as a single page.
 */
export type Route =
  | { page: 'projects' }
  | { page: 'vocabulary' }
  | { page: 'editor'; projectId: string };

export const parseRoute = (hash: string): Route => {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'vocabulary') return { page: 'vocabulary' };
  const match = /^project\/([A-Za-z0-9_-]+)$/.exec(path);
  if (match) return { page: 'editor', projectId: match[1] };
  return { page: 'projects' };
};

export const formatRoute = (route: Route): string => {
  switch (route.page) {
    case 'vocabulary':
      return '#/vocabulary';
    case 'editor':
      return `#/project/${route.projectId}`;
    default:
      return '#/';
  }
};

let snapshotHash = typeof window !== 'undefined' ? window.location.hash : '';
let snapshot: Route = parseRoute(snapshotHash);

const read = (): Route => {
  const hash = window.location.hash;
  if (hash !== snapshotHash) {
    snapshotHash = hash;
    snapshot = parseRoute(hash);
  }
  return snapshot;
};

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};

export const useRoute = (): Route => useSyncExternalStore(subscribe, read, read);

export const navigate = (route: Route, options: { replace?: boolean } = {}): void => {
  const next = formatRoute(route);
  if (window.location.hash === next) return;
  if (options.replace) {
    window.history.replaceState(null, '', next);
    // replaceState does not fire hashchange, so tell listeners ourselves
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = next;
  }
};
