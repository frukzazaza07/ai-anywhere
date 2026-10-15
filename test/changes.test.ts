import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changesReply, diffPages, redactDiff, trackChanges, type JobChanges } from '../src/changes.js';
import { ProjectSessions } from '../src/project-sessions.js';
import { selectCommand } from '../src/selection.js';
import { JobHistory, JobManager } from '../src/jobs.js';
import { runtimeFixture, owner } from './runtime-fixture.js';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
}

async function repository(t: TestContext, dir?: string): Promise<string> {
  const root = dir ?? await mkdtemp(join(tmpdir(), 'ai-changes-test-'));
  if (!dir) t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'core.autocrlf', 'false');
  return root;
}

async function objectFiles(dir: string): Promise<number> {
  const entries = await readdir(join(dir, '.git', 'objects'), { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile()).length;
}

async function repoState(dir: string) {
  return { index: createHash('sha256').update(await readFile(join(dir, '.git', 'index'))).digest('hex'),
    objects: await objectFiles(dir), head: git(dir, 'rev-parse', 'HEAD'), staged: git(dir, 'diff', '--cached', '--name-only') };
}

test('changes include only what the job changed, are redacted, and leave the repository untouched', async t => {
  const dir = await repository(t);
  await writeFile(join(dir, 'a.txt'), 'line 1\nline 2\n');
  await writeFile(join(dir, 'b.txt'), 'b\n');
  await writeFile(join(dir, 'c.txt'), 'c\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'initial');
  // Changes that existed before the job must not be attributed to it.
  await writeFile(join(dir, 'b.txt'), 'pre-existing edit\n');
  await writeFile(join(dir, 'pre.txt'), 'pre-existing file\n');
  const before = await repoState(dir);
  const status = git(dir, 'status', '--porcelain');

  const tracker = await trackChanges(dir);
  assert.deepEqual(await repoState(dir), before);
  assert.equal(git(dir, 'status', '--porcelain'), status);
  await writeFile(join(dir, 'a.txt'), 'line 1\nchanged by job\n');
  await writeFile(join(dir, 'new.txt'), 'new content\n');
  await unlink(join(dir, 'c.txt'));
  await writeFile(join(dir, '.env'), 'API_TOKEN=supersecretvalue\n');
  await writeFile(join(dir, 'config.js'), 'export const apiKey = "abcdefghijk123456";\nexport const name = "demo";\n');
  const changes = await tracker.finish();
  assert.deepEqual(await repoState(dir), before);

  assert.ok(changes.available);
  const files = Object.fromEntries(changes.files.map(file => [file.path, file]));
  assert.deepEqual(Object.keys(files).sort(), ['.env', 'a.txt', 'c.txt', 'config.js', 'new.txt']);
  assert.equal(files['a.txt']!.status, 'modified');
  assert.deepEqual([files['a.txt']!.added, files['a.txt']!.removed], [1, 1]);
  assert.equal(files['new.txt']!.status, 'added');
  assert.equal(files['c.txt']!.status, 'deleted');
  assert.equal(files['.env']!.hidden, true);
  assert.match(changes.diff, /\+changed by job/);
  assert.match(changes.diff, /\+export const name = "demo";/);
  assert.doesNotMatch(changes.diff, /pre-existing|supersecretvalue|abcdefghijk123456/);
  assert.match(changes.diff, /diff hidden: the file name suggests it contains secrets/);
  assert.match(changes.diff, /\+\[line redacted: possible secret\]/);

  // A later job sees only its own edits, even with earlier job changes still uncommitted.
  const second = await trackChanges(dir);
  await writeFile(join(dir, 'new.txt'), 'new content\nsecond job\n');
  const next = await second.finish();
  assert.ok(next.available);
  assert.deepEqual(next.files.map(file => file.path), ['new.txt']);
  assert.deepEqual(await repoState(dir), before);
});

test('changes are unavailable outside Git and for jobs that changed nothing', async t => {
  const plain = await mkdtemp(join(tmpdir(), 'ai-changes-plain-'));
  t.after(() => rm(plain, { recursive: true, force: true }));
  const outside = await (await trackChanges(plain)).finish();
  // A temporary directory may itself be inside a repository on some hosts.
  if (!outside.available) assert.match(outside.reason, /not a Git repository/);
  const dir = await repository(t);
  await writeFile(join(dir, 'a.txt'), 'a\n');
  const tracker = await trackChanges(dir);
  const nothing = await tracker.finish();
  assert.ok(nothing.available);
  assert.deepEqual(nothing.files, []);
  assert.match(changesReply('abcd1234', 'web', nothing, 'completed').content, /did not change any files/);
  assert.match(changesReply('abcd1234', 'web', undefined, 'running').content, /Changes are recorded when it finishes/);
  assert.match(changesReply('abcd1234', 'web', { available: false, reason: 'The project is not a Git repository.' }, 'completed').content, /unavailable: The project is not a Git repository/);
});

test('diff replies fit Discord on every page, escape code fences and attach the full diff', () => {
  const diff = ['diff --git a/big.ts b/big.ts', '@@ -1,1 +1,400 @@',
    ...Array.from({ length: 400 }, (_, index) => '+const value' + index + ' = "```" + ' + index + ';')].join('\n');
  const changes: JobChanges = { available: true, truncated: false, diff,
    files: Array.from({ length: 20 }, (_, index) => ({ path: 'src/file-' + index + '.ts', status: 'modified' as const, added: 20, removed: 0 })) };
  const pages = diffPages(diff);
  assert.ok(pages.length > 5);
  for (let page = 1; page <= pages.length; page++) {
    const reply = changesReply('abcd1234', 'web', changes, 'completed', page);
    assert.ok(reply.content.length <= 2000, 'page ' + page + ' is ' + reply.content.length);
    assert.equal((reply.content.match(/```/g) ?? []).length, 2);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
  }
  const first = changesReply('abcd1234', 'web', changes, 'completed');
  assert.match(first.content, /20 files · \+400 −0/);
  assert.match(first.content, /…and 8 more files/);
  assert.match(first.content, /Page 1\/\d+ · next: \/ai changes id:abcd1234 page:2/);
  assert.equal(first.files[0]?.name, 'job-abcd1234.diff');
  assert.match(changesReply('abcd1234', 'web', changes, 'completed', 999).content, new RegExp('Page ' + pages.length + '/' + pages.length));
  assert.equal(redactDiff('+password = "hunter2hunter2"\n context'), '+[line redacted: possible secret]\n context');
});

test('jobs record per-job changes, and read-only jobs report that nothing could change', async t => {
  const f = await runtimeFixture(t);
  await repository(t, f.directory);
  git(f.directory, 'add', '.');
  git(f.directory, 'commit', '-qm', 'initial');
  const historyDir = await mkdtemp(join(tmpdir(), 'ai-job-history-'));
  t.after(() => rm(historyDir, { recursive: true, force: true }));
  const sessions = new ProjectSessions({ runtime: f.runtime, workdir: f.directory, projects: f.runtime.value.projects,
    sandbox: 'workspace-write' }, async (_prompt, options) => {
    await writeFile(join(options.workdir, 'from-job.txt'), 'hello\n');
    return 'wrote a file';
  });
  const selection = selectCommand(f.runtime.value, 'codex', null, 'm2');
  const me = { guildId: owner.guildId, userId: owner.userId };
  const manager = new JobManager({ history: new JobHistory(historyDir), sessions, sandbox: 'workspace-write' });
  const job = manager.submit({ owner, prompt: 'write', selection, project: 'web' });
  await job.result;
  const details = await manager.details(me, job.job.id);
  assert.ok(details.job?.changes?.available);
  assert.deepEqual(details.job.changes.files.map(file => file.path), ['from-job.txt']);
  assert.match(details.text, /Changed files: 1 · \/ai changes id:/);
  assert.match(manager.outcomeLine(job.job.id), /Changed 1 files/);
  const reply = changesReply(job.job.id, details.job.project, details.job.changes, details.job.state);
  assert.match(reply.content, /A from-job.txt \(\+1 −0\)/);
  assert.match(reply.content, /```diff\n[\s\S]*\+hello/);

  const readOnly = new JobManager({ history: new JobHistory(historyDir), sessions, sandbox: 'read-only' });
  const second = readOnly.submit({ owner, prompt: 'look', selection, project: 'web' });
  await second.result;
  const recorded = await readOnly.details(me, second.job.id);
  assert.equal(recorded.job?.changes?.available, false);
});
