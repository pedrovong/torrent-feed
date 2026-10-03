import { useSyncExternalStore } from 'react';

/**
 * Connection config and theme live in localStorage. A browser has no Keychain/Keystore,
 * so the API token is stored here; serve the app over HTTPS and treat the device as trusted.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type SortOrder = 'asc' | 'desc';
export type FeedSort = 'date' | 'seeders' | 'leechers' | 'title';
export interface Config {
  serverUrl: string; // '' = same origin as the web app
  token: string;
  theme: ThemePref;
  recentFolders: string[];
  feedSort: FeedSort;
  feedOrder: SortOrder;
}

const KEY = 'torrent-feed-config';
const defaults: Config = { serverUrl: '', token: '', theme: 'system', recentFolders: [], feedSort: 'date', feedOrder: 'desc' };

function load(): Config {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

let current = load();
const listeners = new Set<() => void>();

export const getConfig = () => current;

export function updateConfig(patch: Partial<Config>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: keep in memory */
  }
  applyTheme(current.theme);
  listeners.forEach((l) => l());
}

export function useConfig(): Config {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    getConfig,
  );
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function isDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function rememberFolder(dir: string) {
  if (!dir) return;
  const next = [dir, ...current.recentFolders.filter((d) => d !== dir)].slice(0, 8);
  updateConfig({ recentFolders: next });
}

applyTheme(current.theme);
