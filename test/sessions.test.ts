import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexSessions } from '../src/sessions.js';
import { type RunOptions } from '../src/runner.js';
import { commands, commandNames } from '../src/commands.js';

const options: RunOptions = { workdir: 'C:/projects/example', sandbox: 'read-only', timeoutMs: 5000 };
const alice = 'guild:channel:alice';
const bob = 'guild:channel:bob';

test('/ai offers scheduling options and management subcommands', () => {
  const definitions = commands.map(command => command.toJSON());
  assert.deepEqual(definitions.map(command => command.name), ['ai', 'ai-admin', 'help']);
  assert.deepEqual([...commandNames], ['ai', 'ai-admin', 'help']);
  const actions = definitions[0]?.options ?? [];
  assert.deepEqual(actions.map(action => action.name), ['run', 'new', 'status', 'context', 'clear', 'result', 'models', 'config', 'schedules', 'cancel', 'projects', 'project', 'init']);
  assert.ok(actions.every(action => action.type === 1));
  const run = actions[0];
  assert.ok(run && run.type === 1);
  const prompt = run.options?.[0];
  assert.ok(prompt && prompt.type === 3);
  assert.equal(prompt.name, 'prompt');
  assert.equal(prompt.required, true);
  assert.equal(prompt.min_length, 1);
  assert.equal(prompt.max_length, 4000);
  assert.deepEqual(run.options?.map(option => option.name), ['prompt', 'at', 'after', 'every', 'provider', 'profile', 'model', 'effort', 'project']);
  assert.ok(run.options?.slice(1).every(option => !option.required));
  assert.ok(actions.slice(1, 5).every(action => action.type === 1 && action.options?.some(option => option.name === 'project')));
  const schedules = actions.find(action => action.name === 'schedules');
  assert.ok(schedules?.type === 1 && !schedules.options?.length);
  const cancel = actions.find(action => action.name === 'cancel');
  assert.ok(cancel && cancel.type === 1);
  assert.equal(cancel.options?.[0]?.name, 'id');
  assert.equal(cancel.options?.[0]?.required, true);
});

test('follow-up prompts resume only the same user and channel session', async () => {
  const calls: RunOptions[] = [];
  const sessions = new CodexSessions(options, async (_prompt, settings) => {
    calls.push(settings);
    settings.onSession?.(settings.sessionId ?? `session-${calls.length}`);
    return 'done';
  });
  await sessions.prompt(alice, 'first');
  await sessions.prompt(alice, 'follow-up');
  await sessions.prompt(bob, 'another user');
  await sessions.prompt('guild:other-channel:alice', 'another channel');
  assert.deepEqual(calls.map(call => call.sessionId), [undefined, 'session-1', undefined, undefined]);
  assert.match(sessions.status(alice), /Completed turns: 2/);
  assert.match(sessions.status(alice), /Session: session-1/);
  assert.doesNotMatch(sessions.status(bob), /session-1/);
  assert.match(sessions.status(alice), /Sandbox: read-only/);
  assert.match(sessions.status(alice), /Timeout: 5s/);
  assert.deepEqual(sessions.contextState(alice), { sessionId: 'session-1', contextRunning: false });
  assert.deepEqual(sessions.contextState(bob), { sessionId: 'session-3', contextRunning: false });
});

test('reset discards the caller context and preserves other users', async () => {
  const calls: Array<string | undefined> = [];
  const sessions = new CodexSessions(options, async (_prompt, settings) => {
    calls.push(settings.sessionId);
    settings.onSession?.(settings.sessionId ?? `session-${calls.length}`);
    return 'done';
  });
  await sessions.prompt(alice, 'first');
  await sessions.prompt(bob, 'first');
  sessions.reset(alice);
  assert.match(sessions.status(alice), /Session: none/);
  assert.match(sessions.status(alice), /Completed turns: 0/);
  assert.match(sessions.status(bob), /Session: session-2/);
  assert.deepEqual(sessions.contextState(alice), { sessionId: undefined, contextRunning: false });
  assert.equal(sessions.contextState(bob).sessionId, 'session-2');
  await sessions.prompt(alice, 'fresh');
  assert.equal(calls[2], undefined);
  sessions.reset('unused');
});

test('status remains available during a job and concurrent prompts or resets are rejected', async () => {
  let finish!: (result: string) => void;
  const sessions = new CodexSessions(options, async () =>
    new Promise<string>(resolve => { finish = resolve; }));
  const running = sessions.prompt(alice, 'long task');
  assert.equal(sessions.busy, true);
  assert.deepEqual(sessions.contextState(alice), { sessionId: undefined, contextRunning: true });
  assert.equal(sessions.contextState(bob).contextRunning, false);
  assert.match(sessions.status(alice), /Worker: busy/);
  assert.match(sessions.status(alice), /Current task:/);
  assert.doesNotMatch(sessions.status(bob), /Current task:/);
  await assert.rejects(sessions.prompt(bob, 'second'), /CODEX_BUSY/);
  assert.throws(() => sessions.reset(alice), /CODEX_BUSY/);
  finish('done');
  await running;
  assert.equal(sessions.busy, false);
});

test('failed turns release the worker and preserve the previously successful session', async () => {
  let fail = false;
  const sessions = new CodexSessions(options, async (_prompt, settings) => {
    settings.onSession?.(fail ? 'failed-session' : 'successful-session');
    if (fail) throw new Error('CODEX_TIMEOUT');
    return 'done';
  });
  await sessions.prompt(alice, 'first');
  fail = true;
  await assert.rejects(sessions.prompt(alice, 'fails'), /CODEX_TIMEOUT/);
  assert.equal(sessions.busy, false);
  assert.match(sessions.status(alice), /Session: successful-session/);
  assert.match(sessions.status(alice), /Completed turns: 1/);
  sessions.reset(alice);
  await assert.rejects(sessions.prompt(alice, 'fresh failure'), /CODEX_TIMEOUT/);
  assert.match(sessions.status(alice), /Completed turns: 0/);
});
