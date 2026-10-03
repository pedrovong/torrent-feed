import { getSetting } from './db.js';

let sessionId = '';

export class TransmissionError extends Error {
  constructor(message: string, public code: string = 'client_error') {
    super(message);
  }
}

function rpcUrl(): string {
  const raw = getSetting('transmission_url').trim();
  if (!raw) throw new TransmissionError('Transmission RPC URL is not configured', 'client_not_configured');
  const url = new URL(/^https?:\/\//.test(raw) ? raw : `http://${raw}`);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/transmission/rpc';
  return url.toString();
}

/** Calls Transmission RPC, handling the 409 X-Transmission-Session-Id handshake. */
export async function rpc<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const url = rpcUrl();
  const user = getSetting('transmission_user');
  const pass = getSetting('transmission_password');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user || pass) headers.authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'x-transmission-session-id': sessionId },
        body: JSON.stringify({ method, arguments: args }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new TransmissionError(`Cannot reach Transmission: ${(e as Error).message}`, 'client_unreachable');
    }
    if (res.status === 409) {
      sessionId = res.headers.get('x-transmission-session-id') ?? '';
      await res.body?.cancel();
      continue;
    }
    if (res.status === 401) throw new TransmissionError('Transmission rejected the credentials', 'client_auth');
    if (!res.ok) throw new TransmissionError(`Transmission returned ${res.status}`);
    const json = (await res.json()) as { result: string; arguments: T };
    if (json.result !== 'success') throw new TransmissionError(json.result);
    return json.arguments;
  }
  throw new TransmissionError('Transmission session handshake failed');
}

export async function addTorrent(target: { magnet?: string | null; torrentUrl?: string | null }, opts: { downloadDir?: string; paused?: boolean }): Promise<string> {
  const filename = target.magnet || target.torrentUrl;
  if (!filename) throw new TransmissionError('Item has no magnet or torrent URL', 'no_source');
  const args: Record<string, unknown> = { filename, paused: !!opts.paused };
  if (opts.downloadDir) args['download-dir'] = opts.downloadDir;
  const r = await rpc('torrent-add', args);
  const t = r['torrent-added'] ?? r['torrent-duplicate'];
  return String(t?.hashString ?? '');
}

export async function removeTorrent(hash: string): Promise<void> {
  await rpc('torrent-remove', { ids: [hash], 'delete-local-data': false });
}

export async function testClient(): Promise<{ version: string; downloadDir: string }> {
  const s = await rpc('session-get', { fields: ['version', 'download-dir'] });
  return { version: String(s.version ?? ''), downloadDir: String(s['download-dir'] ?? '') };
}
