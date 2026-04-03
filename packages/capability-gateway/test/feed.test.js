import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeedXml } from '../dist/feed.js';

test('parseFeedXml parses RSS 2.0 items', () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/1</link>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Article One');
  assert.equal(items[0].link, 'https://example.com/1');
  assert.equal(items[1].title, 'Article Two');
});

test('parseFeedXml parses Atom entries', () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Entry A</title>
    <link href="https://example.com/a"/>
  </entry>
  <entry>
    <title>Entry B</title>
    <link href="https://example.com/b"/>
  </entry>
</feed>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Entry A');
  assert.equal(items[0].link, 'https://example.com/a');
});

test('parseFeedXml detects Atom via contentType', () => {
  const xml = `<feed><entry><title>X</title><link href="https://example.com/x"/></entry></feed>`;
  const items = parseFeedXml(xml, 'application/atom+xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'X');
});

test('parseFeedXml returns empty for empty feed', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 0);
});

test('parseFeedXml decodes XML entities in title', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>A &amp; B &quot;C&quot;</title>
    <link>https://example.com/e</link>
  </item></channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'A & B "C"');
});

test('parseFeedXml handles CDATA in title', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title><![CDATA[Some <b>bold</b> text]]></title>
    <link>https://example.com/cdata</link>
  </item></channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Some bold text');
});

test('parseFeedXml falls back to guid when no link', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>No Link</title>
    <guid>https://example.com/guid</guid>
  </item></channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/guid');
});

test('parseFeedXml skips items without title or link', () => {
  const xml = `<rss version="2.0"><channel>
    <item><title>No link here</title></item>
    <item><link>https://example.com/x</link></item>
    <item><title>Has both</title><link>https://example.com/y</link></item>
  </channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Has both');
});
