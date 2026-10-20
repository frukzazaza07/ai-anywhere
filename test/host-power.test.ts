import test from 'node:test';
import assert from 'node:assert/strict';
import { hostPower, type HostPowerCommand } from '../src/host-power.js';
import { commands } from '../src/commands.js';

function recorder(code: number | null) {
  const calls: { executable: string; args: string[] }[] = [];
  const run: HostPowerCommand = async (executable, args) => { calls.push({ executable, args }); return code; };
  return { calls, run };
}

test('shutdown schedules shutdown.exe with the delay in seconds and no shell', async () => {
  const { calls, run } = recorder(0);
  assert.match(await hostPower('shutdown', 5, run, 'win32'), /in 5 minutes.*shutdown-cancel/s);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.executable, /System32[\\/]shutdown\.exe$/i);
  assert.deepEqual(calls[0]!.args.slice(0, 3), ['/s', '/t', '300']);
});

test('shutdown rejects delays outside 1–60 minutes without running a command', async () => {
  const { calls, run } = recorder(0);
  for (const delay of [0, 61, 1.5]) await assert.rejects(hostPower('shutdown', delay, run, 'win32'), /AI_HOST_POWER_DELAY/);
  assert.equal(calls.length, 0);
});

test('cancel aborts a pending shutdown and reports when none is scheduled', async () => {
  const done = recorder(0);
  assert.match(await hostPower('cancel', 1, done.run, 'win32'), /cancelled/);
  assert.deepEqual(done.calls[0]!.args, ['/a']);
  assert.match(await hostPower('cancel', 1, recorder(1116).run, 'win32'), /No host shutdown/);
});

test('host power fails safely on other platforms and when Windows rejects the request', async () => {
  const { calls, run } = recorder(0);
  await assert.rejects(hostPower('shutdown', 1, run, 'linux'), /AI_HOST_POWER_UNSUPPORTED/);
  assert.equal(calls.length, 0);
  await assert.rejects(hostPower('shutdown', 1, recorder(5).run, 'win32'), /AI_HOST_POWER_FAILED/);
  await assert.rejects(hostPower('shutdown', 1, async () => { throw new Error('spawn failed'); }, 'win32'), /AI_HOST_POWER_FAILED/);
});

test('/ai-admin shutdown requires explicit confirmation and bounds the delay', () => {
  const admin = commands.find(command => command.name === 'ai-admin')!.toJSON();
  const shutdown = admin.options!.find(option => option.name === 'shutdown')!;
  assert.ok(shutdown.type === 1);
  assert.deepEqual(shutdown.options?.map(option => option.name), ['confirm', 'delay']);
  const confirm = shutdown.options![0]!;
  assert.ok(confirm.type === 5 && confirm.required);
  const delay = shutdown.options![1]!;
  assert.ok(delay.type === 4 && !delay.required && delay.min_value === 1 && delay.max_value === 60);
});
