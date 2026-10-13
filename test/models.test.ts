import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modelCatalog, modelsText } from '../src/models.js';
import { listModels, parseModelsArguments } from '../src/models-cli.js';
import { taskErrorMessage } from '../src/results.js';
import { runtimeFixture } from './runtime-fixture.js';

test('model listing uses configured defaults/profiles and exposes no host paths', async t => {
  const f = await runtimeFixture(t);
  const catalog = modelCatalog(f.runtime.value);
  assert.equal(catalog.selectedModel, 'm2');
  assert.deepEqual(catalog.allowedModels, ['m1', 'm2']);
  assert.equal(modelCatalog(f.runtime.value, 'codex').selectedModel, 'm1');
  assert.equal(modelCatalog(f.runtime.value, null, 'plain').selectedModel, undefined);
  const text = modelsText(catalog);
  assert.match(text, /plain: CLI default/);
  assert.match(text, /provider:codex model:MODEL/);
  assert.doesNotMatch(text, /[A-Z]:[\\/]|ai-runtime-|DISCORD_TOKEN/);
  assert.throws(() => modelCatalog(f.runtime.value, 'codex', 'review'), /AI_SELECTION_CONFLICT/);
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  assert.throws(() => modelCatalog(f.runtime.value, 'claude'), /AI_PROVIDER_DISABLED/);
  assert.match(modelsText({ ...catalog, selectedModel: undefined, allowedModels: [], profiles: [{ name: 'plain' }] }),
    /No explicit models configured/);
});

test('local CLI arguments accept explicit flags and reject arbitrary providers and options', () => {
  assert.deepEqual(parseModelsArguments([]), { discover: false, json: false });
  assert.deepEqual(parseModelsArguments(['--json', '--provider', 'codex', '--discover']),
    { discover: true, json: true, provider: 'codex' });
  for (const args of [['--provider'], ['--provider', 'unknown'], ['--path', '/private'], ['--json', '--json'], ['codex']]) {
    assert.throws(() => parseModelsArguments(args), /AI_MODELS_ARGUMENTS/);
  }
});

test('local catalogs probe each requested provider without changing the local configuration', async t => {
  const f = await runtimeFixture(t);
  let calls = 0;
  const discover = async () => { calls++; return ['m1', 'new-model']; };
  const options = parseModelsArguments([]);
  assert.equal((await listModels(f.runtime.value, options, discover)).length, 2);
  assert.equal(calls, 0);
  const catalogs = await listModels(f.runtime.value, { ...options, discover: true }, discover,
    async provider => { assert.equal(provider, 'claude'); return [{ model: 'haiku' }]; });
  assert.equal(calls, 1);
  assert.deepEqual(catalogs[0]?.allowedModels, ['m1', 'm2']);
  assert.deepEqual(catalogs[0]?.discoveredModels, ['m1', 'new-model']);
  assert.match(modelsText(catalogs[0]!), /new-model \(not allowed locally\)/);
  assert.deepEqual(catalogs[1]!.discoveredModels, ['haiku']);
  assert.match(catalogs[1]!.discoveryNote!, /\/ai config provider:claude/);
  const failed = await listModels(f.runtime.value, { ...options, provider: 'codex', discover: true },
    async () => { throw new Error('secret token and private directory'); });
  assert.match(failed[0]!.discoveryNote!, /discovery unavailable/);
  assert.doesNotMatch(JSON.stringify(failed), /secret token|private directory/);
});

test('terminal entry point lists runtime choices without Discord credentials and supports JSON', async t => {
  const f = await runtimeFixture(t);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('DISCORD_')) delete env[key];
  const run = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/models-cli.ts', import.meta.url)),
    '--provider', 'codex', '--json'], { cwd: f.directory, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout)[0].allowedModels, ['m1', 'm2']);
  assert.equal(run.stderr, '');
});

test('model selection errors explain the list/picker without reflecting rejected input', () => {
  assert.match(taskErrorMessage(new Error('AI_MODEL_NOT_ALLOWED')), /\/ai models/);
  assert.match(taskErrorMessage(new Error('AI_SELECTION_CONFLICT')), /profile OR provider\/model/);
});
