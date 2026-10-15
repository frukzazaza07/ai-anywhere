import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCodex } from '../src/runner.js';
import { executeCli } from '../src/agent-runner.js';
import { codexActivity, commandActivity, geminiActivity } from '../src/activity.js';
import { CodexSessions } from '../src/sessions.js';
import { taskErrorMessage } from '../src/results.js';

test('Codex output floods stop the worker, clean temporary output and preserve the last successful session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-output-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'flood.mjs');
  const log = join(directory, 'output-path.txt');
  const id = '12345678-1234-1234-1234-123456789abc';
  await writeFile(script, `import { writeFileSync } from 'node:fs';
    let prompt = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => prompt += chunk);
    process.stdin.on('end', () => {
      const output = process.argv[process.argv.indexOf('--output-last-message') + 1];
      writeFileSync(${JSON.stringify(log)}, output);
      writeFileSync(output, prompt === 'answer' ? 'x'.repeat(1_000_001) : 'small final answer');
      process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: prompt === 'success'
        ? '${id}' : '87654321-4321-4321-4321-cba987654321' }) + '\\n');
      if (prompt === 'success' || prompt === 'answer') return;
      const flood = prompt === 'events' ? (JSON.stringify({ type: 'item.completed', text: 'x'.repeat(2100) }) + '\\n').repeat(1000)
        : prompt === 'event' ? JSON.stringify({ type: 'item.completed', text: 'x'.repeat(2_000_100) }) + '\\n'
        : 'x'.repeat(2_000_100);
      process.stdout.write(flood);
      setInterval(() => {}, 1000);
    });`);
  const sessions = new CodexSessions({ workdir: directory, sandbox: 'read-only', cliScript: script, timeoutMs: 5000 });
  await sessions.prompt('owner', 'success');
  for (const mode of ['no-newline', 'event', 'events', 'answer']) {
    await assert.rejects(sessions.prompt('owner', mode), { message: 'AI_OUTPUT_LIMIT' });
    assert.equal(sessions.busy, false);
    assert.equal(sessions.contextState('owner').sessionId, id);
    assert.match(sessions.status('owner'), /Completed turns: 1/);
    assert.equal(sessions.result('owner'), 'Codex response exceeded the output limit.');
    const output = await readFile(log, 'utf8');
    await assert.rejects(stat(dirname(output)), { code: 'ENOENT' });
  }
  assert.equal(taskErrorMessage(new Error('AI_OUTPUT_LIMIT')), 'Codex response exceeded the output limit.');
  assert.equal(await sessions.prompt('owner', 'success'), 'small final answer');
});

test('fresh and resumed Codex tasks use the selected plain folder with spaces and Unicode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-directory-test-'));
  const workdir = join(dir, 'plain folder ไทย');
  const id = '12345678-1234-1234-1234-123456789abc';
  try {
    await mkdir(workdir);
    const script = join(dir, 'cwd.mjs');
    await writeFile(script, `import { writeFileSync, existsSync } from 'node:fs';
      if (existsSync('.git') || !process.argv.includes('--skip-git-repo-check')) process.exit(2);
      let text = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => text += chunk);
      process.stdin.on('end', () => {
        const output = process.argv[process.argv.indexOf('--output-last-message') + 1];
        writeFileSync(output, JSON.stringify({ cwd: process.cwd(), text }));
      });`);
    for (const sessionId of [undefined, id]) {
      const answer = JSON.parse(await runCodex('inspect folder', { workdir,
        sandbox: 'read-only', cliScript: script, sessionId, timeoutMs: 5000 }));
      assert.equal(answer.cwd, workdir);
      assert.equal(answer.text, 'inspect folder');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stdin preserves Thai and shell metacharacters, while Discord secrets stay outside the worker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-runner-test-'));
  const script = join(dir, 'mock.mjs');
  const oldToken = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = 'test-secret';
  try {
    await writeFile(script, `import { writeFileSync } from 'node:fs';
      let text = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => text += chunk);
      process.stdin.on('end', () => {
        const output = process.argv[process.argv.indexOf('--output-last-message') + 1];
        writeFileSync(output, JSON.stringify({ text, leaked: Boolean(process.env.DISCORD_TOKEN), args: process.argv.slice(2) }));
      });`);
    const prompt = 'ช่วยดูบั๊ก "quotes" $(echo bad) & `test`\nsecond line';
    const result = JSON.parse(await runCodex(prompt, { workdir: dir, sandbox: 'read-only', timeoutMs: 5000, cliScript: script, model: 'test-model', effort: 'high' }));
    assert.equal(result.text, prompt);
    assert.equal(result.leaked, false);
    assert.equal(result.args[result.args.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(result.args[result.args.indexOf('--model') + 1], 'test-model');
    assert.equal(result.args[result.args.indexOf('--config') + 1], 'model_reasoning_effort="high"');
  } finally {
    if (oldToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = oldToken;
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-zero CLI exit is reported as failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-failure-test-'));
  try {
    const script = join(dir, 'fail.mjs');
    await writeFile(script, 'process.stderr.write("not authenticated"); process.exit(2);');
    await assert.rejects(runCodex('hello', { workdir: dir, sandbox: 'read-only', timeoutMs: 5000, cliScript: script }), /code 2/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('timeout terminates a stalled CLI task', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-timeout-test-'));
  try {
    const script = join(dir, 'stall.mjs');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    await assert.rejects(runCodex('hello', { workdir: dir, sandbox: 'read-only', timeoutMs: 200, cliScript: script }), /CODEX_TIMEOUT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('aborting terminates a stalled CLI task without a deadline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-stop-test-'));
  try {
    const script = join(dir, 'stall.mjs');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const running = runCodex('hello', { workdir: dir, sandbox: 'read-only', cliScript: script, signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(running, /AI_CANCELLED/);
    await assert.rejects(runCodex('hello', { workdir: dir, sandbox: 'read-only', cliScript: script, signal: AbortSignal.abort() }), /AI_CANCELLED/);
    await assert.rejects(executeCli(process.execPath, [script], {}, '', { workdir: dir, sandbox: 'read-only', signal: AbortSignal.abort() }), /AI_CANCELLED/);
    const agent = new AbortController();
    const cli = executeCli(process.execPath, [script], { ...process.env }, '', { workdir: dir, sandbox: 'read-only', signal: agent.signal });
    setTimeout(() => agent.abort(), 200);
    await assert.rejects(cli, /AI_CANCELLED/);
    assert.match(taskErrorMessage(new Error('AI_CANCELLED'), 'claude'), /Claude.*stopped.*not reverted/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('stopping terminates the whole CLI process tree before the worker is released', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-tree-test-'));
  try {
    const pidFile = join(dir, 'grandchild.pid');
    const script = join(dir, 'tree.mjs');
    // The fake CLI starts a long-lived child of its own, like a test runner or build tool.
    await writeFile(script, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'writeFileSync(' + JSON.stringify(pidFile) + ', String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    for (const run of [
      (signal: AbortSignal) => runCodex('hello', { workdir: dir, sandbox: 'read-only', cliScript: script, signal }),
      (signal: AbortSignal) => executeCli(process.execPath, [script], { ...process.env }, '', { workdir: dir, sandbox: 'read-only', signal }),
    ]) {
      await rm(pidFile, { force: true });
      const controller = new AbortController();
      const running = run(controller.signal);
      let grandchild = 0;
      for (let index = 0; index < 200 && !grandchild; index++) {
        await new Promise(resolve => setTimeout(resolve, 25));
        grandchild = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
      }
      assert.ok(grandchild > 0 && alive(grandchild));
      controller.abort();
      await assert.rejects(running, /AI_CANCELLED/);
      // No orphaned or zombie descendant remains once the task has settled.
      assert.equal(alive(grandchild), false);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Codex JSON events become fixed activity labels without exposing commands or text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-progress-test-'));
  try {
    const script = join(dir, 'events.mjs');
    await writeFile(script, [
      "import { writeFileSync } from 'node:fs';",
      "const out = process.argv[process.argv.indexOf('--output-last-message') + 1];",
      "for (const event of [{ type: 'turn.started' }, { type: 'item.started', item: { type: 'command_execution', command: 'npm test -- --token=SECRET' } },",
      "  { type: 'item.started', item: { type: 'file_change', changes: [{ path: 'private.txt' }] } }]) console.log(JSON.stringify(event));",
      "console.log('plain text');",
      "writeFileSync(out, 'done');",
    ].join('\n'));
    const reports: Array<string | undefined> = [];
    assert.equal(await runCodex('hello', { workdir: dir, sandbox: 'read-only', cliScript: script, onProgress: activity => reports.push(activity) }), 'done');
    assert.deepEqual(reports, ['Started working', 'Running tests', 'Editing files', undefined]);
    assert.doesNotMatch(JSON.stringify(reports), /SECRET|private|npm/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('activity labels map provider events and command kinds', () => {
  assert.equal(commandActivity('bash -lc "rg TODO src"'), 'Reading files');
  assert.equal(commandActivity('pytest -q'), 'Running tests');
  assert.equal(commandActivity('npm run build'), 'Building or checking the project');
  assert.equal(commandActivity('git status --short'), 'Checking Git');
  assert.equal(commandActivity('npm ci'), 'Installing dependencies');
  assert.equal(commandActivity('python script.py'), 'Running a command');
  assert.equal(codexActivity({ type: 'item.started', item: { type: 'reasoning' } }), 'Thinking');
  assert.equal(codexActivity({ type: 'item.completed', item: { type: 'reasoning' } }), undefined);
  assert.equal(codexActivity({ type: 'thread.started' }), undefined);
  assert.equal(codexActivity('not an object'), undefined);
  assert.equal(geminiActivity({ type: 'tool_use', tool_name: 'read_file', parameters: { path: 'x' } }), 'Reading files');
  assert.equal(geminiActivity({ type: 'tool_use', tool_name: 'write_file' }), 'Editing files');
  assert.equal(geminiActivity({ type: 'tool_use', tool_name: 'custom' }), 'Using a tool');
  assert.equal(geminiActivity({ type: 'message', role: 'assistant', content: 'hi' }), 'Writing a response');
  assert.equal(geminiActivity({ type: 'result' }), undefined);
});

test('JSON session events enable explicit resume while preserving sandbox and stdin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-session-test-'));
  const id = '12345678-1234-1234-1234-123456789abc';
  try {
    const script = join(dir, 'session.mjs');
    await writeFile(script, `import { writeFileSync } from 'node:fs';
      let text = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => text += chunk);
      process.stdin.on('end', () => {
        process.stdout.write('not a JSON event\\n');
        const event = JSON.stringify({ type: 'thread.started', thread_id: '${id}' }) + '\\n';
        process.stdout.write(event.slice(0, 20));
        process.stdout.write(event.slice(20));
        process.stdout.write(JSON.stringify({ type: 'item.completed', item: { text: 'private event' } }) + '\\n');
        const output = process.argv[process.argv.indexOf('--output-last-message') + 1];
        writeFileSync(output, JSON.stringify({ text, args: process.argv.slice(2) }));
      });`);
    let sessionId: string | undefined;
    const initial = JSON.parse(await runCodex('first', {
      workdir: dir, sandbox: 'read-only', timeoutMs: 5000, cliScript: script,
      onSession: session => { sessionId = session; },
    }));
    assert.equal(sessionId, id);
    assert.ok(initial.args.includes('--json'));
    assert.ok(initial.args.includes('--skip-git-repo-check'));
    assert.ok(!initial.args.includes('resume'));
    const resumed = JSON.parse(await runCodex('ต่อจากเดิม $ &', {
      workdir: dir, sandbox: 'workspace-write', timeoutMs: 5000, cliScript: script, sessionId,
    }));
    assert.equal(resumed.text, 'ต่อจากเดิม $ &');
    assert.deepEqual(resumed.args.slice(-3), ['resume', id, '-']);
    assert.equal(resumed.args[resumed.args.indexOf('--sandbox') + 1], 'workspace-write');
    assert.ok(resumed.args.includes('--skip-git-repo-check'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('omitted and zero deadlines allow a delayed CLI task to complete normally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-no-timeout-test-'));
  try {
    const script = join(dir, 'delayed.mjs');
    await writeFile(script, `import { writeFileSync } from 'node:fs';
      process.stdin.resume();
      process.stdin.on('end', () => setTimeout(() => {
        const output = process.argv[process.argv.indexOf('--output-last-message') + 1];
        writeFileSync(output, 'finished without a deadline');
      }, 250));`);
    for (const timeoutMs of [undefined, 0]) {
      assert.equal(await runCodex('hello', {
        workdir: dir, sandbox: 'read-only', cliScript: script, timeoutMs,
      }), 'finished without a deadline');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
