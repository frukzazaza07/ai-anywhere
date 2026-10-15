import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { manageConfig } from '../src/admin-config.js';
import { RuntimeConfig, atomicConfigWrite } from '../src/runtime-config.js';
import { autocomplete, selectCommand } from '../src/selection.js';
import { taskErrorMessage } from '../src/results.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { type AgentRunOptions } from '../src/agent-runner.js';
import { runtimeFixture, access, auth, owner } from './runtime-fixture.js';

async function fixture(t: TestContext, options: { env?: NodeJS.ProcessEnv; busy?: () => boolean; write?: typeof atomicConfigWrite } = {}) {
  const f = await runtimeFixture(t);
  const config = { ...f.config, providers: { codex: f.config.providers.codex },
    profiles: { review: f.config.profiles.review, plain: f.config.profiles.plain } };
  await writeFile(f.file, JSON.stringify(config));
  const runtimeOptions = { ...f.runtimeOptions, env: {}, ...options };
  const runtime = new RuntimeConfig(runtimeOptions);
  await runtime.load();
  return { ...f, config, runtime, runtimeOptions };
}

test('admins register a provider and profile, select immediately and retain both across restart', async t => {
  const f = await fixture(t);
  await f.runtime.change({ kind: 'defaults', profile: 'plain' });
  const overrides = await readFile(f.overridesFile, 'utf8');
  const before = f.runtime.value;
  const reply = await manageConfig(f.runtime, access, auth, { kind: 'add-provider', provider: 'claude',
    models: 'sonnet, opus', defaultModel: 'sonnet' });
  assert.match(reply, /Provider claude added and enabled/);
  assert.doesNotMatch(reply, /ai-runtime-|directory|[A-Z]:[\\/]/);
  assert.equal(f.runtime.value.defaultProfile, before.defaultProfile);
  assert.deepEqual(f.runtime.value.projects, before.projects);
  assert.equal(f.runtime.value.providers.enabled.has('claude'), true);
  assert.deepEqual(selectCommand(f.runtime.value, 'claude'), { provider: 'claude', model: 'sonnet' });
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'provider', 'cl'), [{ name: 'claude', value: 'claude' }]);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai-admin', 'model', '', 'claude').map(c => c.value), ['sonnet', 'opus']);
  assert.equal(await readFile(f.overridesFile, 'utf8'), overrides);
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.deepEqual(saved.projects, f.config.projects);
  assert.deepEqual(saved.providers.codex, f.config.providers.codex);
  assert.deepEqual(saved.profiles, f.config.profiles);
  assert.deepEqual(saved.providers.claude, { enabled: true, models: ['sonnet', 'opus'], defaultModel: 'sonnet' });
  assert.match(await manageConfig(f.runtime, access, auth, { kind: 'add-profile', name: 'writer',
    profile: { provider: 'claude', model: 'opus' } }), /Profile writer added/);
  assert.deepEqual(selectCommand(f.runtime.value, null, 'writer'), { provider: 'claude', model: 'opus', profile: 'writer' });
  const restarted = new RuntimeConfig(f.runtimeOptions);
  await restarted.load();
  assert.deepEqual({ ...restarted.value, revision: 0 }, { ...f.runtime.value, revision: 0 });
  assert.deepEqual(autocomplete(restarted.value, access, auth, 'ai', 'profile', 'writer'), [{ name: 'writer', value: 'writer' }]);
  assert.ok(!(await readdir(f.directory)).some(file => file.endsWith('.tmp')));
});

test('provider registration reads only relevant host settings and supports CLI default without models', async t => {
  const f = await fixture(t, { env: { AI_PROVIDERS: 'invalid', AI_DEFAULT_PROVIDER: 'invalid',
    GEMINI_MODEL: '--invalid', GEMINI_CLI_SCRIPT: 'private-missing-path' } });
  await f.runtime.change({ kind: 'add-provider', provider: 'claude' });
  assert.deepEqual(f.runtime.value.providers.allowedModels?.claude, []);
  assert.deepEqual(selectCommand(f.runtime.value, 'claude'), { provider: 'claude', model: undefined });
  await f.runtime.change({ kind: 'add-profile', name: 'writer', profile: { provider: 'claude' } });
  assert.equal(selectCommand(f.runtime.value, null, 'writer').model, undefined);
});

test('host CLI paths and model defaults are persisted without accepting executable options from Discord', async t => {
  const f = await fixture(t, { env: { CLAUDE_EXECUTABLE: process.execPath, CLAUDE_MODEL: 'sonnet' } });
  await f.runtime.change({ kind: 'add-provider', provider: 'claude', models: 'opus' });
  assert.equal(f.runtime.value.providers.claudeExecutable, process.execPath);
  assert.deepEqual(f.runtime.value.providers.allowedModels?.claude, ['opus', 'sonnet']);
  assert.equal(f.runtime.value.providers.models.claude, 'sonnet');
  const script = join(f.directory, 'gemini.mjs');
  await writeFile(script, '// Host fixture; never executed.');
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: { GEMINI_CLI_SCRIPT: script } });
  await runtime.load();
  await runtime.change({ kind: 'add-provider', provider: 'gemini', defaultModel: 'gemini-model' });
  assert.equal(runtime.value.providers.geminiScript, script);
  assert.deepEqual(runtime.value.providers.allowedModels?.gemini, ['gemini-model']);
  const restarted = new RuntimeConfig({ ...f.runtimeOptions, env: {} });
  await restarted.load();
  assert.equal(restarted.value.providers.geminiScript, script);
  assert.equal(restarted.value.providers.claudeExecutable, process.execPath);
});

test('bundled Codex can be registered when the file only configures another adapter', async t => {
  const f = await fixture(t);
  await writeFile(f.file, JSON.stringify({ ...f.config, providers: { claude: { models: [] } },
    profiles: { writer: { provider: 'claude' } }, defaultProfile: 'writer' }));
  await f.runtime.reload();
  await f.runtime.change({ kind: 'add-provider', provider: 'codex' });
  assert.equal(f.runtime.value.providers.enabled.has('codex'), true);
  assert.equal(f.runtime.value.defaultProfile, 'writer');
});

test('invalid models, duplicate providers and duplicate profiles preserve saved and active settings', async t => {
  const f = await fixture(t);
  const before = f.runtime.value;
  const text = await readFile(f.file, 'utf8');
  for (const models of ['', 'sonnet,', 'sonnet,sonnet', '--flag', 'model with space', '../model']) {
    await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude', models }), /AI_CONFIG_INVALID/);
  }
  await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude', defaultModel: '--flag' }), /AI_CONFIG_INVALID/);
  await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'codex' }), /AI_PROVIDER_EXISTS/);
  await assert.rejects(f.runtime.change({ kind: 'add-profile', name: 'review', profile: { provider: 'codex' } }), /AI_PROFILE_EXISTS/);
  await assert.rejects(f.runtime.change({ kind: 'add-profile', name: 'bad/name', profile: { provider: 'codex' } }), /AI_CONFIG_INVALID/);
  await assert.rejects(f.runtime.change({ kind: 'add-profile', name: 'new', profile: { provider: 'codex', model: 'unapproved' } }), /AI_CONFIG_INVALID/);
  await assert.rejects(f.runtime.change({ kind: 'add-profile', name: 'new', profile: { provider: 'gemini' } }), /AI_CONFIG_INVALID/);
  assert.equal(f.runtime.value, before);
  assert.equal(await readFile(f.file, 'utf8'), text);
  await assert.rejects(readFile(f.overridesFile), { code: 'ENOENT' });
});

test('missing or unsafe host installation settings are rejected with private actionable errors', async t => {
  for (const env of [{}, { GEMINI_CLI_SCRIPT: 'private-token.cmd' }, { GEMINI_CLI_SCRIPT: '/private/missing.mjs' }]) {
    const f = await fixture(t, { env });
    const before = f.runtime.value;
    await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'gemini' }), /AI_PROVIDER_INSTALLATION/);
    assert.equal(f.runtime.value, before);
  }
  const f = await fixture(t, { env: { CLAUDE_EXECUTABLE: 'private-token.cmd' } });
  await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude' }), /AI_PROVIDER_INSTALLATION/);
  assert.doesNotMatch(taskErrorMessage(new Error('AI_PROVIDER_INSTALLATION')), /private-token|[A-Z]:[\\/]/);
  assert.match(taskErrorMessage(new Error('AI_PROVIDER_INSTALLATION')), /GEMINI_CLI_SCRIPT/);
});

test('provider addition requires setup and is rejected while a worker is active', async t => {
  let busy = false;
  const f = await fixture(t, { busy: () => busy });
  busy = true;
  await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude' }), /CODEX_BUSY/);
  await assert.rejects(f.runtime.change({ kind: 'add-profile', name: 'new', profile: { provider: 'codex' } }), /CODEX_BUSY/);
  busy = false;
  await rm(f.file);
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: { AI_WORKDIR: f.directory } });
  await runtime.load();
  await assert.rejects(runtime.change({ kind: 'add-provider', provider: 'claude' }), /AI_PROVIDER_SETUP/);
});

test('provider save failures retain the active snapshot and base file', async t => {
  const f = await fixture(t, { write: async () => { throw new Error('private path credential'); } });
  const before = f.runtime.value;
  const text = await readFile(f.file, 'utf8');
  await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude' }), /AI_PROVIDER_SAVE/);
  assert.equal(f.runtime.value, before);
  assert.equal(await readFile(f.file, 'utf8'), text);
  assert.equal(f.runtime.updating, false);
});

test('base and override edits before or during provider publication are preserved and require reload', async t => {
  for (const target of ['base', 'overrides', 'during-write']) {
    let edited = '';
    const f = await fixture(t, target === 'during-write' ? { write: async (file, text, beforePublish) => {
      edited = (await readFile(file, 'utf8')) + '\n';
      await writeFile(file, edited);
      await atomicConfigWrite(file, text, beforePublish);
    } } : {});
    const before = f.runtime.value;
    if (target === 'base') { edited = JSON.stringify({ ...f.config, defaultProject: 'api' }); await writeFile(f.file, edited); }
    if (target === 'overrides') { edited = JSON.stringify({ defaultProject: 'api' }); await writeFile(f.overridesFile, edited); }
    await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude' }), /AI_PROVIDER_CONFIG_CHANGED/);
    assert.equal(f.runtime.value, before);
    assert.equal(await readFile(target === 'overrides' ? f.overridesFile : f.file, 'utf8'), edited);
    assert.ok(!(await readdir(f.directory)).some(file => file.endsWith('.tmp')));
  }
});

test('provider and profile additions enforce both allowlists and guild membership', async t => {
  const f = await fixture(t);
  for (const [who, permissions] of [
    [access, { ...auth, adminUsers: new Set<string>() }],
    [access, { ...auth, allowedUsers: new Set<string>() }],
    [{ ...access, guildId: null }, auth],
    [{ ...access, guildId: 'other' }, auth],
  ] as const) {
    await assert.rejects(manageConfig(f.runtime, who, permissions, { kind: 'add-provider', provider: 'claude' }), /AI_ADMIN_DENIED/);
    await assert.rejects(manageConfig(f.runtime, who, permissions, { kind: 'add-profile', name: 'new', profile: { provider: 'codex' } }), /AI_ADMIN_DENIED/);
  }
  assert.equal(f.runtime.value.revision, 1);
});

test('dispatch waits for durable provider registration and competing mutations are rejected', async t => {
  let entered!: () => void;
  let release!: () => void;
  const saving = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, { write: async (file, text, beforePublish) => {
    entered(); await finish; await atomicConfigWrite(file, text, beforePublish);
  } });
  const adding = f.runtime.change({ kind: 'add-provider', provider: 'claude' });
  await saving;
  await assert.rejects(f.runtime.change({ kind: 'add-provider', provider: 'claude' }), /CODEX_BUSY/);
  await assert.rejects(f.runtime.change({ kind: 'add-profile', name: 'writer', profile: { provider: 'claude' } }), /CODEX_BUSY/);
  let dispatched = false;
  const dispatch = f.runtime.exclusive(() => {
    dispatched = true;
    assert.equal(f.runtime.value.providers.enabled.has('claude'), true);
  });
  assert.equal(dispatched, false);
  release(); await adding; await dispatch;
  assert.equal(dispatched, true);
});

test('new provider profiles run immediately while existing sessions and schedules keep their targets', async t => {
  const f = await fixture(t);
  const calls: AgentRunOptions[] = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, projects: f.runtime.value.projects,
    workdir: f.directory, sandbox: 'read-only' }, async (_prompt, options) => {
    calls.push(options); options.onSession?.(options.sessionId ?? 's' + calls.length); return 'done';
  });
  sessions.switchProject('user', 'api');
  const selection = selectCommand(f.runtime.value);
  await sessions.prompt('user', 'first', selection);
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), runtime: f.runtime,
    workdir: f.directory, sandbox: 'read-only', guildId: owner.guildId, allowedUsers: auth.allowedUsers,
    busy: () => sessions.busy, now: () => 1000, run: async () => 'done' });
  await scheduler.add(owner, 'later', { nextRun: 2000 }, selection, 'api', selection.profile);
  const job = structuredClone(scheduler.list(scheduleKey(owner))[0]!);
  await f.runtime.change({ kind: 'add-provider', provider: 'claude', models: 'sonnet' });
  await f.runtime.change({ kind: 'add-profile', name: 'writer', profile: { provider: 'claude', model: 'sonnet' } });
  assert.deepEqual(scheduler.list(scheduleKey(owner))[0], job);
  assert.equal(sessions.currentProject('user').project, 'api');
  await sessions.prompt('user', 'new provider', selectCommand(f.runtime.value, null, 'writer'));
  await sessions.prompt('user', 'old provider', selection);
  assert.deepEqual(calls.map(c => [c.provider, c.model, c.sessionId, c.workdir]), [
    ['codex', 'm2', undefined, join(f.directory, 'api')],
    ['claude', 'sonnet', undefined, join(f.directory, 'api')],
    ['codex', 'm2', 's1', join(f.directory, 'api')],
  ]);
});
