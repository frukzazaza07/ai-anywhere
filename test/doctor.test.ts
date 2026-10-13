import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diagnose, probeCli, supportedNode, type Probe } from '../src/doctor.js';
import { runtimeFixture } from './runtime-fixture.js';

test('doctor accepts the minimum Node version and rejects older runtimes', () => {
  for (const version of ['24.17.0', 'v24.21.0', '25.0.0']) assert.equal(supportedNode(version), true);
  for (const version of ['v20.20.2', '24.16.99', '24.17.0-beta.1', 'unknown']) assert.equal(supportedNode(version), false);
});

test('doctor checks only version/authentication commands and keeps raw credentials out of results', async t => {
  const f = await runtimeFixture(t);
  const calls: string[][] = [];
  const probe: Probe = async (_executable, args) => {
    calls.push(args);
    if (args.includes('--version')) return { code: 0, output: args.length === 1 ? '2.1.248 (Claude Code)' : 'codex-cli 0.162.1' };
    return { code: 0, output: args.includes('auth') ? '{"loggedIn":true,"email":"private@example.com","token":"private-secret"}' : 'Logged in with private-secret' };
  };
  const checks = await diagnose(f.runtime.value, probe, {}, f.directory);
  assert.ok(checks.every(check => check.status === 'pass'));
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3], ['auth', 'status']);
  assert.doesNotMatch(JSON.stringify(checks), /private-secret|private@example|ai-runtime-/);
  assert.ok(calls.every(args => args.includes('--version') || args.includes('status')));
});

test('doctor reports unsupported CLI versions and does not probe authentication for them', async t => {
  const f = await runtimeFixture(t);
  const calls: string[][] = [];
  const checks = await diagnose(f.runtime.value, async (_executable, args) => {
    calls.push(args); return { code: 0, output: '2.1.247-private-secret' };
  }, {}, f.directory);
  assert.equal(calls.length, 2);
  assert.ok(checks.filter(check => check.name.endsWith('CLI')).every(check => check.status === 'fail'));
  assert.doesNotMatch(JSON.stringify(checks), /private-secret/);
});

test('doctor reports login failures, malformed auth output and unavailable executables safely', async t => {
  const f = await runtimeFixture(t);
  const checks = await diagnose(f.runtime.value, async (_executable, args) => {
    if (args.includes('--version')) return { code: 0, output: args.length === 1 ? '2.1.248' : 'codex-cli 0.162.1' };
    return { code: 1, output: 'private-token invalid-json' };
  }, {}, f.directory);
  assert.ok(checks.some(check => check.name === 'codex authentication' && check.status === 'fail'));
  assert.ok(checks.some(check => check.name === 'claude probe' && check.status === 'fail'));
  const unavailable = await diagnose(f.runtime.value, async () => { throw new Error('private-path'); }, {}, f.directory);
  assert.equal(unavailable.filter(check => check.name.endsWith('probe')).length, 2);
  assert.doesNotMatch(JSON.stringify([checks, unavailable]), /private-token|private-path/);
});

test('Gemini authentication checks remain warnings for missing, cached and environment credentials', async t => {
  const f = await runtimeFixture(t);
  const runtime = { ...f.runtime.value, providers: { ...f.runtime.value.providers, enabled: new Set<'gemini'>(['gemini']), geminiScript: 'local-script.js' } };
  const probe: Probe = async (_executable, args) => {
    assert.equal(args.at(-1), '--version');
    return { code: 0, output: '0.63.0' };
  };
  const missing = await diagnose(runtime, probe, {}, f.directory);
  assert.match(missing.at(-1)!.detail, /No local credential/);
  await mkdir(join(f.directory, '.gemini'));
  await writeFile(join(f.directory, '.gemini', 'oauth_creds.json'), '{"refresh_token":"private-secret"}');
  const cached = await diagnose(runtime, probe, {}, f.directory);
  assert.equal(cached.at(-1)!.status, 'warn');
  assert.match(cached.at(-1)!.detail, /Cached OAuth/);
  const key = await diagnose(runtime, probe, { GEMINI_API_KEY: 'private-secret' }, f.directory);
  assert.match(key.at(-1)!.detail, /API key configured/);
  assert.doesNotMatch(JSON.stringify([cached, key]), /private-secret/);
});

test('diagnostic probes deliver no prompt and filter Discord credentials', async t => {
  const f = await runtimeFixture(t);
  const script = join(f.directory, 'probe.mjs');
  const previous = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = 'private-secret';
  t.after(() => { if (previous === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = previous; });
  await writeFile(script, `process.stdin.on('data', () => process.exit(2));
    process.stdin.on('end', () => console.log(JSON.stringify({ leaked: !!process.env.DISCORD_TOKEN, args: process.argv.slice(2) })));
    process.stdin.resume();`);
  const result = await probeCli(process.execPath, [script, '--version'], f.directory);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.output), { leaked: false, args: ['--version'] });
});

test('diagnostic probes bound untrusted output and terminate the worker', async t => {
  const f = await runtimeFixture(t);
  const script = join(f.directory, 'flood.mjs');
  await writeFile(script, `setInterval(() => process.stdout.write('x'.repeat(65537)), 5);`);
  await assert.rejects(probeCli(process.execPath, [script], f.directory), /AI_DIAGNOSTIC_LIMIT/);
});
