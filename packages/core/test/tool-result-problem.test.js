import test from 'node:test';
import assert from 'node:assert/strict';

test('formatToolResultForLlm leaves successes and missing problem unchanged', async () => {
  const { formatToolResultForLlm } = await import('../dist/model/tool-result-problem.js');
  assert.equal(
    formatToolResultForLlm({ content: 'ok', ok: true, problem: { title: 'x', detail: 'y', code: 'Z' } }),
    'ok'
  );
  assert.equal(formatToolResultForLlm({ content: 'plain fail', ok: false }), 'plain fail');
});

test('formatToolResultForLlm appends RFC 9457 JSON for failed tool with problem', async () => {
  const { formatToolResultForLlm, toolInfraProblem, TOOL_INFRA_PROBLEM_TYPE } = await import(
    '../dist/model/tool-result-problem.js'
  );
  const problem = toolInfraProblem('bash', 'call_1', 'TOOL_UNHANDLED_EXCEPTION', 'ENOENT', {
    title: 'Tool raised an exception',
    status: 500
  });
  const out = formatToolResultForLlm({ content: 'ENOENT', ok: false, problem });
  const marker = 'Content-Type: application/problem+json\n';
  const idx = out.indexOf(marker);
  assert.ok(idx > 0, 'problem+json block present');
  const parsed = JSON.parse(out.slice(idx + marker.length));
  assert.equal(parsed.code, 'TOOL_UNHANDLED_EXCEPTION');
  assert.equal(parsed.title, 'Tool raised an exception');
  assert.equal(parsed.status, 500);
  assert.equal(parsed.type, TOOL_INFRA_PROBLEM_TYPE);
  assert.ok(parsed.instance.includes('bash'));
});
