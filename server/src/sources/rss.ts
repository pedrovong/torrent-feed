import { XMLParser } from 'fast-xml-parser';
import { fallbackHash, hashFromMagnet, mapCategory, parseSize, parseTags, type NormalizedItem } from '../normalize.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true });

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  const s = String(v).trim();
  return s || null;
};

/** Parses RSS 2.0 / Atom, including Torznab (`torznab:attr`) and common `torrent:*` extensions. */
export function parseRss(xml: string, categoryDefault?: string | null): NormalizedItem[] {
  const doc = parser.parse(xml);
  const rawItems: any[] = arr(doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.['rdf:RDF']?.item);
  if (!doc?.rss && !doc?.feed && !doc?.['rdf:RDF']) throw new Error('Response is not an RSS/Atom feed');

  const out: NormalizedItem[] = [];
  for (const it of rawItems) {
    const title = text(it.title);
    if (!title) continue;

    const attrs: Record<string, string> = {};
    for (const a of arr(it['torznab:attr'] ?? it['newznab:attr'])) if (a?.['@_name']) attrs[a['@_name']] = String(a['@_value']);

    const enclosure = it.enclosure?.['@_url'] as string | undefined;
    const link = text(it.link) ?? (typeof it.link === 'object' ? (it.link?.['@_href'] as string) : null);
    const guid = text(it.guid) ?? text(it.id);
    const candidates = [enclosure, link, guid, text(it['torrent:magnetURI']), attrs.magneturl].filter(Boolean) as string[];
    const magnet = candidates.find((c) => c.startsWith('magnet:')) ?? null;
    const torrent_url = candidates.find((c) => /^https?:/.test(c) && (c === enclosure || /\.torrent(\?|$)/.test(c))) ?? null;

    const hash =
      (attrs.infohash || text(it['torrent:infoHash']))?.toLowerCase() ||
      hashFromMagnet(magnet) ||
      null;

    const description = text(it.description) ?? text(it.summary) ?? text(it.content) ?? text(it['content:encoded']);
    const size =
      Number(attrs.size) || Number(it.enclosure?.['@_length']) || Number(text(it['torrent:contentLength'])) || parseSize(description) || null;
    const seeders = Number(attrs.seeders ?? text(it['torrent:seeds']) ?? 0) || 0;
    const peers = Number(attrs.peers ?? text(it['torrent:peers']) ?? 0) || 0;
    const leechers = attrs.leechers !== undefined ? Number(attrs.leechers) || 0 : Math.max(0, peers - seeders);

    const pub = text(it.pubDate) ?? text(it.published) ?? text(it.updated) ?? text(it['dc:date']);
    const published = pub ? Date.parse(pub) : NaN;
    const feedCategory = text(it.category) ?? attrs.category ?? null;
    const mapped = mapCategory(feedCategory, title);
    const { tags, resolution } = parseTags(title);

    out.push({
      info_hash: hash ?? fallbackHash(title, size),
      title,
      category: mapped === 'Other' && categoryDefault ? (categoryDefault as NormalizedItem['category']) : mapped,
      tags,
      resolution,
      size_bytes: size,
      seeders,
      leechers,
      published_at: Number.isNaN(published) ? Date.now() : published,
      magnet,
      torrent_url,
      origin: null,
      details_url: link && /^https?:/.test(link) && link !== torrent_url ? link : null,
      description_html: description,
    });
  }
  return out;
}
