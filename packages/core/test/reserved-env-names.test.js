import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWritableEnvName,
  isReservedEnvName,
  stripReservedEnvNames
} from '../dist/secrets/index.js';

test('reserved env names cover linker / interpreter switches', () => {
  for (const name of ['PATH', 'HOME', 'NODE_OPTIONS', 'PYTHONPATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES']) {
    assert.equal(isReservedEnvName(name), true, name);
    assert.throws(() => assertWritableEnvName(name));
  }
  assert.equal(isReservedEnvName('MY_API_KEY'), false);
  assertWritableEnvName('MY_API_KEY');
});

test('env name grammar rejects lowercase and empty', () => {
  assert.throws(() => assertWritableEnvName('api_key'));
  assert.throws(() => assertWritableEnvName(''));
  assert.throws(() => assertWritableEnvName('1FOO'));
});

test('stripReservedEnvNames drops PATH but keeps vault names', () => {
  assert.deepEqual(stripReservedEnvNames({ PATH: '/bin', MY_TOKEN: 'x', LD_PRELOAD: 'evil' }), {
    MY_TOKEN: 'x'
  });
});
