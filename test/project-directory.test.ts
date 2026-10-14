import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RuntimeConfig, atomicConfigWrite } from '../src/runtime-config.js';
import { manageConfig } from '../src/admin-config.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { autocomplete, selectCommand } from '../src/selection.js';
import { taskErrorMessage, taskReply } from '../src/results.js';
import { runtimeFixture, access, auth } from './runtime-fixture.js';

test('admins can register an absolute directory outside configured roots with an independent alias', async t => {
  const f = await runtimeFixture(t);
  const external = await runtimeFixture(t);
  const directory = join(external.directory, 'folder with spaces ไทย');
  await mkdir(directory);
  const canonical = realpathSync.native(directory);
  await writeFile(join(directory, 'keep.txt'), 'keep');
  const before = JSON.parse(await readFile(f.file, 'utf8'));
  await f.runtime.change({ kind: 'defaults', profile: 'fast' });
  const overrides = await readFile(f.overridesFile, 'utf8');
  const reply = await manageConfig(f.runtime, access, auth,
    { kind: 'add-project', name: 'remote', directory, create: false });
  assert.equal(f.runtime.value.projectRoots.size, 0);
  assert.equal(f.runtime.value.projects.directories.get('remote'), canonical);
  assert.equal(f.runtime.value.projects.defaultProject, 'web');
  assert.equal(f.runtime.value.defaultProfile, 'fast');
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), { ...before,
    projects: { ...before.projects, remote: { directory: canonical, enabled: true } } });
  assert.equal(await readFile(f.overridesFile, 'utf8'), overrides);
  assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'keep');
  assert.doesNotMatch(reply, /ai-runtime-|folder with|[A-Z]:[\\/]/);
  assert.deepEqual(taskReply(reply).allowedMentions, { parse: [] });
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'project', 'remote'),
    [{ name: 'remote', value: 'remote' }]);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai-admin', 'directory', ''), []);
  const restored = new RuntimeConfig(f.runtimeOptions);
  await restored.load();
  assert.deepEqual({ ...restored.value, revision: 0 }, { ...f.runtime.value, revision: 0 });
  const sessions = new ProjectSessions({ runtime: f.runtime, projects: f.runtime.value.projects,
    workdir: f.directory, sandbox: 'read-only' }, async (_prompt, options) => {
    assert.equal(options.workdir, canonical); return 'ran in selected directory';
  });
  await sessions.prompt('user', 'task', selectCommand(f.runtime.value), 'remote');
  assert.equal(sessions.currentProject('user').project, 'web');
  assert.throws(() => sessions.currentProject('user', directory), /AI_PROJECT_UNAVAILABLE/);
});

test('directory creation builds missing parent folders and rejects existing targets and duplicate aliases', async t => {
  const f = await runtimeFixture(t);
  const external = await runtimeFixture(t);
  const directory = join(external.directory, 'new-parent', 'nested', 'my folder ไทย');
  const addition = { kind: 'add-project', name: 'created', directory, create: true } as const;
  await manageConfig(f.runtime, access, auth, addition);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(f.runtime.value.projects.directories.get('created'), realpathSync.native(directory));
  const saved = await readFile(f.file, 'utf8');
  await writeFile(join(directory, 'keep.txt'), 'keep');
  await assert.rejects(f.runtime.change(addition), /AI_PROJECT_EXISTS/);
  await assert.rejects(f.runtime.change({ ...addition, name: 'another' }), /AI_PROJECT_DIRECTORY_EXISTS/);
  assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(f.file, 'utf8'), saved);
});

test('existing directory registration stores canonical spelling on case-insensitive hosts', async t => {
  const f = await runtimeFixture(t);
  const directory = join(f.directory, 'MixedCaseFolder');
  await mkdir(directory);
  await f.runtime.change({ kind: 'add-project', name: 'mixed',
    directory: process.platform === 'win32' ? directory.toLowerCase() : directory, create: false });
  assert.equal(f.runtime.value.projects.directories.get('mixed'), realpathSync.native(directory));
});

test('location requires exactly one directory or root and rejects nonabsolute paths without writing', async t => {
  const f = await runtimeFixture(t);
  const saved = await readFile(f.file, 'utf8');
  const previous = f.runtime.value;
  const base = { kind: 'add-project', name: 'new', create: true } as const;
  await assert.rejects(f.runtime.change(base), /AI_PROJECT_LOCATION/);
  await assert.rejects(f.runtime.change({ ...base, root: 'workspace', directory: f.directory }), /AI_PROJECT_LOCATION/);
  for (const directory of ['', ' ', './relative', '../relative', 'bad\0path',
    ...(process.platform === 'win32' ? ['D:relative', '\\rooted-without-drive', '/without-drive'] : [])]) {
    await assert.rejects(f.runtime.change({ ...base, directory }), /AI_PROJECT_PATH/);
  }
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.doesNotMatch(taskErrorMessage(new Error('AI_PROJECT_PATH')), /[A-Z]:[\\/]/);
});

test('only allowed admins can supply arbitrary host directories', async t => {
  const f = await runtimeFixture(t);
  const directory = join(f.directory, 'new');
  for (const [who, permissions] of [
    [{ ...access, guildId: null }, auth], [{ ...access, userId: 'other' }, auth],
    [access, { ...auth, adminUsers: new Set<string>() }], [access, { ...auth, allowedUsers: new Set<string>() }],
  ] as const) {
    await assert.rejects(manageConfig(f.runtime, who, permissions,
      { kind: 'add-project', name: 'new', directory, create: true }), /AI_ADMIN_DENIED/);
  }
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
});

test('directory mode rejects missing targets, files and target junctions without changing them', async t => {
  const f = await runtimeFixture(t);
  const external = await runtimeFixture(t);
  const file = join(f.directory, 'file');
  const linked = join(f.directory, 'linked');
  await writeFile(file, 'keep');
  await symlink(external.directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const base = { kind: 'add-project', name: 'new', create: false } as const;
  for (const directory of [file, linked, join(f.directory, 'missing', 'leaf')]) {
    await assert.rejects(f.runtime.change({ ...base, directory }), /AI_PROJECT_DIRECTORY/);
  }
  await assert.rejects(f.runtime.change({ ...base, directory: file, create: true }), /AI_PROJECT_DIRECTORY_EXISTS/);
  await assert.rejects(f.runtime.change({ ...base, directory: linked, create: true }), /AI_PROJECT_DIRECTORY_EXISTS/);
  assert.equal(await readFile(file, 'utf8'), 'keep');
  assert.equal(await readFile(external.file, 'utf8'), JSON.stringify(external.config));
});

test('failed saves roll back all owned empty parent folders and preserve existing parents', async t => {
  const f = await runtimeFixture(t, { write: async () => { throw new Error('private path'); } });
  const external = await runtimeFixture(t);
  const directory = join(external.directory, 'created-parent', 'nested', 'leaf');
  const previous = f.runtime.value;
  const saved = await readFile(f.file, 'utf8');
  await assert.rejects(f.runtime.change({ kind: 'add-project', name: 'new', directory, create: true }), /AI_PROJECT_SAVE/);
  await assert.rejects(readdir(join(external.directory, 'created-parent')), { code: 'ENOENT' });
  assert.equal(await readFile(external.file, 'utf8'), JSON.stringify(external.config));
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(f.file, 'utf8'), saved);
});

test('failed parent cleanup preserves files written by another process', async t => {
  const external = await runtimeFixture(t);
  const directory = join(external.directory, 'created-parent', 'leaf');
  const f = await runtimeFixture(t, { write: async () => {
    await writeFile(join(dirname(directory), 'keep.txt'), 'keep');
    throw new Error('private path');
  } });
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.change({ kind: 'add-project', name: 'new', directory, create: true }), /AI_PROJECT_CLEANUP/);
  assert.equal(await readFile(join(dirname(directory), 'keep.txt'), 'utf8'), 'keep');
  assert.equal(f.runtime.value, previous);
});

test('partial directory creation failure removes only owned empty ancestors', async t => {
  const f = await runtimeFixture(t);
  const directory = join(f.directory, 'new-parent', 'x'.repeat(300));
  const previous = f.runtime.value;
  const saved = await readFile(f.file, 'utf8');
  await assert.rejects(f.runtime.change({ kind: 'add-project', name: 'new', directory, create: true }), /AI_PROJECT_DIRECTORY/);
  await assert.rejects(readdir(join(f.directory, 'new-parent')), { code: 'ENOENT' });
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(f.file, 'utf8'), saved);
});

test('directory mode canonicalizes an existing parent link and stores the resolved target', async t => {
  const f = await runtimeFixture(t);
  const external = await runtimeFixture(t);
  const parent = join(f.directory, 'parent-link');
  await symlink(external.directory, parent, process.platform === 'win32' ? 'junction' : 'dir');
  await f.runtime.change({ kind: 'add-project', name: 'new', directory: join(parent, 'leaf'), create: true });
  assert.equal(f.runtime.value.projects.directories.get('new'), realpathSync.native(join(external.directory, 'leaf')));
});

test('alternate path spelling for an existing project shares its canonical directory and session', async t => {
  const f = await runtimeFixture(t);
  const directory = f.runtime.value.projects.directories.get('api')!;
  const sessions = new ProjectSessions({ runtime: f.runtime, projects: f.runtime.value.projects,
    workdir: f.directory, sandbox: 'read-only' }, async (_prompt, options) => {
    options.onSession?.(options.sessionId ?? 'existing-session');
    return options.sessionId ?? 'first turn';
  });
  const selection = selectCommand(f.runtime.value);
  await sessions.prompt('user', 'first', selection, 'api');
  await f.runtime.change({ kind: 'add-project', name: 'same-folder',
    directory: process.platform === 'win32' ? directory.toLowerCase() : directory, create: false });
  assert.equal(f.runtime.value.projects.directories.get('same-folder'), directory);
  assert.equal(await sessions.prompt('user', 'follow-up', selection, 'same-folder'), 'existing-session');
});

test('a parent moved during saving is rejected and rollback leaves its replacement untouched', async t => {
  const external = await runtimeFixture(t);
  const directory = join(external.directory, 'new-parent', 'leaf');
  const replacement = await runtimeFixture(t);
  const f = await runtimeFixture(t, { write: async (file, text, beforePublish) => {
    await rename(dirname(directory), dirname(directory) + '-moved');
    await symlink(replacement.directory, dirname(directory), process.platform === 'win32' ? 'junction' : 'dir');
    await atomicConfigWrite(file, text, beforePublish);
  } });
  const previous = f.runtime.value;
  await assert.rejects(f.runtime.change({ kind: 'add-project', name: 'new', directory, create: true }), /AI_PROJECT_CLEANUP/);
  assert.equal(f.runtime.value, previous);
  assert.equal(await readFile(replacement.file, 'utf8'), JSON.stringify(replacement.config));
});
