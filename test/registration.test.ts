import test from 'node:test';
import assert from 'node:assert/strict';
import { Routes, type REST } from 'discord.js';
import { registerCommands } from '../src/registration.js';

const legacy = [
  { id: 'codex-id', name: 'codex', description: 'Run Codex tasks and manage your session' },
  { id: 'new-id', name: 'new', description: 'Start a fresh Codex conversation with your next prompt' },
  { id: 'status-id', name: 'status', description: 'Show your Codex session, worker state and configuration' },
  { id: 'clear-id', name: 'clear', description: 'Clear your current Codex conversation context' },
];

test('registration replaces the active schemas and removes legacy bot commands only', async () => {
  const writes: unknown[] = [];
  const deletions: string[] = [];
  const route = Routes.applicationGuildCommands('app', 'guild');
  const rest: Pick<REST, 'post' | 'get' | 'delete'> = {
    post: async (path, options) => { assert.equal(path, route); writes.push(options?.body); return {}; },
    get: async path => {
      assert.equal(path, route);
      assert.equal(writes.length, 3);
      return [...legacy, { id: 'ai-id', name: 'ai', description: 'Run AI tasks and manage your session' },
        { id: 'other-id', name: 'other', description: 'Unrelated command' },
        { id: 'custom-id', name: 'codex', description: 'Unrelated Codex integration' }];
    },
    delete: async path => { deletions.push(path); return {}; },
  };
  await registerCommands(rest, 'app', 'guild');
  assert.deepEqual(writes.map(body => (body as { name: string }).name), ['ai', 'ai-admin', 'help']);
  assert.deepEqual(deletions, legacy.map(command => Routes.applicationGuildCommand('app', 'guild', command.id)));
});

test('registration can be rerun after legacy commands have been removed', async () => {
  const rest: Pick<REST, 'post' | 'get' | 'delete'> = {
    post: async () => ({}),
    get: async () => [],
    delete: async () => { assert.fail('No legacy commands should be deleted'); },
  };
  await registerCommands(rest, 'app', 'guild');
});
