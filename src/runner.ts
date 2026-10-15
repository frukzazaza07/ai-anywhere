import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { validateEffort, type Effort } from './effort.js';
import { codexActivity } from './activity.js';

const maxOutputBytes = 2_000_000;

export interface RunOptions {
  workdir: string;
  sandbox: 'read-only' | 'workspace-write';
  // Omitted or zero means no task deadline.
  timeoutMs?: number;
  sessionId?: string;
  model?: string;
  effort?: Effort;
  onSession?: (sessionId: string, contextWindows?: Record<string, number>) => void;
  // Aborting terminates the worker process tree; completed file edits are not reverted.
  signal?: AbortSignal;
  // Called on CLI output with a fixed activity label when one is recognized; never raw output.
  onProgress?: (activity?: string) => void;
  // Override only in local tests; never expose this setting through chat.
  cliScript?: string;
}

export function codexScript(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@openai/codex/package.json')), 'bin', 'codex.js');
}

export function workerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The worker does not need the Discord credentials.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('DISCORD_') || ['ALLOWED_USER_IDS', 'ADMIN_USER_IDS'].includes(key.toUpperCase())) delete env[key];
  }
  return env;
}

/** Kill the worker process tree; resolves after the kill completed (and, on POSIX, the group is gone). */
export function terminateWorker(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        shell: false, windowsHide: true, stdio: 'ignore',
      });
      killer.on('error', () => { child.kill(); resolve(); });
      killer.on('close', code => { if (code !== 0) child.kill(); resolve(); });
    });
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  return processGroupExited(pid);
}

async function processGroupExited(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Signal 0 only checks whether any process in the group remains.
    try { process.kill(-pid, 0); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function runCodex(prompt: string, options: RunOptions): Promise<string> {
  validateEffort('codex', options.model, options.effort);
  if (!prompt.trim() || prompt.length > 4000) throw new Error('Prompt must contain 1–4000 characters');
  if (options.signal?.aborted) throw new Error('AI_CANCELLED');
  const temporary = await mkdtemp(join(tmpdir(), 'discord-codex-'));
  const outputFile = join(temporary, 'answer.txt');
  const env = workerEnvironment();
  let stderr = '';
  let sessionId: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      // Launch the local npm CLI through Node directly, avoiding Windows .cmd and shell quoting.
      const child = spawn(process.execPath, [
        options.cliScript ?? codexScript(), 'exec',
        '--sandbox', options.sandbox, '--color', 'never',
        '--skip-git-repo-check',
        '--json', '--output-last-message', outputFile,
        ...(options.model ? ['--model', options.model] : []),
        ...(options.effort ? ['--config', 'model_reasoning_effort="' + options.effort + '"'] : []),
        ...(options.sessionId ? ['resume', options.sessionId] : []), '-',
      ], {
        cwd: options.workdir,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let failure: string | undefined;
      let bytes = 0;
      let terminated: Promise<void> = Promise.resolve();
      const terminate = (reason: string) => {
        if (failure) return;
        failure = reason;
        terminated = terminateWorker(child);
      };
      // Bound bytes before readline can accumulate an unfinished JSON event.
      const stdout = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxOutputBytes) {
          if (!failure) {
            events.close();
            stdout.resume();
            terminate('AI_OUTPUT_LIMIT');
          }
          callback();
        } else callback(null, failure ? undefined : chunk);
      } });
      // Only retain the session ID; other events may contain private project content.
      const events = createInterface({ input: stdout });
      events.on('line', line => {
        try {
          const event = JSON.parse(line);
          if (event.type === 'thread.started' && typeof event.thread_id === 'string'
            && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(event.thread_id)) {
            sessionId = event.thread_id;
          }
          options.onProgress?.(codexActivity(event));
        } catch { options.onProgress?.(); }
      });
      child.on('close', () => { child.stdout.unpipe(stdout); events.close(); stdout.destroy(); });
      const timer = options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => terminate('CODEX_TIMEOUT'), options.timeoutMs) : undefined;
      const cancel = () => terminate('AI_CANCELLED');
      options.signal?.addEventListener('abort', cancel, { once: true });
      // The signal may have fired while temporary output was being prepared.
      if (options.signal?.aborted) cancel();
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-8000);
      });
      // Early exit (for example authentication failure) can close stdin before delivery.
      child.stdin.on('error', () => {});
      child.on('error', error => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
        // Release the worker only after the whole process tree has been terminated.
        void terminated.then(() => {
          if (failure) reject(new Error(failure));
          else if (code !== 0) reject(new Error(`Codex exited with code ${code}. ${stderr}`));
          else resolve();
        });
      });
      child.stdout.pipe(stdout);
      // Chat text is data on stdin. Characters such as quotes, $, & and backticks are not shell code.
      child.stdin.end(prompt, 'utf8');
    });
    if ((await stat(outputFile)).size > 1_000_000) throw new Error('AI_OUTPUT_LIMIT');
    const result = (await readFile(outputFile, 'utf8')).trim() || 'Codex finished without a text response.';
    if (sessionId) options.onSession?.(sessionId);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
