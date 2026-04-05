import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillFrontmatter, mergeSkillsByName } from '../dist/skills/skill-registry.js';

// ── parseSkillFrontmatter ──

test('parseSkillFrontmatter: no frontmatter returns full text as body', () => {
  const result = parseSkillFrontmatter('Just a skill body\nwith content');
  assert.deepEqual(result.meta, {});
  assert.equal(result.body, 'Just a skill body\nwith content');
});

test('parseSkillFrontmatter: parses basic key-value frontmatter', () => {
  const text = `---
name: my-skill
description: A test skill
---
Body content here`;
  const result = parseSkillFrontmatter(text);
  assert.equal(result.meta.name, 'my-skill');
  assert.equal(result.meta.description, 'A test skill');
  assert.equal(result.body, 'Body content here');
});

test('parseSkillFrontmatter: parses quoted values', () => {
  const text = `---
name: "quoted skill"
alt: 'single quoted'
---
body`;
  const result = parseSkillFrontmatter(text);
  assert.equal(result.meta.name, 'quoted skill');
  assert.equal(result.meta.alt, 'single quoted');
});

test('parseSkillFrontmatter: parses inline list', () => {
  const text = `---
triggers: [build, test, deploy]
---
body`;
  const result = parseSkillFrontmatter(text);
  assert.deepEqual(result.meta.triggers, ['build', 'test', 'deploy']);
});

test('parseSkillFrontmatter: parses empty inline list', () => {
  const text = `---
tags: []
---
body`;
  const result = parseSkillFrontmatter(text);
  assert.deepEqual(result.meta.tags, []);
});

test('parseSkillFrontmatter: parses YAML-style list', () => {
  const text = `---
tools:
  - read_file
  - write_file
  - bash
---
body`;
  const result = parseSkillFrontmatter(text);
  assert.deepEqual(result.meta.tools, ['read_file', 'write_file', 'bash']);
});

test('parseSkillFrontmatter: handles missing closing ---', () => {
  const text = `---
name: broken
No closing delimiter`;
  const result = parseSkillFrontmatter(text);
  assert.deepEqual(result.meta, {});
  assert.ok(result.body.includes('broken'));
});

test('parseSkillFrontmatter: skips comment lines in frontmatter', () => {
  const text = `---
name: my-skill
# This is a comment
description: desc
---
body`;
  const result = parseSkillFrontmatter(text);
  assert.equal(result.meta.name, 'my-skill');
  assert.equal(result.meta.description, 'desc');
  assert.ok(!result.meta['#']);
});

test('parseSkillFrontmatter: handles \\r\\n line endings', () => {
  const text = '---\r\nname: crlf-skill\r\n---\r\nbody';
  const result = parseSkillFrontmatter(text);
  assert.equal(result.meta.name, 'crlf-skill');
  assert.equal(result.body, 'body');
});

test('parseSkillFrontmatter: key with empty value starts list mode', () => {
  const text = `---
examples:
  - example one
  - example two
---
body`;
  const result = parseSkillFrontmatter(text);
  assert.deepEqual(result.meta.examples, ['example one', 'example two']);
});

// ── mergeSkillsByName ──

test('mergeSkillsByName: empty arrays → empty', () => {
  assert.deepEqual(mergeSkillsByName([], []), []);
});

test('mergeSkillsByName: primary only', () => {
  const primary = [{ name: 'alpha', body: 'a', triggers: [] }];
  const result = mergeSkillsByName(primary, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'alpha');
});

test('mergeSkillsByName: override replaces same-name skill', () => {
  const primary = [{ name: 'skill-a', body: 'original', triggers: [] }];
  const override = [{ name: 'skill-a', body: 'override', triggers: [] }];
  const result = mergeSkillsByName(primary, override);
  assert.equal(result.length, 1);
  assert.equal(result[0].body, 'override');
});

test('mergeSkillsByName: merges and sorts by name', () => {
  const primary = [{ name: 'charlie', body: 'c', triggers: [] }];
  const override = [{ name: 'alpha', body: 'a', triggers: [] }];
  const result = mergeSkillsByName(primary, override);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'alpha');
  assert.equal(result[1].name, 'charlie');
});

test('mergeSkillsByName: override adds new skills', () => {
  const primary = [{ name: 'a', body: 'a', triggers: [] }];
  const override = [{ name: 'b', body: 'b', triggers: [] }];
  const result = mergeSkillsByName(primary, override);
  assert.equal(result.length, 2);
});
