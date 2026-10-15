import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { manageConfig } from '../src/admin-config.js';
import { ProviderPreferences } from '../src/provider-preferences.js';
import { RuntimeConfig } from '../src/runtime-config.js';
import { autocomplete, selectCommand } from '../src/selection.js';
import { scheduleKey } from '../src/scheduler.js';
import { commands } from '../src/commands.js';
import { runtimeFixture, owner, access, auth } from './runtime-fixture.js';

const key = scheduleKey(owner);

test('profiles store an optional effort that prompts can override or reset', async t => {
  const f = await runtimeFixture(t);
  const reply = await manageConfig(f.runtime, access, auth, { kind: 'add-profile', name: 'deep',
    profile: { provider: 'codex', model: 'm2', effort: 'high', project: 'api' } });
  assert.match(reply, /Profile deep added \(effort: high\)/);
  assert.deepEqual(selectCommand(f.runtime.value, null, 'deep'),
    { provider: 'codex', model: 'm2', effort: 'high', profile: 'deep', project: 'api' });
  assert.equal(selectCommand(f.runtime.value, null, 'deep', null, 'low').effort, 'low');
  const reset = selectCommand(f.runtime.value, null, 'deep', null, 'default');
  assert.equal(reset.effort, undefined);
  assert.equal(reset.project, 'api');
  assert.match(f.runtime.status(), /deep: codex \/ m2 \/ effort: high \/ project: api/);
  // Survives restart through the overrides file.
  const restarted = new RuntimeConfig(f.runtimeOptions);
  await restarted.load();
  assert.equal(restarted.value.profiles.get('deep')?.effort, 'high');
  assert.equal(JSON.parse(await readFile(f.overridesFile, 'utf8')).profiles.deep.effort, 'high');

  await manageConfig(f.runtime, access, auth, { kind: 'profile', name: 'deep', profile: { provider: 'codex', model: 'm2', project: 'api' } });
  assert.equal(selectCommand(f.runtime.value, null, 'deep').effort, undefined);
  await assert.rejects(manageConfig(f.runtime, access, auth, { kind: 'add-profile', name: 'bad',
    profile: { provider: 'claude', model: 'sonnet', effort: 'minimal', project: 'web' } }), /AI_EFFORT_INVALID/);
  assert.equal(f.runtime.value.profiles.has('bad'), false);
});

test('profile-add/profile-set expose effort with provider capability autocomplete', async t => {
  const f = await runtimeFixture(t);
  const admin = commands.find(command => command.name === 'ai-admin')!.toJSON();
  for (const name of ['profile-add', 'profile-set']) {
    const action = admin.options?.find(option => option.name === name);
    const effort = action?.type === 1 ? action.options?.find(option => option.name === 'effort') : undefined;
    assert.ok(effort && effort.type === 3 && effort.autocomplete && !effort.required);
  }
  const claude = autocomplete(f.runtime.value, access, auth, 'ai-admin', 'effort', '', 'claude', false, null, 'sonnet').map(choice => choice.value);
  assert.deepEqual(claude, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai-admin', 'effort', '', null), []);
  assert.deepEqual(autocomplete(f.runtime.value, { ...access, userId: '999999999999999999' }, auth, 'ai-admin', 'effort', '', 'codex'), []);
});

test('changing the default profile replaces personal choices saved under the previous default', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'preferences.json');
  const preferences = new ProviderPreferences(file, undefined, () => f.runtime.value.defaultProfile);
  await preferences.save(f.runtime.value, key, 'claude', { model: 'sonnet', effort: 'high' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'claude', model: 'sonnet', effort: 'high' });

  const reply = await manageConfig(f.runtime, access, auth, { kind: 'defaults', profile: 'fast' });
  assert.match(reply, /Personal \/ai config choices saved under a previous default no longer apply; users get profile fast/);
  assert.equal(preferences.selectedProvider(key), undefined);
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm1', profile: 'fast' });

  // Choosing again applies on top of the new default and survives restart.
  await preferences.save(f.runtime.value, key, 'claude', { model: 'sonnet' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'claude', model: 'sonnet' });
  assert.equal(preferences.get(key, 'claude')?.effort, undefined);
  const reloaded = new ProviderPreferences(file, undefined, () => f.runtime.value.defaultProfile);
  await reloaded.load();
  assert.equal(reloaded.selectedProvider(key), 'claude');
  // A project-only defaults change keeps personal choices.
  await manageConfig(f.runtime, access, auth, { kind: 'defaults', project: 'api' });
  assert.equal(preferences.selectedProvider(key), 'claude');
});

test('personal choices saved before the default was recorded follow the default profile', async t => {
  const f = await runtimeFixture(t);
  const file = join(f.directory, 'preferences.json');
  await writeFile(file, JSON.stringify({ version: 1, entries: { [key]: { provider: 'codex', providers: { codex: { model: 'm2', effort: 'high' } } } } }));
  const preferences = new ProviderPreferences(file, undefined, () => f.runtime.value.defaultProfile);
  await preferences.load();
  assert.deepEqual(preferences.resolve(f.runtime.value, key), { provider: 'codex', model: 'm2', profile: 'review' });
  // Without a default source (local tools), saved choices are used as before.
  const plain = new ProviderPreferences(file);
  await plain.load();
  assert.equal(plain.resolve(f.runtime.value, key).effort, 'high');
});

test('an effort override on the default profile keeps its model and project binding', async t => {
  const f = await runtimeFixture(t);
  await f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm2', effort: 'medium', project: 'api' } });
  const preferences = new ProviderPreferences(join(f.directory, 'preferences.json'), undefined, () => f.runtime.value.defaultProfile);
  assert.deepEqual(preferences.resolve(f.runtime.value, key),
    { provider: 'codex', model: 'm2', effort: 'medium', profile: 'review', project: 'api' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, null, null, 'high'),
    { provider: 'codex', model: 'm2', effort: 'high', profile: 'review', project: 'api' });
  assert.deepEqual(preferences.resolve(f.runtime.value, key, null, null, null, 'default'),
    { provider: 'codex', model: 'm2', profile: 'review', project: 'api' });
});
