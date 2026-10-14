import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RuntimeConfig, atomicConfigWrite } from '../src/runtime-config.js';
import { manageConfig } from '../src/admin-config.js';
import { autocomplete, selectCommand } from '../src/selection.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { taskErrorMessage, taskReply } from '../src/results.js';
import { runtimeFixture, access, auth, owner } from './runtime-fixture.js';

async function fixture(t: TestContext, options: { busy?: () => boolean; write?: typeof atomicConfigWrite } = {}) {
  const f = await runtimeFixture(t, options);
  await writeFile(f.file, JSON.stringify({ ...f.config, projectRoots: { workspace: '.' } }));
  await f.runtime.reload();
  return f;
}

const addition = { kind: 'add-project', name: 'my-app', root: 'workspace', create: false } as const;

test('registering a folder preserves base entries, overrides and defaults and survives restart', async t => {
  const f = await fixture(t);
  await mkdir(join(f.directory, addition.name));
  await f.runtime.change({ kind: 'defaults', profile: 'fast' });
  await f.runtime.change({ kind: 'profile', name: 'custom', profile: { provider: 'codex', model: 'm1' } });
  await f.runtime.change({ kind: 'project', name: 'api', enabled: false });
  await f.runtime.updateModelCatalog('codex', [{ model: 'discovered', efforts: ['low', 'high'] }]);
  const savedOverrides = await readFile(f.overridesFile, 'utf8');
  const before = JSON.parse(await readFile(f.file, 'utf8'));
  const previous = f.runtime.value;
  const reply = await manageConfig(f.runtime, access, auth, addition);
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.deepEqual(saved, { ...before, projects: { ...before.projects,
    [addition.name]: { directory: join(f.directory, addition.name), enabled: true } } });
  assert.equal(await readFile(f.overridesFile, 'utf8'), savedOverrides);
  assert.equal(f.runtime.value.projects.defaultProject, previous.projects.defaultProject);
  assert.equal(f.runtime.value.defaultProfile, previous.defaultProfile);
  assert.equal(f.runtime.value.revision, previous.revision + 1);
  assert.match(reply, /existing folder/);
  assert.match(reply, /\/ai project name:my-app/);
  assert.doesNotMatch(reply, /ai-runtime-|[A-Z]:[\\/]/);
  assert.deepEqual(taskReply(reply).allowedMentions, { parse: [] });
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'project', 'my-app'),
    [{ name: 'my-app', value: 'my-app' }]);
  const restarted = new RuntimeConfig(f.runtimeOptions);
  await restarted.load();
  assert.deepEqual({ ...restarted.value, revision: 0 }, { ...f.runtime.value, revision: 0 });
  await f.runtime.reload();
  assert.equal(f.runtime.value.projects.directories.get(addition.name), join(f.directory, addition.name));
  assert.ok(!(await readdir(f.directory)).some(file => file.endsWith('.tmp')));
});

test('creation adds an empty folder and duplicate requests never replace folders or aliases', async t => {
  const f = await fixture(t);
  await manageConfig(f.runtime, access, auth, { ...addition, create: true });
  const path = join(f.directory, addition.name);
  assert.deepEqual(await readdir(path), []);
  await writeFile(join(path, 'keep.txt'), 'original');
  const previous = f.runtime.value;
  const saved = await readFile(f.file, 'utf8');
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_EXISTS/);
  await assert.rejects(f.runtime.change({ ...addition, name: 'api', create: true }), /AI_PROJECT_EXISTS/);
  await mkdir(join(f.directory, 'collision'));
  await writeFile(join(f.directory, 'collision', 'keep.txt'), 'original');
  await assert.rejects(f.runtime.change({ ...addition, name: 'collision', create: true }), /AI_PROJECT_DIRECTORY_EXISTS/);
  assert.equal(await readFile(join(path, 'keep.txt'), 'utf8'), 'original');
  assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.equal(f.runtime.value, previous);
});

test('roots are optional and invalid local root configuration preserves the active generation', async t => {
  const f = await runtimeFixture(t);
  assert.equal(f.runtime.value.projectRoots.size, 0);
  await assert.rejects(f.runtime.change(addition), /AI_PROJECT_ROOT/);
  const previous = f.runtime.value;
  await writeFile(join(f.directory, 'file.txt'), 'file');
  for (const roots of [[], null, { workspace: 'missing' }, { 'bad/root': '.' }, { workspace: 'file.txt' }, { workspace: '' }]) {
    await writeFile(f.file, JSON.stringify({ ...f.config, projectRoots: roots }));
    await assert.rejects(f.runtime.reload(), /AI_CONFIG_INVALID/);
    assert.equal(f.runtime.value, previous);
  }
});

test('root mode rejects path-shaped aliases, traversal, unknown roots and files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'file'), 'keep');
  const previous = f.runtime.value;
  const saved = await readFile(f.file, 'utf8');
  for (const create of [false, true]) {
    for (const name of ['../escape', '..', 'C:/private', '/private', 'bad/name', 'bad\\name', 'Upper', 'x'.repeat(33)]) {
      await assert.rejects(f.runtime.change({ ...addition, name, create }), /AI_PROJECT_NAME/);
    }
    await assert.rejects(f.runtime.change({ ...addition, root: '../private', create }), /AI_PROJECT_ROOT/);
    await assert.rejects(f.runtime.change({ ...addition, root: 'unknown', create }), /AI_PROJECT_ROOT/);
  }
  await assert.rejects(f.runtime.change({ ...addition, name: 'file' }), /AI_PROJECT_DIRECTORY/);
  await assert.rejects(f.runtime.change(addition), /AI_PROJECT_DIRECTORY/);
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.equal(await readFile(join(f.directory, 'file'), 'utf8'), 'keep');
});

test('symbolic links and Windows junctions cannot register a redirected child directory', async t => {
  const f = await fixture(t);
  const outside = await runtimeFixture(t);
  await symlink(outside.directory, join(f.directory, addition.name), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.runtime.change(addition), /AI_PROJECT_DIRECTORY/);
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_DIRECTORY_EXISTS/);
  assert.equal(f.runtime.value.projects.directories.has(addition.name), false);
  assert.equal(await readFile(outside.file, 'utf8'), JSON.stringify(outside.config));
});

test('failed saves remove only newly created empty directories and retain existing folders', async t => {
  const f = await fixture(t, { write: async () => { throw new Error('private storage path'); } });
  const previous = f.runtime.value;
  const saved = await readFile(f.file, 'utf8');
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_SAVE/);
  await assert.rejects(readdir(join(f.directory, addition.name)), { code: 'ENOENT' });
  await mkdir(join(f.directory, addition.name));
  await writeFile(join(f.directory, addition.name, 'keep.txt'), 'keep');
  await assert.rejects(f.runtime.change(addition), /AI_PROJECT_SAVE/);
  assert.equal(await readFile(join(f.directory, addition.name, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.equal(f.runtime.updating, false);
});

test('rollback preserves files added by another process and reports cleanup failure without paths', async t => {
  const f = await fixture(t, { write: async file => {
    await writeFile(join(file, '..', addition.name, 'keep.txt'), 'another process');
    throw new Error('private storage path');
  } });
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_CLEANUP/);
  assert.equal(await readFile(join(f.directory, addition.name, 'keep.txt'), 'utf8'), 'another process');
  assert.equal(f.runtime.value, previous);
  assert.doesNotMatch(taskErrorMessage(new Error('AI_PROJECT_CLEANUP')), /ai-runtime-|[A-Z]:[\\/]/);
});

test('local base edits block additions until reload instead of overwriting operator changes', async t => {
  const f = await fixture(t);
  const previous = f.runtime.value;
  const edited = JSON.stringify({ ...f.config, projectRoots: { workspace: '.' }, defaultProject: 'api' });
  await writeFile(f.file, edited);
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_CONFIG_CHANGED/);
  assert.equal(await readFile(f.file, 'utf8'), edited);
  assert.equal(f.runtime.value, previous);
  await assert.rejects(readdir(join(f.directory, addition.name)), { code: 'ENOENT' });
  await f.runtime.reload();
  await f.runtime.change({ ...addition, create: true });
  assert.equal(f.runtime.value.projects.defaultProject, 'api');
});

test('edits during temporary-file publication abort the save and clean up the owned directory', async t => {
  let edited = '';
  const f = await fixture(t, { write: async (file, text, beforePublish) => {
    edited = (await readFile(file, 'utf8')) + '\n';
    await writeFile(file, edited);
    await atomicConfigWrite(file, text, beforePublish);
  } });
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_CONFIG_CHANGED/);
  assert.equal(await readFile(f.file, 'utf8'), edited);
  assert.equal(f.runtime.value, previous);
  await assert.rejects(readdir(join(f.directory, addition.name)), { code: 'ENOENT' });
  assert.ok(!(await readdir(f.directory)).some(file => file.endsWith('.tmp')));
});

test('unloaded override edits block additions without changing either file', async t => {
  const f = await fixture(t);
  const previous = f.runtime.value;
  const saved = await readFile(f.file, 'utf8');
  const overrides = JSON.stringify({ defaultProject: 'api' });
  await writeFile(f.overridesFile, overrides);
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_CONFIG_CHANGED/);
  assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.equal(await readFile(f.overridesFile, 'utf8'), overrides);
  assert.equal(f.runtime.value, previous);
});

test('a child redirected during saving is rejected and rollback never touches the redirected target', async t => {
  const outside = await runtimeFixture(t);
  const f = await fixture(t, { write: async (file, text, beforePublish) => {
    const child = join(file, '..', addition.name);
    await rename(child, child + '-moved');
    await symlink(outside.directory, child, process.platform === 'win32' ? 'junction' : 'dir');
    await atomicConfigWrite(file, text, beforePublish);
  } });
  const saved = await readFile(f.file, 'utf8');
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /AI_PROJECT_CLEANUP/);
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.equal(await readFile(outside.file, 'utf8'), JSON.stringify(outside.config));
  assert.ok(!(await readdir(f.directory)).some(file => file.endsWith('.tmp')));
});

test('only allowed admins can add projects or autocomplete root aliases', async t => {
  const f = await fixture(t);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai-admin', 'root', 'work'),
    [{ name: 'workspace', value: 'workspace' }]);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'root', ''), []);
  for (const [who, permissions] of [
    [{ ...access, guildId: null }, auth], [{ ...access, userId: 'other' }, auth],
    [access, { ...auth, adminUsers: new Set<string>() }], [access, { ...auth, allowedUsers: new Set<string>() }],
  ] as const) {
    await assert.rejects(manageConfig(f.runtime, who, permissions, { ...addition, create: true }), /AI_ADMIN_DENIED/);
    assert.deepEqual(autocomplete(f.runtime.value, who, permissions, 'ai-admin', 'root', ''), []);
  }
  assert.equal(f.runtime.value.projects.directories.has(addition.name), false);
  await assert.rejects(readdir(join(f.directory, addition.name)), { code: 'ENOENT' });
});

test('busy workers and concurrent additions are rejected and dispatch waits for durable save', async t => {
  let busy = false;
  let release!: () => void;
  let entered!: () => void;
  const saving = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, { busy: () => busy, write: async (file, text, beforePublish) => {
    entered(); await finish; await atomicConfigWrite(file, text, beforePublish);
  } });
  busy = true;
  await assert.rejects(f.runtime.change({ ...addition, create: true }), /CODEX_BUSY/);
  busy = false;
  const adding = f.runtime.change({ ...addition, create: true });
  await saving;
  await assert.rejects(f.runtime.change({ ...addition, name: 'other', create: true }), /CODEX_BUSY/);
  let dispatched = false;
  const dispatch = f.runtime.exclusive(() => {
    dispatched = true;
    assert.equal(f.runtime.value.projects.directories.has(addition.name), true);
  });
  assert.equal(dispatched, false);
  release(); await adding; await dispatch;
  await assert.rejects(readdir(join(f.directory, 'other')), { code: 'ENOENT' });
});

test('initialization is required and adding projects does not persist environment config implicitly', async t => {
  const f = await runtimeFixture(t);
  await rm(f.file);
  const runtime = new RuntimeConfig({ ...f.runtimeOptions, env: { AI_WORKDIR: f.directory } });
  await runtime.load();
  await assert.rejects(runtime.change({ ...addition, create: true }), /AI_PROJECT_SETUP/);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('new projects run immediately while existing sessions and schedules keep their targets', async t => {
  const f = await fixture(t);
  const calls: Array<{ workdir: string; sessionId?: string }> = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, projects: f.runtime.value.projects,
    workdir: f.directory, sandbox: 'read-only' }, async (_prompt, options) => {
    calls.push({ workdir: options.workdir, sessionId: options.sessionId });
    options.onSession?.(options.sessionId ?? 's' + calls.length);
    return 'done';
  });
  sessions.switchProject('user', 'api');
  const selection = selectCommand(f.runtime.value);
  await sessions.prompt('user', 'first', selection);
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), runtime: f.runtime,
    workdir: f.directory, sandbox: 'read-only', guildId: owner.guildId, allowedUsers: auth.allowedUsers,
    busy: () => sessions.busy, now: () => 1000, run: async () => 'done' });
  await scheduler.add(owner, 'later', { nextRun: 2000 }, selection, 'api', selection.profile);
  const job = structuredClone(scheduler.list(scheduleKey(owner))[0]!);
  await f.runtime.change({ ...addition, create: true });
  assert.equal(sessions.currentProject('user').project, 'api');
  assert.match(sessions.projectsText('user'), /my-app/);
  assert.equal(sessions.currentProject('new-user').project, 'web');
  assert.deepEqual(scheduler.list(scheduleKey(owner))[0], job);
  await sessions.prompt('user', 'second', selection);
  sessions.switchProject('user', addition.name);
  await sessions.prompt('user', 'new project', selection);
  assert.deepEqual(calls, [
    { workdir: join(f.directory, 'api'), sessionId: undefined },
    { workdir: join(f.directory, 'api'), sessionId: 's1' },
    { workdir: join(f.directory, addition.name), sessionId: undefined },
  ]);
});
