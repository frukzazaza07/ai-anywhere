import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexScheduler, durationMs, parseSchedule, scheduledDate, scheduleKey, schedulesText } from '../src/scheduler.js';
import { CodexSessions } from '../src/sessions.js';
import { type ProviderConfig, type ProviderSelection } from '../src/providers.js';
import { type ProjectConfig } from '../src/projects.js';
import { ProjectSessions } from '../src/project-sessions.js';

const owner = { guildId: '111111111111111111', channelId: '222222222222222222', userId: '333333333333333333' };
const key = scheduleKey(owner);
const start = Date.parse('2026-10-11T00:00:00Z');
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-scheduler-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = start;
  let busy = false;
  const calls: Array<{ key: string; prompt: string }> = [];
  const options = { file: join(directory, 'jobs.json'), workdir: 'C:/projects/example', sandbox: 'read-only',
    guildId: owner.guildId, allowedUsers: new Set([owner.userId]), busy: () => busy,
    now: () => time, run: async (key: string, prompt: string) => { calls.push({ key, prompt }); return 'done'; } };
  return { options, calls, scheduler: new CodexScheduler(options),
    time: (value: number) => { time = value; }, busy: (value: boolean) => { busy = value; } };
}

test('date inputs default to Bangkok and validate explicit offsets and calendar values', () => {
  assert.equal(scheduledDate('2026-10-12 09:30'), Date.parse('2026-10-12T02:30:00Z'));
  assert.equal(scheduledDate('2026-10-12T09:30:12+07:00'), Date.parse('2026-10-12T02:30:12Z'));
  assert.equal(scheduledDate('2026-10-12T09:30Z'), Date.parse('2026-10-12T09:30Z'));
  assert.equal(scheduledDate('2028-02-29 09:00'), Date.parse('2028-02-29T02:00Z'));
  for (const value of ['2026-02-29 09:00', '2026-11-31 09:00', '2026-10-12 24:00',
    '2026-10-12 09:60', '2026-10-12T09:00:60Z', '2026-10-12T09:00+14:30', '2026-10-12', 'tomorrow']) {
    assert.throws(() => scheduledDate(value));
  }
});

test('duration and schedule parsing reject conflicts, past dates and unsafe intervals', () => {
  assert.equal(durationMs('1h 30m'), 5400000);
  assert.equal(durationMs('2 hours'), 7200000);
  assert.equal(durationMs('1 week'), 604800000);
  assert.equal(parseSchedule({}, start), undefined);
  assert.deepEqual(parseSchedule({ after: '10m' }, start), { nextRun: start + 600000 });
  assert.deepEqual(parseSchedule({ every: '1 day' }, start), { nextRun: start + 86400000, intervalMs: 86400000 });
  assert.deepEqual(parseSchedule({ at: '2026-10-12 09:00' }, start), { nextRun: Date.parse('2026-10-12T02:00Z') });
  for (const value of ['', '0m', '-1h', '1.5h', '10', '1h junk', '366 days', '99999999999999999w']) {
    assert.throws(() => durationMs(value));
  }
  assert.throws(() => parseSchedule({ every: '59s' }, start), /at least 1 minute/);
  assert.throws(() => parseSchedule({ at: '2026-10-10 09:00' }, start), /future/);
  assert.throws(() => parseSchedule({ after: '1m', every: '1h' }, start), /only one/);
});

test('one-off job survives restart, waits for the worker and executes only once', async t => {
  const f = await setup(t);
  await f.scheduler.load();
  await f.scheduler.add(owner, 'Inspect project', { nextRun: start + 1000 });
  const restored = new CodexScheduler(f.options);
  await restored.load();
  f.time(start + 2000);
  f.busy(true);
  await restored.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(restored.list(key)[0]?.state, 'pending');
  f.busy(false);
  await restored.tick();
  await restored.tick();
  assert.deepEqual(f.calls, [{ key, prompt: 'Inspect project' }]);
  assert.equal(restored.list(key)[0]?.state, 'completed');
  assert.equal(JSON.parse(await readFile(f.options.file, 'utf8'))[0].state, 'completed');
});

test('repeating runs do not overlap and skip missed ticks after a long task', async t => {
  const f = await setup(t);
  let finish!: (text: string) => void;
  let calls = 0;
  const scheduler = new CodexScheduler({ ...f.options, run: async () => {
    calls++;
    return new Promise<string>(resolve => { finish = resolve; });
  } });
  await scheduler.add(owner, 'repeat', { nextRun: start + 60000, intervalMs: 60000 });
  f.time(start + 60000);
  const running = scheduler.tick();
  // Wait for the atomic claim to reach the fake runner.
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  await scheduler.tick();
  assert.equal(calls, 1);
  f.time(start + 301000);
  finish('done');
  await running;
  assert.equal(scheduler.list(key)[0]?.nextRun, start + 360000);
  assert.equal(scheduler.list(key)[0]?.state, 'pending');
  await scheduler.tick();
  assert.equal(calls, 1);
});

test('schedule listing and cancellation are isolated by user and channel', async t => {
  const f = await setup(t);
  const job = await f.scheduler.add(owner, 'private prompt', { nextRun: start + 1000 });
  assert.deepEqual(f.scheduler.list(key + ':other'), []);
  assert.equal(await f.scheduler.cancel(key + ':other', job.id), false);
  assert.equal(await f.scheduler.cancel(key, job.id), true);
  const restored = new CodexScheduler(f.options);
  await restored.load();
  f.time(start + 2000);
  await restored.tick();
  assert.equal(f.calls.length, 0);
  assert.match(schedulesText(restored.list(key)), /No schedules/);
});

test('cancelling a running repeat prevents future runs without terminating its task', async t => {
  const f = await setup(t);
  let finish!: (text: string) => void;
  const scheduler = new CodexScheduler({ ...f.options, run: async () => new Promise<string>(resolve => { finish = resolve; }) });
  const job = await scheduler.add(owner, 'repeat', { nextRun: start + 60000, intervalMs: 60000 });
  f.time(start + 60000);
  const running = scheduler.tick();
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await scheduler.cancel(key, job.id), true);
  finish('done');
  await running;
  assert.deepEqual(scheduler.list(key), []);
  assert.deepEqual(JSON.parse(await readFile(f.options.file, 'utf8')), []);
});

test('interrupted tasks are not replayed and repeats resume at the next future interval', async t => {
  const f = await setup(t);
  const once = await f.scheduler.add(owner, 'once', { nextRun: start + 1000 });
  const repeat = await f.scheduler.add(owner, 'repeat', { nextRun: start + 60000, intervalMs: 60000 });
  await writeFile(f.options.file, JSON.stringify([{ ...once, state: 'running' }, { ...repeat, state: 'running' }]));
  f.time(start + 121000);
  const restored = new CodexScheduler(f.options);
  await restored.load();
  assert.equal(restored.list(key).find(job => job.id === once.id)?.state, 'failed');
  assert.equal(restored.list(key).find(job => job.id === repeat.id)?.nextRun, start + 180000);
  await restored.tick();
  assert.equal(f.calls.length, 0);
});

test('changed authorization, guild, project or sandbox pauses saved schedules', async t => {
  const f = await setup(t);
  await f.scheduler.add(owner, 'check', { nextRun: start + 1000 });
  const original = await readFile(f.options.file, 'utf8');
  f.time(start + 2000);
  for (const changes of [{ allowedUsers: new Set<string>() }, { guildId: '999999999999999999' },
    { workdir: 'C:/projects/other' }, { sandbox: 'workspace-write' }]) {
    await writeFile(f.options.file, original);
    const restored = new CodexScheduler({ ...f.options, ...changes });
    await restored.load();
    await restored.tick();
    assert.equal(restored.list(key)[0]?.state, 'paused');
    assert.equal(f.calls.length, 0);
  }
});

test('scheduled outcomes use the existing private result cache and sanitized failures', async t => {
  const f = await setup(t);
  const sessions = new CodexSessions({ workdir: f.options.workdir, sandbox: 'read-only' }, async () => 'scheduled answer');
  const scheduler = new CodexScheduler({ ...f.options, busy: () => sessions.busy, run: (key, prompt) => sessions.prompt(key, prompt) });
  await scheduler.add(owner, 'check', { nextRun: start + 1000 });
  f.time(start + 2000);
  await scheduler.tick();
  assert.equal(sessions.result(key), 'scheduled answer');
  assert.match(scheduler.list(key)[0]?.lastOutcome ?? '', /\/ai result provider:codex/);
  assert.match(schedulesText([]), /Use \/ai run/);
  assert.doesNotMatch(sessions.result(key + ':other'), /scheduled answer/);
  const failure = new CodexScheduler({ ...f.options, run: async () => { throw new Error('private token/path'); } });
  await failure.add(owner, 'fails', { nextRun: start + 3000 });
  f.time(start + 4000);
  await failure.tick();
  assert.equal(failure.list(key)[0]?.state, 'failed');
  assert.doesNotMatch(await readFile(f.options.file, 'utf8'), /private token/);
});

test('a manual prompt winning the worker race leaves the schedule pending', async t => {
  const f = await setup(t);
  let busy = true;
  const scheduler = new CodexScheduler({ ...f.options, busy: () => false, run: async () => {
    if (busy) throw new Error('CODEX_BUSY');
    return 'done';
  } });
  await scheduler.add(owner, 'check', { nextRun: start + 1000 });
  f.time(start + 2000);
  await scheduler.tick();
  assert.equal(scheduler.list(key)[0]?.state, 'pending');
  assert.equal(scheduler.list(key)[0]?.runs, 0);
  busy = false;
  await scheduler.tick();
  assert.equal(scheduler.list(key)[0]?.state, 'completed');
});

test('malformed storage fails closed and a failed durable claim never launches a task', async t => {
  const f = await setup(t);
  await writeFile(f.options.file, JSON.stringify([{ prompt: 'unsafe' }]));
  await assert.rejects(f.scheduler.load(), /Invalid schedule storage/);
  await rm(f.options.file);
  await f.scheduler.add(owner, 'check', { nextRun: start + 1000 });
  const { mkdir } = await import('node:fs/promises');
  await rm(f.options.file);
  await mkdir(f.options.file);
  f.time(start + 2000);
  await assert.rejects(f.scheduler.tick());
  assert.equal(f.calls.length, 0);
  assert.equal(f.scheduler.list(key)[0]?.state, 'pending');
});

test('failed repeating runs retain their future cadence with a sanitized outcome', async t => {
  const f = await setup(t);
  const scheduler = new CodexScheduler({ ...f.options, run: async () => { throw new Error('private CLI diagnostics'); } });
  await scheduler.add(owner, 'repeat', { nextRun: start + 60000, intervalMs: 60000 });
  f.time(start + 125000);
  await scheduler.tick();
  const job = scheduler.list(key)[0]!;
  assert.equal(job.state, 'pending');
  assert.equal(job.nextRun, start + 180000);
  assert.equal(job.runs, 1);
  assert.doesNotMatch(job.lastOutcome!, /private CLI/);
});

test('schedule limits apply per owner and callers cannot mutate stored entries', async t => {
  const f = await setup(t);
  for (let i = 0; i < 50; i++) await f.scheduler.add(owner, 'check', { nextRun: start + 1000 });
  await assert.rejects(f.scheduler.add(owner, 'too many', { nextRun: start + 1000 }), /Schedule limit/);
  const listed = f.scheduler.list(key);
  listed[0]!.prompt = 'mutated';
  assert.equal(f.scheduler.list(key)[0]!.prompt, 'check');
});


test('provider and model survive schedule restart and feed the matching private result cache', async t => {
  const f = await setup(t);
  const providers: ProviderConfig = { enabled: new Set(['codex', 'claude', 'gemini']),
    defaultProvider: 'codex', models: { claude: 'sonnet' } };
  const selections: ProviderSelection[] = [];
  const sessions = new CodexSessions({ workdir: f.options.workdir, sandbox: 'read-only', providers },
    async (_prompt, options) => { selections.push({ provider: options.provider!, model: options.model }); return options.provider + ' answer'; });
  const options = { ...f.options, providers, busy: () => sessions.busy,
    run: (key: string, prompt: string, selection: ProviderSelection) => sessions.prompt(key, prompt, selection) };
  const scheduler = new CodexScheduler(options);
  await scheduler.add(owner, 'claude task', { nextRun: start + 1000 }, { provider: 'claude', model: 'sonnet' });
  await scheduler.add(owner, 'gemini task', { nextRun: start + 1001 }, { provider: 'gemini' });
  const restored = new CodexScheduler(options);
  await restored.load();
  f.time(start + 2000);
  await restored.tick(); await restored.tick();
  assert.deepEqual(selections, [{ provider: 'claude', model: 'sonnet' }, { provider: 'gemini', model: undefined }]);
  assert.equal(sessions.result(key, { provider: 'claude', model: 'sonnet' }), 'claude answer');
  assert.equal(sessions.result(key, { provider: 'gemini' }), 'gemini answer');
  assert.match(sessions.result(key), /No saved result/);
  assert.match(schedulesText(restored.list(key)), /Provider: claude.*Model: sonnet/);
  assert.deepEqual(restored.list(key + ':other'), []);
});

test('legacy schedules remain Codex tasks even when the default provider changes', async t => {
  const f = await setup(t);
  const original = await f.scheduler.add(owner, 'legacy', { nextRun: start + 1000 });
  const { provider: _provider, model: _model, ...legacy } = original;
  await writeFile(f.options.file, JSON.stringify([legacy]));
  const providers: ProviderConfig = { enabled: new Set(['codex', 'claude']), defaultProvider: 'claude', models: {} };
  const selections: ProviderSelection[] = [];
  const restored = new CodexScheduler({ ...f.options, providers, run: async (_key, _prompt, selection) => {
    selections.push(selection); return 'done';
  } });
  await restored.load(); f.time(start + 2000); await restored.tick();
  assert.deepEqual(selections, [{ provider: 'codex', model: undefined }]);
});

test('disabled providers and changed models pause persisted schedules while retaining cancellation', async t => {
  const f = await setup(t);
  const providers: ProviderConfig = { enabled: new Set(['codex', 'claude']), defaultProvider: 'codex', models: { claude: 'sonnet' } };
  const scheduler = new CodexScheduler({ ...f.options, providers });
  const job = await scheduler.add(owner, 'task', { nextRun: start + 1000 }, { provider: 'claude', model: 'sonnet' });
  const stored = await readFile(f.options.file, 'utf8');
  f.time(start + 2000);
  for (const changed of [{ ...providers, enabled: new Set<'codex'>(['codex']) },
    { ...providers, models: { claude: 'opus' } }]) {
    await writeFile(f.options.file, stored);
    const restored = new CodexScheduler({ ...f.options, providers: changed });
    await restored.load(); await restored.tick();
    assert.equal(restored.list(key)[0]?.state, 'paused');
    assert.equal(f.calls.length, 0);
    assert.equal(await restored.cancel(key + ':other', job.id), false);
    assert.equal(await restored.cancel(key, job.id), true);
  }
});

test('schedule creation rejects disabled providers, model overrides and malformed persisted providers', async t => {
  const f = await setup(t);
  await assert.rejects(f.scheduler.add(owner, 'task', { nextRun: start + 1000 }, { provider: 'claude' }), /Invalid schedule/);
  await assert.rejects(f.scheduler.add(owner, 'task', { nextRun: start + 1000 }, { provider: 'codex', model: 'override' }), /Invalid schedule/);
  const job = await f.scheduler.add(owner, 'task', { nextRun: start + 1000 });
  await writeFile(f.options.file, JSON.stringify([{ ...job, provider: 'unknown' }]));
  await assert.rejects(new CodexScheduler(f.options).load(), /Invalid schedule storage/);
});


test('scheduled projects remain fixed after preferences and the default project change', async t => {
  const f = await setup(t);
  const projects: ProjectConfig = { directories: new Map([['web', f.options.workdir], ['api', 'C:/projects/api']]), defaultProject: 'web' };
  const calls: string[] = [];
  const sessions = new ProjectSessions({ workdir: f.options.workdir, projects, sandbox: 'read-only' },
    async (_prompt, options) => { calls.push(options.workdir); return 'scheduled web answer'; });
  const options = { ...f.options, projects, busy: () => sessions.busy,
    run: (key: string, prompt: string, selection: ProviderSelection, project?: string) => sessions.prompt(key, prompt, selection, project) };
  const scheduler = new CodexScheduler(options);
  await scheduler.add(owner, 'review', { nextRun: start + 1000 }, { provider: 'codex' }, 'web');
  sessions.switchProject(key, 'api');
  const restored = new CodexScheduler({ ...options, workdir: 'C:/projects/api', projects: { ...projects, defaultProject: 'api' } });
  await restored.load(); f.time(start + 2000); await restored.tick();
  assert.deepEqual(calls, [f.options.workdir]);
  assert.equal(sessions.result(key, { provider: 'codex' }, 'web'), 'scheduled web answer');
  assert.match(sessions.result(key, { provider: 'codex' }), /No saved result/);
  assert.match(schedulesText(restored.list(key)), /Project: web/);
  assert.match(restored.list(key)[0]?.lastOutcome ?? '', /project:web/);
});

test('legacy directory schedules migrate to matching configured aliases rather than the new default', async t => {
  const f = await setup(t);
  await f.scheduler.add(owner, 'legacy', { nextRun: start + 1000 });
  const projects: ProjectConfig = { directories: new Map([['api', 'C:/projects/api'], ['web', f.options.workdir]]), defaultProject: 'api' };
  const selected: Array<string | undefined> = [];
  const restored = new CodexScheduler({ ...f.options, projects, workdir: 'C:/projects/api',
    run: async (_key, _prompt, _selection, project) => { selected.push(project); return 'done'; } });
  await restored.load();
  assert.equal(restored.list(key)[0]?.project, 'web');
  f.time(start + 2000); await restored.tick();
  assert.deepEqual(selected, ['web']);
});

test('removed or remapped project aliases pause saved jobs and can still be listed and cancelled', async t => {
  const f = await setup(t);
  const projects: ProjectConfig = { directories: new Map([['web', f.options.workdir], ['api', 'C:/projects/api']]), defaultProject: 'web' };
  const scheduler = new CodexScheduler({ ...f.options, projects });
  const job = await scheduler.add(owner, 'review', { nextRun: start + 1000 }, { provider: 'codex' }, 'web');
  const original = await readFile(f.options.file, 'utf8');
  f.time(start + 2000);
  for (const directories of [new Map([['api', 'C:/projects/api']]),
    new Map([['web', 'C:/projects/remapped'], ['api', 'C:/projects/api']])]) {
    await writeFile(f.options.file, original);
    const restored = new CodexScheduler({ ...f.options, projects: { directories, defaultProject: 'api' } });
    await restored.load(); await restored.tick();
    assert.equal(restored.list(key)[0]?.state, 'paused');
    assert.equal(f.calls.length, 0);
    assert.equal(await restored.cancel(key + ':other', job.id), false);
    assert.equal(await restored.cancel(key, job.id), true);
  }
});

test('project schedules reject arbitrary aliases and legacy directories outside the configured list stay paused', async t => {
  const f = await setup(t);
  const projects: ProjectConfig = { directories: new Map([['api', 'C:/projects/api']]), defaultProject: 'api' };
  const scheduler = new CodexScheduler({ ...f.options, projects });
  await assert.rejects(scheduler.add(owner, 'review', { nextRun: start + 1000 }, { provider: 'codex' }, 'C:/other'), /AI_PROJECT_UNAVAILABLE/);
  await f.scheduler.add(owner, 'legacy', { nextRun: start + 1000 });
  const restored = new CodexScheduler({ ...f.options, projects });
  await restored.load(); f.time(start + 2000); await restored.tick();
  assert.equal(restored.list(key)[0]?.state, 'paused');
  assert.equal(f.calls.length, 0);
});
