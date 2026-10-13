import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeConfig, atomicConfigCreate } from '../src/runtime-config.js';
import { initializeConfig } from '../src/init-config.js';
import { initializationDialog, submitInitialization } from '../src/init-dialog.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { discordConfig, workerConfig } from '../src/config.js';
import { autocomplete } from '../src/selection.js';
import { taskErrorMessage, taskReply } from '../src/results.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { access, auth, owner } from './runtime-fixture.js';

async function fixture(t: TestContext, options: { busy?: () => boolean; create?: typeof atomicConfigCreate } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-init-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  await mkdir(join(directory, 'web'));
  await mkdir(join(directory, 'api'));
  const geminiScript = join(directory, 'gemini.mjs');
  await writeFile(geminiScript, '// Local configured CLI fixture; never executed.');
  const env = { AI_PROJECTS: JSON.stringify({ web: join(directory, 'web'), api: join(directory, 'api') }),
    AI_PROVIDERS: 'codex,claude,gemini', AI_DEFAULT_PROVIDER: 'codex', CODEX_MODEL: 'm1',
    CLAUDE_MODEL: 'sonnet', GEMINI_MODEL: 'g1', GEMINI_CLI_SCRIPT: geminiScript };
  const file = join(directory, 'ai.config.json');
  const overridesFile = join(directory, 'overrides.json');
  const runtimeOptions = { file, overridesFile, env, ...options };
  const runtime = new RuntimeConfig(runtimeOptions);
  await runtime.load();
  return { directory, file, overridesFile, runtime, runtimeOptions };
}

test('/ai init creates validated version-1 configuration and activates it without restart', async t => {
  const f = await fixture(t);
  const previous = f.runtime.value;
  const reply = await initializeConfig(f.runtime, access, auth);
  const config = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(config.version, 1);
  assert.equal(config.defaultProject, 'web');
  assert.equal(config.defaultProfile, 'codex');
  assert.equal(config.providers.gemini.script, f.runtime.value.providers.geminiScript);
  assert.equal(config.profiles.claude.model, 'sonnet');
  assert.deepEqual(config.providers.codex.models, ['m1']);
  assert.equal(f.runtime.value.source, 'file');
  assert.equal(f.runtime.value.revision, previous.revision + 1);
  assert.match(reply, /Setup complete|No restart/);
  assert.match(reply, /\/ai run project:web profile:codex/);
  assert.doesNotMatch(reply, /ai-init-|gemini\.mjs/);
  assert.deepEqual(taskReply(reply).allowedMentions, { parse: [] });
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp')));
  const restored = new RuntimeConfig({ ...f.runtimeOptions, env: { AI_PROJECTS: 'invalid' } });
  await restored.load();
  assert.deepEqual([...restored.value.profiles], [...f.runtime.value.profiles]);
  assert.deepEqual([...restored.value.projects.directories], [...f.runtime.value.projects.directories]);
});

test('/ai init selects approved project/profile defaults and repeated setup preserves the file', async t => {
  const f = await fixture(t);
  await initializeConfig(f.runtime, access, auth, { project: 'api', profile: 'claude' });
  assert.equal(f.runtime.value.projects.defaultProject, 'api');
  assert.equal(f.runtime.value.defaultProfile, 'claude');
  assert.equal(f.runtime.value.providers.defaultProvider, 'claude');
  const original = await readFile(f.file, 'utf8');
  const revision = f.runtime.value.revision;
  const reply = await initializeConfig(f.runtime, access, auth, { project: 'web', profile: 'codex' });
  assert.match(reply, /already configured|preserved/);
  assert.equal(await readFile(f.file, 'utf8'), original);
  assert.equal(f.runtime.value.revision, revision);
});

test('/ai init requires both allowlists and the configured guild before writing or listing configuration', async t => {
  const f = await fixture(t);
  for (const [who, permissions] of [
    [{ ...access, guildId: '999999999999999999' }, auth],
    [{ ...access, userId: '999999999999999999' }, auth],
    [access, { ...auth, adminUsers: new Set<string>() }],
    [access, { ...auth, allowedUsers: new Set<string>() }],
  ] as const) {
    await assert.rejects(initializeConfig(f.runtime, who, permissions), /AI_ADMIN_DENIED/);
    assert.deepEqual(autocomplete(f.runtime.value, who, permissions, 'ai', 'project', '', null, true), []);
  }
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.equal(f.runtime.value.source, 'environment');
});

test('init autocomplete lists only enabled projects and usable profiles for an admin', async t => {
  const f = await fixture(t);
  await f.runtime.change({ kind: 'project', name: 'api', enabled: false });
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'project', '', null, true), [{ name: 'web', value: 'web' }]);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'profile', 'code', null, true), [{ name: 'codex', value: 'codex' }]);
  assert.ok(!autocomplete(f.runtime.value, access, auth, 'ai', 'profile', '', null, true).some(choice => choice.value === 'claude'));
});

test('invalid/disabled init defaults never create a file or publish a runtime generation', async t => {
  const f = await fixture(t);
  await f.runtime.change({ kind: 'project', name: 'api', enabled: false });
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  const previous = f.runtime.value;
  for (const defaults of [{ project: 'api' }, { project: 'C:/private/path' }, { project: '../escape' },
    { project: 'unknown' }, { profile: 'claude' }, { profile: 'unknown' }]) {
    await assert.rejects(f.runtime.initialize(defaults), /AI_CONFIG_INVALID/);
    assert.equal(f.runtime.value, previous);
    await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  }
});

test('initialization keeps profile edits/deletions and overrides valid across restart', async t => {
  const f = await fixture(t);
  await f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'claude', model: 'sonnet' } });
  await f.runtime.change({ kind: 'delete-profile', name: 'gemini' });
  await f.runtime.change({ kind: 'defaults', project: 'api', profile: 'review' });
  const overrides = await readFile(f.overridesFile, 'utf8');
  await f.runtime.initialize();
  assert.equal(await readFile(f.overridesFile, 'utf8'), overrides);
  const restored = new RuntimeConfig(f.runtimeOptions);
  await restored.load();
  assert.equal(restored.value.projects.defaultProject, 'api');
  assert.equal(restored.value.defaultProfile, 'review');
  assert.equal(restored.value.profiles.has('gemini'), false);
  assert.deepEqual(restored.value.profiles.get('review'), { provider: 'claude', model: 'sonnet' });
});

test('conflicting persisted defaults produce actionable guidance instead of silently ignoring selections', async t => {
  const f = await fixture(t);
  await f.runtime.change({ kind: 'defaults', project: 'api' });
  await assert.rejects(f.runtime.initialize({ project: 'web' }), /AI_INIT_DEFAULT_OVERRIDE/);
  assert.match(taskErrorMessage(new Error('AI_INIT_DEFAULT_OVERRIDE')), /\/ai-admin defaults/);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('manually copied config takes precedence and init preserves its exact contents', async t => {
  const f = await fixture(t);
  await f.runtime.initialize();
  const copied = JSON.parse(await readFile(f.file, 'utf8'));
  copied.defaultProject = 'api';
  const content = JSON.stringify(copied, null, 4) + '\n';
  await writeFile(f.file, content);
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: { AI_PROVIDERS: 'invalid' } });
  await runtime.load();
  const reply = await initializeConfig(runtime, access, auth);
  assert.equal(await readFile(f.file, 'utf8'), content);
  assert.equal(runtime.value.projects.defaultProject, 'api');
  assert.match(reply, /already configured/);
});

test('a concurrent manual copy is never replaced by initializer publication', async t => {
  const content = '{"operator":"private existing file"}\n';
  const f = await fixture(t, { create: async (file, text) => {
    await writeFile(file, content);
    await atomicConfigCreate(file, text);
  } });
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.initialize(), /AI_CONFIG_EXISTS/);
  assert.equal(await readFile(f.file, 'utf8'), content);
  assert.equal(f.runtime.value, previous);
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp')));
});

test('creation failures and active workers leave existing runtime state untouched', async t => {
  let busy = false;
  const f = await fixture(t, { busy: () => busy, create: async () => { throw new Error('private-path/secret'); } });
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.initialize(), /AI_INIT_SAVE/);
  assert.equal(f.runtime.value, previous);
  assert.doesNotMatch(taskErrorMessage(new Error('AI_INIT_SAVE')), /private-path|secret/);
  busy = true;
  await assert.rejects(f.runtime.initialize(), /CODEX_BUSY/);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('setup serializes publication with dispatch and rejects competing config changes', async t => {
  const saving = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const f = await fixture(t, { create: async (file, text) => {
    saving.resolve(); await finish.promise; await atomicConfigCreate(file, text);
  } });
  const initialized = f.runtime.initialize({ project: 'api', profile: 'claude' });
  await saving.promise;
  await assert.rejects(f.runtime.initialize(), /CODEX_BUSY/);
  await assert.rejects(f.runtime.change({ kind: 'defaults', project: 'web' }), /CODEX_BUSY/);
  let dispatched = false;
  const dispatch = f.runtime.exclusive(() => { dispatched = true; return f.runtime.value.defaultProfile; });
  assert.equal(dispatched, false);
  finish.resolve();
  await initialized;
  assert.equal(await dispatch, 'claude');
});

test('init default changes preserve captured schedule project/provider/model targets', async t => {
  const f = await fixture(t);
  let time = Date.now();
  const calls: string[] = [];
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), runtime: f.runtime,
    workdir: f.runtime.value.projects.directories.get('web')!, sandbox: 'read-only',
    guildId: auth.guildId, allowedUsers: auth.allowedUsers, busy: () => false, now: () => time,
    run: async (_key, _prompt, selection, project) => { calls.push(project + ':' + selection.provider + ':' + selection.model); return 'done'; } });
  await scheduler.add(owner, 'inspect', { nextRun: time + 1000 }, { provider: 'codex', model: 'm1' }, 'web', 'codex');
  await f.runtime.initialize({ project: 'api', profile: 'claude' });
  time += 1000;
  await scheduler.tick();
  assert.deepEqual(calls, ['web:codex:m1']);
  assert.equal(scheduler.list(scheduleKey(owner))[0]?.state, 'completed');
});

test('missing config and missing or invalid project settings can boot into setup without creating files', async t => {
  const f = await fixture(t);
  for (const env of [{}, { CODEX_WORKDIR: join(f.directory, 'missing') }, { AI_PROJECTS: 'invalid' }]) {
    const runtime = new RuntimeConfig({ ...f.runtimeOptions, env, allowSetup: true });
    await runtime.load();
    assert.equal(runtime.value.source, 'setup');
    assert.equal(runtime.value.projects.defaultProject, 'default');
    assert.equal(runtime.value.projects.directories.get('default'), f.directory);
    assert.equal(runtime.value.defaultProfile, 'codex');
    assert.match(runtime.status(), /\/ai init/);
    await assert.rejects(readFile(f.file), { code: 'ENOENT' });
    // Noninteractive tools can still request strict validation.
    await assert.rejects(new RuntimeConfig({ ...f.runtimeOptions, env }).load(), /AI_CONFIG_INVALID/);
  }
});

test('setup blocks worker execution and scheduling until the Discord form is saved, then survives restart', async t => {
  const f = await fixture(t);
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: {}, allowSetup: true });
  await runtime.load();
  let runs = 0;
  const sessions = new ProjectSessions({ workdir: f.directory, sandbox: 'read-only', runtime,
    projects: runtime.value.projects, providers: runtime.value.providers }, async () => { runs++; return 'done'; });
  const scheduler = new CodexScheduler({ file: join(f.directory, 'setup-jobs.json'), workdir: f.directory,
    sandbox: 'read-only', guildId: auth.guildId, allowedUsers: auth.allowedUsers, runtime,
    busy: () => sessions.busy, run: async () => { runs++; return 'done'; } });
  await assert.rejects(sessions.prompt('owner', 'task', { provider: 'codex' }), /AI_SETUP_REQUIRED/);
  await assert.rejects(scheduler.add(owner, 'task', { nextRun: Date.now() + 60000 }), /AI_SETUP_REQUIRED/);
  assert.equal(runs, 0);
  const dialog = initializationDialog(runtime, access, auth).toJSON();
  assert.match(JSON.stringify(dialog), /default = bot startup folder/);
  assert.doesNotMatch(JSON.stringify(dialog), /ai-init-|[A-Z]:\\/);
  const reply = await submitInitialization(runtime, access, auth, dialog.custom_id, ' default ', ' codex ');
  assert.match(reply, /Setup complete/);
  assert.equal(runtime.value.source, 'file');
  assert.equal(await sessions.prompt('owner', 'task', { provider: 'codex' }), 'done');
  assert.equal(runs, 1);
  const restored = new RuntimeConfig({ ...f.runtimeOptions, env: {} });
  await restored.load();
  assert.equal(restored.value.source, 'file');
  assert.equal(restored.value.projects.directories.get('default'), f.directory);
});

test('a setup form lists approved aliases and revalidates access, input and runtime revision on submission', async t => {
  const f = await fixture(t);
  const dialog = initializationDialog(f.runtime, access, auth).toJSON();
  const text = JSON.stringify(dialog);
  assert.match(text, /web, api/);
  assert.match(text, /codex, claude, gemini/);
  assert.doesNotMatch(text, /gemini\.mjs|ai-init-[a-z0-9]|[A-Z]:\\/);
  const denied = { ...auth, adminUsers: new Set<string>() };
  assert.throws(() => initializationDialog(f.runtime, access, denied), /AI_ADMIN_DENIED/);
  for (const [who, permissions] of [[access, denied], [{ ...access, guildId: null }, auth],
    [access, { ...auth, allowedUsers: new Set<string>() }]] as const) {
    await assert.rejects(submitInitialization(f.runtime, who, permissions, dialog.custom_id, 'web', 'codex'), /AI_ADMIN_DENIED/);
  }
  await assert.rejects(submitInitialization(f.runtime, access, auth, 'ai-init:bad', 'web', 'codex'), /AI_CONFIG_INVALID/);
  await assert.rejects(submitInitialization(f.runtime, access, auth, dialog.custom_id, '../private', 'codex'), /AI_CONFIG_INVALID/);
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  await assert.rejects(submitInitialization(f.runtime, access, auth, dialog.custom_id, 'web', 'claude'), /AI_INIT_STALE/);
  const current = initializationDialog(f.runtime, access, auth).toJSON();
  await assert.rejects(submitInitialization(f.runtime, access, auth, current.custom_id, 'web', 'claude'), /AI_CONFIG_INVALID/);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('minimal host credentials boot the worker in setup mode and forms from a previous process are rejected', async t => {
  const f = await fixture(t);
  const settings = { DISCORD_TOKEN: 'offline-test-token', DISCORD_CLIENT_ID: auth.guildId,
    DISCORD_GUILD_ID: auth.guildId, ALLOWED_USER_IDS: access.userId, ADMIN_USER_IDS: access.userId,
    CODEX_SANDBOX: 'read-only', CODEX_TIMEOUT_SECONDS: '0' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, settings);
  const options = { ...f.runtimeOptions, env: {}, allowSetup: true };
  const runtime = new RuntimeConfig(options);
  await runtime.load();
  assert.equal(discordConfig().guildId, auth.guildId);
  const worker = workerConfig(runtime.value);
  assert.equal(worker.workdir, f.directory);
  assert.ok(worker.allowedUsers.has(access.userId) && worker.adminUsers.has(access.userId));
  const dialog = initializationDialog(runtime, access, auth).toJSON();
  const restarted = new RuntimeConfig(options);
  await restarted.load();
  assert.equal(restarted.value.revision, runtime.value.revision);
  await assert.rejects(submitInitialization(restarted, access, auth, dialog.custom_id, 'default', 'codex'), /AI_INIT_STALE/);
  assert.match(taskErrorMessage(new Error('AI_INIT_STALE')), /Run \/ai init again/);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('setup mode never hides invalid existing files, provider settings or saved overrides', async t => {
  const f = await fixture(t);
  const options = { ...f.runtimeOptions, env: {}, allowSetup: true };
  await writeFile(f.file, '{broken');
  await assert.rejects(new RuntimeConfig(options).load(), /AI_CONFIG_INVALID/);
  await rm(f.file);
  await assert.rejects(new RuntimeConfig({ ...options, env: { AI_PROVIDERS: 'bad' } }).load(), /AI_CONFIG_INVALID/);
  await writeFile(f.overridesFile, JSON.stringify({ defaultProject: 'missing' }));
  await assert.rejects(new RuntimeConfig(options).load(), /AI_CONFIG_INVALID/);
});

test('saved schedules pause in setup mode without executing or redirecting their captured directories', async t => {
  const f = await fixture(t);
  let runs = 0;
  const file = join(f.directory, 'jobs.json');
  const options = { file, runtime: f.runtime, workdir: f.directory, sandbox: 'read-only' as const,
    guildId: auth.guildId, allowedUsers: auth.allowedUsers, busy: () => false,
    run: async () => { runs++; return 'done'; } };
  const scheduler = new CodexScheduler(options);
  const job = await scheduler.add(owner, 'task', { nextRun: Date.now() + 1000 }, { provider: 'codex', model: 'm1' }, 'web');
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: {}, allowSetup: true });
  await runtime.load();
  const restarted = new CodexScheduler({ ...options, runtime, now: () => job.nextRun + 1000 });
  await restarted.load();
  await restarted.tick();
  assert.equal(runs, 0);
  assert.equal(restarted.list(scheduleKey(owner))[0]?.state, 'paused');
  assert.equal(restarted.list(scheduleKey(owner))[0]?.workdir, job.workdir);
  await runtime.initialize();
  await restarted.tick();
  assert.equal(runs, 0);
  assert.equal(restarted.list(scheduleKey(owner))[0]?.workdir, job.workdir);
});
