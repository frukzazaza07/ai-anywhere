import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import { workerEnvironment } from './runner.js';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'changed';
  added: number;
  removed: number;
  binary?: boolean;
  hidden?: boolean;
}
export type JobChanges = { available: false; reason: string }
  | { available: true; files: ChangedFile[]; diff: string; truncated: boolean };
export interface ChangeTracker { finish(): Promise<JobChanges> }

const maxStoredDiff = 1_000_000;
const maxGitOutput = 4_000_000;
const gitTimeoutMs = 60_000;

/** Files whose names suggest credentials: their diff bodies are never stored or shown. */
const sensitiveName = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|ppk)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials(\.[^/]*)?|secrets?\.[^/]*)$/i;
const secretPatterns = [
  /(key|secret|token|passw(or)?d|pwd|credential|auth)[\w-]*["']?\s*[:=]\s*["'`][^"'`\s]{8,}/i,
  /^\s*(export\s+)?[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*\S{4,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, /\b[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/,
];

export function isSensitivePath(path: string): boolean { return sensitiveName.test(path.replace(/^"|"$/g, '')); }
export function hasSecret(text: string): boolean { return secretPatterns.some(pattern => pattern.test(text)); }

/** Hide likely secrets: whole bodies of sensitive files and individual matching lines. */
export function redactDiff(diff: string): string {
  const output: string[] = [];
  let hidden = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const path = / b\/(.+)$/.exec(line)?.[1] ?? line;
      hidden = isSensitivePath(path);
      output.push(line);
      if (hidden) output.push('[diff hidden: the file name suggests it contains secrets]');
      continue;
    }
    if (hidden) continue;
    const marker = /^[+\- ]/.test(line) && !/^(\+\+\+|---) /.test(line) ? line.charAt(0) : '';
    output.push(hasSecret(line.slice(marker.length)) ? marker + '[line redacted: possible secret]' : line);
  }
  return output.join('\n');
}

interface GitResult { code: number | null; stdout: string; truncated: boolean }

function git(args: string[], cwd: string, env: NodeJS.ProcessEnv, limit = maxGitOutput): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    // Repository hooks/fsmonitor helpers are disabled; these commands never touch the working tree.
    const child = spawn('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'core.safecrlf=false', ...args],
      { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, gitTimeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      if (bytes + chunk.length > limit) {
        chunks.push(chunk.subarray(0, limit - bytes));
        truncated = true;
        child.kill();
      } else { chunks.push(chunk); bytes += chunk.length; }
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('GIT_UNAVAILABLE')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('GIT_TIMEOUT'));
      else resolvePromise({ code, stdout: Buffer.concat(chunks).toString('utf8'), truncated });
    });
  });
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = workerEnvironment();
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}

function unavailable(reason: string): ChangeTracker {
  return { finish: async () => ({ available: false, reason }) };
}

/** Capture the project's Git state into a private temporary index and object store. */
async function snapshot(workdir: string, env: NodeJS.ProcessEnv, index: string): Promise<string> {
  const added = await git(['add', '--all', '--ignore-errors', '--', '.'], workdir, env);
  // A copied index can reference repository-local split-index files; rebuild privately instead.
  if (added.code !== 0) {
    await rm(index, { force: true });
    await git(['add', '--all', '--ignore-errors', '--', '.'], workdir, env);
  }
  const tree = await git(['write-tree'], workdir, env);
  const hash = tree.stdout.trim();
  if (tree.code !== 0 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(hash)) throw new Error('GIT_SNAPSHOT');
  return hash;
}

function parseChanges(nameStatus: string, numstat: string): ChangedFile[] {
  const counts = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, removed, ...path] = line.split('\t');
    counts.set(path.join('\t'), { added: Number(added) || 0, removed: Number(removed) || 0, binary: added === '-' });
  }
  return nameStatus.split('\n').filter(Boolean).map(line => {
    const [code, ...rest] = line.split('\t');
    const path = rest.join('\t');
    const count = counts.get(path) ?? { added: 0, removed: 0, binary: false };
    const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === 'M' ? 'modified' : 'changed';
    return { path, status, added: count.added, removed: count.removed,
      ...(count.binary ? { binary: true } : {}), ...(isSensitivePath(path) ? { hidden: true } : {}) };
  });
}

/**
 * Record the project state before a job, then diff it against the state after the job.
 * Changes made before the job (or by earlier jobs) are part of the starting snapshot and are excluded.
 * Read-only for the project: no reset, checkout, commit, index or working tree writes.
 */
export async function trackChanges(workdir: string): Promise<ChangeTracker> {
  const env = gitEnvironment();
  let info: GitResult;
  try { info = await git(['rev-parse', '--is-inside-work-tree', '--git-path', 'index', '--git-path', 'objects'], workdir, env); }
  catch { return unavailable('Git is unavailable on the bot host.'); }
  const [inside, index, objects] = info.stdout.split(/\r?\n/);
  if (info.code !== 0 || inside !== 'true' || !index || !objects) return unavailable('The project is not a Git repository.');
  const temporary = await mkdtemp(join(tmpdir(), 'ai-changes-'));
  const privateIndex = join(temporary, 'index');
  const snapshotEnv = { ...env, GIT_INDEX_FILE: privateIndex, GIT_OBJECT_DIRECTORY: join(temporary, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: resolve(workdir, objects) };
  let before: string;
  try {
    await mkdir(join(temporary, 'objects'));
    // Reuse cached file hashes; unchanged files are not re-read.
    await copyFile(resolve(workdir, index), privateIndex).catch(() => {});
    before = await snapshot(workdir, snapshotEnv, privateIndex);
  } catch {
    await rm(temporary, { recursive: true, force: true });
    return unavailable('Unable to record the starting Git state.');
  }
  return {
    finish: async () => {
      try {
        const after = await snapshot(workdir, snapshotEnv, privateIndex);
        const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative'];
        const names = await git([...common, '--name-status', before, after, '--', '.'], workdir, snapshotEnv);
        const stats = await git([...common, '--numstat', before, after, '--', '.'], workdir, snapshotEnv);
        const patch = await git([...common, '--patch', '-U3', before, after, '--', '.'], workdir, snapshotEnv);
        if (names.code !== 0 || stats.code !== 0 || (patch.code !== 0 && !patch.truncated)) throw new Error('GIT_DIFF');
        let diff = redactDiff(patch.stdout);
        let truncated = patch.truncated;
        if (diff.length > maxStoredDiff) { diff = diff.slice(0, diff.lastIndexOf('\n', maxStoredDiff)); truncated = true; }
        return { available: true, files: parseChanges(names.stdout, stats.stdout), diff, truncated };
      } catch { return { available: false, reason: 'Unable to compare the Git state after the job.' }; }
      finally { await rm(temporary, { recursive: true, force: true }); }
    },
  };
}

const pageSize = 1400;

/** Split on line boundaries so each page fits a Discord message with its summary. */
export function diffPages(diff: string, size = pageSize): string[] {
  const pages: string[] = [];
  let current = '';
  for (const raw of diff.split('\n')) {
    const line = raw.length > size - 40 ? raw.slice(0, size - 40) + ' …[line shortened]' : raw;
    if (current && current.length + line.length + 1 > size) { pages.push(current); current = ''; }
    current += (current ? '\n' : '') + line;
  }
  if (current.trim()) pages.push(current);
  return pages;
}

function fileLine(file: ChangedFile): string {
  const code = { added: 'A', modified: 'M', deleted: 'D', changed: 'T' }[file.status];
  const counts = file.binary ? 'binary' : '+' + file.added + ' −' + file.removed;
  return code + ' ' + file.path + ' (' + counts + (file.hidden ? ', content hidden' : '') + ')';
}

/** Mobile-friendly summary plus one diff page; the full diff is attached when it does not fit. */
export function changesReply(id: string, project: string, changes: JobChanges | undefined, state: string, page = 1) {
  const reply = (content: string, files: AttachmentBuilder[] = []) => ({ content, files, allowedMentions: { parse: [] as [] } });
  if (state === 'queued' || state === 'running') return reply('Job ' + id + ' is ' + state + '. Changes are recorded when it finishes.');
  if (!changes) return reply('Job ' + id + ' has no recorded changes (it finished before change tracking was available).');
  if (!changes.available) return reply('Changes for job ' + id + ' are unavailable: ' + changes.reason);
  if (!changes.files.length) return reply('Job ' + id + ' did not change any files in project ' + project + '.');
  const added = changes.files.reduce((sum, file) => sum + file.added, 0);
  const removed = changes.files.reduce((sum, file) => sum + file.removed, 0);
  const pages = diffPages(changes.diff);
  const selected = Math.min(Math.max(1, page), Math.max(1, pages.length));
  const more = changes.files.length - 12;
  const listed = changes.files.slice(0, 12).map(fileLine);
  if (more > 0) listed.push('…and ' + more + ' more files (see attachment)');
  const header = ['Job ' + id + ' changes · project ' + project,
    changes.files.length + ' files · +' + added + ' −' + removed + (changes.truncated ? ' · diff truncated' : ''), ...listed].join('\n');
  // Prevent diff content from closing the code block early.
  const body = (pages[selected - 1] ?? '').replace(/```/g, '`​`​`');
  const footer = pages.length > 1 ? 'Page ' + selected + '/' + pages.length
    + (selected < pages.length ? ' · next: /ai changes id:' + id + ' page:' + (selected + 1) : '') : '';
  const block = '\n```diff\n' + body + '\n```' + (footer ? '\n' + footer : '');
  // Long file lists shrink first; the diff page always stays readable.
  const content = header.length + block.length > 1990 ? header.slice(0, 1990 - block.length - 2) + '…' + block : header + block;
  const attach = pages.length > 1 || more > 0 || header.length + block.length > 1990;
  return reply(content, attach ? [new AttachmentBuilder(Buffer.from(changes.files.map(fileLine).join('\n') + '\n\n' + changes.diff, 'utf8'),
    { name: 'job-' + id + '.diff' })] : []);
}
