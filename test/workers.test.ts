import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSessions } from '../src/project-sessions.js';
import { selectCommand } from '../src/selection.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { JobHistory, JobManager, overlappingDirectories, ownerFromKey } from '../src/jobs.js';
import { maxWorkers } from '../src/config.js';
import { type AgentRunOptions } from '../src/agent-runner.js';
import { runtimeFixture, owner } from './runtime-fixture.js';

const other = { ...owner, userId: '444444444444444444' };
const me = { guildId: owner.guildId, userId: owner.userId };

interface Pending { prompt: string; options: AgentRunOptions; resolve: (value: string) => void }

/** Projects: web (fixture root), api (nested inside web) and docs (a separate folder). */
async function fixture(t: TestContext, workers: number) {
  const f = await runtimeFixture(t);
  const docs = await mkdtemp(join(tmpdir(), 'ai-workers-docs-'));
  t.after(() => rm(docs, { recursive: true, force: true }));
  await f.runtime.change({ kind: 'add-project', name: 'docs', directory: docs, create: false });
  const pending: Pending[] = [];
  let concurrent = 0;
  let peak = 0;
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects,
    sandbox: 'workspace-write', maxWorkers: workers }, (prompt, options) => {
    concurrent++; peak = Math.max(peak, concurrent);
    return new Promise<string>(resolve => pending.push({ prompt, options, resolve: value => { concurrent--; resolve(value); } }));
  });
  const historyDir = await mkdtemp(join(tmpdir(), 'ai-workers-history-'));
  t.after(() => rm(historyDir, { recursive: true, force: true }));
  const history = new JobHistory(historyDir);
  const manager = new JobManager({ history, sessions, sandbox: 'workspace-write', maxWorkers: workers, tracker: async () => undefined });
  const selection = selectCommand(f.runtime.value, 'codex', null, 'm2');
  const submit = (prompt: string, project: string, extra: { owner?: typeof owner; queue?: boolean } = {}) =>
    manager.submit({ owner: extra.owner ?? owner, prompt, selection, project, queue: extra.queue });
  const until = async (check: () => boolean) => {
    for (let index = 0; index < 200 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(check());
  };
  const finish = async (prompt: string, value = 'done') => {
    await until(() => pending.some(item => item.prompt === prompt));
    pending.find(item => item.prompt === prompt)!.resolve(value);
  };
  return { f, docs, pending, sessions, manager, selection, submit, until, finish, peak: () => peak };
}

test('worker limit parses from 1 to 8 and defaults to one shared worker', () => {
  assert.equal(maxWorkers(undefined), 1);
  assert.equal(maxWorkers(' '), 1);
  assert.equal(maxWorkers('4'), 4);
  for (const value of ['0', '9', '1.5', 'many', '-1']) assert.throws(() => maxWorkers(value), /AI_MAX_WORKERS/);
});

test('nested and identical folders overlap; siblings do not', () => {
  const root = join(tmpdir(), 'projects');
  assert.ok(overlappingDirectories(root, root));
  assert.ok(overlappingDirectories(root, join(root, 'api')));
  assert.ok(overlappingDirectories(join(root, 'api', 'src'), root));
  assert.ok(!overlappingDirectories(join(root, 'api'), join(root, 'api-v2')));
  assert.ok(!overlappingDirectories(join(root, 'web'), join(root, 'api')));
  if (process.platform === 'win32') assert.ok(overlappingDirectories('C:/Work/App', 'c:\\work\\app\\'));
});

test('jobs in different projects run concurrently up to the worker limit, one per project', async t => {
  const x = await fixture(t, 2);
  const web = x.submit('web task', 'web');
  const docs = x.submit('docs task', 'docs', { owner: other });
  await x.until(() => x.pending.length === 2);
  assert.equal(x.peak(), 2);
  assert.equal(x.manager.full, true);
  // Same project, nested project and a full pool are all rejected without queue.
  assert.equal(x.manager.blockedReason(scheduleKey(owner), x.selection, 'web'), 'project');
  assert.equal(x.manager.blockedReason(scheduleKey(owner), x.selection, 'api'), 'project');
  assert.throws(() => x.submit('again', 'docs'), /CODEX_BUSY/);
  assert.match(x.sessions.status(scheduleKey(owner), x.selection, 'web'), /Workers: 2\/2 busy/);
  await x.finish('docs task');
  await docs.result;
  // The api folder is inside web, so it waits even though a worker is free.
  assert.equal(x.manager.full, false);
  assert.throws(() => x.submit('nested', 'api'), /CODEX_BUSY/);
  const fresh = x.submit('docs again', 'docs');
  await x.finish('docs again');
  await fresh.result;
  await x.finish('web task');
  await web.result;
  assert.equal(x.manager.busy, false);
  assert.equal(x.peak(), 2);
});

test('the queue starts jobs as soon as their project and a worker are free, FIFO per project', async t => {
  const x = await fixture(t, 2);
  const web = x.submit('web 1', 'web');
  const nested = x.submit('api 1', 'api', { queue: true });
  const web2 = x.submit('web 2', 'web', { queue: true });
  const docs = x.submit('docs 1', 'docs', { queue: true });
  // docs starts immediately: a worker is free and its folder is unrelated.
  assert.equal(docs.position, 0);
  assert.deepEqual([nested.position, web2.position], [1, 2]);
  assert.match(x.manager.progress(web2.job.id), /when the job ahead of it in project web finishes/);
  await x.until(() => x.pending.length === 2);
  await x.finish('web 1');
  await web.result;
  // The earlier queued nested job runs before the later web job.
  await x.until(() => x.pending.some(item => item.prompt === 'api 1'));
  assert.ok(!x.pending.some(item => item.prompt === 'web 2'));
  await x.finish('api 1');
  await x.finish('web 2');
  await x.finish('docs 1');
  await Promise.all([nested.result, web2.result, docs.result]);
  assert.equal(x.peak(), 2);
});

test('stop without an ID needs a single matching job when several run', async t => {
  const x = await fixture(t, 3);
  const first = x.submit('mine web', 'web');
  const second = x.submit('mine docs', 'docs');
  await x.until(() => x.pending.length === 2);
  const ambiguous = x.manager.stop(me);
  assert.equal(ambiguous.outcome, 'ambiguous');
  assert.deepEqual(ambiguous.jobs?.map(job => job.id).sort(), [first.job.id, second.job.id].sort());
  assert.equal(x.manager.stop({ guildId: owner.guildId, userId: other.userId }).outcome, 'denied');
  assert.equal(x.manager.stop(me, first.job.id).outcome, 'stopping');
  x.pending[0]!.resolve('late');
  await first.result.catch(() => {});
  assert.equal(x.manager.stop(me).outcome, 'stopping');
  x.pending[1]!.resolve('late');
  await second.result.catch(() => {});
  assert.equal(x.manager.stop(me).outcome, 'idle');
});

test('project sessions allow parallel folders, reject a busy folder and keep preferences switchable', async t => {
  const x = await fixture(t, 2);
  const key = scheduleKey(owner);
  const running = x.sessions.prompt(key, 'web', x.selection, 'web');
  await assert.rejects(x.sessions.prompt(scheduleKey(other), 'same folder', x.selection, 'web'), /CODEX_BUSY/);
  const parallel = x.sessions.prompt(scheduleKey(other), 'docs', x.selection, 'docs');
  await assert.rejects(x.sessions.prompt(key, 'third', x.selection, 'api'), /CODEX_BUSY/);
  assert.equal(x.sessions.switchProject(key, 'docs').project, 'docs');
  assert.throws(() => x.sessions.reset(key, x.selection, 'web'), /CODEX_BUSY/);
  for (const item of x.pending) item.resolve('ok');
  await Promise.all([running, parallel]);
  assert.equal(x.sessions.busy, false);
});

test('schedules for different projects run concurrently while a busy project waits', async t => {
  const x = await fixture(t, 2);
  let clock = Date.now();
  const scheduler = new CodexScheduler({ file: join(x.f.directory, 'schedules.json'), workdir: x.f.directory, sandbox: 'workspace-write',
    guildId: owner.guildId, allowedUsers: new Set([owner.userId]), runtime: x.f.runtime, now: () => clock,
    busy: () => x.manager.full, ready: (key, selection, project) => !x.manager.blockedReason(key, selection, project),
    run: (key, prompt, selection, project, schedule) =>
      x.manager.submit({ owner: ownerFromKey(key), prompt, selection, project, schedule }).result });
  const manual = x.submit('manual web', 'web');
  await scheduler.add(owner, 'scheduled web', { nextRun: clock + 1000 }, x.selection, 'web');
  await scheduler.add(owner, 'scheduled docs', { nextRun: clock + 2000 }, x.selection, 'docs');
  clock += 5000;
  // The earlier web schedule is skipped while web is busy; docs takes the free worker.
  const tick = scheduler.tick();
  await x.until(() => x.pending.some(item => item.prompt === 'scheduled docs'));
  assert.ok(!x.pending.some(item => item.prompt === 'scheduled web'));
  await x.finish('manual web');
  await manual.result;
  const second = scheduler.tick();
  await x.until(() => x.pending.some(item => item.prompt === 'scheduled web'));
  assert.equal(x.peak(), 2);
  await x.finish('scheduled docs');
  await x.finish('scheduled web');
  await Promise.all([tick, second]);
  assert.deepEqual(scheduler.list(scheduleKey(owner)).map(job => job.state), ['completed', 'completed']);
});
