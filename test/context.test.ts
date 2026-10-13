import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readContextUsage, formatContextUsage, threadContextStatus } from '../src/context.js';
import { codexLimitsStatus } from '../src/limits.js';

const id = '12345678-1234-1234-1234-123456789abc';
const snapshot = (used: number, window: number | null = 112000) => JSON.stringify({
  type: 'event_msg', payload: { type: 'token_count', info: {
    last_token_usage: { total_tokens: used, cached_input_tokens: 50000 },
    total_token_usage: { total_tokens: 1000000 },
    model_context_window: window,
  } },
});
const quota = { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } } };

async function withRollout(check: (dir: string, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-context-test-'));
  try { await check(dir, join(dir, 'rollout.jsonl')); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('context uses the latest response usage including cached tokens rather than cumulative account usage', async () => {
  await withRollout(async (_dir, path) => {
    await writeFile(path, [
      JSON.stringify({ type: 'response_item', payload: { text: 'private prompt' } }),
      snapshot(82000), snapshot(62000),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
      '{"partial":',
    ].join('\n'));
    const usage = await readContextUsage(path);
    assert.deepEqual(usage, { usedTokens: 62000, windowTokens: 112000 });
    const text = formatContextUsage(usage!, { sessionId: id });
    assert.match(text, /Context remaining: 50%/);
    assert.match(text, /Tokens in context: 62,000 \/ 112,000/);
    assert.match(text, /Tokens remaining: 50,000/);
    assert.doesNotMatch(text, /private prompt|1,000,000/);
  });
});

test('compaction invalidates old context until a new snapshot is reported', async () => {
  await withRollout(async (_dir, path) => {
    await writeFile(path, snapshot(90000) + '\n' + JSON.stringify({ type: 'compacted' }) + '\n');
    assert.equal(await readContextUsage(path), undefined);
    await writeFile(path, snapshot(90000) + '\n' + JSON.stringify({ type: 'compacted' }) + '\n' + snapshot(20000));
    assert.deepEqual(await readContextUsage(path), { usedTokens: 20000, windowTokens: 112000 });
  });
});

test('missing or invalid model windows remain unavailable rather than reusing older figures', async () => {
  await withRollout(async (_dir, path) => {
    for (const invalid of [snapshot(20000, null), snapshot(-1), snapshot(1, 0)]) {
      await writeFile(path, snapshot(62000) + '\n' + invalid);
      assert.equal(await readContextUsage(path), undefined);
    }
  });
});

test('bounded tail reading ignores fragments and finds the latest token metadata', async () => {
  await withRollout(async (_dir, path) => {
    await writeFile(path, snapshot(90000) + '\n' + 'x'.repeat(9 * 1024 * 1024) + '\n' + snapshot(62000));
    assert.deepEqual(await readContextUsage(path), { usedTokens: 62000, windowTokens: 112000 });
  });
});

test('context metadata is read only for the requested session and missing files are safe', async () => {
  await withRollout(async (_dir, path) => {
    await writeFile(path, snapshot(62000));
    const text = await threadContextStatus({ thread: { id, path } }, { sessionId: id });
    assert.match(text, /Context remaining: 50%/);
    assert.match(await threadContextStatus({ thread: { id: 'other', path } }, { sessionId: id }), /unavailable/);
    assert.match(await threadContextStatus({ thread: { id, path: 'relative.jsonl' } }, { sessionId: id }), /unavailable/);
    assert.match(await threadContextStatus({ thread: { id, path: path + '.missing' } }, { sessionId: id }), /unavailable/);
  });
});

test('context estimate stays within bounds and identifies a running-task snapshot', () => {
  assert.match(formatContextUsage({ usedTokens: 0, windowTokens: 112000 }, {}), /100%/);
  const full = formatContextUsage({ usedTokens: 120000, windowTokens: 112000 }, { contextRunning: true });
  assert.match(full, /Context remaining: 0%/);
  assert.match(full, /Tokens remaining: 0/);
  assert.match(full, /Task running/);
});

async function withStatusServer(mode: string, check: (dir: string, script: string) => Promise<void>) {
  await withRollout(async (dir, path) => {
    await writeFile(path, snapshot(62000));
    const script = join(dir, 'server.mjs');
    await writeFile(script, `import { createInterface } from 'node:readline';
      const mode = ${JSON.stringify(mode)};
      let initialized = false;
      const reply = message => process.stdout.write(JSON.stringify(message) + '\\n');
      createInterface({ input: process.stdin }).on('line', line => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') reply({ id: request.id, result: {} });
        else if (request.method === 'initialized') initialized = true;
        else if (!initialized) process.exit(3);
        else if (request.method === 'thread/read') {
          if (mode === 'no-session') process.exit(4);
          if (request.params.threadId !== ${JSON.stringify(id)} || request.params.includeTurns !== false) process.exit(5);
          reply(mode === 'context-error'
            ? { id: request.id, error: { message: 'private thread data' } }
            : { id: request.id, result: { thread: { id: ${JSON.stringify(id)}, path: ${JSON.stringify(path)} } } });
        } else if (request.method === 'account/read') {
          reply({ id: request.id, result: { account: { type: mode === 'api' ? 'apiKey' : 'chatgpt' } } });
        } else if (request.method === 'account/rateLimits/read') {
          if (mode === 'quota-stall') return;
          reply(mode === 'quota-error'
            ? { id: request.id, error: { message: 'private auth details' } }
            : { id: request.id, result: ${JSON.stringify(quota)} });
        } else process.exit(6);
      });
    `);
    await check(dir, script);
  });
}

test('status combines caller context and account quota through read-only requests', async () => {
  await withStatusServer('success', async (dir, cliScript) => {
    const text = await codexLimitsStatus({ workdir: dir, cliScript, includeContext: true, sessionId: id });
    assert.match(text, /Context remaining: 50%/);
    assert.match(text, /5-hour limit: 75% remaining/);
    assert.doesNotMatch(text, /rollout.jsonl/);
  });
});

test('context and account failures are independent, including API-key accounts', async () => {
  for (const mode of ['quota-error', 'context-error', 'api']) {
    await withStatusServer(mode, async (dir, cliScript) => {
      const text = await codexLimitsStatus({ workdir: dir, cliScript, includeContext: true, sessionId: id });
      if (mode === 'context-error') {
        assert.match(text, /Context usage unavailable/);
        assert.match(text, /75% remaining/);
      } else {
        assert.match(text, /Context remaining: 50%/);
        assert.match(text, mode === 'api' ? /API-key accounts/ : /account usage limits are unavailable/);
      }
      assert.doesNotMatch(text, /private/);
    });
  }
});

test('account timeout preserves context already read from the current session', async () => {
  await withStatusServer('quota-stall', async (dir, cliScript) => {
    const text = await codexLimitsStatus({
      workdir: dir, cliScript, includeContext: true, sessionId: id, timeoutMs: 1000,
    });
    assert.match(text, /Context remaining: 50%/);
    assert.match(text, /account usage limits are unavailable/);
  });
});

test('fresh or reset sessions have no invented context percentage and skip thread reads', async () => {
  await withStatusServer('no-session', async (dir, cliScript) => {
    const text = await codexLimitsStatus({ workdir: dir, cliScript, includeContext: true });
    assert.match(text, /No active session/);
    assert.doesNotMatch(text, /Context remaining:/);
    assert.match(text, /75% remaining/);
  });
});
