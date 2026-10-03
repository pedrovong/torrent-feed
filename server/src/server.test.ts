import { describe, expect, it } from 'vitest';
import { hashFromMagnet, mapCategory, parseSize, parseTags } from './normalize.js';
import { parseKnaben } from './sources/knaben.js';
import { parseRss } from './sources/rss.js';
import { htmlToParagraphs, parseDetailPage } from './detailParser.js';
import { isPrivateIp } from './safeFetch.js';

describe('normalize', () => {
  it('parses quality tags and resolution', () => {
    const r = parseTags('Show.S01E01.2160p.WEB-DL.DDP5.1.HDR.x265-GRP');
    expect(r.resolution).toBe(2160);
    expect(r.tags).toEqual(expect.arrayContaining(['2160p', 'x265', 'HDR', 'WEB-DL']));
  });
  it('maps categories', () => {
    expect(mapCategory('TV / HD', 'x')).toBe('TV');
    expect(mapCategory('Movies / UHD', 'x')).toBe('Movies');
    expect(mapCategory('Audio / Lossless', 'x')).toBe('Music');
    expect(mapCategory('PC / Linux', 'x')).toBe('Linux');
  });
  it('extracts hex and base32 hashes from magnets', () => {
    expect(hashFromMagnet('magnet:?xt=urn:btih:CAC5D7AE139B8E6DA94C6B0F7D78754A5DC096FA&dn=x')).toBe('cac5d7ae139b8e6da94c6b0f7d78754a5dc096fa');
    expect(hashFromMagnet('magnet:?xt=urn:btih:VBXRJQF4N7WNS6DRQN2I5ALKHHQ2KBQZ')).toHaveLength(40);
  });
  it('parses sizes', () => {
    expect(parseSize('4.5 GB')).toBe(Math.round(4.5 * 1024 ** 3));
  });
});

describe('sources', () => {
  it('parses Knaben JSON, using live seeders when higher', () => {
    const items = parseKnaben({
      hits: [{ title: 'A S01E01 1080p', bytes: 100, category: 'TV / HD', date: '2026-10-03T04:55:00+00:00', hash: 'ABCD'.repeat(10), seeders: 0, liveSeeders: 58, peers: 0, livePeers: 70, magnetUrl: 'magnet:?xt=urn:btih:x', tracker: '1337x', details: 'https://example.com/d' }],
    });
    expect(items[0]).toMatchObject({ info_hash: 'abcd'.repeat(10), seeders: 58, leechers: 12, category: 'TV', origin: '1337x', details_url: 'https://example.com/d' });
  });
  it('rejects unexpected Knaben payloads', () => {
    expect(() => parseKnaben({ nope: 1 })).toThrow();
  });
  it('parses RSS with torznab attrs', () => {
    const xml = `<?xml version="1.0"?><rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item>
      <title>Ubuntu 24.04 ISO</title><link>https://t.example/1</link><pubDate>Fri, 02 Oct 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://t.example/1.torrent" length="123" type="application/x-bittorrent"/>
      <torznab:attr name="infohash" value="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"/><torznab:attr name="seeders" value="9"/><torznab:attr name="peers" value="12"/>
    </item></channel></rss>`;
    const [it] = parseRss(xml);
    expect(it).toMatchObject({ info_hash: 'a'.repeat(40), seeders: 9, leechers: 3, size_bytes: 123, torrent_url: 'https://t.example/1.torrent' });
  });
});

describe('details', () => {
  it('extracts description, images and files from a detail page', () => {
    const html = `<html><body><div id="description"><p>Hello <b>world</b></p><img src="/p/poster.jpg"><script>x()</script><p>Second</p></div>
      <div id="files"><ul><li>a/b.mkv (1.5 GB)</li><li>c.nfo (2 KB)</li></ul></div></body></html>`;
    const d = parseDetailPage(html, 'https://site.example/t/1');
    expect(d.image_urls).toEqual(['https://site.example/p/poster.jpg']);
    expect(htmlToParagraphs(d.description_html)).toEqual(['Hello world', 'Second']);
    expect(d.files).toHaveLength(2);
    expect(d.files[0]).toMatchObject({ path: 'a/b.mkv' });
  });
  it('strips script and event handlers', () => {
    const d = parseDetailPage('<div id="description"><p onclick="x()">hi</p><script>bad()</script></div>', 'https://a.example/');
    expect(d.description_html).not.toMatch(/script|onclick/);
  });
});

describe('ssrf guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1'])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700::1111'])('allows %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});
