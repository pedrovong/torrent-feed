import type { Category } from './api';

export function formatSize(bytes: number | null): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) (n /= 1024), i++;
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Compact age: 5m, 2h, 3d */
export function formatAge(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function formatRelative(ms: number | null): string {
  if (!ms) return 'never';
  const a = formatAge(ms);
  return a === 'now' ? 'just now' : `${a} ago`;
}

export function formatIn(ms: number | null): string {
  if (!ms) return '—';
  const m = Math.round((ms - Date.now()) / 60000);
  return m <= 0 ? 'any moment' : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

export const catKey = (c: Category) => c.toLowerCase();
export const catColor = (c: Category) => `var(--cat-${catKey(c)})`;

export const CATEGORIES = ['All', 'TV', 'Movies', 'Music', 'Linux'] as const;

export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported (iOS Safari) */
  }
}
