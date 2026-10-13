import test from 'node:test';
import assert from 'node:assert/strict';
import { autocomplete, authorized, selectCommand } from '../src/selection.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { type AgentRunOptions } from '../src/agent-runner.js';
import { runtimeFixture, access, auth } from './runtime-fixture.js';

test('default profile, explicit profile, explicit providers resolve distinct permitted selections', async t => {
  const f = await runtimeFixture(t);
  assert.deepEqual(selectCommand(f.runtime.value), { provider: 'codex', model: 'm2', profile: 'review' });
  assert.deepEqual(selectCommand(f.runtime.value, null, 'plain'), { provider: 'codex', model: undefined, profile: 'plain' });
  assert.deepEqual(selectCommand(f.runtime.value, 'claude'), { provider: 'claude', model: undefined });
  assert.deepEqual(selectCommand(f.runtime.value, 'codex'), { provider: 'codex', model: 'm1' });
  assert.throws(() => selectCommand(f.runtime.value, 'codex', 'review'), /AI_SELECTION_CONFLICT/);
  assert.throws(() => selectCommand(f.runtime.value, null, 'missing'), /AI_PROFILE_UNAVAILABLE/);
  assert.throws(() => selectCommand(f.runtime.value, 'unknown'), /AI_PROVIDER_DISABLED/);
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  assert.throws(() => selectCommand(f.runtime.value, null, 'writer'), /AI_PROVIDER_DISABLED/);
});

test('autocomplete authenticates guild/user/admin before returning aliases and includes disabled admin entries', async t => {
  const f = await runtimeFixture(t);
  const suggestions = (command: string, option: string, query = '') => autocomplete(f.runtime.value, access, auth, command, option, query);
  assert.deepEqual(suggestions('ai', 'project').map(p => p.value), ['web', 'api']);
  await f.runtime.change({ kind: 'project', name: 'api', enabled: false });
  await f.runtime.change({ kind: 'provider', name: 'claude', enabled: false });
  assert.deepEqual(suggestions('ai', 'project').map(p => p.value), ['web']);
  assert.deepEqual(suggestions('ai-admin', 'project').map(p => p.value), ['web', 'api']);
  assert.deepEqual(suggestions('ai-admin', 'provider').map(p => p.value), ['codex', 'claude']);
  assert.ok(!suggestions('ai', 'profile').some(p => p.value === 'writer'));
  assert.ok(suggestions('ai-admin', 'name').some(p => p.value === 'writer'));
  assert.deepEqual(suggestions('ai', 'project', 'WEB'), [{ name: 'web', value: 'web' }]);
  assert.doesNotMatch(JSON.stringify(suggestions('ai-admin', 'project')), /[A-Z]:\\|ai-runtime-|directory/);
  for (const denied of [{ ...access, guildId: null }, { ...access, guildId: 'other' }, { ...access, userId: 'other' }]) {
    assert.equal(authorized(denied, auth, true), false);
    assert.deepEqual(autocomplete(f.runtime.value, denied, auth, 'ai', 'profile', ''), []);
  }
  const noAdmin = { ...auth, adminUsers: new Set<string>() };
  assert.equal(authorized(access, noAdmin, true), false);
  assert.deepEqual(autocomplete(f.runtime.value, access, noAdmin, 'ai-admin', 'project', ''), []);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai-admin', 'model', '', 'codex').map(p => p.value), ['m1', 'm2']);
});

test('autocomplete reads reloaded additions beyond 25 and typed selections are validated again', async t => {
  const f = await runtimeFixture(t);
  Object.assign(f.config.projects, Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['p' + i, { directory: '.' }])));
  await f.save(); await f.runtime.reload();
  assert.equal(autocomplete(f.runtime.value, access, auth, 'ai', 'project', '').length, 25);
  assert.deepEqual(autocomplete(f.runtime.value, access, auth, 'ai', 'project', 'p39'), [{ name: 'p39', value: 'p39' }]);
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects, sandbox: 'read-only' });
  assert.equal(sessions.currentProject('user', 'p39').project, 'p39');
  assert.throws(() => sessions.currentProject('user', '../private'), /AI_PROJECT_UNAVAILABLE/);
  await f.runtime.change({ kind: 'project', name: 'p39', enabled: false });
  assert.throws(() => sessions.currentProject('user', 'p39'), /AI_PROJECT_UNAVAILABLE/);
});

test('profiles share provider/model sessions and restore their previous session when edited back', async t => {
  const f = await runtimeFixture(t);
  const calls: AgentRunOptions[] = [];
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects,
    providers: f.runtime.value.providers, sandbox: 'read-only' }, async (_prompt, options) => {
    calls.push(options); options.onSession?.(options.sessionId ?? 's' + calls.length); return 'result-' + calls.length;
  });
  await f.runtime.change({ kind: 'profile', name: 'twin', profile: { provider: 'codex', model: 'm2' } });
  await sessions.prompt('user', 'one', selectCommand(f.runtime.value));
  await sessions.prompt('user', 'two', selectCommand(f.runtime.value, null, 'twin'));
  await f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm1' } });
  await sessions.prompt('user', 'three', selectCommand(f.runtime.value));
  await f.runtime.change({ kind: 'profile', name: 'review', profile: { provider: 'codex', model: 'm2' } });
  await sessions.prompt('user', 'four', selectCommand(f.runtime.value));
  await sessions.prompt('other-user', 'five', selectCommand(f.runtime.value));
  await sessions.prompt('user', 'six', selectCommand(f.runtime.value), 'api');
  assert.deepEqual(calls.map(c => c.sessionId), [undefined, 's1', undefined, 's1', undefined, undefined]);
  assert.equal(sessions.result('user', selectCommand(f.runtime.value)), 'result-4');
  await assert.rejects(sessions.prompt('user', 'bad', { provider: 'codex', model: 'not-allowed' }), /AI_INVALID_SELECTION/);
});

test('disabled/removed preferences require explicit reselection and never silently follow a new default', async t => {
  const f = await runtimeFixture(t);
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects, sandbox: 'read-only' });
  sessions.switchProject('user', 'web');
  await f.runtime.change({ kind: 'defaults', project: 'api' });
  await f.runtime.change({ kind: 'project', name: 'web', enabled: false });
  assert.throws(() => sessions.currentProject('user'), /AI_PROJECT_UNAVAILABLE/);
  assert.equal(sessions.currentProject('new-user').project, 'api');
  assert.match(sessions.projectsText('user'), /unavailable.*select an enabled project/);
  assert.equal(sessions.switchProject('user', 'api').project, 'api');
});
