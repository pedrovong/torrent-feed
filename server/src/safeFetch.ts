import dns from 'node:dns/promises';
import net from 'node:net';
import { ALLOW_PRIVATE_HOSTS } from './config.js';

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

/** Throws unless the URL is http(s) and every address it resolves to is public. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Blocked protocol ${url.protocol}`);
  if (ALLOW_PRIVATE_HOSTS) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.length === 0) throw new Error('Host did not resolve');
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('Blocked private address');
  return url;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Return true to accept the response's content-type; otherwise the fetch is aborted. */
  acceptType?: (contentType: string) => boolean;
}

export interface SafeResponse {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
}

/**
 * Fetch an untrusted URL: public addresses only (re-checked on each redirect),
 * bounded time and size, content-type gate. Note: DNS is resolved once for the
 * check and again by fetch; a rebinding attacker could race that, which is an
 * accepted risk for a single-user home server.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { timeoutMs = 15000, maxBytes = 8 * 1024 * 1024, maxRedirects = 4 } = opts;
  const deadline = AbortSignal.timeout(timeoutMs);
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: deadline,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TorrentFeed/0.1)', accept: '*/*', ...opts.headers },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      await res.body?.cancel();
      continue;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (opts.acceptType && !opts.acceptType(contentType)) {
      await res.body?.cancel();
      throw new Error(`Unexpected content-type ${contentType || '(none)'}`);
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new Error('Response too large');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) throw new Error('Response too large');
        chunks.push(Buffer.from(chunk));
      }
    }
    return { status: res.status, url: url.toString(), contentType, body: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}
