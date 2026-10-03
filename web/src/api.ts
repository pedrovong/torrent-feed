import { getConfig } from './store';

export type Category = 'TV' | 'Movies' | 'Music' | 'Linux' | 'Other';
export type ItemState = 'new' | 'sent' | 'hidden';

export interface ListItem {
  id: number;
  title: string;
  category: Category;
  tags: string[];
  size_bytes: number | null;
  seeders: number;
  leechers: number;
  published_at: number;
  state: ItemState;
  source_name: string;
}
export interface ItemsPage {
  items: ListItem[];
  next_cursor: string | null;
  total: number;
}
export interface ItemImage {
  id: number;
  source_url: string;
  width: number | null;
  height: number | null;
  status: 'pending' | 'ok' | 'failed';
  url: string;
}
export interface ItemDetail extends ListItem {
  origin: string | null;
  info_hash: string | null;
  magnet: string | null;
  details_url: string | null;
  description: string[];
  details_status: 'none' | 'pending' | 'ok' | 'failed';
  details_error: string | null;
  files: Array<{ path: string; size_bytes: number | null }>;
  images: ItemImage[];
}
export interface Source {
  id: number;
  name: string;
  url: string;
  type: 'rss' | 'knaben';
  category_default: Category | null;
  enabled: boolean;
  interval_min: number;
  headers_json: string | null;
  detail_headers_json: string | null;
  include_regex: string | null;
  exclude_regex: string | null;
  last_fetched_at: number | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  item_count: number;
  next_due_at: number | null;
}
export interface Status {
  version: string;
  next_poll_at: number | null;
  poll_interval_min: number | null;
  items_total: number;
  newest_created_at: number | null;
  new_since: number;
  sources_ok: number;
  sources_error: number;
  client_configured: boolean;
}
export interface ServerSettings {
  transmission_url: string;
  transmission_user: string;
  transmission_password_set: boolean;
  download_dir: string;
  start_paused: boolean;
  prune_days: number;
  prefetch_details: boolean;
}
export interface TestResult {
  ok: boolean;
  type?: string;
  count?: number;
  sample?: string[];
  error?: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function baseUrl() {
  return getConfig().serverUrl.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const { token } = getConfig();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { ...authHeaders(), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', "Can't reach server");
  }
  const text = await res.text();
  const json = text ? safeParse(text) : null;
  if (!res.ok) {
    const err = json?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Server returned ${res.status}`);
  }
  return json as T;
}

function safeParse(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Images need the bearer header, so fetch as a blob and hand the <img> an object URL. */
export async function fetchImageBlobUrl(path: string): Promise<string> {
  const res = await fetch(`${baseUrl()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new ApiError(res.status, 'image', 'Image failed to load');
  return URL.createObjectURL(await res.blob());
}

export const itemsQuery = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  return `/items?${sp.toString()}`;
};
