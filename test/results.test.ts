import test from 'node:test';
import assert from 'node:assert/strict';
import { taskReply, deliverTaskReply } from '../src/results.js';
import { CodexSessions } from '../src/sessions.js';

test('completed results remain private and retrievable after the original reply expires', async () => {
  const sessions = new CodexSessions({ workdir: 'C:/projects/example', sandbox: 'read-only', timeoutMs: 0 }, async () => 'private task result');
  await sessions.prompt('alice:channel', 'task');
  let edits = 0;
  const delivered = await deliverTaskReply({
    createdTimestamp: 0, editReply: async () => { edits++; },
  }, sessions.result('alice:channel'), 20 * 60 * 1000);
  assert.equal(delivered, false);
  assert.equal(edits, 0);
  assert.equal(sessions.result('alice:channel'), 'private task result');
  assert.doesNotMatch(sessions.result('bob:channel'), /private task result/);
  assert.doesNotMatch(sessions.result('alice:other-channel'), /private task result/);
  sessions.reset('alice:channel');
  assert.match(sessions.result('alice:channel'), /No saved result/);
  assert.match(sessions.result('alice:channel'), /\/ai run provider:codex prompt:/);
  assert.match(sessions.status('alice:channel'), /Timeout: disabled/);
});

test('delivery failures preserve successful outcomes instead of overwriting them', async () => {
  const sessions = new CodexSessions({ workdir: 'C:/projects/example', sandbox: 'read-only' }, async () => 'saved answer');
  await sessions.prompt('alice', 'task');
  const delivered = await deliverTaskReply({
    createdTimestamp: 0, editReply: async () => { throw new Error('expired webhook'); },
  }, sessions.result('alice'), 100);
  assert.equal(delivered, false);
  assert.equal(sessions.result('alice'), 'saved answer');
});

test('active tasks report still running, then expose their sanitized failure', async () => {
  let fail!: (error: Error) => void;
  const sessions = new CodexSessions({ workdir: 'C:/projects/example', sandbox: 'read-only' },
    async () => new Promise<string>((_resolve, reject) => { fail = reject; }));
  const running = sessions.prompt('alice', 'task');
  assert.match(sessions.result('alice'), /still running/);
  assert.match(sessions.result('alice'), /\/ai result provider:codex/);
  fail(new Error('private credentials in stderr'));
  await assert.rejects(running);
  const result = sessions.result('alice');
  assert.match(result, /Codex task failed/);
  assert.doesNotMatch(result, /private|credentials|stderr/);
  assert.equal(sessions.busy, false);
});

test('large retrieved answers retain full content in an attachment with mentions disabled', () => {
  const text = '@everyone ' + 'x'.repeat(4000);
  const reply = taskReply(text);
  assert.ok(reply.content.length < 2000);
  assert.equal(reply.files[0]?.name, 'codex-result.txt');
  assert.equal((reply.files[0]?.attachment as Buffer).toString('utf8'), text);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('unexpired responses can still deliver their result normally', async () => {
  let content: string | null | undefined;
  const delivered = await deliverTaskReply({
    createdTimestamp: 0, editReply: async reply => { content = reply.content; },
  }, 'answer', 1000);
  assert.equal(delivered, true);
  assert.equal(content, 'answer');
});
