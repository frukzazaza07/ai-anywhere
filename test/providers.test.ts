import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerConfig } from '../src/config.js';
import { selectProvider, type ProviderConfig, type ProviderId } from '../src/providers.js';
import { runAgent } from '../src/agent-runner.js';
import { AiSessions } from '../src/sessions.js';
import { taskErrorMessage, taskReply } from '../src/results.js';

const id = '12345678-1234-1234-1234-123456789abc';

async function fixture(t: TestContext, version = '0.63.0') {
  const directory = await mkdtemp(join(tmpdir(), 'ai-provider-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'mock.mjs');
  const oldSystem = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = join(directory, 'system.json');
  t.after(() => {
    if (oldSystem === undefined) delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    else process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = oldSystem;
  });
  const write = (body: string) => writeFile(script, `if (process.argv.includes('--version')) { process.stdout.write('${version}'); process.exit(0); }\n` + body);
  await write(`import { readFileSync } from 'node:fs';
    let text = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => text += chunk);
    process.stdin.on('end', () => {
      const args = process.argv.slice(2);
      const claude = args.includes('--print');
      const settingsPath = claude ? undefined : process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : undefined;
      const answer = JSON.stringify({ text, cwd: process.cwd(), args, settings, settingsPath,
        defaultsPath: process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH,
        leaked: Object.keys(process.env).some(key => key.toUpperCase().startsWith('DISCORD_') || key.toUpperCase() === 'ALLOWED_USER_IDS') });
      const session = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : '${id}';
      if (claude) process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
        result: answer, session_id: session, permission_denials: [] }));
      else {
        for (const event of [{ type: 'init', session_id: session },
          { type: 'message', role: 'user', content: 'do not return user content' },
          { type: 'message', role: 'assistant', content: answer.slice(0, 20), delta: true },
          { type: 'message', role: 'assistant', content: answer.slice(20), delta: true },
          { type: 'result', status: 'success' }]) process.stdout.write(JSON.stringify(event) + '\\n');
      }
    });`);
  return { directory, script, write };
}

test('provider configuration defaults to Codex and validates enabled providers, models and script paths', async t => {
  const f = await fixture(t);
  const defaults = providerConfig({});
  assert.deepEqual([...defaults.enabled], ['codex']);
  assert.deepEqual(selectProvider(defaults), { provider: 'codex', model: undefined });
  const config = providerConfig({ AI_PROVIDERS: 'codex, claude,gemini', AI_DEFAULT_PROVIDER: 'claude',
    CLAUDE_MODEL: 'sonnet', GEMINI_CLI_SCRIPT: f.script });
  assert.deepEqual(selectProvider(config), { provider: 'claude', model: 'sonnet' });
  assert.equal(selectProvider(config, 'gemini').provider, 'gemini');
  for (const env of [{ AI_PROVIDERS: 'other' }, { AI_PROVIDERS: '' },
    { AI_DEFAULT_PROVIDER: 'claude' }, { CODEX_MODEL: '--bad' }, { CLAUDE_MODEL: 'two words' },
    { AI_PROVIDERS: 'codex,gemini' }, { AI_PROVIDERS: 'codex,gemini', GEMINI_CLI_SCRIPT: 'gemini.cmd' },
    { AI_PROVIDERS: 'codex,claude', CLAUDE_EXECUTABLE: 'claude.cmd' }]) {
    assert.throws(() => providerConfig(env));
  }
  assert.throws(() => selectProvider(defaults, 'claude'), /AI_PROVIDER_DISABLED/);
  assert.throws(() => selectProvider(defaults, 'unknown'), /AI_PROVIDER_DISABLED/);
});

for (const provider of ['claude', 'gemini'] as const) {
  test(provider + ' sends stdin intact, filters credentials and resumes explicit sessions with the configured model', async t => {
    const f = await fixture(t, provider === 'claude' ? '2.1.248' : '0.63.0');
    const old = process.env.DISCORD_TOKEN;
    process.env.DISCORD_TOKEN = 'test-secret';
    t.after(() => { if (old === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = old; });
    const prompt = 'ช่วยดู "quotes" $(bad) & `test`\nsecond line';
    let session: string | undefined;
    const options = { provider, workdir: f.directory, sandbox: 'read-only' as const,
      timeoutMs: 5000, cliScript: f.script, model: 'test-model', onSession: (value: string) => { session = value; } };
    const answer = JSON.parse(await runAgent(prompt, options));
    assert.equal(answer.text, prompt);
    assert.equal(answer.cwd, f.directory);
    assert.equal(answer.leaked, false);
    assert.ok(!answer.args.includes(prompt));
    assert.equal(answer.args[answer.args.indexOf('--model') + 1], 'test-model');
    assert.ok(!answer.args.includes('--resume'));
    assert.equal(session, id);
    const resumed = JSON.parse(await runAgent('follow up', { ...options, sessionId: session }));
    assert.equal(resumed.args[resumed.args.indexOf('--resume') + 1], id);
    assert.ok(!resumed.args.includes('latest') && !resumed.args.includes('--continue'));
    if (provider === 'claude') {
      assert.ok(answer.args.includes('--restricted'));
      assert.equal(answer.args[answer.args.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.equal(answer.args[answer.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
      assert.ok(!answer.args.includes('--dangerously-skip-permissions'));
    } else {
      assert.equal(answer.args[answer.args.indexOf('--approval-mode') + 1], 'plan');
      assert.ok(!answer.settings.tools.core.includes('write_file'));
      assert.ok(!answer.settings.tools.core.includes('run_shell_command'));
      assert.equal(answer.settings.hooksConfig.enabled, false);
      assert.equal(answer.settings.admin.mcp.enabled, false);
      assert.equal(answer.settings.admin.extensions.enabled, false);
      assert.equal(answer.settings.advanced.ignoreLocalEnv, true);
      assert.equal(answer.defaultsPath, join(f.directory, 'system-defaults.json'));
      await assert.rejects(stat(answer.settingsPath), { code: 'ENOENT' });
    }
  });

  test(provider + ' workspace-write enables file editing while excluding shell tools', async t => {
    const f = await fixture(t, provider === 'claude' ? '2.1.248' : '0.63.0');
    const answer = JSON.parse(await runAgent('edit', { provider, workdir: f.directory,
      sandbox: 'workspace-write', cliScript: f.script, timeoutMs: 5000 }));
    if (provider === 'claude') {
      assert.equal(answer.args[answer.args.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write');
      assert.ok(!answer.args.includes('bypassPermissions'));
    } else {
      assert.equal(answer.args[answer.args.indexOf('--approval-mode') + 1], 'auto_edit');
      assert.ok(answer.settings.tools.core.includes('write_file'));
      assert.ok(!answer.settings.tools.core.includes('run_shell_command'));
      assert.ok(!answer.args.includes('yolo'));
    }
  });

  test(provider + ' rejects malformed output, failed results, invalid sessions and nonzero exits without committing a session', async t => {
    const f = await fixture(t, provider === 'claude' ? '2.1.248' : '0.63.0');
    const invalid = provider === 'claude'
      ? [JSON.stringify({ type: 'result', subtype: 'error', result: 'private diagnostics', session_id: id }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'answer', session_id: 'latest' }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'answer', session_id: id, permission_denials: [{}] })]
      : [JSON.stringify({ type: 'init', session_id: id }),
        JSON.stringify({ type: 'init', session_id: id }) + '\n' + JSON.stringify({ type: 'result', status: 'error' }),
        JSON.stringify({ type: 'init', session_id: 'latest' }) + '\n' + JSON.stringify({ type: 'result', status: 'success' })];
    let captured = 0;
    for (const output of ['not json', ...invalid]) {
      await f.write( 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(' + JSON.stringify(output) + '));');
      await assert.rejects(runAgent('task', { provider, workdir: f.directory, sandbox: 'read-only',
        cliScript: f.script, timeoutMs: 5000, onSession: () => { captured++; } }));
    }
    await f.write( 'process.stderr.write("private diagnostics"); process.exit(2);');
    await assert.rejects(runAgent('task', { provider, workdir: f.directory, sandbox: 'read-only',
      cliScript: f.script, timeoutMs: 5000 }), /AI_TASK_FAILED/);
    assert.equal(captured, 0);
    assert.doesNotMatch(taskErrorMessage(new Error('private diagnostics'), provider), /private diagnostics/);
  });

  test(provider + ' terminates stalled and oversized CLI output', async t => {
    const f = await fixture(t, provider === 'claude' ? '2.1.248' : '0.63.0');
    const options = { provider, workdir: f.directory, sandbox: 'read-only' as const, cliScript: f.script };
    await f.write( 'setInterval(() => {}, 1000);');
    await assert.rejects(runAgent('task', { ...options, timeoutMs: 200 }), /AI_TIMEOUT/);
    await f.write( 'process.stdout.write("x".repeat(2100000)); setInterval(() => {}, 1000);');
    await assert.rejects(runAgent('task', { ...options, timeoutMs: 5000 }), /AI_OUTPUT_LIMIT/);
  });
}

test('Gemini preserves restrictive system policy and rejects settings it cannot safely read', async t => {
  const f = await fixture(t);
  const path = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH!;
  await writeFile(path, JSON.stringify({ security: { disableYoloMode: true },
    tools: { core: ['read_file'], exclude: ['read_many_files'] } }));
  const options = { provider: 'gemini' as const, workdir: f.directory, sandbox: 'read-only' as const,
    cliScript: f.script, timeoutMs: 5000 };
  const answer = JSON.parse(await runAgent('task', options));
  assert.deepEqual(answer.settings.tools.core, ['read_file']);
  assert.deepEqual(answer.settings.tools.exclude, ['read_many_files']);
  assert.equal(answer.settings.security.disableYoloMode, true);
  await writeFile(path, '{bad JSON');
  await assert.rejects(runAgent('task', options), /AI_GEMINI_SETTINGS/);
});

test('unavailable executables and invalid selections fail without launching another provider', async t => {
  const f = await fixture(t);
  const options = { workdir: f.directory, sandbox: 'read-only' as const };
  await assert.rejects(runAgent('task', { ...options, provider: 'claude',
    claudeExecutable: join(f.directory, 'missing.exe') }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(runAgent('task', { ...options, provider: 'gemini' }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(runAgent('task', { ...options, sessionId: 'latest' }), /AI_INVALID_SESSION/);
  await assert.rejects(runAgent('task', { ...options, model: '--bad' }), /AI_INVALID_SELECTION/);
});

test('unsupported CLI versions fail before receiving a prompt', async t => {
  for (const [provider, version] of [['gemini', '0.62.0'], ['gemini', '0.63.0-preview.1'],
    ['claude', '2.1.247']] as const) {
    await t.test(provider + ' ' + version, async child => {
      const f = await fixture(child, version);
      await f.write('process.stderr.write("should not receive a prompt"); process.exit(2);');
      await assert.rejects(runAgent('task', { provider, workdir: f.directory,
        sandbox: 'read-only', cliScript: f.script, timeoutMs: 5000 }), /AI_CLI_VERSION/);
    });
  }
});

test('provider sessions, saved results, resets and model changes remain isolated', async () => {
  const config: ProviderConfig = { enabled: new Set(['codex', 'claude', 'gemini']), defaultProvider: 'codex', models: {} };
  const calls: Array<{ provider?: ProviderId; sessionId?: string; model?: string }> = [];
  const sessions = new AiSessions({ workdir: 'C:/projects/example', sandbox: 'read-only', providers: config },
    async (_prompt, options) => {
      calls.push(options);
      options.onSession?.(options.sessionId ?? 'session-' + calls.length);
      return options.provider + ' answer';
    });
  await sessions.prompt('alice', 'first');
  await sessions.prompt('alice', 'first', { provider: 'claude' });
  await sessions.prompt('alice', 'followup', { provider: 'claude' });
  await sessions.prompt('bob', 'first', { provider: 'claude' });
  await sessions.prompt('alice:other-channel', 'first', { provider: 'claude' });
  assert.deepEqual(calls.map(call => call.sessionId), [undefined, undefined, 'session-2', undefined, undefined]);
  assert.equal(sessions.result('alice'), 'codex answer');
  assert.equal(sessions.result('alice', { provider: 'claude' }), 'claude answer');
  sessions.reset('alice', { provider: 'claude' });
  assert.match(sessions.result('alice', { provider: 'claude' }), /No saved result/);
  assert.equal(sessions.result('alice'), 'codex answer');
  assert.equal(sessions.contextState('bob', { provider: 'claude' }).sessionId, 'session-4');
  config.models.codex = 'another-model';
  assert.match(sessions.result('alice'), /No saved result/);
  await sessions.prompt('alice', 'model changed');
  assert.equal(calls.at(-1)?.sessionId, undefined);
  assert.equal(calls.at(-1)?.model, 'another-model');
  assert.throws(() => sessions.result('alice', { provider: 'codex', model: 'old-model' }), /AI_INVALID_SELECTION/);
  assert.match(sessions.status('bob', { provider: 'claude' }), /quota and context usage: unavailable/);
  assert.doesNotMatch(sessions.status('bob', { provider: 'claude' }), /C:\/projects/);
});

test('all providers share the busy guard and failed turns preserve the last successful session', async () => {
  const config: ProviderConfig = { enabled: new Set(['codex', 'claude']), defaultProvider: 'claude', models: {} };
  let finish!: (value: string) => void;
  let fail = false;
  const sessions = new AiSessions({ workdir: 'C:/projects/example', sandbox: 'read-only', providers: config },
    async (_prompt, options) => {
      options.onSession?.(fail ? 'bad-session' : 'good-session');
      if (fail) throw new Error('AI_TASK_FAILED');
      return new Promise<string>(resolve => { finish = resolve; });
    });
  const running = sessions.prompt('alice', 'task');
  assert.match(sessions.result('alice'), /Claude Code is still running/);
  assert.match(sessions.result('alice', { provider: 'codex' }), /No saved result/);
  await assert.rejects(sessions.prompt('bob', 'task', { provider: 'codex' }), /CODEX_BUSY/);
  assert.throws(() => sessions.reset('alice', { provider: 'codex' }), /CODEX_BUSY/);
  finish('answer'); await running;
  fail = true;
  await assert.rejects(sessions.prompt('alice', 'fails'), /AI_TASK_FAILED/);
  assert.equal(sessions.busy, false);
  assert.equal(sessions.contextState('alice').sessionId, 'good-session');
  const reply = taskReply(sessions.result('alice'));
  assert.match(reply.content, /Claude Code task failed/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
