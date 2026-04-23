import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeInboxItems, parseInboxItems } from '../../../scripts/evolution/inbox-loader.mjs';

test('parseInboxItems(section=new) 只解析今日新条目，不包含近期滚动重复项', () => {
  const inbox = `# Evolution inbox 2026-04-20

## 今日新条目
- [Fresh one](https://example.com/fresh)
- [Fresh two](https://example.com/two)

## 近期滚动（参考）
- [Fresh one](https://example.com/fresh)
- [Old one](https://example.com/old)
`;

  const items = parseInboxItems(inbox, { section: 'new' });
  assert.deepEqual(items, [
    { title: 'Fresh one', link: 'https://example.com/fresh' },
    { title: 'Fresh two', link: 'https://example.com/two' }
  ]);
});

test('parseInboxItems 会压平成多行标题里的空白', () => {
  const inbox = `## 今日新条目
- [Line one

Line two
Line three](https://example.com/multiline)
`;

  const items = parseInboxItems(inbox, { section: 'new' });
  assert.equal(items[0].title, 'Line one Line two Line three');
});

test('dedupeInboxItems 按 link 去重，避免同一链接重复调度', () => {
  const items = [
    { title: 'Fresh one', link: 'https://example.com/fresh' },
    { title: 'Fresh one duplicate title', link: 'https://example.com/fresh' },
    { title: 'Fresh two', link: 'https://example.com/two' }
  ];

  assert.deepEqual(dedupeInboxItems(items), [
    { title: 'Fresh one', link: 'https://example.com/fresh' },
    { title: 'Fresh two', link: 'https://example.com/two' }
  ]);
});
