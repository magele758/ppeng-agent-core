import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpUrls } from '../dist/mcp-jsonrpc.js';

test('parseMcpUrls returns empty array for undefined env', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  const saved2 = process.env.RAW_AGENT_MCP_URL;
  delete process.env.RAW_AGENT_MCP_URLS;
  delete process.env.RAW_AGENT_MCP_URL;
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, []);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  if (saved2 !== undefined) process.env.RAW_AGENT_MCP_URL = saved2;
});

test('parseMcpUrls parses single URL from RAW_AGENT_MCP_URL', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  const saved2 = process.env.RAW_AGENT_MCP_URL;
  delete process.env.RAW_AGENT_MCP_URLS;
  process.env.RAW_AGENT_MCP_URL = 'http://localhost:8080/mcp';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://localhost:8080/mcp']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  if (saved2 !== undefined) process.env.RAW_AGENT_MCP_URL = saved2;
  else delete process.env.RAW_AGENT_MCP_URL;
});

test('parseMcpUrls prefers RAW_AGENT_MCP_URLS over RAW_AGENT_MCP_URL', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  const saved2 = process.env.RAW_AGENT_MCP_URL;
  process.env.RAW_AGENT_MCP_URLS = 'http://a.com,http://b.com';
  process.env.RAW_AGENT_MCP_URL = 'http://ignored.com';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://a.com', 'http://b.com']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  else delete process.env.RAW_AGENT_MCP_URLS;
  if (saved2 !== undefined) process.env.RAW_AGENT_MCP_URL = saved2;
  else delete process.env.RAW_AGENT_MCP_URL;
});

test('parseMcpUrls splits by comma', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  process.env.RAW_AGENT_MCP_URLS = 'http://a.com,http://b.com,http://c.com';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://a.com', 'http://b.com', 'http://c.com']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  else delete process.env.RAW_AGENT_MCP_URLS;
});

test('parseMcpUrls splits by semicolon', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  process.env.RAW_AGENT_MCP_URLS = 'http://a.com;http://b.com';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://a.com', 'http://b.com']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  else delete process.env.RAW_AGENT_MCP_URLS;
});

test('parseMcpUrls splits by whitespace', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  process.env.RAW_AGENT_MCP_URLS = 'http://a.com http://b.com\nhttp://c.com';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://a.com', 'http://b.com', 'http://c.com']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  else delete process.env.RAW_AGENT_MCP_URLS;
});

test('parseMcpUrls trims whitespace from URLs', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  process.env.RAW_AGENT_MCP_URLS = '  http://a.com  ,  http://b.com  ';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://a.com', 'http://b.com']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  else delete process.env.RAW_AGENT_MCP_URLS;
});

test('parseMcpUrls filters empty strings', () => {
  const saved = process.env.RAW_AGENT_MCP_URLS;
  process.env.RAW_AGENT_MCP_URLS = 'http://a.com,,http://b.com,  ,http://c.com';
  const result = parseMcpUrls(process.env);
  assert.deepEqual(result, ['http://a.com', 'http://b.com', 'http://c.com']);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_URLS = saved;
  else delete process.env.RAW_AGENT_MCP_URLS;
});
