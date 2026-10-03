import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGES_DIR } from './config.js';
import { db } from './db.js';
import { extractImageUrls, looksLikeBotChallenge, parseDetailPage, sanitizeDescription } from './detailParser.js';
import { safeFetch } from './safeFetch.js';
import { parseHeaders } from './sources/index.js';

interface ItemForDetails {
  id: number;
  details_url: string | null;
  description_html: string | null;
  detail_headers_json: string | null;
}

const queue: number[] = [];
let running = false;
const GAP_MS = 1500; // be polite to third-party sites

/** Queue a detail fetch. Safe to call repeatedly; items already pending/ok are skipped. */
export function enqueueDetails(itemId: number, force = false): void {
  const row = db.prepare('SELECT details_status FROM items WHERE id = ?').get(itemId) as { details_status: string } | undefined;
  if (!row) return;
  if (row.details_status === 'pending' || (row.details_status === 'ok' && !force)) return;
  db.prepare(`UPDATE items SET details_status = 'pending', details_error = NULL WHERE id = ?`).run(itemId);
  queue.push(itemId);
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await processItem(id);
      } catch (e) {
        db.prepare(`UPDATE items SET details_status = 'failed', details_error = ?, details_fetched_at = ? WHERE id = ?`).run(
          (e as Error).message.slice(0, 300),
          Date.now(),
          id,
        );
      }
      if (queue.length) await new Promise((r) => setTimeout(r, GAP_MS));
    }
  } finally {
    running = false;
  }
}

async function processItem(id: number) {
  const item = db
    .prepare(
      `SELECT i.id, i.details_url, i.description_html, s.detail_headers_json
       FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?`,
    )
    .get(id) as ItemForDetails | undefined;
  if (!item) return;

  let description = item.description_html ? sanitizeDescription(item.description_html) : null;
  let imageUrls = item.description_html ? extractImageUrls(item.description_html, item.details_url ?? 'http://invalid.local/') : [];
  let files: Array<{ path: string; size_bytes: number | null }> = [];

  if (item.details_url && !item.description_html) {
    const res = await safeFetch(item.details_url, {
      headers: { accept: 'text/html,application/xhtml+xml', ...parseHeaders(item.detail_headers_json) },
      maxBytes: 3 * 1024 * 1024,
      acceptType: (t) => t === '' || t.includes('html') || t.includes('xml'),
    }).catch((e: Error) => {
      throw new Error(`Detail page fetch failed: ${e.message}`);
    });
    const html = res.body.toString('utf8');
    if (looksLikeBotChallenge(res.status, html)) {
      throw new Error(`Blocked by site bot protection (HTTP ${res.status}). Add cookies under the source's detail headers.`);
    }
    if (res.status >= 400) throw new Error(`Detail page returned HTTP ${res.status}`);
    const parsed = parseDetailPage(html, res.url);
    description = parsed.description_html;
    imageUrls = parsed.image_urls;
    files = parsed.files;
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE items SET description_html = ?, details_status = 'ok', details_error = NULL, details_fetched_at = ? WHERE id = ?`).run(
      description,
      Date.now(),
      id,
    );
    if (files.length) {
      db.prepare('DELETE FROM item_files WHERE item_id = ?').run(id);
      const ins = db.prepare('INSERT INTO item_files(item_id, path, size_bytes) VALUES (?, ?, ?)');
      for (const f of files.slice(0, 500)) ins.run(id, f.path, f.size_bytes);
    }
    const ins = db.prepare('INSERT OR IGNORE INTO item_images(item_id, source_url) VALUES (?, ?)');
    for (const u of imageUrls) ins.run(id, u);
  });
  tx();

  const pending = db.prepare(`SELECT id, source_url FROM item_images WHERE item_id = ? AND status = 'pending'`).all(id) as Array<{ id: number; source_url: string }>;
  await Promise.all(pending.map((img) => cacheImage(img.id, img.source_url)));
}

async function cacheImage(imageId: number, url: string) {
  try {
    const res = await safeFetch(url, {
      timeoutMs: 15000,
      maxBytes: 10 * 1024 * 1024,
      acceptType: (t) => t.startsWith('image/') && !t.includes('svg'),
    });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const out = await sharp(res.body, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1080, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const file = `${imageId}.webp`;
    fs.writeFileSync(path.join(IMAGES_DIR, file), out.data);
    db.prepare(`UPDATE item_images SET status = 'ok', local_path = ?, width = ?, height = ? WHERE id = ?`).run(file, out.info.width, out.info.height, imageId);
  } catch {
    db.prepare(`UPDATE item_images SET status = 'failed' WHERE id = ?`).run(imageId);
  }
}

export function removeImageFiles(imageRows: Array<{ local_path: string | null }>) {
  for (const r of imageRows) if (r.local_path) fs.rmSync(path.join(IMAGES_DIR, r.local_path), { force: true });
}
