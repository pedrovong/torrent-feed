import { db, getSetting } from './db.js';
import { enqueueDetails, removeImageFiles } from './details.js';
import { safeRegex } from './normalize.js';
import { fetchSource, type SourceRow } from './sources/index.js';

const polling = new Set<number>();
const MAX_BACKOFF_MULT = 8;

const selectExisting = db.prepare('SELECT id FROM items WHERE info_hash = ?');
const insertItem = db.prepare(`
  INSERT INTO items (source_id, info_hash, title, category, tags_json, resolution, size_bytes, seeders, leechers,
                     published_at, magnet, torrent_url, origin, details_url, description_html, created_at)
  VALUES (@source_id, @info_hash, @title, @category, @tags_json, @resolution, @size_bytes, @seeders, @leechers,
          @published_at, @magnet, @torrent_url, @origin, @details_url, @description_html, @created_at)`);
const updateItem = db.prepare(`
  UPDATE items SET seeders = @seeders, leechers = @leechers,
         size_bytes = COALESCE(size_bytes, @size_bytes),
         magnet = COALESCE(magnet, @magnet),
         torrent_url = COALESCE(torrent_url, @torrent_url)
  WHERE id = @id`);

export interface PollResult {
  ok: boolean;
  added: number;
  seen: number;
  error?: string;
}

export async function pollSource(id: number): Promise<PollResult> {
  const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
  if (!src) return { ok: false, added: 0, seen: 0, error: 'Source not found' };
  if (polling.has(id)) return { ok: false, added: 0, seen: 0, error: 'Already polling' };
  polling.add(id);
  const now = Date.now();
  try {
    const items = await fetchSource(src);
    const include = safeRegex(src.include_regex);
    const exclude = safeRegex(src.exclude_regex);
    const newIds: number[] = [];
    let seen = 0;

    db.transaction(() => {
      for (const it of items) {
        if (include && !include.test(it.title)) continue;
        if (exclude && exclude.test(it.title)) continue;
        seen++;
        const row = { ...it, source_id: src.id, tags_json: JSON.stringify(it.tags), created_at: now };
        const existing = selectExisting.get(it.info_hash) as { id: number } | undefined;
        if (existing) {
          updateItem.run({ ...row, id: existing.id });
        } else {
          newIds.push(Number(insertItem.run(row).lastInsertRowid));
        }
      }
      const count = (db.prepare('SELECT COUNT(*) AS n FROM items WHERE source_id = ?').get(src.id) as { n: number }).n;
      db.prepare(
        `UPDATE sources SET last_fetched_at = ?, last_attempt_at = ?, last_status = 'ok', last_error = NULL, fail_count = 0, item_count = ? WHERE id = ?`,
      ).run(now, now, count, src.id);
    })();

    if (getSetting('prefetch_details') === '1') newIds.slice(0, 30).forEach((i) => enqueueDetails(i));
    return { ok: true, added: newIds.length, seen };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    db.prepare(`UPDATE sources SET last_attempt_at = ?, last_status = 'error', last_error = ?, fail_count = fail_count + 1 WHERE id = ?`).run(now, msg, src.id);
    return { ok: false, added: 0, seen: 0, error: msg };
  } finally {
    polling.delete(id);
  }
}

export function dueAt(src: SourceRow): number {
  const mult = Math.min(2 ** src.fail_count, MAX_BACKOFF_MULT);
  return (src.last_attempt_at ?? 0) + src.interval_min * 60_000 * mult;
}

export function nextPollAt(): number | null {
  const rows = db.prepare('SELECT * FROM sources WHERE enabled = 1').all() as SourceRow[];
  if (!rows.length) return null;
  return Math.min(...rows.map((r) => (r.last_attempt_at ? dueAt(r) : Date.now())));
}

export async function pollAll(): Promise<PollResult[]> {
  const rows = db.prepare('SELECT id FROM sources WHERE enabled = 1').all() as Array<{ id: number }>;
  return Promise.all(rows.map((r) => pollSource(r.id)));
}

export function startScheduler(): () => void {
  const tick = async () => {
    const rows = db.prepare('SELECT * FROM sources WHERE enabled = 1').all() as SourceRow[];
    const now = Date.now();
    for (const r of rows) if (now >= dueAt(r)) void pollSource(r.id);
  };
  const handle = setInterval(tick, 30_000);
  setTimeout(tick, 2_000);
  return () => clearInterval(handle);
}

export function prune(olderThanDays: number): number {
  const cutoff = Date.now() - olderThanDays * 86_400_000;
  // Keep items the user has sent, so history stays intact.
  const imgs = db
    .prepare(`SELECT local_path FROM item_images WHERE item_id IN (SELECT id FROM items WHERE published_at < ? AND state != 'sent')`)
    .all(cutoff) as Array<{ local_path: string | null }>;
  const res = db.prepare(`DELETE FROM items WHERE published_at < ? AND state != 'sent'`).run(cutoff);
  removeImageFiles(imgs);
  return res.changes;
}
