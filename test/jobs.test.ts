import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectSessions } from '../src/project-sessions.js';
import { selectCommand } from '../src/selection.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { JobHistory, JobManager, formatDuration, ownerFromKey, ownerKey, type JobRecord } from '../src/jobs.js';
import { type AgentRunOptions } from '../src/agent-runner.js';
import { runtimeFixture, owner } from './runtime-fixture.js';

const other = { ...owner, userId: '444444444444444444' };
const admin = { guildId: other.guildId, userId: '555555555555555555', admin: true };
const me = { guildId: owner.guildId, userId: owner.userId };
const them = { guildId: other.guildId, userId: other.userId };

interface Pending { prompt: string; options: AgentRunOptions; resolve: (value: string) => void; reject: (error: Error) => void }

/** A controllable fake CLI: each prompt waits until the test settles it or aborts it. */
async function fixture(t: TestContext, options: { queueLimit?: number; now?: () => number } = {}) {
  const f = await runtimeFixture(t);
  const pending: Pending[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects,
    sandbox: 'workspace-write' }, (prompt, run) => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    return new Promise<string>((resolve, reject) => {
      const done = () => { concurrent--; };
      pending.push({ prompt, options: run, resolve: value => { done(); resolve(value); }, reject: error => { done(); reject(error); } });
      run.signal?.addEventListener('abort', () => { done(); reject(new Error('AI_CANCELLED')); }, { once: true });
    });
  });
  const directory = join(f.directory, 'jobs');
  const history = new JobHistory(directory);
  const manager = new JobManager({ history, sessions, sandbox: 'workspace-write', tracker: async () => undefined, ...options });
  const selection = selectCommand(f.runtime.value, 'codex', null, 'm2');
  const submit = (prompt: string, extra: { owner?: typeof owner; queue?: boolean } = {}) =>
    manager.submit({ owner: extra.owner ?? owner, prompt, selection, project: 'web', queue: extra.queue });
  const until = async (check: () => boolean) => {
    for (let index = 0; index < 200 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(check());
  };
  return { f, pending, sessions, history, manager, selection, submit, directory, until, max: () => maxConcurrent };
}

test('jobs are saved durably with owner, prompt, state, timestamps and result, and survive restart', async t => {
  const x = await fixture(t);
  const first = x.submit('Review the code');
  assert.match(first.job.id, /^[0-9a-f]{8}$/);
  assert.equal(first.position, 0);
  await x.until(() => x.pending.length === 1);
  assert.match(x.manager.jobsText(me), new RegExp(first.job.id + '` running'));
  x.pending[0]!.resolve('All good');
  assert.equal(await first.result, 'All good');
  const failed = x.submit('Broken task');
  await x.until(() => x.pending.length === 2);
  x.pending[1]!.reject(new Error('AI_TASK_FAILED'));
  await assert.rejects(failed.result, /AI_TASK_FAILED/);
  await x.history.flush();

  const saved = JSON.parse(await readFile(join(x.directory, first.job.id + '.json'), 'utf8')) as JobRecord;
  assert.equal(saved.state, 'completed');
  assert.equal(saved.result, 'All good');
  assert.equal(saved.prompt, 'Review the code');
  assert.deepEqual([saved.guildId, saved.channelId, saved.userId], [owner.guildId, owner.channelId, owner.userId]);
  assert.ok(saved.started! >= saved.created && saved.finished! >= saved.started!);
  if (process.platform !== 'win32') assert.equal((await stat(join(x.directory, first.job.id + '.json'))).mode & 0o777, 0o600);

  // A fresh process reads the same history.
  const reloaded = new JobHistory(x.directory);
  await reloaded.load();
  const restarted = new JobManager({ history: reloaded, sessions: x.sessions, sandbox: 'workspace-write' });
  const text = restarted.jobsText(me);
  assert.match(text, new RegExp(first.job.id + '` completed'));
  assert.match(text, new RegExp(failed.job.id + '` failed'));
  const details = await restarted.details(me, first.job.id);
  assert.match(details.text, /Job [0-9a-f]{8} · completed/);
  assert.match(details.text, /Prompt: Review the code/);
  assert.match(details.text, /All good$/);
  assert.match((await restarted.details(me, failed.job.id)).text, /task failed/);
});

test('job history is private to its owner and bounded by retention', async t => {
  const x = await fixture(t);
  const job = x.submit('Private task');
  await x.until(() => x.pending.length === 1);
  x.pending[0]!.resolve('secret answer');
  await job.result;
  assert.match((await x.manager.details(them, job.job.id)).text, /was not found/);
  assert.doesNotMatch(x.manager.jobsText(them), /Private task/);
  assert.match((await x.manager.details({ ...me, guildId: '999999999999999999' }, job.job.id)).text, /was not found/);
  assert.match((await x.manager.details(me, 'zzzzzzzz')).text, /was not found/);
  assert.deepEqual(x.manager.choices(them, ''), []);
  assert.equal(x.manager.choices(me, 'private')[0]?.value, job.job.id);

  const small = new JobHistory(join(x.f.directory, 'small'), 2);
  for (let index = 0; index < 4; index++) {
    await small.save({ id: '0000000' + index, ...owner, source: 'discord', prompt: 'p' + index, project: 'web',
      provider: 'codex', state: 'completed', created: 1000 + index, result: 'r' });
    await small.prune();
  }
  assert.deepEqual(small.list().map(item => item.id), ['00000003', '00000002']);
  assert.deepEqual((await readdir(join(x.f.directory, 'small'))).sort(), ['00000002.json', '00000003.json']);
});

test('restart never replays interrupted or queued jobs and tolerates unreadable files', async t => {
  const x = await fixture(t);
  const running = x.submit('long');
  const queued = x.submit('later', { queue: true });
  await x.until(() => x.pending.length === 1);
  await x.history.flush();
  await writeFile(join(x.directory, 'abcdef12.json'), '{broken');
  const history = new JobHistory(x.directory);
  const errors = t.mock.method(console, 'error', () => {});
  await history.load();
  assert.equal(errors.mock.callCount(), 1);
  assert.equal(history.get(running.job.id)?.state, 'failed');
  assert.equal(history.get(queued.job.id)?.state, 'cancelled');
  assert.match((await history.read(running.job.id))?.result ?? '', /Interrupted by bot restart/);
  assert.match((await history.read(queued.job.id))?.result ?? '', /did not run/);
  assert.equal(history.get('abcdef12'), undefined);
  x.pending[0]!.resolve('done');
  await running.result;
  await x.until(() => x.pending.length === 2);
  x.pending[1]!.resolve('done later');
  await queued.result;
});

test('each schedule run gets its own job record and result', async t => {
  const x = await fixture(t);
  let clock = Date.now();
  const scheduler = new CodexScheduler({ file: join(x.f.directory, 'schedules.json'), workdir: x.f.directory, sandbox: 'workspace-write',
    guildId: owner.guildId, allowedUsers: new Set([owner.userId]), runtime: x.f.runtime, now: () => clock,
    busy: () => x.manager.busy, run: (key, prompt, selection, project, schedule) =>
      x.manager.submit({ owner: ownerFromKey(key), prompt, selection, project, schedule }).result });
  const job = await scheduler.add(owner, 'Nightly check', { nextRun: clock + 60000, intervalMs: 60000 }, x.selection, 'web');
  for (const answer of ['first run', 'second run']) {
    clock += 60000;
    const tick = scheduler.tick();
    await x.until(() => x.pending.length > 0 && x.manager.busy);
    x.pending.shift()!.resolve(answer);
    await tick;
  }
  const runs = x.history.list(item => item.scheduleId === job.id);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(run => run.scheduleRun), [2, 1]);
  assert.notEqual(runs[0]!.id, runs[1]!.id);
  assert.match((await x.manager.details(me, runs[0]!.id)).text, /second run$/);
  assert.match((await x.manager.details(me, runs[1]!.id)).text, /first run$/);
  assert.match(scheduler.list(scheduleKey(owner))[0]!.lastOutcome ?? '', /Every run is kept separately in \/ai jobs/);
  assert.equal(ownerKey(ownerFromKey(scheduleKey(owner))), scheduleKey(owner));
});

test('stop cancels only the selected job for its owner or an admin, and the worker accepts new work', async t => {
  const x = await fixture(t);
  assert.deepEqual(x.manager.stop(me), { outcome: 'idle' });
  const job = x.submit('long task');
  await x.until(() => x.pending.length === 1);
  assert.equal(x.manager.stop(them, job.job.id).outcome, 'denied');
  assert.equal(x.pending[0]!.options.signal?.aborted, false);
  assert.equal(x.manager.stop(me, 'ffffffff').outcome, 'not-found');
  assert.equal(x.manager.stop(me, job.job.id).outcome, 'stopping');
  assert.equal(x.manager.stop(me, job.job.id).outcome, 'already-stopping');
  await assert.rejects(job.result, /AI_CANCELLED/);
  assert.equal(x.manager.busy, false);
  assert.equal(x.history.get(job.job.id)?.state, 'cancelled');
  assert.match((await x.manager.details(me, job.job.id)).text, /stopped.*not reverted/);
  const finished = x.manager.stop(me, job.job.id);
  assert.equal(finished.outcome, 'finished');
  assert.equal(finished.job?.state, 'cancelled');

  // The worker is free again; an admin may stop another user's task.
  const next = x.submit('their task', { owner: other });
  await x.until(() => x.pending.length === 2);
  assert.equal(x.manager.stop(me).outcome, 'denied');
  assert.equal(x.manager.stop(admin, next.job.id).outcome, 'stopping');
  await assert.rejects(next.result, /AI_CANCELLED/);
  const after = x.submit('after stop');
  await x.until(() => x.pending.length === 3);
  x.pending[2]!.resolve('ok');
  assert.equal(await after.result, 'ok');
});

test('queue runs jobs one at a time in FIFO order, reports positions, and rejects when full', async t => {
  const x = await fixture(t, { queueLimit: 2 });
  const first = x.submit('one');
  await x.until(() => x.pending.length === 1);
  assert.throws(() => x.submit('rejected'), /CODEX_BUSY/);
  const second = x.submit('two', { queue: true });
  const third = x.submit('three', { queue: true, owner: other });
  assert.deepEqual([second.position, third.position], [1, 2]);
  assert.equal(second.job.state, 'queued');
  assert.throws(() => x.submit('four', { queue: true }), /AI_QUEUE_FULL/);
  assert.match(x.manager.progress(third.job.id), /queued · position 2 of 2/);
  assert.match(x.manager.jobsText(me), /queued #1/);
  x.pending[0]!.resolve('1');
  await first.result;
  await x.until(() => x.pending.length === 2);
  assert.equal(x.pending[1]!.prompt, 'two');
  assert.match(x.manager.progress(third.job.id), /position 1 of 1/);
  x.pending[1]!.resolve('2');
  await second.result;
  await x.until(() => x.pending.length === 3);
  assert.equal(x.pending[2]!.prompt, 'three');
  x.pending[2]!.resolve('3');
  assert.equal(await third.result, '3');
  assert.equal(x.max(), 1);
  assert.equal(x.manager.busy, false);
});

test('queued jobs can be withdrawn without running, and shutdown drops the queue', async t => {
  const x = await fixture(t);
  const running = x.submit('running');
  const mine = x.submit('mine', { queue: true });
  const theirs = x.submit('theirs', { queue: true, owner: other });
  await x.until(() => x.pending.length === 1);
  assert.equal(x.manager.stop(me, theirs.job.id).outcome, 'denied');
  assert.equal(x.manager.stop(me, mine.job.id).outcome, 'dequeued');
  await assert.rejects(mine.result, /AI_QUEUE_CANCELLED/);
  assert.equal(x.history.get(mine.job.id)?.state, 'cancelled');
  assert.match(x.manager.progress(theirs.job.id), /position 1 of 1/);
  const stopping = x.manager.shutdown();
  await assert.rejects(theirs.result, /AI_SHUTTING_DOWN/);
  assert.throws(() => x.submit('late'), /AI_SHUTTING_DOWN/);
  x.pending[0]!.resolve('done');
  await running.result;
  await stopping;
  assert.equal(x.pending.length, 1);
  assert.equal(x.history.get(theirs.job.id)?.state, 'cancelled');
});

test('progress shows elapsed time and provider activity, flags long silence, and stops updating when finished', async t => {
  let clock = 1_000_000;
  const x = await fixture(t, { now: () => clock });
  const job = x.submit('watch me');
  await x.until(() => x.pending.length === 1);
  assert.match(x.manager.progress(job.job.id), /running · 0s elapsed\nActivity: none reported yet\nNo CLI output yet/);
  clock += 65_000;
  x.pending[0]!.options.onProgress?.('Running tests');
  clock += 5_000;
  assert.match(x.manager.progress(job.job.id), /running · 1m 10s elapsed\nActivity: Running tests \(5s ago\)\nLast CLI output: 5s ago/);
  x.pending[0]!.options.onProgress?.();
  clock += 11 * 60_000;
  assert.match(x.manager.progress(job.job.id), /Activity: Running tests \(11m 05s ago\)\nLast CLI output: 11m 00s ago\nNo CLI output for 11m 00s; the job may be stalled/);
  assert.match(x.manager.activeText(me), /Stop: \/ai stop id:/);
  assert.equal(x.manager.activeText(them), '');
  x.pending[0]!.resolve('done');
  await job.result;
  const final = x.manager.progress(job.job.id);
  assert.equal(final, 'Job ' + job.job.id + ': completed in 12m 10s.');
  clock += 60_000;
  assert.equal(x.manager.progress(job.job.id), final);
  assert.match(x.manager.outcomeLine(job.job.id), /completed after 12m 10s/);
  assert.equal(formatDuration(3_725_000), '1h 02m');
});

test('Claude progress reports only verified state', async t => {
  const x = await fixture(t);
  const selection = selectCommand(x.f.runtime.value, 'claude', null, 'sonnet');
  const job = x.manager.submit({ owner, prompt: 'claude task', selection, project: 'web' });
  await x.until(() => x.pending.length === 1);
  assert.match(x.manager.progress(job.job.id), /Activity: not reported while running \(Claude Code reports when it finishes\)/);
  assert.doesNotMatch(x.manager.progress(job.job.id), /stalled|CLI output/);
  x.pending[0]!.resolve('ok');
  await job.result;
});
