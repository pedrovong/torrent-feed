import { parseKnaben } from './knaben.js';
import { parseRss } from './rss.js';
import type { NormalizedItem } from '../normalize.js';

export interface SourceRow {
  id: number;
  name: string;
  url: string;
  type: string;
  category_default: string | null;
  enabled: number;
  interval_min: number;
  headers_json: string | null;
  detail_headers_json: string | null;
  include_regex: string | null;
  exclude_regex: string | null;
  last_fetched_at: number | null;
  last_attempt_at: number | null;
  last_status: string | null;
  last_error: string | null;
  fail_count: number;
  item_count: number;
}

export function parseHeaders(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, val]) => [k, String(val)])) : {};
  } catch {
    return {};
  }
}

/** Fetch and parse a source. Feeds are admin-configured, so private (LAN) hosts such as Jackett/Prowlarr are allowed. */
export async function fetchSource(src: Pick<SourceRow, 'url' | 'type' | 'headers_json' | 'category_default'>): Promise<NormalizedItem[]> {
  const res = await fetch(src.url, {
    headers: { 'user-agent': 'TorrentFeed/0.1', accept: src.type === 'knaben' ? 'application/json' : 'application/rss+xml, application/xml, text/xml, */*', ...parseHeaders(src.headers_json) },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  if (src.type === 'knaben') return parseKnaben(await res.json(), src.category_default);
  return parseRss(await res.text(), src.category_default);
}

export function detectType(url: string): 'knaben' | 'rss' {
  try {
    return new URL(url).hostname.endsWith('knaben.org') ? 'knaben' : 'rss';
  } catch {
    return 'rss';
  }
}
