import * as cheerio from 'cheerio';
import { parseSize } from './normalize.js';

export interface ParsedDetails {
  description_html: string | null;
  image_urls: string[];
  files: Array<{ path: string; size_bytes: number | null }>;
}

const DESCRIPTION_SELECTORS = [
  '#description',
  '#descr',
  '.torrent-description',
  '.nfo',
  '[itemprop="description"]',
  '.torrent-detail-page .box-info-detail',
  '#details .nfo',
];
const FILE_SELECTORS = ['#files li', '#filelist li', '.file-content li', '#files tr', '#filelist tr', '.filelist li'];
const IMAGE_FILE = /\.(jpe?g|png|webp|gif)(\?|$)/i;

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'a', 'div', 'span']);
const DROP_WITH_CONTENT = 'script,style,noscript,iframe,object,embed,form,svg,template,head,title';

/** Whitelist sanitizer: unknown tags are unwrapped, all attributes dropped except http(s) links. */
export function sanitizeDescription(html: string): string {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  $(DROP_WITH_CONTENT).remove();
  $('#r *').each((_, node) => {
    const el = $(node);
    const name = (node as { tagName?: string }).tagName?.toLowerCase() ?? '';
    if (!ALLOWED_TAGS.has(name)) {
      el.replaceWith(el.contents());
      return;
    }
    const href = name === 'a' ? el.attr('href') : undefined;
    for (const attr of Object.keys((node as { attribs?: Record<string, string> }).attribs ?? {})) el.removeAttr(attr);
    if (href && /^https?:\/\//i.test(href.trim())) el.attr('href', href.trim()).attr('rel', 'noopener noreferrer nofollow');
  });
  return $('#r').html() ?? '';
}

/** Plain-text paragraphs for the app; avoids shipping HTML to the client at all. */
export function htmlToParagraphs(html: string | null): string[] {
  if (!html) return [];
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,h4,pre,blockquote').each((_, el) => {
    $(el).append('\n\n');
  });
  return $('#r')
    .text()
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim())
    .filter(Boolean);
}

function resolveUrl(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function extractImageUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  const urls: string[] = [];
  $('#r img').each((_, el) => {
    const w = Number($(el).attr('width'));
    if (w && w < 50) return;
    const u = resolveUrl($(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('src'), baseUrl);
    if (u) urls.push(u);
  });
  $('#r a[href]').each((_, el) => {
    const u = resolveUrl($(el).attr('href'), baseUrl);
    if (u && IMAGE_FILE.test(u)) urls.push(u);
  });
  return [...new Set(urls)];
}

export function parseDetailPage(pageHtml: string, pageUrl: string): ParsedDetails {
  const $ = cheerio.load(pageHtml);
  $('script,style,noscript').remove();

  let container: ReturnType<typeof $> | null = null;
  for (const sel of DESCRIPTION_SELECTORS) {
    const el = $(sel).first();
    if (el.length && el.text().trim()) {
      container = el;
      break;
    }
  }

  const imageUrls: string[] = [];
  let descriptionHtml: string | null = null;
  if (container) {
    const inner = container.html() ?? '';
    imageUrls.push(...extractImageUrls(inner, pageUrl));
    descriptionHtml = sanitizeDescription(inner.replace(/<img[^>]*>/gi, ''));
  } else {
    const meta = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content');
    if (meta) descriptionHtml = sanitizeDescription(`<p>${meta.replace(/</g, '&lt;')}</p>`);
  }

  const poster = resolveUrl($('.torrent-image img').first().attr('src') || $('meta[property="og:image"]').attr('content'), pageUrl);
  if (poster) imageUrls.unshift(poster);

  const files: ParsedDetails['files'] = [];
  for (const sel of FILE_SELECTORS) {
    const rows = $(sel);
    if (!rows.length) continue;
    rows.each((_, el) => {
      const cells = $(el).find('td');
      let name: string;
      let size: number | null;
      if (cells.length >= 2) {
        name = $(cells[0]).text().trim();
        size = parseSize($(cells[cells.length - 1]).text());
      } else {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        const m = /^(.*?)\s*[(\[]\s*([\d.,]+\s*[kmgt]?i?b)\s*[)\]]\s*$/i.exec(t);
        name = (m ? m[1] : t).trim();
        size = m ? parseSize(m[2]) : null;
      }
      if (name && !/^(name|filename)$/i.test(name)) files.push({ path: name, size_bytes: size });
    });
    if (files.length) break;
  }

  return { description_html: descriptionHtml, image_urls: [...new Set(imageUrls)].slice(0, 12), files };
}

/** True when the response looks like an anti-bot interstitial rather than the real page. */
export function looksLikeBotChallenge(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  return /go-away|Just a moment|cf-chl|Checking your browser|Attention Required/i.test(html.slice(0, 4000)) && html.length < 20000;
}
