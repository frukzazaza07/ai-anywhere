import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RuntimeConfig } from '../src/runtime-config.js';
import { adminUserIds } from '../src/config.js';
import { taskErrorMessage } from '../src/results.js';
import { workerEnvironment } from '../src/runner.js';
import { selectCommand } from '../src/selection.js';
import { manageConfig } from '../src/admin-config.js';
import { runtimeFixture, access, auth } from './runtime-fixture.js';

test('legacy env produces in-memory profiles and retains persisted overrides across restart', async t => {
  const f = await runtimeFixture(t);
  await rm(f.file);
  const options = { ...f.runtimeOptions, env: { AI_WORKDIR: f.directory, AI_PROVIDERS: 'codex,claude',
    AI_DEFAULT_PROVIDER: 'claude', CLAUDE_MODEL: 'sonnet' } };
  const runtime = new RuntimeConfig(options);
  await runtime.load();
  assert.equal(runtime.value.source, 'environment');
  assert.deepEqual(selectCommand(runtime.value), { provider: 'claude', model: 'sonnet', profile: 'claude' });
  await runtime.change({ kind: 'defaults', profile: 'codex' });
  const restarted = new RuntimeConfig(options);
  await restarted.load();
  assert.equal(restarted.value.defaultProfile, 'codex');
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('file runtime is authoritative over incompatible legacy env and canonicalizes relative projects', async t => {
  const f = await runtimeFixture(t);
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: { AI_PROVIDERS: 'bad', AI_WORKDIR: 'missing' } });
  await runtime.load();
  assert.equal(runtime.value.source, 'file');
  assert.equal(runtime.value.projects.directories.get('api'), join(f.directory, 'api'));
  assert.equal(selectCommand(runtime.value).model, 'm2');
  assert.equal(selectCommand(runtime.value, 'codex').model, 'm1');
});

test('overrides persist profile edits, deletions, enablement and defaults without modifying the base file', async t => {
  const f = await runtimeFixture(t);
  const original = await readFile(f.file, 'utf8');
  await f.runtime.change({ kind: 'profile', name: 'new-profile', profile: { provider: 'codex', model: 'm1' } });
  await f.runtime.change({ kind: 'defaults', project: 'api', profile: 'new-profile' });
  await f.runtime.change({ kind: 'delete-profile', name: 'review' });
  await f.runtime.change({ kind: 'project', name: 'web', enabled: false });
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  const restarted = new RuntimeConfig(f.runtimeOptions);
  await restarted.load();
  assert.equal(restarted.value.defaultProfile, 'new-profile');
  assert.equal(restarted.value.projects.defaultProject, 'api');
  assert.equal(restarted.value.profiles.has('review'), false);
  assert.equal(restarted.value.projects.enabled?.has('web'), false);
  assert.equal(restarted.value.providers.enabled.has('claude'), false);
  assert.equal(await readFile(f.file, 'utf8'), original);
  assert.ok((await readdir(f.directory)).every(name => !name.endsWith('.tmp')));
  await restarted.change({ kind: 'delete-profile', name: 'fast' });
  await restarted.change({ kind: 'profile', name: 'transient', profile: { provider: 'codex' } });
  await restarted.change({ kind: 'delete-profile', name: 'transient' });
  await restarted.reload();
  assert.equal(restarted.value.profiles.has('transient'), false);
});

test('invalid config and stale overrides leave the complete prior generation active and hide paths', async t => {
  const f = await runtimeFixture(t);
  const original = f.runtime.value;
  for (const text of ['{', '[]', JSON.stringify({ ...f.config, defaultProject: 'absent' }),
    JSON.stringify({ ...f.config, profiles: { review: { provider: 'codex', model: 'unapproved' } } }),
    JSON.stringify({ ...f.config, projects: { web: { directory: './private-token-path' } } }),
    JSON.stringify({ ...f.config, providers: { codex: { models: [], executable: 'secret.exe' } } })]) {
    await writeFile(f.file, text);
    await assert.rejects(f.runtime.reload(), error => {
      assert.equal((error as Error).message, 'AI_CONFIG_INVALID');
      assert.doesNotMatch(taskErrorMessage(error), /private-token|secret\.exe|[A-Z]:\\/);
      return true;
    });
    assert.equal(f.runtime.value, original);
  }
  await f.save();
  for (const overrides of [{ projects: { missing: false } }, { providers: { gemini: true } },
    { profiles: { gone: null } }, { profiles: { x: { provider: 'gemini' } } },
    { projects: { web: 'false' } }, { path: 'secret' }, { profiles: { bad: { provider: 'codex', model: '--bad' } } }]) {
    await writeFile(f.overridesFile, JSON.stringify(overrides));
    await assert.rejects(f.runtime.reload(), /AI_CONFIG_INVALID/);
    assert.equal(f.runtime.value, original);
  }
});

test('mutations cannot add paths, installations, unapproved models or disable/delete defaults', async t => {
  const f = await runtimeFixture(t);
  for (const change of [
    { kind: 'project' as const, name: 'missing', enabled: true },
    { kind: 'provider' as const, name: 'gemini', enabled: true },
    { kind: 'profile' as const, name: 'x', profile: { provider: 'codex' as const, model: 'unapproved' } },
    { kind: 'profile' as const, name: 'bad/path', profile: { provider: 'codex' as const } },
    { kind: 'project' as const, name: 'web', enabled: false },
    { kind: 'provider' as const, name: 'codex', enabled: false },
    { kind: 'delete-profile' as const, name: 'review' },
    { kind: 'defaults' as const, project: 'missing' },
  ]) await assert.rejects(f.runtime.change(change), /AI_CONFIG_INVALID/);
  assert.equal(f.runtime.value.revision, 1);
  await assert.rejects(readFile(f.overridesFile), { code: 'ENOENT' });
  assert.doesNotMatch(f.runtime.status(), /[A-Z]:\\|ai-runtime-|directory|secret/);
});

test('write failure never publishes success or changes the active snapshot', async t => {
  const f = await runtimeFixture(t, { write: async () => { throw new Error('secret path credential'); } });
  const original = f.runtime.value;
  await assert.rejects(f.runtime.change({ kind: 'defaults', profile: 'fast' }), /AI_CONFIG_SAVE/);
  assert.equal(f.runtime.value, original);
  assert.equal(f.runtime.updating, false);
  await assert.rejects(readFile(f.overridesFile), { code: 'ENOENT' });
});

test('active workers reject reload/mutations and pending writes serialize dispatch', async t => {
  let busy = false;
  let release!: () => void;
  let writing!: () => void;
  const entered = new Promise<void>(resolve => { writing = resolve; });
  const f = await runtimeFixture(t, { busy: () => busy, write: async () => {
    writing(); await new Promise<void>(resolve => { release = resolve; });
  } });
  busy = true;
  await assert.rejects(f.runtime.reload(), /CODEX_BUSY/);
  await assert.rejects(f.runtime.change({ kind: 'defaults', profile: 'fast' }), /CODEX_BUSY/);
  busy = false;
  const update = f.runtime.change({ kind: 'defaults', profile: 'fast' });
  await entered;
  let dispatched = false;
  const dispatch = f.runtime.exclusive(() => { dispatched = true; assert.equal(f.runtime.value.defaultProfile, 'fast'); });
  assert.equal(dispatched, false);
  await assert.rejects(f.runtime.reload(), /CODEX_BUSY/);
  release(); await update; await dispatch;
  assert.equal(dispatched, true);
});

test('admins default to disabled, validate Discord IDs and are filtered out of worker environments', t => {
  assert.equal(adminUserIds('').size, 0);
  assert.equal(adminUserIds('333333333333333333').size, 1);
  assert.throws(() => adminUserIds('username'));
  const previous = process.env.ADMIN_USER_IDS;
  t.after(() => { if (previous === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = previous; });
  process.env.ADMIN_USER_IDS = '333333333333333333';
  assert.equal(workerEnvironment().ADMIN_USER_IDS, undefined);
});

test('admin actions require membership in both allowlists and the configured guild before any mutation', async t => {
  const f = await runtimeFixture(t);
  for (const [request, permissions] of [
    [access, { ...auth, adminUsers: new Set<string>() }],
    [access, { ...auth, allowedUsers: new Set<string>() }],
    [{ ...access, guildId: 'other' }, auth],
  ] as const) {
    for (const action of ['status', 'reload', { kind: 'defaults', profile: 'fast' }] as const) {
      await assert.rejects(manageConfig(f.runtime, request, permissions, action), /AI_ADMIN_DENIED/);
    }
  }
  assert.equal(f.runtime.value.revision, 1);
  await assert.rejects(readFile(f.overridesFile), { code: 'ENOENT' });
  assert.match(await manageConfig(f.runtime, access, auth, { kind: 'defaults', profile: 'fast' }), /Configuration updated/);
});
