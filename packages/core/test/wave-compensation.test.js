import test from 'node:test';
import assert from 'node:assert/strict';
import { compensateCompletedLifo } from '../dist/session/compensation.js';

test('wave compensation runs LIFO and skips irreversible', async () => {
  const order = [];
  const completed = [
    {
      tool: {
        name: 'write_file',
        compensate: async () => {
          order.push('write');
        }
      },
      toolCallId: 'a',
      args: {},
      snapshot: null,
      context: {}
    },
    {
      tool: { name: 'bash', irreversible: true },
      toolCallId: 'b',
      args: {},
      snapshot: null,
      context: {}
    },
    {
      tool: {
        name: 'edit_file',
        compensate: async () => {
          order.push('edit');
        }
      },
      toolCallId: 'c',
      args: {},
      snapshot: null,
      context: {}
    }
  ];
  const result = await compensateCompletedLifo(completed);
  assert.deepEqual(order, ['edit', 'write']);
  assert.deepEqual(result.compensated, ['c', 'a']);
  assert.deepEqual(result.irreversible, ['b']);
});
