import test from 'node:test';
import assert from 'node:assert/strict';
import { taskTimeoutMs } from '../src/config.js';

test('task deadlines are disabled when omitted, blank or zero', () => {
  for (const value of [undefined, '', ' ', '0']) assert.equal(taskTimeoutMs(value), 0);
});

test('explicit task deadlines accept more than ten minutes without timer overflow', () => {
  assert.equal(taskTimeoutMs('600'), 600000);
  assert.equal(taskTimeoutMs('3600'), 3600000);
  assert.equal(taskTimeoutMs('2147483'), 2147483000);
  for (const value of ['-1', '0.5', 'bad', 'Infinity', '2147484']) {
    assert.throws(() => taskTimeoutMs(value), /CODEX_TIMEOUT_SECONDS/);
  }
});
