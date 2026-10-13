import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Shutdown } from '../src/shutdown.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { runAgent } from '../src/agent-runner.js';
import { owner, runtimeFixture } from './runtime-fixture.js';

test('shutdown closes admission immediately and waits for worker, schedules and replies before disconnecting', async () => {
  const scheduler = Promise.withResolvers<void>();
  const worker = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<void>();
  const calls: string[] = [];
  const shutdown = new Shutdown({ stopScheduler: () => { calls.push('scheduler'); return scheduler.promise; },
    stopWorker: () => { calls.push('worker'); return worker.promise; }, closeClient: () => { calls.push('client'); } });
  shutdown.track(reply.promise);
  const stop = shutdown.stop();
  assert.equal(shutdown.stopping, true);
  assert.equal(shutdown.stop(), stop);
  assert.deepEqual(calls, ['scheduler', 'worker']);
  worker.resolve(); scheduler.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['scheduler', 'worker']);
  reply.resolve();
  await stop;
  assert.deepEqual(calls, ['scheduler', 'worker', 'client']);
});

test('shutdown drains and closes Discord even when schedule persistence fails', async () => {
  const worker = Promise.withResolvers<void>();
  let closed = false;
  const shutdown = new Shutdown({ stopScheduler: async () => { throw new Error('private-path'); },
    stopWorker: () => worker.promise, closeClient: () => { closed = true; } });
  const stopped = shutdown.stop();
  const rejected = assert.rejects(stopped, /AI_SHUTDOWN_SAVE/);
  assert.equal(closed, false);
  worker.resolve(); await rejected;
  assert.equal(closed, true);
});

test('project shutdown finishes a real mock CLI task and rejects new work across projects', async t => {
  const f = await runtimeFixture(t);
  const script = join(f.directory, 'finish.mjs');
  await writeFile(script, `import { writeFileSync } from 'node:fs';
    process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => {
      writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], 'finished');
    }, 100));`);
  const sessions = new ProjectSessions({ projects: f.runtime.value.projects, workdir: f.directory, sandbox: 'read-only', cliScript: script }, runAgent);
  const task = sessions.prompt('key', 'inspect', { provider: 'codex' });
  const stop = sessions.shutdown();
  await assert.rejects(sessions.prompt('other', 'inspect', { provider: 'codex' }, 'api'), /AI_SHUTTING_DOWN/);
  await stop;
  assert.equal(await task, 'finished');
  assert.equal(sessions.busy, false);
});

for (const repeating of [false, true]) {
  test('scheduler shutdown persists ' + (repeating ? 'the next interval' : 'completion') + ' after an active task without dispatching more work', async t => {
    const f = await runtimeFixture(t);
    const active = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    const file = join(f.directory, 'jobs.json');
    let time = Date.now();
    let calls = 0;
    const options = { file, workdir: f.directory, sandbox: 'read-only', guildId: owner.guildId,
      allowedUsers: new Set([owner.userId]), busy: () => false, now: () => time,
      run: async () => { calls++; started.resolve(); return active.promise; } };
    const scheduler = new CodexScheduler(options);
    await scheduler.add(owner, 'inspect', { nextRun: time + 1000, ...(repeating ? { intervalMs: 60000 } : {}) });
    time += 1000;
    const tick = scheduler.tick();
    await started.promise;
    const stop = scheduler.shutdown();
    await assert.rejects(scheduler.add(owner, 'new', { nextRun: time + 1000 }), /AI_SHUTTING_DOWN/);
    time += 120000;
    await scheduler.tick();
    active.resolve('done');
    await Promise.all([stop, tick]);
    scheduler.start(); await scheduler.tick();
    assert.equal(calls, 1);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved[0].state, repeating ? 'pending' : 'completed');
    assert.equal(saved[0].runs, 1);
    const restored = new CodexScheduler(options);
    await restored.load(); await restored.tick();
    assert.equal(calls, 1);
    assert.equal(restored.list(scheduleKey(owner))[0]?.state, repeating ? 'pending' : 'completed');
  });
}

test('shutdown while dispatch waits for the config gate leaves the job pending without starting a worker', async t => {
  const f = await runtimeFixture(t);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const holding = f.runtime.exclusive(async () => { entered.resolve(); await gate.promise; });
  await entered.promise;
  let time = Date.now();
  let calls = 0;
  const scheduler = new CodexScheduler({ file: join(f.directory, 'jobs.json'), workdir: f.directory,
    sandbox: 'read-only', runtime: f.runtime, guildId: owner.guildId, allowedUsers: new Set([owner.userId]),
    busy: () => false, now: () => time, run: async () => { calls++; return 'done'; } });
  await scheduler.add(owner, 'inspect', { nextRun: time + 1000 }, { provider: 'codex', model: 'm1' }, 'web');
  time += 1000;
  const tick = scheduler.tick();
  const stop = scheduler.shutdown();
  gate.resolve();
  await Promise.all([holding, tick, stop]);
  assert.equal(calls, 0);
  assert.equal(scheduler.list(scheduleKey(owner))[0]?.state, 'pending');
});

test('project shutdown drains a failed task and permanently refuses new tasks', async t => {
  const f = await runtimeFixture(t);
  const active = Promise.withResolvers<string>();
  const sessions = new ProjectSessions({ projects: f.runtime.value.projects, workdir: f.directory, sandbox: 'read-only' },
    async () => active.promise);
  const task = sessions.prompt('key', 'inspect', { provider: 'codex' });
  const failed = assert.rejects(task, /mock failure/);
  const stop = sessions.shutdown();
  active.reject(new Error('mock failure'));
  await Promise.all([failed, stop]);
  assert.equal(sessions.busy, false);
  await assert.rejects(sessions.prompt('key', 'new task', { provider: 'codex' }), /AI_SHUTTING_DOWN/);
});

test('scheduler shutdown retries a transient completion save failure before disconnecting', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'jobs.json');
  let time = Date.now();
  const active = Promise.withResolvers<string>();
  const started = Promise.withResolvers<void>();
  const scheduler = new CodexScheduler({ file, workdir: f.directory, sandbox: 'read-only',
    guildId: owner.guildId, allowedUsers: new Set([owner.userId]), busy: () => false, now: () => time,
    run: async () => { started.resolve(); return active.promise; } });
  await scheduler.add(owner, 'inspect', { nextRun: time + 1000 });
  const storage = scheduler as unknown as { save: () => Promise<void> };
  const save = storage.save.bind(scheduler);
  let saves = 0;
  t.mock.method(storage, 'save', async () => {
    if (++saves === 2) throw new Error('temporary storage failure');
    await save();
  });
  time += 1000;
  const tick = scheduler.tick();
  const failedTick = assert.rejects(tick, /temporary storage failure/);
  await started.promise;
  const stop = scheduler.shutdown();
  active.resolve('done');
  await Promise.all([failedTick, stop]);
  assert.equal(saves, 3);
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].state, 'completed');
});
