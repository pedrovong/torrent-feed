import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IMAGES_DIR, VERSION } from './config.js';
import { db, getSetting, setSetting, SETTING_DEFAULTS } from './db.js';
import { enqueueDetails, removeImageFiles } from './details.js';
import { htmlToParagraphs } from './detailParser.js';
import { nextPollAt, pollAll, pollSource, prune, dueAt } from './ingest.js';
import { addTorrent, removeTorrent, testClient, TransmissionError } from './transmission.js';
import { detectType, fetchSource, type SourceRow } from './sources/index.js';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const LIST_COLUMNS = `i.id, i.title, i.category, i.tags_json, i.size_bytes, i.seeders, i.leechers, i.published_at, i.state, s.name AS source_name`;

function listRow(r: any) {
  const { tags_json, ...rest } = r;
  return { ...rest, tags: JSON.parse(tags_json) as string[] };
}

function ftsQuery(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}]+/gu);
  return tokens?.length ? tokens.map((t) => `"${t}"*`).join(' ') : null;
}

const encodeCursor = (published: number, id: number) => Buffer.from(`${published}_${id}`).toString('base64url');
function decodeCursor(c: string): [number, number] {
  const [p, i] = Buffer.from(c, 'base64url').toString().split('_').map(Number);
  if (!Number.isFinite(p) || !Number.isFinite(i)) throw new ApiError(400, 'bad_cursor', 'Invalid cursor');
  return [p, i];
}

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'bad_id', 'Invalid id');
  return n;
};

const sourceBody = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().refine((u) => /^https?:/.test(u), 'Must be http(s)'),
  type: z.enum(['rss', 'knaben']).optional(),
  category_default: z.enum(['TV', 'Movies', 'Music', 'Linux', 'Other']).nullable().optional(),
  enabled: z.boolean().optional(),
  interval_min: z.number().int().min(1).max(1440).optional(),
  headers_json: z.string().nullable().optional(),
  detail_headers_json: z.string().nullable().optional(),
  include_regex: z.string().max(500).nullable().optional(),
  exclude_regex: z.string().max(500).nullable().optional(),
});

function checkJsonObject(v: string | null | undefined, field: string) {
  if (!v) return;
  try {
    const p = JSON.parse(v);
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error();
  } catch {
    throw new ApiError(400, 'bad_request', `${field} must be a JSON object, e.g. {"Cookie":"..."}`);
  }
}

function checkRegex(v: string | null | undefined, field: string) {
  if (!v) return;
  try {
    new RegExp(v);
  } catch {
    throw new ApiError(400, 'bad_request', `${field} is not a valid regular expression`);
  }
}

function sourceOut(s: SourceRow) {
  return { ...s, enabled: !!s.enabled, next_due_at: s.enabled ? (s.last_attempt_at ? dueAt(s) : Date.now()) : null };
}

export function registerRoutes(app: FastifyInstance) {
  // ---- items ----------------------------------------------------------------
  app.get('/items', async (req) => {
    const q = z
      .object({
        state: z.string().default('new'),
        category: z.string().optional(),
        q: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        min_res: z.coerce.number().int().optional(),
        min_seeders: z.coerce.number().int().optional(),
        since_days: z.coerce.number().optional(),
      })
      .parse(req.query);

    const states = q.state.split(',').filter((s) => ['new', 'sent', 'hidden'].includes(s));
    if (!states.length) throw new ApiError(400, 'bad_request', 'Invalid state');
    const where: string[] = [`i.state IN (${states.map(() => '?').join(',')})`];
    const params: unknown[] = [...states];
    let join = '';

    if (q.category && q.category !== 'All') (where.push('i.category = ?'), params.push(q.category));
    if (q.min_res) (where.push('i.resolution >= ?'), params.push(q.min_res));
    if (q.min_seeders) (where.push('i.seeders >= ?'), params.push(q.min_seeders));
    if (q.since_days) (where.push('i.published_at >= ?'), params.push(Date.now() - q.since_days * 86_400_000));
    if (q.q !== undefined && q.q.trim()) {
      const fts = ftsQuery(q.q);
      if (!fts) return { items: [], next_cursor: null, total: 0 };
      join = 'JOIN items_fts ON items_fts.rowid = i.id';
      where.push('items_fts MATCH ?');
      params.push(fts);
    }

    const base = `FROM items i JOIN sources s ON s.id = i.source_id ${join} WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params) as { n: number }).n;

    const pageWhere = [...where];
    const pageParams = [...params];
    if (q.cursor) {
      const [p, id] = decodeCursor(q.cursor);
      pageWhere.push('(i.published_at < ? OR (i.published_at = ? AND i.id < ?))');
      pageParams.push(p, p, id);
    }
    const rows = db
      .prepare(`SELECT ${LIST_COLUMNS} FROM items i JOIN sources s ON s.id = i.source_id ${join} WHERE ${pageWhere.join(' AND ')} ORDER BY i.published_at DESC, i.id DESC LIMIT ?`)
      .all(...pageParams, q.limit + 1) as any[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { items: page.map(listRow), next_cursor: hasMore && last ? encodeCursor(last.published_at, last.id) : null, total };
  });

  app.get('/items/:id', async (req) => {
    const id = idParam((req.params as any).id);
    const row = db.prepare(`SELECT i.*, s.name AS source_name FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?`).get(id) as any;
    if (!row) throw new ApiError(404, 'not_found', 'Item not found');

    const stale = row.details_status === 'failed' && Date.now() - (row.details_fetched_at ?? 0) > 10 * 60_000;
    if (row.details_status === 'none' || stale) {
      enqueueDetails(id, true);
      row.details_status = 'pending';
    }

    const files = db.prepare('SELECT path, size_bytes FROM item_files WHERE item_id = ?').all(id);
    const images = db
      .prepare('SELECT id, source_url, width, height, status FROM item_images WHERE item_id = ? ORDER BY id')
      .all(id)
      .map((im: any) => ({ id: im.id, source_url: im.source_url, width: im.width, height: im.height, status: im.status, url: `/api/images/${im.id}` }));

    return {
      id: row.id,
      title: row.title,
      category: row.category,
      tags: JSON.parse(row.tags_json) as string[],
      size_bytes: row.size_bytes,
      seeders: row.seeders,
      leechers: row.leechers,
      published_at: row.published_at,
      state: row.state,
      source_name: row.source_name,
      origin: row.origin,
      info_hash: row.info_hash.startsWith('x-') ? null : row.info_hash,
      magnet: row.magnet,
      details_url: row.details_url,
      description: htmlToParagraphs(row.description_html),
      details_status: row.details_status,
      details_error: row.details_error,
      files,
      images,
    };
  });

  app.post('/items/:id/refresh-details', async (req) => {
    const id = idParam((req.params as any).id);
    enqueueDetails(id, true);
    return { ok: true };
  });

  app.post('/items/:id/download', async (req) => {
    const id = idParam((req.params as any).id);
    const body = z.object({ download_dir: z.string().optional(), paused: z.boolean().optional() }).parse(req.body ?? {});
    const item = db.prepare('SELECT id, magnet, torrent_url FROM items WHERE id = ?').get(id) as any;
    if (!item) throw new ApiError(404, 'not_found', 'Item not found');
    try {
      const hash = await addTorrent(
        { magnet: item.magnet, torrentUrl: item.torrent_url },
        { downloadDir: body.download_dir || getSetting('download_dir') || undefined, paused: body.paused ?? getSetting('start_paused') === '1' },
      );
      db.prepare(`UPDATE items SET state = 'sent', sent_at = ?, client_torrent_id = ? WHERE id = ?`).run(Date.now(), hash || null, id);
      return { ok: true, state: 'sent', client_torrent_id: hash };
    } catch (e) {
      if (e instanceof TransmissionError) throw new ApiError(502, e.code, e.message);
      throw e;
    }
  });

  app.post('/items/:id/hide', async (req) => {
    const id = idParam((req.params as any).id);
    const r = db.prepare(`UPDATE items SET state = 'hidden' WHERE id = ?`).run(id);
    if (!r.changes) throw new ApiError(404, 'not_found', 'Item not found');
    return { ok: true, state: 'hidden' };
  });

  app.post('/items/:id/restore', async (req) => {
    const id = idParam((req.params as any).id);
    const { remove_from_client } = z.object({ remove_from_client: z.coerce.boolean().optional() }).parse(req.query);
    const item = db.prepare('SELECT state, client_torrent_id FROM items WHERE id = ?').get(id) as any;
    if (!item) throw new ApiError(404, 'not_found', 'Item not found');
    let warning: string | undefined;
    if (item.state === 'sent' && remove_from_client && item.client_torrent_id) {
      try {
        await removeTorrent(item.client_torrent_id);
      } catch (e) {
        warning = `Marked as new, but could not remove from client: ${(e as Error).message}`;
      }
    }
    db.prepare(`UPDATE items SET state = 'new', sent_at = NULL, client_torrent_id = NULL WHERE id = ?`).run(id);
    return { ok: true, state: 'new', warning };
  });

  // ---- images ---------------------------------------------------------------
  app.get('/images/:id', async (req, reply) => {
    const id = idParam((req.params as any).id);
    const img = db.prepare(`SELECT local_path FROM item_images WHERE id = ? AND status = 'ok'`).get(id) as { local_path: string } | undefined;
    if (!img?.local_path) throw new ApiError(404, 'not_found', 'Image not found');
    const file = path.join(IMAGES_DIR, path.basename(img.local_path));
    if (!fs.existsSync(file)) throw new ApiError(404, 'not_found', 'Image not found');
    return reply.header('cache-control', 'private, max-age=31536000, immutable').type('image/webp').send(fs.createReadStream(file));
  });

  // ---- sources --------------------------------------------------------------
  app.get('/sources', async () => (db.prepare('SELECT * FROM sources ORDER BY id').all() as SourceRow[]).map(sourceOut));

  app.post('/sources', async (req, reply) => {
    const b = sourceBody.parse(req.body);
    checkJsonObject(b.headers_json, 'headers_json');
    checkJsonObject(b.detail_headers_json, 'detail_headers_json');
    checkRegex(b.include_regex, 'include_regex');
    checkRegex(b.exclude_regex, 'exclude_regex');
    const r = db
      .prepare(
        `INSERT INTO sources (name, url, type, category_default, enabled, interval_min, headers_json, detail_headers_json, include_regex, exclude_regex)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.name, b.url, b.type ?? detectType(b.url), b.category_default ?? null, b.enabled === false ? 0 : 1, b.interval_min ?? 15, b.headers_json ?? null, b.detail_headers_json ?? null, b.include_regex ?? null, b.exclude_regex ?? null);
    const id = Number(r.lastInsertRowid);
    void pollSource(id);
    reply.code(201);
    return sourceOut(db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow);
  });

  app.patch('/sources/:id', async (req) => {
    const id = idParam((req.params as any).id);
    const b = sourceBody.partial().parse(req.body);
    checkJsonObject(b.headers_json, 'headers_json');
    checkJsonObject(b.detail_headers_json, 'detail_headers_json');
    checkRegex(b.include_regex, 'include_regex');
    checkRegex(b.exclude_regex, 'exclude_regex');
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    if (sets.length) {
      // Re-enabling or editing the URL resets backoff so the change takes effect promptly.
      if ('enabled' in b || 'url' in b) sets.push('fail_count = 0');
      const r = db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      if (!r.changes) throw new ApiError(404, 'not_found', 'Source not found');
    }
    const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!row) throw new ApiError(404, 'not_found', 'Source not found');
    return sourceOut(row);
  });

  app.delete('/sources/:id', async (req) => {
    const id = idParam((req.params as any).id);
    const imgs = db.prepare('SELECT local_path FROM item_images WHERE item_id IN (SELECT id FROM items WHERE source_id = ?)').all(id) as any[];
    const r = db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    if (!r.changes) throw new ApiError(404, 'not_found', 'Source not found');
    removeImageFiles(imgs);
    return { ok: true };
  });

  // Test a saved source (by id) or an unsaved draft (url/type/headers in body) without storing anything.
  app.post('/sources/test', async (req) => {
    const b = sourceBody.pick({ url: true, type: true, headers_json: true, category_default: true }).parse(req.body);
    checkJsonObject(b.headers_json, 'headers_json');
    const type = b.type ?? detectType(b.url);
    try {
      const items = await fetchSource({ url: b.url, type, headers_json: b.headers_json ?? null, category_default: b.category_default ?? null });
      return { ok: true, type, count: items.length, sample: items.slice(0, 5).map((i) => i.title) };
    } catch (e) {
      return { ok: false, type, count: 0, sample: [], error: (e as Error).message };
    }
  });

  app.post('/sources/:id/test', async (req) => {
    const id = idParam((req.params as any).id);
    const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!s) throw new ApiError(404, 'not_found', 'Source not found');
    try {
      const items = await fetchSource(s);
      return { ok: true, type: s.type, count: items.length, sample: items.slice(0, 5).map((i) => i.title) };
    } catch (e) {
      return { ok: false, type: s.type, count: 0, sample: [], error: (e as Error).message };
    }
  });

  app.post('/sources/:id/poll', async (req) => {
    const id = idParam((req.params as any).id);
    return pollSource(id);
  });

  app.post('/ingest/poll', async () => {
    const results = await pollAll();
    return { ok: results.every((r) => r.ok), added: results.reduce((a, r) => a + r.added, 0), results };
  });

  // ---- status / settings / maintenance -------------------------------------
  app.get('/status', async (req) => {
    const { since } = z.object({ since: z.coerce.number().optional() }).parse(req.query);
    const newSince = since
      ? (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE created_at > ? AND state = 'new'`).get(since) as { n: number }).n
      : 0;
    const totals = db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM items').get() as { n: number; newest: number | null };
    const srcs = db.prepare('SELECT enabled, last_status, interval_min FROM sources').all() as any[];
    const enabled = srcs.filter((s) => s.enabled);
    return {
      version: VERSION,
      next_poll_at: nextPollAt(),
      poll_interval_min: enabled.length ? Math.min(...enabled.map((s) => s.interval_min)) : null,
      items_total: totals.n,
      newest_created_at: totals.newest,
      new_since: newSince,
      sources_ok: enabled.filter((s) => s.last_status !== 'error').length,
      sources_error: enabled.filter((s) => s.last_status === 'error').length,
      client_configured: !!getSetting('transmission_url'),
    };
  });

  const settingsOut = () => ({
    transmission_url: getSetting('transmission_url'),
    transmission_user: getSetting('transmission_user'),
    transmission_password_set: !!getSetting('transmission_password'),
    download_dir: getSetting('download_dir'),
    start_paused: getSetting('start_paused') === '1',
    prune_days: Number(getSetting('prune_days')),
    prefetch_details: getSetting('prefetch_details') === '1',
  });

  app.get('/settings', async () => settingsOut());

  app.put('/settings', async (req) => {
    const b = z
      .object({
        transmission_url: z.string().max(300).optional(),
        transmission_user: z.string().max(200).optional(),
        transmission_password: z.string().max(200).optional(), // omit to keep, send "" to clear
        download_dir: z.string().max(500).optional(),
        start_paused: z.boolean().optional(),
        prune_days: z.number().int().min(1).max(3650).optional(),
        prefetch_details: z.boolean().optional(),
      })
      .parse(req.body);
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined || !(k in SETTING_DEFAULTS)) continue;
      setSetting(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    return settingsOut();
  });

  app.post('/settings/test-client', async () => {
    try {
      return { ok: true, ...(await testClient()) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  app.post('/maintenance/prune', async (req) => {
    const { older_than_days } = z.object({ older_than_days: z.number().int().min(1).max(3650) }).parse(req.body);
    return { ok: true, deleted: prune(older_than_days) };
  });
}
