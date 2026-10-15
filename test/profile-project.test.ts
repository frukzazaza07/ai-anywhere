import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectSessions } from '../src/project-sessions.js';
import { ProviderPreferences } from '../src/provider-preferences.js';
import { RuntimeConfig } from '../src/runtime-config.js';
import { autocomplete, selectCommand } from '../src/selection.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { manageConfig } from '../src/admin-config.js';
import { initializeConfig } from '../src/init-config.js';
import { modelCatalog, modelsText } from '../src/models.js';
import { taskErrorMessage } from '../src/results.js';
import { type AgentRunOptions } from '../src/agent-runner.js';
import { runtimeFixture, owner, access, auth } from './runtime-fixture.js';

test('profile alone runs and retrieves the bound project session despite current-project and personal defaults', async t => {
  const f = await runtimeFixture(t);
  const reply = await manageConfig(f.runtime, access, auth, { kind: 'add-profile', name: 'api-review',
    profile: { project: 'api', provider: 'codex', model: 'm2' } });
  assert.match(reply, /\/ai run profile:api-review prompt:/);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  const key = scheduleKey(owner);
  await preferences.save(f.runtime.value, key, 'claude', { model: 'sonnet' });
  const selection = preferences.resolve(f.runtime.value, key, null, 'api-review');
  assert.deepEqual(selection, { project: 'api', provider: 'codex', model: 'm2', profile: 'api-review' });
  assert.equal(preferences.resolve(f.runtime.value, key, null, 'api-review', null, 'high').project, 'api');
  const calls: AgentRunOptions[] = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory,
    projects: f.runtime.value.projects, sandbox: 'read-only' }, async (_prompt, options) => {
    calls.push(options); options.onSession?.(options.sessionId ?? 's' + calls.length); return 'answer-' + calls.length;
  });
  sessions.switchProject(key, 'web');
  assert.equal(sessions.currentProject(key, null, selection).project, 'api');
  assert.match(sessions.result(key, selection), /\/ai run profile:api-review prompt:/);
  await sessions.prompt(key, 'review', selection);
  assert.equal(calls[0]?.workdir, join(f.directory, 'api'));
  assert.equal(sessions.result(key, selection), 'answer-1');
  assert.match(sessions.status(key, selection), /Project: api\nProfile: api-review/);
  assert.match(sessions.status(key, selection), /Session: s1/);
  assert.equal(sessions.contextState(key, selection).sessionId, 's1');
  // Manual selection shares the same canonical directory/provider/model session.
  const direct = selectCommand(f.runtime.value, 'codex', null, 'm2');
  assert.equal(sessions.result(key, direct, 'api'), 'answer-1');
  await sessions.prompt(key, 'manual', direct, 'api');
  assert.equal(calls[1]?.sessionId, 's1');
  assert.equal(sessions.result(key, selection), 'answer-2');
  assert.match(sessions.result(key, direct, 'web'), /No saved result/);
  assert.match(sessions.result('other-user', selection), /No saved result/);
  assert.equal(sessions.currentProject(key).project, 'web');
  sessions.reset(key, selection);
  assert.match(sessions.result(key, selection), /No saved result/);
  assert.equal(sessions.contextState(key, selection).sessionId, undefined);
});

test('bound profiles reject conflicting project overrides on every session operation', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.change({ kind: 'profile', name: 'review', profile: { project: 'api', provider: 'codex', model: 'm2' } });
  const selection = selectCommand(f.runtime.value);
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory,
    projects: f.runtime.value.projects, sandbox: 'read-only' }, async () => { throw new Error('Must not run'); });
  for (const project of ['web', '../private', 'missing']) {
    assert.throws(() => sessions.currentProject('user', project, selection), /AI_PROFILE_PROJECT_CONFLICT/);
    assert.throws(() => sessions.result('user', selection, project), /AI_PROFILE_PROJECT_CONFLICT/);
    assert.throws(() => sessions.status('user', selection, project), /AI_PROFILE_PROJECT_CONFLICT/);
    assert.throws(() => sessions.reset('user', selection, project), /AI_PROFILE_PROJECT_CONFLICT/);
    assert.throws(() => sessions.contextState('user', selection, project), /AI_PROFILE_PROJECT_CONFLICT/);
    await assert.rejects(sessions.prompt('user', 'bad', selection, project), /AI_PROFILE_PROJECT_CONFLICT/);
  }
  assert.equal(sessions.currentProject('user', 'api', selection).project, 'api');
  assert.match(taskErrorMessage(new Error('AI_PROFILE_PROJECT_CONFLICT')), /profile alone/);
  assert.equal(sessions.busy, false);
});

test('running profile status/results remain readable and one worker still guards every project', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.change({ kind: 'profile', name: 'api-review', profile: { project: 'api', provider: 'codex', model: 'm2' } });
  const selection = selectCommand(f.runtime.value, null, 'api-review');
  let finish!: (value: string) => void;
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory,
    projects: f.runtime.value.projects, sandbox: 'read-only' }, () => new Promise(resolve => { finish = resolve; }));
  const running = sessions.prompt('user', 'review', selection);
  t.after(() => { finish('done'); });
  assert.match(sessions.result('user', selection), /still running.*\/ai result profile:api-review again/);
  assert.match(sessions.status('user', selection), /Current task:/);
  assert.equal(sessions.contextState('user', selection).contextRunning, true);
  const manual = selectCommand(f.runtime.value, 'claude', null, 'sonnet');
  assert.match(sessions.status('user', manual, 'web'), /Worker: busy/);
  await assert.rejects(sessions.prompt('other-user', 'manual', manual, 'web'), /CODEX_BUSY/);
  assert.throws(() => sessions.reset('user', selection), /CODEX_BUSY/);
  finish('done'); await running;
  assert.equal(sessions.result('user', selection), 'done');
  assert.match(sessions.status('user', selection), /Completed turns: 1/);
});

test('a stopped task keeps the last completed session and frees the worker', async t => {
  const f = await runtimeFixture(t);
  const selection = selectCommand(f.runtime.value, 'codex', null, 'm2');
  let turn = 0;
  const signals: Array<AbortSignal | undefined> = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory,
    projects: f.runtime.value.projects, sandbox: 'read-only' }, (_prompt, options) => {
    signals.push(options.signal);
    if (++turn === 1) { options.onSession?.('s1'); return Promise.resolve('first'); }
    return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('AI_CANCELLED'))));
  });
  await sessions.prompt('user', 'first', selection, 'web');
  const controller = new AbortController();
  const running = sessions.prompt('user', 'long', selection, 'web', { signal: controller.signal });
  assert.equal(signals[1], controller.signal);
  controller.abort();
  await assert.rejects(running, /AI_CANCELLED/);
  assert.equal(sessions.busy, false);
  assert.match(sessions.result('user', selection, 'web'), /stopped/);
  assert.match(sessions.status('user', selection, 'web'), /Session: s1\n.*Completed turns: 1/s);
});

test('profile project validation, persistence, disabled targets and default protection use configured aliases only', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.change({ kind: 'profile', name: 'api-review', profile: { project: 'api', provider: 'codex', model: 'm2' } });
  const restarted = new RuntimeConfig(f.runtimeOptions);
  await restarted.load();
  assert.equal(selectCommand(restarted.value, null, 'api-review').project, 'api');
  assert.match(restarted.status(), /api-review: codex \/ m2 \/ project: api/);
  assert.match(modelsText(modelCatalog(restarted.value)), /api-review: m2 \/ project: api/);
  const original = restarted.value;
  const saved = await readFile(f.overridesFile, 'utf8');
  for (const project of ['unknown', '../private', 'C:/private', '', 'api\nsecret']) {
    await assert.rejects(restarted.change({ kind: 'profile', name: 'bad', profile: { project, provider: 'codex' } }), /AI_CONFIG_INVALID/);
    assert.equal(restarted.value, original);
    assert.equal(await readFile(f.overridesFile, 'utf8'), saved);
  }
  await restarted.change({ kind: 'defaults', profile: 'api-review' });
  await assert.rejects(restarted.change({ kind: 'project', name: 'api', enabled: false }), /AI_CONFIG_INVALID/);
  await restarted.change({ kind: 'defaults', profile: 'review' });
  await restarted.change({ kind: 'project', name: 'api', enabled: false });
  assert.throws(() => selectCommand(restarted.value, null, 'api-review'), /AI_PROJECT_UNAVAILABLE/);
  const choices = (admin: boolean) => autocomplete(restarted.value, access, auth, admin ? 'ai-admin' : 'ai', 'profile', 'api');
  assert.deepEqual(choices(false), []);
  assert.deepEqual(choices(true), [{ name: 'api-review', value: 'api-review' }]);
  await restarted.change({ kind: 'project', name: 'api', enabled: true });
  assert.equal(selectCommand(restarted.value, null, 'api-review').project, 'api');
  const sessions = new ProjectSessions({ runtime: restarted, workdir: f.directory,
    projects: restarted.value.projects, sandbox: 'read-only' });
  sessions.switchProject('user', 'web');
  await restarted.change({ kind: 'defaults', project: 'api', profile: 'api-review' });
  await restarted.change({ kind: 'project', name: 'web', enabled: false });
  assert.throws(() => sessions.currentProject('user'), /AI_PROJECT_UNAVAILABLE/);
  assert.equal(sessions.currentProject('user', null, selectCommand(restarted.value)).project, 'api');
});

test('file profiles load project bindings and reject missing project references without publishing a reload', async t => {
  const f = await runtimeFixture(t);
  await writeFile(f.file, JSON.stringify({ ...f.config, profiles: {
    ...f.config.profiles, review: { project: 'api', provider: 'codex', model: 'm2' },
  } }));
  await f.runtime.reload();
  assert.equal(selectCommand(f.runtime.value).project, 'api');
  const reply = await initializeConfig(f.runtime, access, auth);
  assert.match(reply, /Try your first task:\n\/ai run profile:review prompt:/);
  const original = f.runtime.value;
  await writeFile(f.file, JSON.stringify({ ...f.config, profiles: {
    ...f.config.profiles, review: { project: 'absent', provider: 'codex', model: 'm2' },
  } }));
  await assert.rejects(f.runtime.reload(), /AI_CONFIG_INVALID/);
  assert.equal(f.runtime.value, original);
});

test('retargeted profiles restore their original project session when switched back and failures stay scoped', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.change({ kind: 'profile', name: 'bound', profile: { project: 'api', provider: 'codex', model: 'm2' } });
  const calls: AgentRunOptions[] = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory,
    projects: f.runtime.value.projects, sandbox: 'read-only' }, async (prompt, options) => {
    calls.push(options);
    if (prompt === 'fail') throw new Error('AI_PERMISSION_DENIED');
    options.onSession?.(options.sessionId ?? 's' + calls.length); return 'answer-' + calls.length;
  });
  const selected = () => selectCommand(f.runtime.value, null, 'bound');
  await sessions.prompt('user', 'first', selected());
  await f.runtime.change({ kind: 'profile', name: 'bound', profile: { project: 'web', provider: 'codex', model: 'm2' } });
  assert.match(sessions.result('user', selected()), /No saved result/);
  await sessions.prompt('user', 'second', selected());
  assert.equal(calls[1]?.sessionId, undefined);
  await f.runtime.change({ kind: 'profile', name: 'bound', profile: { project: 'api', provider: 'codex', model: 'm2' } });
  assert.equal(sessions.result('user', selected()), 'answer-1');
  await sessions.prompt('user', 'resume', selected());
  assert.equal(calls[2]?.sessionId, 's1');
  await assert.rejects(sessions.prompt('user', 'fail', selected()), /AI_PERMISSION_DENIED/);
  assert.match(sessions.result('user', selected()), /configured file permissions/);
  assert.equal(sessions.result('user', selectCommand(f.runtime.value, 'codex', null, 'm2'), 'web'), 'answer-2');
  assert.equal(sessions.busy, false);
});

test('profile-only schedules capture project and survive restart/default changes with a short result command', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.change({ kind: 'profile', name: 'api-review', profile: { project: 'api', provider: 'codex', model: 'm2' } });
  let now = 1000000;
  const calls: Array<{ provider: string; model?: string; project?: string }> = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory,
    projects: f.runtime.value.projects, sandbox: 'read-only' }, async () => 'scheduled answer');
  const options = { runtime: f.runtime, file: join(f.directory, 'jobs.json'), workdir: f.directory,
    sandbox: 'read-only', guildId: owner.guildId, allowedUsers: auth.allowedUsers, busy: () => false,
    now: () => now, run: async (key: string, prompt: string, selection: { provider: 'codex' | 'claude' | 'gemini'; model?: string }, project?: string) => {
      calls.push({ ...selection, project }); return sessions.prompt(key, prompt, selection, project);
    } };
  const scheduler = new CodexScheduler(options);
  const job = await scheduler.add(owner, 'review', { nextRun: now + 100 }, selectCommand(f.runtime.value, null, 'api-review'));
  assert.equal(job.profile, 'api-review');
  assert.equal(job.project, 'api');
  assert.equal(job.profileProject, 'api');
  assert.equal(job.workdir, join(f.directory, 'api'));
  await f.runtime.change({ kind: 'defaults', project: 'api', profile: 'writer' });
  const restored = new CodexScheduler(options);
  await restored.load(); now += 100; await restored.tick();
  assert.deepEqual(calls, [{ provider: 'codex', model: 'm2', project: 'api' }]);
  assert.equal(sessions.result(scheduleKey(owner), selectCommand(f.runtime.value, null, 'api-review')), 'scheduled answer');
  assert.equal(restored.list(scheduleKey(owner))[0]?.lastOutcome, 'Completed. Read the latest result with /ai result profile:api-review. Every run is kept separately in /ai jobs.');
});

test('changing or removing a profile project permanently pauses its captured schedules', async t => {
  for (const project of ['web', undefined]) {
    await t.test(project ?? 'binding removed', async sub => {
      const f = await runtimeFixture(sub);
      await f.runtime.change({ kind: 'profile', name: 'api-review', profile: { project: 'api', provider: 'codex', model: 'm2' } });
      let now = 1000000;
      let calls = 0;
      const options = { runtime: f.runtime, file: join(f.directory, 'jobs.json'), workdir: f.directory,
        sandbox: 'read-only', guildId: owner.guildId, allowedUsers: auth.allowedUsers, busy: () => false,
        now: () => now, run: async () => { calls++; return 'done'; } };
      const scheduler = new CodexScheduler(options);
      await scheduler.add(owner, 'review', { nextRun: now + 100 }, selectCommand(f.runtime.value, null, 'api-review'));
      await f.runtime.change({ kind: 'profile', name: 'api-review', profile: { project, provider: 'codex', model: 'm2' } });
      assert.equal(scheduler.list(scheduleKey(owner))[0]?.state, 'paused');
      assert.match(scheduler.list(scheduleKey(owner))[0]!.lastOutcome!, /profile project changed/);
      await f.runtime.change({ kind: 'profile', name: 'api-review', profile: { project: 'api', provider: 'codex', model: 'm2' } });
      const restored = new CodexScheduler(options);
      await restored.load(); now += 100; await restored.tick();
      assert.equal(calls, 0);
      assert.equal(restored.list(scheduleKey(owner))[0]?.state, 'paused');
    });
  }
});
