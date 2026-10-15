import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeContextStatus, claudeContextWindows, readClaudeContextUsage } from '../src/claude-context.js';
import { AiSessions } from '../src/sessions.js';

const id = '12345678-1234-1234-1234-123456789abc';
const model = 'claude-sonnet-4-5';
const assistant = (input: number, read: number, extra: object = {}) => JSON.stringify({
  type: 'assistant', sessionId: id, ...extra,
  message: { model, content: [{ type: 'text', text: 'private answer' }],
    usage: { input_tokens: input, cache_creation_input_tokens: 1000, cache_read_input_tokens: read, output_tokens: 500 } },
});

async function withHistory(check: (config: string, workdir: string, write: (lines: string[]) => Promise<string>) => Promise<void>) {
  const config = await mkdtemp(join(tmpdir(), 'claude-context-test-'));
  const workdir = join(config, 'my project');
  try {
    await check(config, workdir, async lines => {
      const directory = join(config, 'projects', workdir.replace(/[^a-zA-Z0-9]/g, '-'));
      await mkdir(directory, { recursive: true });
      const path = join(directory, id + '.jsonl');
      await writeFile(path, lines.join('\n'));
      return path;
    });
  } finally { await rm(config, { recursive: true, force: true }); }
}

test('Claude context uses the latest main-conversation request and skips subagents and synthetic errors', async () => {
  await withHistory(async (_config, _workdir, write) => {
    const path = await write([
      JSON.stringify({ type: 'user', message: { content: 'private prompt' } }),
      assistant(10, 50000), assistant(2000, 96500),
      assistant(1, 1, { isSidechain: true }),
      JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { model: '<synthetic>', usage: { input_tokens: 0 } } }),
      '{"partial":',
    ]);
    assert.deepEqual(await readClaudeContextUsage(path),
      { model, inputTokens: 2000, cacheCreationTokens: 1000, cacheReadTokens: 96500, outputTokens: 500 });
  });
});

test('compaction invalidates older Claude usage until a new request is recorded', async () => {
  await withHistory(async (_config, _workdir, write) => {
    const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    assert.equal(await readClaudeContextUsage(await write([assistant(10, 90000), boundary])), undefined);
    assert.equal((await readClaudeContextUsage(await write([assistant(10, 90000), boundary, assistant(10, 8000)])))?.cacheReadTokens, 8000);
  });
});

test('Claude context details report the reported window and breakdown without chat text or paths', async () => {
  await withHistory(async (config, workdir, write) => {
    await write([assistant(2000, 96500)]);
    const text = await claudeContextStatus({ workdir, configDir: config, sessionId: id, contextWindows: { [model]: 200000 } });
    assert.match(text, /Model: claude-sonnet-4-5/);
    assert.match(text, /Context used: 50% \(100,000 \/ 200,000 tokens\)/);
    assert.match(text, /Tokens remaining: 100,000/);
    assert.match(text, /Cache read: 96,500/);
    assert.match(text, /Session: 12345678/);
    assert.doesNotMatch(text, /private|jsonl|my project/);
    assert.match(await claudeContextStatus({ workdir, configDir: config, sessionId: id }), /Tokens in context: 100,000\nContext window: not reported/);
  });
});

test('Claude transcripts stored under another project folder are still found', async () => {
  await withHistory(async (config, workdir) => {
    const directory = join(config, 'projects', 'canonical-path');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, id + '.jsonl'), assistant(0, 0));
    assert.match(await claudeContextStatus({ workdir, configDir: config, sessionId: id }), /Tokens in context: 1,500/);
  });
});

test('missing sessions and history never invent Claude usage', async () => {
  await withHistory(async (config, workdir) => {
    assert.match(await claudeContextStatus({ workdir, configDir: config }), /No active session/);
    assert.match(await claudeContextStatus({ workdir, configDir: config, contextRunning: true }), /until the first task/);
    assert.match(await claudeContextStatus({ workdir, configDir: config, sessionId: id }), /Context usage unavailable/);
    assert.match(await claudeContextStatus({ workdir, configDir: config, sessionId: '../escape' }), /Context usage unavailable/);
  });
});

test('context windows come from CLI modelUsage and persist across turns that omit them', async () => {
  assert.deepEqual(claudeContextWindows({ [model]: { contextWindow: 200000 }, bad: { contextWindow: -1 }, none: null }), { [model]: 200000 });
  assert.equal(claudeContextWindows([]), undefined);
  let turn = 0;
  const sessions = new AiSessions({ workdir: '.', sandbox: 'read-only',
    providers: { enabled: new Set(['codex', 'claude']), defaultProvider: 'codex', models: {} } }, async (_prompt, options) => {
    options.onSession?.(id, turn++ === 0 ? { [model]: 200000 } : undefined);
    return 'done';
  });
  await sessions.prompt('user', 'first', { provider: 'claude' });
  await sessions.prompt('user', 'second', { provider: 'claude' });
  assert.deepEqual(sessions.contextState('user', { provider: 'claude' }),
    { sessionId: id, contextRunning: false, contextWindows: { [model]: 200000 } });
});
