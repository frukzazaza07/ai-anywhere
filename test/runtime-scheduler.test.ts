import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexScheduler, scheduleKey, schedulesText } from '../src/scheduler.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { RuntimeConfig, atomicConfigWrite } from '../src/runtime-config.js';
import { selectCommand } from '../src/selection.js';
import { runtimeFixture, owner, auth } from './runtime-fixture.js';

const key = scheduleKey(owner);
const initialTime = 1000000;

test('scheduled profile captures the selected tuple/project and default changes do not redirect it', async t => {
  const f = await runtimeFixture(t);
  let time = initialTime;
  const calls: Array<{ provider: string; model?: string; project?: string }> = [];
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only',
    guildId: owner.guildId, allowedUsers: auth.allowedUsers, runtime: f.runtime, busy: () => false, now: () => time,
    run: async (_key, _prompt, selection, project) => { calls.push({ ...selection, project }); return 'done'; } });
  const selection = selectCommand(f.runtime.value);
  const job = await scheduler.add(owner, 'review', { nextRun: time + 1 }, selection, 'web', selection.profile);
  assert.equal(job.profile, 'review'); assert.equal(job.model, 'm2');
  assert.equal(job.workdir, f.runtime.value.projects.directories.get('web'));
  await f.runtime.change({ kind: 'defaults', project: 'api', profile: 'writer' });
  time++; await scheduler.tick();
  assert.deepEqual(calls, [{ provider: 'codex', model: 'm2', project: 'web' }]);
  assert.match(schedulesText(scheduler.list(key)), /profile:review/);
});

test('profile deletion/retargeting, provider/model revocation and project changes permanently pause pending jobs', async t => {
  for (const cause of ['profile-deleted', 'profile-changed', 'provider-disabled', 'model-removed', 'project-disabled', 'directory-changed']) {
    await t.test(cause, async sub => {
      const f = await runtimeFixture(sub);
      let calls = 0;
      const options = { file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only',
        guildId: owner.guildId, allowedUsers: auth.allowedUsers, runtime: f.runtime, busy: () => false,
        now: () => initialTime, run: async () => { calls++; return 'done'; } };
      const scheduler = new CodexScheduler(options);
      const job = await scheduler.add(owner, 'review', { nextRun: initialTime + 1, intervalMs: 60000 },
        { provider: 'codex', model: 'm2' }, 'web', cause === 'model-removed' ? undefined : 'review');
      if (cause === 'profile-deleted') {
        await f.runtime.change({ kind: 'defaults', profile: 'fast' });
        await f.runtime.change({ kind: 'delete-profile', name: 'review' });
      } else if (cause === 'profile-changed') {
        await f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm1' } });
      } else if (cause === 'provider-disabled') {
        await f.runtime.change({ kind: 'defaults', profile: 'writer' });
        await f.runtime.change({ kind: 'provider', name: 'codex', enabled: false });
      } else if (cause === 'model-removed') {
        f.config.providers.codex.models = ['m1']; f.config.profiles.review.model = 'm1';
        await f.save(); await f.runtime.reload();
      } else if (cause === 'project-disabled') {
        await f.runtime.change({ kind: 'defaults', project: 'api' });
        await f.runtime.change({ kind: 'project', name: 'web', enabled: false });
      } else {
        f.config.projects.web.directory = './api'; await f.save(); await f.runtime.reload();
      }
      assert.equal(scheduler.list(key)[0]?.state, 'paused');
      assert.match(scheduler.list(key)[0]!.lastOutcome!, /Paused:.*Cancel and recreate/);
      assert.doesNotMatch(schedulesText(scheduler.list(key)), /ai-runtime-|[A-Z]:\\/);
      const stored = JSON.parse(await readFile(options.file, 'utf8'));
      assert.equal(stored[0].state, 'paused');
      // Restore the original pair/project/provider. Paused is a durable terminal state.
      f.config.providers.codex.models = ['m1', 'm2']; f.config.profiles.review.model = 'm2'; f.config.projects.web.directory = '.';
      await f.save();
      await writeFile(f.overridesFile, '{}'); await f.runtime.reload();
      const restarted = new CodexScheduler({ ...options, now: () => initialTime + 100000 });
      await restarted.load(); await restarted.tick();
      assert.equal(restarted.list(key)[0]?.state, 'paused'); assert.equal(calls, 0);
      assert.equal(await restarted.cancel(key, job.id), true);
    });
  }
});

test('legacy jobs without profile/provider keep their saved model/directory after migration and defaults change', async t => {
  const f = await runtimeFixture(t);
  let time = initialTime;
  const calls: string[] = [];
  const options = { file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only', runtime: f.runtime,
    guildId: owner.guildId, allowedUsers: auth.allowedUsers, busy: () => false, now: () => time,
    run: async (_key: string, _prompt: string, selection: { provider: string; model?: string }, project?: string) => {
      calls.push(selection.provider + ':' + (selection.model ?? '') + ':' + project); return 'done';
    } };
  const scheduler = new CodexScheduler(options);
  await scheduler.add(owner, 'legacy', { nextRun: time + 1 }, { provider: 'codex', model: 'm2' }, 'web');
  const stored = JSON.parse(await readFile(options.file, 'utf8'));
  delete stored[0].provider; delete stored[0].project;
  await writeFile(options.file, JSON.stringify(stored));
  await f.runtime.change({ kind: 'defaults', project: 'api', profile: 'writer' });
  const restarted = new CodexScheduler(options); await restarted.load();
  assert.equal(restarted.list(key)[0]?.project, 'web');
  time++; await restarted.tick(); assert.deepEqual(calls, ['codex:m2:web']);
});

test('scheduler dispatch claims the shared worker under the config gate while schedule creation remains available', async t => {
  let sessions: ProjectSessions;
  const f = await runtimeFixture(t, { busy: () => sessions?.busy ?? false });
  let finish!: (value: string) => void;
  let entered!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects,
    sandbox: 'read-only' }, async () => { entered(); return new Promise<string>(resolve => { finish = resolve; }); });
  let time = initialTime;
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only',
    guildId: owner.guildId, allowedUsers: auth.allowedUsers, runtime: f.runtime, busy: () => sessions.busy, now: () => time,
    run: (key, prompt, selection, project) => sessions.prompt(key, prompt, selection, project) });
  await scheduler.add(owner, 'run', { nextRun: time + 1 }, { provider: 'codex', model: 'm2' }, 'web', 'review');
  time++; const tick = scheduler.tick(); await began;
  assert.equal(sessions.busy, true);
  await assert.rejects(f.runtime.change({ kind: 'defaults', profile: 'fast' }), /CODEX_BUSY/);
  await assert.rejects(f.runtime.reload(), /CODEX_BUSY/);
  await assert.rejects(sessions.prompt('another', 'task', { provider: 'claude' }, 'api'), /CODEX_BUSY/);
  const later = await f.runtime.exclusive(() => scheduler.add(owner, 'later', { nextRun: time + 10000 },
    { provider: 'codex', model: 'm1' }, 'api'));
  assert.equal(later.state, 'pending');
  finish('done'); await tick;
  assert.equal(scheduler.list(key)[0]?.state, 'completed');
});

test('configuration writes serialize with scheduler dispatch so it cannot run a superseded profile', async t => {
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const f = await runtimeFixture(t, { write: async (file, text) => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); await atomicConfigWrite(file, text);
  } });
  let time = initialTime;
  let calls = 0;
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only',
    guildId: owner.guildId, allowedUsers: auth.allowedUsers, runtime: f.runtime, busy: () => false, now: () => time,
    run: async () => { calls++; return 'done'; } });
  await scheduler.add(owner, 'review', { nextRun: time + 1 }, { provider: 'codex', model: 'm2' }, 'web', 'review');
  const change = f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm1' } });
  await writing; time++; await scheduler.tick(); assert.equal(calls, 0);
  release(); await change; await scheduler.tick();
  assert.equal(calls, 0); assert.equal(scheduler.list(key)[0]?.state, 'paused');
  const restartedConfig = new RuntimeConfig(f.runtimeOptions); await restartedConfig.load();
  assert.equal(restartedConfig.value.profiles.get('review')?.model, 'm1');
});

test('failed schedule pause persistence reports applied config and blocks restoration until pauses are durable', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'jobs.json');
  let calls = 0;
  const scheduler = new CodexScheduler({ file, workdir: f.directory, sandbox: 'read-only',
    guildId: owner.guildId, allowedUsers: auth.allowedUsers, runtime: f.runtime, busy: () => false,
    now: () => initialTime, run: async () => { calls++; return 'done'; } });
  await scheduler.add(owner, 'review', { nextRun: initialTime + 1 }, { provider: 'codex', model: 'm2' }, 'web', 'review');
  await rm(file); await mkdir(file);
  await assert.rejects(f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm1' } }),
    /AI_CONFIG_JOBS_APPLIED/);
  assert.equal(f.runtime.value.profiles.get('review')?.model, 'm1');
  assert.equal(scheduler.list(key)[0]?.state, 'paused');
  const revision = f.runtime.value.revision;
  await assert.rejects(f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm2' } }),
    /AI_CONFIG_JOBS_PENDING/);
  assert.equal(f.runtime.value.revision, revision);
  await assert.rejects(scheduler.tick());
  assert.equal(calls, 0);
  await rmdir(file);
  await f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm2' } });
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].state, 'paused');
  assert.equal(scheduler.list(key)[0]?.state, 'paused');
});
