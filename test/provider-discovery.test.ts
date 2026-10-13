import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProviderModels } from '../src/provider-discovery.js';
import { discoverCodexCatalog } from '../src/model-discovery.js';
import { ModelCatalogService } from '../src/model-catalog-service.js';
import { RuntimeConfig } from '../src/runtime-config.js';
import { ProviderPreferences } from '../src/provider-preferences.js';
import { configPicker, updateConfigPicker } from '../src/config-picker.js';
import { selectCommand, autocomplete } from '../src/selection.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { runtimeFixture, access, auth, owner } from './runtime-fixture.js';

async function probeFixture(t: TestContext, provider: 'claude' | 'gemini' | 'codex', mode = 'success') {
  const directory = await mkdtemp(join(tmpdir(), 'ai-catalog-test-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const cliScript = join(directory, 'cli.mjs');
  const log = join(directory, 'calls.json');
  const versionLog = join(directory, 'version.json');
  await writeFile(cliScript, `
    import { createInterface } from 'node:readline';
    import { readFileSync, writeFileSync } from 'node:fs';
    const provider = ${JSON.stringify(provider)}; const mode = ${JSON.stringify(mode)};
    if (process.argv.includes('--version')) {
      writeFileSync(${JSON.stringify(versionLog)}, JSON.stringify({ args: process.argv.slice(2) }));
      if (mode === 'version-stall') setInterval(() => {}, 1000);
      else {
        process.stdout.write(mode === 'version-old' ? '0.1.0' : mode === 'version-malformed' ? 'private diagnostics'
          : mode === 'version-flood' ? 'x'.repeat(2_000_100) : provider === 'claude' ? '2.1.248' : '0.63.0');
        process.exitCode = mode === 'version-failed' ? 1 : 0;
      }
    } else {
    const requests = [];
    const data = { args: process.argv.slice(2), requests,
      leaked: Object.keys(process.env).filter(key => key.startsWith('DISCORD_') || ['ALLOWED_USER_IDS', 'ADMIN_USER_IDS'].includes(key)),
      settings: process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH
        ? JSON.parse(readFileSync(process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8')) : undefined };
    createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line); requests.push(request); writeFileSync(${JSON.stringify(log)}, JSON.stringify(data));
      if (mode === 'stall') return;
      if (mode === 'flood') { process.stdout.write('x'.repeat(1000100)); return; }
      if (mode === 'stderr') { process.stderr.write('private secret'.repeat(100000)); return; }
      const send = response => process.stdout.write(JSON.stringify(response) + '\\n');
      if (provider === 'claude') send({ type: 'control_response', response: { request_id: 'models',
        subtype: mode === 'error' ? 'error' : 'success', error: 'private token', response: { models: mode === 'malformed' ? 'bad' : [
          { value: 'sonnet', displayName: 'Private account', supportedEffortLevels: ['low', 'high'] },
          { value: mode === 'invalid-id' ? '--help' : 'haiku', supportsEffort: false }] } } });
      else if (provider === 'gemini') send({ jsonrpc: '2.0', id: request.id,
        ...(mode === 'error' ? { error: { message: 'private token' } } : { result: request.method === 'initialize'
          ? { protocolVersion: 1 } : { sessionId: 'metadata-session', models: { availableModels:
              mode === 'malformed' ? 'bad' : [{ modelId: mode === 'invalid-id' ? '--help' : 'gemini-3-pro-preview', name: 'Private account' }] } } }) });
      else if (request.method !== 'initialized') send({ id: request.id, result: request.method === 'initialize' ? {}
        : { data: [{ model: 'discovered', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }], nextCursor: null } });
    });
    if (mode === 'stall') setInterval(() => {}, 1000);
    }
  `);
  return { directory, log, versionLog, options: { workdir: directory, cliScript, timeoutMs: mode.includes('stall') ? 1000 : 5000 } };
}

for (const provider of ['claude', 'gemini'] as const) {
  test(provider + ' exposes CLI model choices without a prompt, leaked credentials or permission bypass', async t => {
    const f = await probeFixture(t, provider);
    const previous = process.env.DISCORD_TOKEN;
    const previousSystem = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    process.env.DISCORD_TOKEN = 'private-secret';
    if (provider === 'gemini') {
      const system = join(f.directory, 'system.json');
      await writeFile(system, JSON.stringify({ experimental: { autoMemory: true }, tools: { core: ['read_file'] } }));
      process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = system;
    } else delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    t.after(() => {
      if (previous === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = previous;
      if (previousSystem === undefined) delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH; else process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = previousSystem;
    });
    const models = await discoverProviderModels(provider, f.options);
    assert.deepEqual(JSON.parse(await readFile(f.versionLog, 'utf8')).args, ['--version']);
    assert.deepEqual(models, provider === 'claude' ? [{ model: 'sonnet', efforts: ['low', 'high'] }, { model: 'haiku', efforts: [] }]
      : [{ model: 'gemini-3-pro-preview' }]);
    const log = JSON.parse(await readFile(f.log, 'utf8'));
    assert.deepEqual(log.leaked, []);
    assert.ok(!log.args.includes('--dangerously-skip-permissions') && !log.args.includes('--yolo'));
    assert.doesNotMatch(JSON.stringify(models), /Private account|private-secret/);
    if (provider === 'claude') {
      assert.deepEqual(log.requests.map((request: { request: { subtype: string } }) => request.request.subtype), ['initialize']);
      assert.equal(log.args[log.args.indexOf('--tools') + 1], '');
      assert.ok(log.args.includes('--no-session-persistence') && log.args.includes('--restricted'));
    } else {
      assert.deepEqual(log.requests.map((request: { method: string }) => request.method), ['initialize', 'session/new']);
      assert.deepEqual(log.requests[1].params.mcpServers, []);
      assert.equal(log.settings.experimental.autoMemory, false);
      assert.equal(log.settings.advanced.autoConfigureMemory, false);
      assert.equal(log.settings.hooksConfig.enabled, false);
      assert.equal(log.settings.admin.mcp.enabled, false);
      assert.deepEqual(log.settings.tools.core, ['read_file']);
    }
  });
  test(provider + ' catalog failures, unsafe IDs, output floods and stalls are bounded and sanitized', async t => {
    for (const mode of ['error', 'malformed', 'invalid-id', 'flood', 'stderr', 'stall']) {
      await t.test(mode, async sub => {
        const f = await probeFixture(sub, provider, mode);
        await assert.rejects(discoverProviderModels(provider, f.options), { message: mode === 'stall' ? 'AI_MODELS_TIMEOUT'
          : ['flood', 'stderr'].includes(mode) ? 'AI_MODELS_OUTPUT_LIMIT' : 'AI_MODELS_UNAVAILABLE' });
      });
    }
  });
  test(provider + ' rejects unsupported or failed version probes before initializing a metadata session', async t => {
    for (const mode of ['version-old', 'version-malformed', 'version-failed', 'version-flood', 'version-stall']) {
      await t.test(mode, async sub => {
        const f = await probeFixture(sub, provider, mode);
        await assert.rejects(discoverProviderModels(provider, f.options), { message:
          mode === 'version-stall' ? 'AI_MODELS_TIMEOUT' : mode === 'version-flood' ? 'AI_MODELS_OUTPUT_LIMIT'
            : mode === 'version-failed' ? 'AI_MODELS_UNAVAILABLE' : 'AI_CLI_VERSION' });
        assert.deepEqual(JSON.parse(await readFile(f.versionLog, 'utf8')).args, ['--version']);
        await assert.rejects(readFile(f.log, 'utf8'), { code: 'ENOENT' });
      });
    }
  });
}

test('Codex discovery carries the CLI effort capabilities alongside model IDs', async t => {
  const f = await probeFixture(t, 'codex');
  assert.deepEqual(await discoverCodexCatalog(f.options), [{ model: 'discovered', efforts: ['low', 'high'] }]);
});

test('CLI models become selectable, survive restart and feed prompts and captured schedules with CLI effort limits', async t => {
  const f = await runtimeFixture(t);
  const key = scheduleKey(owner);
  const originalFile = await readFile(f.file, 'utf8');
  await f.runtime.updateModelCatalog('codex', [{ model: 'new-cli-model', efforts: ['low', 'high'] }]);
  assert.equal(await readFile(f.file, 'utf8'), originalFile);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  await preferences.save(f.runtime.value, key, 'codex', { model: 'new-cli-model', effort: 'high' });
  await assert.rejects(preferences.save(f.runtime.value, key, 'codex', { effort: 'xhigh' }), /AI_EFFORT_INVALID/);
  assert.throws(() => selectCommand(f.runtime.value, 'codex', null, 'new-cli-model', 'xhigh'), /AI_EFFORT_INVALID/);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'effort', '', 'codex', false, null, 'new-cli-model')
    .map(item => item.value), ['default', 'low', 'high']);
  const restored = new RuntimeConfig(f.runtimeOptions); await restored.load();
  assert.equal(preferences.resolve(restored.value, key).model, 'new-cli-model');
  const calls: Array<{ model?: string; effort?: string }> = [];
  const sessions = new ProjectSessions({ runtime: restored, workdir: f.directory, projects: restored.value.projects, sandbox: 'read-only' },
    async (_prompt, options) => { calls.push(options); return 'done'; });
  await sessions.prompt(key, 'inspect', preferences.resolve(restored.value, key));
  let now = Date.now();
  const scheduler = new CodexScheduler({ runtime: restored, file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only',
    guildId: auth.guildId, allowedUsers: auth.allowedUsers, busy: () => false, now: () => now,
    run: async (_key, _prompt, selection) => { calls.push(selection); return 'done'; } });
  await scheduler.add(owner, 'later', { nextRun: now + 1000 }, preferences.resolve(restored.value, key), 'web');
  await preferences.save(restored.value, key, 'codex', { model: 'm1', effort: 'low' });
  now += 1000; await scheduler.tick();
  assert.deepEqual(calls.map(call => [call.model, call.effort]), [['new-cli-model', 'high'], ['new-cli-model', 'high']]);
  await restored.updateModelCatalog('codex', []);
  assert.throws(() => selectCommand(restored.value, 'codex', null, 'new-cli-model'), /AI_MODEL_NOT_ALLOWED/);
});

test('catalog service coalesces requests, caches briefly, refreshes explicitly and keeps old choices on failure', async t => {
  const f = await runtimeFixture(t);
  let calls = 0;
  let failed = false;
  let now = 1000;
  const service = new ModelCatalogService(f.runtime, async () => {
    calls++; if (failed) throw new Error('private token or host path');
    return [{ model: 'remote-model' }];
  }, () => false, () => now);
  await Promise.all([service.refresh('codex'), service.refresh('codex')]);
  assert.equal(calls, 1);
  await service.refresh('codex'); assert.equal(calls, 1);
  failed = true; const note = await service.refresh('codex', true);
  assert.match(note, /discovery unavailable/); assert.doesNotMatch(note, /private token|host path/);
  assert.ok(f.runtime.value.providers.allowedModels?.codex?.includes('remote-model'));
  now += 60001; failed = false;
  await service.refresh('codex'); assert.equal(calls, 3);
  const revision = f.runtime.value.revision;
  await service.refresh('codex', true); assert.equal(f.runtime.value.revision, revision);
});

test('discovery publication rejects stale config and save failures without exposing unapproved models', async t => {
  const f = await runtimeFixture(t);
  const oldRevision = f.runtime.value.revision;
  await f.runtime.reload();
  await assert.rejects(f.runtime.updateModelCatalog('codex', [{ model: 'stale' }], oldRevision), /AI_CONFIG_PICKER_STALE/);
  await assert.rejects(f.runtime.updateModelCatalog('gemini', [{ model: 'uninstalled' }]), /AI_PROVIDER_DISABLED/);
  await assert.rejects(f.runtime.updateModelCatalog('codex', [{ model: '--help' }]), /AI_MODELS_UNAVAILABLE/);
  const failed = await runtimeFixture(t, { write: async () => { throw new Error('private path'); } });
  const original = failed.runtime.value;
  await assert.rejects(failed.runtime.updateModelCatalog('codex', [{ model: 'unpublished' }]), /AI_CONFIG_SAVE/);
  assert.equal(failed.runtime.value, original);
});

test('switching provider loads that CLI catalog, while unauthorized components never run discovery', async t => {
  const f = await runtimeFixture(t);
  const key = scheduleKey(owner);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  let calls = 0;
  const service = new ModelCatalogService(f.runtime, async provider => { calls++; return [{ model: provider + '-from-cli' }]; });
  const picker = configPicker(f.runtime, preferences, key, access, auth);
  const providerMenu = picker.components[0]!.toJSON().components[0]!;
  assert.ok(providerMenu.type === 3);
  await assert.rejects(updateConfigPicker(f.runtime, preferences, key, { ...access, guildId: null }, auth,
    providerMenu.custom_id, 'claude', service), /AI_ADMIN_DENIED/);
  assert.equal(calls, 0);
  const updated = await updateConfigPicker(f.runtime, preferences, key, access, auth, providerMenu.custom_id, 'claude', service);
  assert.ok(updated.components.length <= 5);
  const modelMenu = updated.components[1]!.toJSON().components[0]!;
  assert.ok(modelMenu.type === 3 && modelMenu.options.some(option => option.value === 'claude-from-cli'));
  await updateConfigPicker(f.runtime, preferences, key, access, auth, modelMenu.custom_id, 'claude-from-cli', service);
  assert.equal(preferences.resolve(f.runtime.value, key).model, 'claude-from-cli');
  assert.equal(calls, 1);
});
