import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, commandNames, createCommands } from '../src/commands.js';

test('/ai exposes dynamic provider/profile options and leaves schedule management provider-neutral', () => {
  const definition = commands.find(command => command.name === 'ai')!.toJSON();
  assert.deepEqual(definition.options?.map(option => option.name), ['run', 'new', 'status', 'context', 'clear', 'result', 'models', 'config', 'schedules', 'cancel', 'projects', 'project', 'init']);
  for (const option of definition.options ?? []) {
    assert.equal(option.type, 1);
    if (option.type !== 1) continue;
    const provider = option.options?.find(value => value.name === 'provider');
    if (option.name === 'config') {
      assert.ok(provider && provider.type === 3 && provider.autocomplete);
      assert.deepEqual(option.options?.map(value => value.name), ['provider', 'model', 'effort']);
      continue;
    }
    if (['schedules', 'cancel', 'projects', 'project', 'init'].includes(option.name)) { assert.equal(provider, undefined); continue; }
    assert.ok(provider && provider.type === 3);
    assert.ok(!provider.required);
    assert.equal(provider.choices, undefined);
    assert.equal(provider.autocomplete, true);
    const profile = option.options?.find(value => value.name === 'profile');
    assert.ok(profile && profile.type === 3 && profile.autocomplete);
    assert.ok(!option.options?.some(value => ['path', 'executable', 'flags'].includes(value.name)));
    const model = option.options?.find(value => value.name === 'model');
    if (option.name === 'models') assert.equal(model, undefined);
    else assert.ok(model && model.type === 3 && model.autocomplete && !model.required && model.max_length === 120);
  }
});

test('command definitions are independent of project inventory and accept more than 25 aliases', () => {
  assert.deepEqual(createCommands(['web']).map(command => command.toJSON()),
    createCommands(Array.from({ length: 40 }, (_, i) => 'project-' + i)).map(command => command.toJSON()));
  for (const command of createCommands().filter(command => command.name !== 'ai-admin')) {
    const actions = command.toJSON().options ?? [];
    for (const action of actions) {
      if (action.type !== 1) continue;
      const choice = action.options?.find(option => option.name === (action.name === 'project' ? 'name' : 'project'));
      if (['schedules', 'cancel', 'projects', 'models', 'config'].includes(action.name)) { assert.equal(choice, undefined); continue; }
      assert.ok(choice && choice.type === 3);
      assert.equal(choice.choices, undefined);
      assert.equal(choice.autocomplete, true);
      assert.equal(Boolean(choice.required), action.name === 'project');
    }
  }
});

test('only admin project-add accepts a directory; executable overrides remain local', () => {
  const admin = commands.find(command => command.name === 'ai-admin')!.toJSON();
  assert.deepEqual(admin.options?.map(option => option.name),
    ['status', 'reload', 'provider-add', 'profile-add', 'profile-set', 'profile-delete', 'project', 'project-add', 'provider', 'defaults']);
  for (const action of admin.options ?? []) {
    if (action.type !== 1) continue;
    assert.ok(action.options?.every(option => !['executable', 'script', 'path'].includes(option.name)
      && (option.name !== 'directory' || action.name === 'project-add')) ?? true);
  }
  const add = admin.options!.find(action => action.name === 'project-add')!;
  assert.ok(add.type === 1);
  assert.deepEqual(add.options?.map(option => option.name), ['name', 'root', 'directory', 'create']);
  const name = add.options![0]!;
  assert.ok(name.type === 3 && name.required && name.max_length === 32 && !name.autocomplete);
  const root = add.options![1]!;
  assert.ok(root.type === 3 && !root.required && root.autocomplete);
  const directory = add.options![2]!;
  assert.ok(directory.type === 3 && !directory.required && !directory.autocomplete && directory.max_length === 1024);
  const create = add.options![3]!;
  assert.ok(create.type === 5 && !create.required);
});

test('provider-add offers supported adapters and model IDs; profile-add accepts a new name and dynamic selections', () => {
  const admin = commands.find(command => command.name === 'ai-admin')!.toJSON();
  const provider = admin.options!.find(option => option.name === 'provider-add')!;
  assert.ok(provider.type === 1);
  assert.deepEqual(provider.options?.map(option => option.name), ['provider', 'models', 'default-model']);
  const adapter = provider.options![0]!;
  assert.ok(adapter.type === 3 && adapter.required);
  assert.deepEqual(adapter.choices?.map(choice => choice.value), ['codex', 'claude', 'gemini']);
  const profile = admin.options!.find(option => option.name === 'profile-add')!;
  assert.ok(profile.type === 1);
  assert.deepEqual(profile.options?.map(option => option.name), ['name', 'provider', 'project', 'model']);
  assert.ok(profile.options![0]!.type === 3 && profile.options![0]!.required && !profile.options![0]!.autocomplete);
  assert.ok(profile.options![1]!.type === 3 && profile.options![1]!.required && profile.options![1]!.autocomplete);
  assert.ok(profile.options![2]!.type === 3 && profile.options![2]!.required && profile.options![2]!.autocomplete);
  assert.ok(profile.options![3]!.type === 3 && !profile.options![3]!.required && profile.options![3]!.autocomplete);
  const replace = admin.options!.find(option => option.name === 'profile-set')!;
  assert.ok(replace.type === 1);
  const project = replace.options?.find(option => option.name === 'project');
  assert.ok(project && project.type === 3 && project.required && project.autocomplete);
});

test('only /ai, /ai-admin and /help are registered and routed', () => {
  assert.deepEqual(commands.map(command => command.name), ['ai', 'ai-admin', 'help']);
  assert.deepEqual([...commandNames], ['ai', 'ai-admin', 'help']);
  assert.equal(commandNames.has('codex'), false);
});

test('/ai init offers optional project/profile autocomplete without host paths or CLI overrides', () => {
  const init = commands.find(command => command.name === 'ai')!.toJSON().options!.find(option => option.name === 'init')!;
  assert.ok(init.type === 1);
  assert.deepEqual(init.options?.map(option => option.name), ['project', 'profile']);
  assert.ok(init.options?.every(option => option.type === 3 && option.autocomplete && !option.required));
});
