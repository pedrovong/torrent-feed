import { fallbackHash, hashFromMagnet, mapCategory, parseTags, type NormalizedItem } from '../normalize.js';

interface KnabenHit {
  bytes?: number;
  category?: string;
  date?: string;
  details?: string | null;
  hash?: string | null;
  link?: string | null;
  liveSeeders?: number | null;
  livePeers?: number | null;
  magnetUrl?: string | null;
  peers?: number | null;
  seeders?: number | null;
  title?: string;
  tracker?: string;
  cachedOrigin?: string;
  description?: string | null;
}

export function parseKnaben(json: unknown, categoryDefault?: string | null): NormalizedItem[] {
  const hits = (json as { hits?: KnabenHit[] })?.hits;
  if (!Array.isArray(hits)) throw new Error('Unexpected Knaben response (no "hits" array)');
  const out: NormalizedItem[] = [];
  for (const h of hits) {
    if (!h.title) continue;
    const hash = (h.hash?.toLowerCase() || hashFromMagnet(h.magnetUrl)) ?? fallbackHash(h.title, h.bytes ?? null);
    const { tags, resolution } = parseTags(h.title);
    const published = h.date ? Date.parse(h.date) : NaN;
    const seeders = Math.max(h.liveSeeders ?? 0, h.seeders ?? 0);
    const peers = Math.max(h.livePeers ?? 0, h.peers ?? 0);
    const mapped = mapCategory(h.category, h.title);
    out.push({
      info_hash: hash,
      title: h.title,
      category: mapped === 'Other' && categoryDefault ? (categoryDefault as NormalizedItem['category']) : mapped,
      tags,
      resolution,
      size_bytes: h.bytes ?? null,
      seeders,
      // Knaben's "peers" counts all peers; leechers = peers - seeders.
      leechers: Math.max(0, peers - seeders),
      published_at: Number.isNaN(published) ? Date.now() : published,
      magnet: h.magnetUrl ?? null,
      torrent_url: h.link ?? null,
      origin: h.tracker ?? h.cachedOrigin ?? null,
      details_url: h.details ?? null,
      description_html: h.description ?? null,
    });
  }
  return out;
}
