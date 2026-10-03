import { useSyncExternalStore } from 'react';

export type Screen = 'feed' | 'search' | 'sources' | 'settings';
export interface Route {
  screen: Screen;
  itemId: number | null;
}

const SCREENS: Screen[] = ['feed', 'search', 'sources', 'settings'];

/** Hash routes: #/feed, #/search, #/feed/item/12. The hash gives native back-button behavior for free. */
export function parseHash(hash: string): Route {
  const [, s, kind, id] = hash.split('/');
  const screen = SCREENS.includes(s as Screen) ? (s as Screen) : 'feed';
  const itemId = kind === 'item' && Number.isInteger(Number(id)) ? Number(id) : null;
  return { screen, itemId };
}

const subscribe = (cb: () => void) => (window.addEventListener('hashchange', cb), () => window.removeEventListener('hashchange', cb));
const snapshot = () => window.location.hash;

export function useRoute(): Route {
  return parseHash(useSyncExternalStore(subscribe, snapshot));
}

let detailPushed = false;

export function navigate(screen: Screen) {
  detailPushed = false;
  window.location.hash = `#/${screen}`;
}

export function openItem(screen: Screen, id: number) {
  detailPushed = true;
  window.location.hash = `#/${screen}/item/${id}`;
}

export function closeItem(screen: Screen) {
  if (detailPushed) {
    detailPushed = false;
    window.history.back();
  } else {
    window.location.replace(`#/${screen}`);
  }
}
