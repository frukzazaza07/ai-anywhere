import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProviderPreferences, cliDefaultModel } from '../src/provider-preferences.js';
import { configPicker, updateConfigPicker } from '../src/config-picker.js';
import { ModelCatalogService } from '../src/model-catalog-service.js';
import { effortChoices } from '../src/effort.js';
import { autocomplete, selectCommand } from '../src/selection.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { CodexScheduler, scheduleKey } from '../src/scheduler.js';
import { type AgentRunOptions } from '../src/agent-runner.js';
import { runtimeFixture, access, auth, owner } from './runtime-fixture.js';

const key = scheduleKey(owner);

test('personal provider/model/effort defaults survive restart without replacing shared profiles or other scopes', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'preferences.json');
  const preferences = new ProviderPreferences(file);
  await preferences.load();
  assert.deepEqual(preferences.resolve(f.runtime.value, key), selectCommand(f.runtime.value));
  assert.match(configPicker(f.runtime, preferences, key, access, auth).content, /Model: m2/);
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm1', effort: 'high' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm1', effort: 'high' });
  await preferences.save(f.runtime.value, key, 'claude', { model: 'sonnet', effort: 'low' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'claude', model: 'sonnet', effort: 'low' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, 'codex'), { provider: 'codex', model: 'm1', effort: 'high' });
  for (const other of [key.replace(owner.userId, '444444444444444444'), key.replace(owner.channelId, '555555555555555555'),
    key.replace(owner.guildId, '666666666666666666')]) {
    assert.deepEqual(preferences.resolve(f.runtime.value, other), selectCommand(f.runtime.value));
  }
  assert.equal(f.runtime.value.profiles.get('review')?.model, 'm2');
  const restored = new ProviderPreferences(file);
  await restored.load();
  assert.deepEqual(restored.resolve(f.runtime.value, key), preferences.resolve(f.runtime.value, key));
  await restored.save(f.runtime.value, key, 'codex');
  assert.deepEqual(restored.resolve(f.runtime.value, key), { provider: 'codex', model: 'm1', effort: 'high' });
});

test('explicit prompt fields and profiles override preferences for one request and effort keeps model session history', async t => {
  const f = await runtimeFixture(t);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm1', effort: 'high' });
  const saved = await readFile(join(f.directory, 'preferences.json'), 'utf8');
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, null, 'm2', 'low'), { provider: 'codex', model: 'm2', effort: 'low' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, 'review'), { provider: 'codex', model: 'm2', profile: 'review' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, 'review', null, 'medium'),
    { provider: 'codex', model: 'm2', profile: 'review', effort: 'medium' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, null, null, 'default'), { provider: 'codex', model: 'm1' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, null, cliDefaultModel, 'default'), { provider: 'codex', model: undefined });
  assert.equal(await readFile(join(f.directory, 'preferences.json'), 'utf8'), saved);
  const calls: AgentRunOptions[] = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects,
    sandbox: 'read-only' }, async (_prompt, options) => { calls.push(options); options.onSession?.('session-one'); return 'done'; });
  await sessions.prompt(key, 'first', preferences.resolve(f.runtime.value, key));
  await sessions.prompt(key, 'second', preferences.resolve(f.runtime.value, key, null, null, null, 'low'));
  assert.deepEqual(calls.map(call => [call.model, call.effort, call.sessionId]), [['m1', 'high', undefined], ['m1', 'low', 'session-one']]);
  assert.match(sessions.status(key, preferences.resolve(f.runtime.value, key)), /Effort: high/);
});

test('unsafe selections, revoked models and failed saves cannot publish a new personal configuration', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'preferences.json');
  const preferences = new ProviderPreferences(file);
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm1', effort: 'high' });
  for (const change of [{ model: 'sonnet' }, { model: '--help' }, { effort: 'arbitrary' }]) {
    await assert.rejects(preferences.save(f.runtime.value, key, 'codex', change));
  }
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm1', effort: 'high' });
  const failing = new ProviderPreferences(file, async () => { throw new Error('private path'); });
  await failing.load();
  await assert.rejects(failing.save(f.runtime.value, key, 'claude', { model: 'sonnet' }), /AI_PREFERENCES_SAVE/);
  assert.equal(failing.selectedProvider(key), 'codex');
  f.config.providers.codex.models = ['m2']; f.config.providers.codex.defaultModel = 'm2';
  f.config.profiles.fast.model = 'm2';
  await f.save(); await f.runtime.reload();
  assert.throws(() => preferences.resolve(f.runtime.value, key), /AI_MODEL_NOT_ALLOWED/);
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm2' });
  assert.equal(preferences.resolve(f.runtime.value, key).model, 'm2');
  await preferences.save(f.runtime.value, key, 'codex', { model: cliDefaultModel, effort: 'default' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: undefined });
});

test('changing models clears unsupported inherited catalog effort and persists the CLI default across restart', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.updateModelCatalog('codex', [
    { model: 'm1', efforts: ['high'] }, { model: 'm2', efforts: ['low'] },
    { model: 'no-effort', efforts: [] }, { model: 'compatible', efforts: ['high'] },
  ]);
  const file = join(f.directory, 'preferences.json');
  const preferences = new ProviderPreferences(file);
  for (const model of ['m2', 'no-effort']) {
    await preferences.save(f.runtime.value, key, 'codex', { model: 'm1', effort: 'high' });
    const picker = configPicker(f.runtime, preferences, key, access, auth);
    const modelMenu = picker.components[1]!.toJSON().components[0]!;
    assert.ok(modelMenu.type === 3);
    const updated = await updateConfigPicker(f.runtime, preferences, key, access, auth, modelMenu.custom_id, model);
    assert.match(updated.content, new RegExp('Model: ' + model + ' \\| Effort: CLI default'));
    assert.deepEqual(preferences.get(key, 'codex'), { model, effort: null });
    assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model });
    const restored = new ProviderPreferences(file);
    await restored.load();
    assert.deepEqual(restored.resolve(f.runtime.value, key), { provider: 'codex', model });
  }
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm1', effort: 'high' });
  await preferences.save(f.runtime.value, key, 'codex', { model: 'compatible' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'compatible', effort: 'high' });
  const saved = await readFile(file, 'utf8');
  await assert.rejects(preferences.save(f.runtime.value, key, 'codex', { model: 'm2', effort: 'high' }), /AI_EFFORT_INVALID/);
  assert.equal(await readFile(file, 'utf8'), saved);
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'compatible', effort: 'high' });
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm2', effort: 'low' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm2', effort: 'low' });
});

test('provider effort choices and autocomplete validate selected models and authenticate before listing', async t => {
  const f = await runtimeFixture(t);
  assert.ok(effortChoices('codex').includes('xhigh'));
  assert.ok(!effortChoices('claude').includes('ultra'));
  assert.deepEqual(effortChoices('gemini', 'gemini-3-pro-preview'), ['low', 'high']);
  assert.deepEqual(effortChoices('gemini', 'unknown'), []);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'effort', 'hi', 'codex').map(item => item.value), ['high', 'xhigh']);
  assert.deepEqual(autocomplete(f.runtime.value, { ...access, guildId: null }, auth, 'ai', 'effort', '', 'codex'), []);
  assert.throws(() => selectCommand(f.runtime.value, 'claude', null, 'sonnet', 'ultra'), /AI_EFFORT_INVALID/);
});

test('choosing effort in the initial picker preserves the displayed default-profile model', async t => {
  const f = await runtimeFixture(t);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  const picker = configPicker(f.runtime, preferences, key, access, auth);
  assert.match(picker.content, /Model: m2/);
  const effortMenu = picker.components[2]!.toJSON().components[0]!;
  assert.ok(effortMenu.type === 3);
  const updated = await updateConfigPicker(f.runtime, preferences, key, access, auth, effortMenu.custom_id, 'high');
  assert.match(updated.content, /Model: m2 \| Effort: high/);
  assert.equal(preferences.resolve(f.runtime.value, key).model, 'm2');
});

test('refresh and pagination preserve unsaved profile defaults and use its catalog effort choices when saving', async t => {
  const f = await runtimeFixture(t);
  f.config.providers.codex.models.push(...Array.from({ length: 25 }, (_, i) => 'choice-' + i));
  await f.save(); await f.runtime.reload();
  await f.runtime.updateModelCatalog('codex', [{ model: 'm1', efforts: ['high'] }, { model: 'm2', efforts: ['low'] }]);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  let calls = 0;
  const catalogs = new ModelCatalogService(f.runtime, async provider => {
    calls++;
    assert.equal(provider, 'codex');
    return [{ model: 'm1', efforts: ['high'] }, { model: 'm2', efforts: ['low'] }, { model: 'discovered' }];
  });
  let picker = configPicker(f.runtime, preferences, key, access, auth);
  const initial = preferences.resolve(f.runtime.value, key);
  const assertDefaults = () => {
    assert.match(picker.content, /Model: m2 \| Effort: CLI default/);
    const effortMenu = picker.components[2]!.toJSON().components[0]!;
    assert.ok(effortMenu.type === 3);
    assert.deepEqual(effortMenu.options.map(option => option.value), ['default', 'low']);
    assert.equal(preferences.selectedProvider(key), undefined);
    assert.deepEqual(preferences.resolve(f.runtime.value, key), initial);
  };
  assertDefaults();
  const refresh = picker.components[4]!.toJSON().components[0]!;
  assert.ok(refresh.type === 2 && 'custom_id' in refresh && typeof refresh.custom_id === 'string');
  const revision = f.runtime.value.revision;
  picker = await updateConfigPicker(f.runtime, preferences, key, access, auth, refresh.custom_id, undefined, catalogs);
  assert.equal(calls, 1);
  assert.ok(f.runtime.value.revision > revision);
  assertDefaults();
  const unchangedRefresh = picker.components[4]!.toJSON().components[0]!;
  assert.ok(unchangedRefresh.type === 2 && 'custom_id' in unchangedRefresh && typeof unchangedRefresh.custom_id === 'string');
  const refreshedRevision = f.runtime.value.revision;
  picker = await updateConfigPicker(f.runtime, preferences, key, access, auth, unchangedRefresh.custom_id, undefined, catalogs);
  assert.equal(calls, 2);
  assert.equal(f.runtime.value.revision, refreshedRevision);
  assertDefaults();
  const next = picker.components[3]!.toJSON().components[1]!;
  assert.ok(next.type === 2 && 'custom_id' in next && typeof next.custom_id === 'string');
  picker = await updateConfigPicker(f.runtime, preferences, key, access, auth, next.custom_id);
  const nextMenu = picker.components[1]!.toJSON().components[0]!;
  assert.ok(nextMenu.type === 3);
  assert.match(nextMenu.placeholder!, /page 2\/2/);
  assertDefaults();
  const previous = picker.components[3]!.toJSON().components[0]!;
  assert.ok(previous.type === 2 && 'custom_id' in previous && typeof previous.custom_id === 'string');
  picker = await updateConfigPicker(f.runtime, preferences, key, access, auth, previous.custom_id);
  assertDefaults();
  const effortMenu = picker.components[2]!.toJSON().components[0]!;
  assert.ok(effortMenu.type === 3);
  picker = await updateConfigPicker(f.runtime, preferences, key, access, auth, effortMenu.custom_id, 'low');
  assert.match(picker.content, /Model: m2 \| Effort: low/);
  assert.deepEqual(preferences.get(key, 'codex'), { model: 'm2', effort: 'low' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm2', effort: 'low' });
  const savedRefresh = picker.components[4]!.toJSON().components[0]!;
  assert.ok(savedRefresh.type === 2 && 'custom_id' in savedRefresh && typeof savedRefresh.custom_id === 'string');
  picker = await updateConfigPicker(f.runtime, preferences, key, access, auth, savedRefresh.custom_id, undefined, catalogs);
  assert.match(picker.content, /Model: m2 \| Effort: low/);
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm2', effort: 'low' });
});

test('private pickers paginate models, preserve long IDs and reject unauthorized or stale component submissions', async t => {
  const f = await runtimeFixture(t);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  const longModel = 'm' + 'a'.repeat(119);
  f.config.providers.codex.models.push(...Array.from({ length: 39 }, (_, i) => 'choice-' + i), longModel);
  await f.save(); await f.runtime.reload();
  const ordinary = { ...auth, adminUsers: new Set<string>() };
  const picker = configPicker(f.runtime, preferences, key, access, ordinary);
  const rows = picker.components.map(component => component.toJSON());
  const model = rows[1]!.components[0]!;
  assert.ok(model.type === 3);
  assert.equal(model.options.length, 25);
  assert.deepEqual(picker.allowedMentions, { parse: [] });
  assert.doesNotMatch(picker.content, /ai-runtime-|[A-Z]:\\/);
  const nextButton = rows[3]!.components[1]!;
  assert.ok(nextButton.type === 2 && 'custom_id' in nextButton && typeof nextButton.custom_id === 'string');
  const next = await updateConfigPicker(f.runtime, preferences, key, access, ordinary, nextButton.custom_id);
  const nextMenu = next.components[1]!.toJSON().components[0]!;
  assert.ok(nextMenu.type === 3);
  const option = nextMenu.options.find(item => item.value.startsWith('__index__'))!;
  await updateConfigPicker(f.runtime, preferences, key, access, ordinary, nextMenu.custom_id, option.value);
  assert.equal(preferences.resolve(f.runtime.value, key).model, longModel);
  await assert.rejects(updateConfigPicker(f.runtime, preferences, key, { ...access, userId: '999999999999999999' }, auth,
    model.custom_id, 'm2'), /AI_ADMIN_DENIED/);
  await assert.rejects(updateConfigPicker(f.runtime, preferences, key, { ...access, guildId: null }, auth, model.custom_id, 'm2'), /AI_ADMIN_DENIED/);
  await f.runtime.reload();
  await assert.rejects(updateConfigPicker(f.runtime, preferences, key, access, auth, model.custom_id, 'm2'), /AI_CONFIG_PICKER_STALE/);
  assert.equal(preferences.resolve(f.runtime.value, key).model, longModel);
});

test('preferences serialize concurrent saves and reject malformed persisted state', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'preferences.json');
  const preferences = new ProviderPreferences(file);
  await Promise.all([preferences.save(f.runtime.value, key, 'codex', { model: 'm1' }),
    preferences.save(f.runtime.value, key, 'codex', { effort: 'high' }),
    preferences.save(f.runtime.value, key, 'claude', { model: 'sonnet' })]);
  assert.deepEqual(preferences.get(key, 'codex'), { model: 'm1', effort: 'high' });
  await writeFile(file, JSON.stringify({ version: 1, entries: { [key]: { provider: 'codex', providers: { codex: { model: '--help' } } } } }));
  await assert.rejects(new ProviderPreferences(file).load(), /AI_PREFERENCES_INVALID/);
});

test('scheduled prompts retain their captured model and effort after preferences change and across restart', async t => {
  const f = await runtimeFixture(t);
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'));
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm1', effort: 'high' });
  const calls: Array<{ model?: string; effort?: string }> = [];
  let now = Date.now();
  const options = { file: join(f.directory, 'jobs.json'), workdir: f.directory, sandbox: 'read-only', runtime: f.runtime,
    guildId: auth.guildId, allowedUsers: auth.allowedUsers, busy: () => false, now: () => now,
    run: async (_key: string, _prompt: string, selection: { model?: string; effort?: string }) => { calls.push(selection); return 'done'; } };
  const scheduler = new CodexScheduler(options);
  await scheduler.add(owner, 'inspect', { nextRun: now + 1000 }, preferences.resolve(f.runtime.value, key), 'web');
  await preferences.save(f.runtime.value, key, 'codex', { model: 'm2', effort: 'low' });
  const restored = new CodexScheduler(options);
  await restored.load(); now += 1000;
  await restored.tick();
  assert.equal(calls[0]?.model, 'm1');
  assert.equal(calls[0]?.effort, 'high');
  assert.match(restored.list(key)[0]!.lastOutcome!, /model:m1 effort:high/);
});
