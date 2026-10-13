import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverCodexModels } from '../src/model-discovery.js';

async function server(t: TestContext, mode: string) {
  const workdir = await mkdtemp(join(tmpdir(), 'ai-models-'));
  t.after(() => rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const cliScript = join(workdir, 'server.mjs');
  await writeFile(cliScript, `
    import { createInterface } from 'node:readline';
    import { writeFileSync } from 'node:fs';
    const mode = ${JSON.stringify(mode)};
    const calls = [];
    const leaked = Object.keys(process.env).filter(k => k.startsWith('DISCORD_') || ['ALLOWED_USER_IDS', 'ADMIN_USER_IDS'].includes(k));
    const input = createInterface({ input: process.stdin });
    let pages = 0;
    input.on('line', line => {
      const request = JSON.parse(line);
      calls.push(request);
      writeFileSync('calls.json', JSON.stringify({ calls, leaked, args: process.argv.slice(2) }));
      if (mode === 'stall') return;
      if (mode === 'flood') { process.stdout.write('x'.repeat(1_000_100)); return; }
      if (mode === 'stderr-flood') { process.stderr.write('secret'.repeat(180000)); return; }
      if (request.method === 'initialized') return;
      if (mode === 'exit') { process.exit(3); return; }
      if (mode === 'error') { process.stdout.write(JSON.stringify({ id: request.id, error: { message: 'private path and auth-token' } }) + '\\n'); return; }
      if (mode === 'invalid-json') { process.stdout.write('bad-json\\n'); return; }
      let result = {};
      if (request.method === 'model/list') {
        pages++;
        result = mode === 'invalid-model' ? { data: [{ model: '../bad\\nsecret' }] }
          : mode === 'invalid-shape' ? { data: 'not an array' }
          : mode === 'empty' ? { data: [], nextCursor: null }
          : mode === 'cycle' ? { data: [], nextCursor: 'same' }
          : mode === 'many-pages' ? { data: [], nextCursor: 'page-' + pages }
          : mode === 'invalid-cursor' ? { data: [], nextCursor: {} }
          : pages === 1 ? { data: [{ model: 'm1', displayName: 'Private email', hidden: false },
              { model: 'hidden-model', hidden: true }], nextCursor: 'page2' }
          : { data: [{ model: 'm1' }, { model: 'm2' }], nextCursor: null };
      }
      // Interleaved notifications and partial writes must not disturb response ordering.
      process.stdout.write(JSON.stringify({ method: 'notification', params: { private: 'secret' } }) + '\\n');
      const response = JSON.stringify({ id: request.id, result }) + '\\n';
      process.stdout.write(response.slice(0, 7)); process.stdout.write(response.slice(7));
    });
    if (mode === 'stall') setInterval(() => {}, 1000);
  `);
  return { workdir, cliScript, timeoutMs: 5000 };
}

test('Codex model discovery initializes, paginates and filters hidden models without prompts or credentials', async t => {
  const options = await server(t, 'success');
  const keys = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ALLOWED_USER_IDS', 'ADMIN_USER_IDS'];
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = 'private-secret';
    assert.deepEqual(await discoverCodexModels(options), ['m1', 'm2']);
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  }
  const data = JSON.parse(await readFile(join(options.workdir, 'calls.json'), 'utf8'));
  assert.deepEqual(data.args, ['app-server', '--stdio']);
  assert.deepEqual(data.leaked, []);
  assert.deepEqual(data.calls.map((call: { method: string }) => call.method), ['initialize', 'initialized', 'model/list', 'model/list']);
  assert.deepEqual(data.calls[2].params, { limit: 100, includeHidden: false });
  assert.deepEqual(data.calls[3].params, { limit: 100, includeHidden: false, cursor: 'page2' });
});

test('Codex model discovery accepts an empty catalog', async t => {
  assert.deepEqual(await discoverCodexModels(await server(t, 'empty')), []);
});

test('discovery rejects CLI failures, malformed models/responses and pagination cycles with sanitized errors', async t => {
  for (const mode of ['exit', 'error', 'invalid-json', 'invalid-model', 'invalid-shape', 'invalid-cursor', 'cycle']) {
    await t.test(mode, async sub => {
      await assert.rejects(discoverCodexModels(await server(sub, mode)), { message: 'AI_MODELS_UNAVAILABLE' });
    });
  }
});

test('discovery bounds pages, unframed output, diagnostics and a stalled server', async t => {
  for (const mode of ['many-pages', 'flood', 'stderr-flood', 'stall']) {
    await t.test(mode, async sub => {
      const options = await server(sub, mode);
      await assert.rejects(discoverCodexModels({ ...options, timeoutMs: mode === 'stall' ? 200 : 5000 }),
        { message: mode === 'stall' ? 'AI_MODELS_TIMEOUT' : 'AI_MODELS_OUTPUT_LIMIT' });
    });
  }
});
