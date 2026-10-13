import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectConfig, selectProject, ProjectPreferences, type ProjectConfig } from '../src/projects.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { type ProviderConfig } from '../src/providers.js';
import { type AgentRunOptions } from '../src/agent-runner.js';

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'ai-projects-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const web = join(base, 'web project ไทย');
  const api = join(base, 'api');
  await mkdir(web); await mkdir(api);
  const config = projectConfig({ AI_PROJECTS: JSON.stringify({ web, api }), AI_DEFAULT_PROJECT: 'web' }, base);
  return { base, web: realpathSync(web), api: realpathSync(api), config };
}

test('project config accepts existing folders with spaces and Unicode, relative paths and legacy defaults', async t => {
  const f = await fixture(t);
  assert.deepEqual(selectProject(f.config), { project: 'web', workdir: f.web });
  assert.equal(selectProject(f.config, 'api').workdir, f.api);
  const relative = projectConfig({ AI_PROJECTS: JSON.stringify({ web: './web project ไทย', api: './api' }) }, f.base);
  assert.equal(relative.directories.get('web'), f.web);
  assert.equal(projectConfig({ CODEX_WORKDIR: f.web }, f.base).directories.get('default'), f.web);
  assert.equal(projectConfig({ AI_WORKDIR: f.api, CODEX_WORKDIR: f.web }, f.base).directories.get('default'), f.api);
  const combined = projectConfig({ AI_PROJECTS: JSON.stringify({ api: f.api }), CODEX_WORKDIR: f.web,
    AI_DEFAULT_PROJECT: 'api' }, f.base);
  assert.deepEqual([...combined.directories.keys()], ['api', 'default']);
  assert.equal(combined.defaultProject, 'api');
  // The operator can select the bot launch folder too; credentials belong outside configured projects.
  assert.equal(projectConfig({ AI_WORKDIR: '.' }, f.base).directories.get('default'), realpathSync(f.base));
});

test('project configuration rejects invalid directories, names, maps and defaults without an inventory limit', async t => {
  const f = await fixture(t);
  const file = join(f.base, 'file.txt'); await writeFile(file, 'file');
  for (const env of [{}, { AI_PROJECTS: 'bad' }, { AI_PROJECTS: '[]' }, { AI_PROJECTS: '{}' },
    { AI_PROJECTS: JSON.stringify({ web: file }) }, { AI_PROJECTS: JSON.stringify({ web: 'missing' }) },
    { AI_PROJECTS: JSON.stringify({ 'bad/name': f.web }) }, { AI_PROJECTS: JSON.stringify({ web: 123 }) },
    { AI_WORKDIR: f.web, AI_DEFAULT_PROJECT: 'absent' }]) {
    assert.throws(() => projectConfig(env, f.base));
  }
  assert.equal(projectConfig({ AI_PROJECTS: JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['p' + i, f.web]))) }).directories.size, 40);
  for (const input of [f.web, '../api', 'absent', '']) assert.throws(() => selectProject(f.config, input), /AI_PROJECT_UNAVAILABLE/);
});

test('project preferences are isolated by user/channel and single-command overrides do not change preferences', async t => {
  const f = await fixture(t);
  const preferences = new ProjectPreferences(f.config);
  preferences.switch('guild:channel:alice', 'api');
  assert.equal(preferences.current('guild:channel:alice').project, 'api');
  assert.equal(preferences.current('guild:channel:bob').project, 'web');
  assert.equal(preferences.current('guild:other:alice').project, 'web');
  assert.equal(preferences.current('guild:channel:alice', 'web').project, 'web');
  assert.equal(preferences.current('guild:channel:alice').project, 'api');
  assert.doesNotMatch(preferences.list('guild:channel:alice'), /web project|[A-Z]:\\|test-/);
  assert.throws(() => preferences.switch('guild:channel:alice', '../elsewhere'), /AI_PROJECT_UNAVAILABLE/);
  assert.equal(preferences.current('guild:channel:alice').project, 'api');
  assert.equal(new ProjectPreferences(f.config).current('guild:channel:alice').project, 'web');
});

test('switching projects routes workers to each directory and preserves separate provider sessions and results', async t => {
  const f = await fixture(t);
  const providers: ProviderConfig = { enabled: new Set(['codex', 'claude']), defaultProvider: 'codex', models: {} };
  const calls: AgentRunOptions[] = [];
  const sessions = new ProjectSessions({ workdir: f.web, projects: f.config, providers, sandbox: 'read-only' },
    async (_prompt, options) => {
      calls.push(options); options.onSession?.(options.sessionId ?? 'session-' + calls.length);
      return options.workdir === f.web ? 'web answer' : 'api answer';
    });
  const codex = { provider: 'codex' as const };
  const claude = { provider: 'claude' as const };
  await sessions.prompt('alice', 'web', codex);
  sessions.switchProject('alice', 'api');
  assert.match(sessions.result('alice', codex), /No saved result/);
  await sessions.prompt('alice', 'api', codex);
  sessions.switchProject('alice', 'web');
  await sessions.prompt('alice', 'web again', codex);
  await sessions.prompt('alice', 'api override', claude, 'api');
  assert.equal(sessions.currentProject('alice').project, 'web');
  assert.deepEqual(calls.map(call => call.workdir), [f.web, f.api, f.web, f.api]);
  assert.deepEqual(calls.map(call => call.sessionId), [undefined, undefined, 'session-1', undefined]);
  assert.equal(sessions.result('alice', codex), 'web answer');
  assert.equal(sessions.result('alice', claude, 'api'), 'api answer');
  assert.equal(sessions.contextState('alice', codex, 'api').sessionId, 'session-2');
  sessions.reset('alice', codex, 'web');
  assert.match(sessions.result('alice', codex), /No saved result/);
  assert.equal(sessions.result('alice', codex, 'api'), 'api answer');
  assert.match(sessions.result('bob', codex, 'api'), /No saved result/);
  assert.match(sessions.status('alice', codex, 'api'), /Project: api/);
});

test('all projects and providers share one worker and switching/resetting cannot redirect active work', async t => {
  const f = await fixture(t);
  const providers: ProviderConfig = { enabled: new Set(['codex', 'claude']), defaultProvider: 'codex', models: {} };
  let finish!: (value: string) => void;
  const sessions = new ProjectSessions({ workdir: f.web, projects: f.config, providers, sandbox: 'read-only' },
    async () => new Promise<string>(resolve => { finish = resolve; }));
  const codex = { provider: 'codex' as const };
  const running = sessions.prompt('alice', 'task', codex, 'web');
  assert.equal(sessions.busy, true);
  assert.match(sessions.status('bob', codex, 'api'), /Worker: busy/);
  assert.equal(sessions.contextState('bob', codex, 'api').contextRunning, false);
  assert.throws(() => sessions.switchProject('alice', 'api'), /CODEX_BUSY/);
  assert.throws(() => sessions.reset('bob', codex, 'api'), /CODEX_BUSY/);
  await assert.rejects(sessions.prompt('bob', 'task', { provider: 'claude' }, 'api'), /CODEX_BUSY/);
  finish('done'); await running;
  assert.equal(sessions.busy, false);
  assert.equal(sessions.result('alice', codex, 'web'), 'done');
  assert.match(sessions.result('alice', codex, 'api'), /No saved result/);
  assert.match(sessions.result('alice', codex, 'api'), /project:api/);
});

test('remapping a project alias starts an independent session for its new directory', async t => {
  const f = await fixture(t);
  const directories = new Map(f.config.directories);
  const config: ProjectConfig = { ...f.config, directories };
  const sessions = new ProjectSessions({ workdir: f.web, projects: config, sandbox: 'read-only' }, async () => 'old result');
  const selection = { provider: 'codex' as const };
  await sessions.prompt('alice', 'task', selection, 'web');
  directories.set('web', f.api);
  assert.match(sessions.result('alice', selection, 'web'), /No saved result/);
});
