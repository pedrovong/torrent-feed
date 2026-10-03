import { createHash } from 'node:crypto';

export type Category = 'TV' | 'Movies' | 'Music' | 'Linux' | 'Other';

export interface NormalizedItem {
  info_hash: string;
  title: string;
  category: Category;
  tags: string[];
  resolution: number | null;
  size_bytes: number | null;
  seeders: number;
  leechers: number;
  published_at: number;
  magnet: string | null;
  torrent_url: string | null;
  origin: string | null;
  details_url: string | null;
  description_html: string | null;
}

export function mapCategory(raw: string | null | undefined, title: string): Category {
  const c = (raw ?? '').toLowerCase();
  if (/linux|ubuntu|debian|fedora|arch/.test(c) || /\b(linux|ubuntu|debian|fedora|archlinux|mint)\b.*\.iso|\.iso\b.*\blinux\b/i.test(title)) return 'Linux';
  if (/^tv|television|series/.test(c)) return 'TV';
  if (/^movie|film|video/.test(c)) return 'Movies';
  if (/^audio|music|flac|mp3/.test(c)) return 'Music';
  return 'Other';
}

const TAG_PATTERNS: Array<[RegExp, string]> = [
  [/\b(2160p|4k|uhd)\b/i, '2160p'],
  [/\b1080[pi]\b/i, '1080p'],
  [/\b720p\b/i, '720p'],
  [/\b480p\b/i, '480p'],
  [/\b(x265|h\.?265|hevc)\b/i, 'x265'],
  [/\b(x264|h\.?264|avc)\b/i, 'x264'],
  [/\bav1\b/i, 'AV1'],
  [/\b(hdr10\+?|hdr|dolby[ .]?vision|dv)\b/i, 'HDR'],
  [/\bremux\b/i, 'REMUX'],
  [/\bweb[-. ]?dl\b/i, 'WEB-DL'],
  [/\bweb[-. ]?rip\b/i, 'WEBRip'],
  [/\b(blu-?ray|bdrip|brrip)\b/i, 'BluRay'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\bflac\b/i, 'FLAC'],
  [/\bmp3\b/i, 'MP3'],
  [/\.iso\b|\biso\b/i, 'ISO'],
  [/\batmos\b/i, 'Atmos'],
];

export function parseTags(title: string): { tags: string[]; resolution: number | null } {
  const tags: string[] = [];
  for (const [re, tag] of TAG_PATTERNS) if (re.test(title) && !tags.includes(tag)) tags.push(tag);
  const res = tags.includes('2160p') ? 2160 : tags.includes('1080p') ? 1080 : tags.includes('720p') ? 720 : tags.includes('480p') ? 480 : null;
  return { tags, resolution: res };
}

export function hashFromMagnet(magnet: string | null | undefined): string | null {
  if (!magnet) return null;
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(magnet);
  if (!m) return null;
  const h = m[1];
  if (h.length === 40) return h.toLowerCase();
  if (h.length === 32) return base32ToHex(h);
  return null;
}

function base32ToHex(s: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex.slice(0, 40);
}

/** Fallback identity when a feed has no info hash: normalized title + size. Prefixed so it can't collide with a real hash. */
export function fallbackHash(title: string, size: number | null): string {
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return 'x-' + createHash('sha1').update(`${norm}|${size ?? ''}`).digest('hex').slice(0, 38);
}

export function parseSize(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /([\d.,]+)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)\b/i.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith('t') ? 1024 ** 4 : unit.startsWith('g') ? 1024 ** 3 : unit.startsWith('m') ? 1024 ** 2 : unit.startsWith('k') ? 1024 : 1;
  return Math.round(n * mult);
}

export function safeRegex(src: string | null | undefined): RegExp | null {
  if (!src) return null;
  try {
    return new RegExp(src, 'i');
  } catch {
    return null;
  }
}
