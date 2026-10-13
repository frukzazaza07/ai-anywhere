import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { codexScript, workerEnvironment } from './runner.js';
import { contextUnavailable, threadContextStatus, type ContextState } from './context.js';

interface LimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}
interface LimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: LimitWindow | null;
  secondary?: LimitWindow | null;
  planType?: string | null;
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null;
  rateLimitReachedType?: string | null;
  spendControlReached?: boolean | null;
}
export interface AccountLimits {
  rateLimits?: LimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, LimitSnapshot | undefined> | null;
  ordinaryUsageAllowed?: boolean | null;
  rateLimitResetCredits?: { availableCount: number } | null;
}

function windowLabel(minutes: number | null | undefined, fallback: string): string {
  if (!minutes) return fallback;
  if (minutes % 10080 === 0) return `${minutes / 10080}-week limit`;
  if (minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

export function formatCodexLimits(response: AccountLimits): string {
  const buckets = Object.entries(response.rateLimitsByLimitId ?? {})
    .filter((entry): entry is [string, LimitSnapshot] => entry[1] !== undefined);
  if (!buckets.length && response.rateLimits) {
    buckets.push([response.rateLimits.limitId ?? 'codex', response.rateLimits]);
  }
  const lines = ['Codex account usage limits'];
  if (!buckets.length) lines.push('Usage data unavailable.');
  for (const [id, bucket] of buckets) {
    lines.push('', bucket.limitName ?? id);
    if (bucket.planType) lines.push(`Plan: ${bucket.planType}`);
    for (const [name, window] of [['Primary limit', bucket.primary], ['Secondary limit', bucket.secondary]] as const) {
      if (!window) continue;
      const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
      lines.push(`${windowLabel(window.windowDurationMins, name)}: ${remaining}% remaining (${window.usedPercent}% used)`);
      lines.push(typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt)
        ? `Resets: <t:${Math.floor(window.resetsAt)}:F> (<t:${Math.floor(window.resetsAt)}:R>)`
        : 'Reset time: unavailable');
    }
    if (!bucket.primary && !bucket.secondary) lines.push('Usage windows unavailable.');
    if (bucket.credits) {
      lines.push(bucket.credits.unlimited ? 'Credits: unlimited'
        : bucket.credits.balance != null ? `Credits balance: ${bucket.credits.balance}`
        : `Credits: ${bucket.credits.hasCredits ? 'available (balance unavailable)' : 'none'}`);
    }
    if (bucket.rateLimitReachedType) lines.push(`Limit reached: ${bucket.rateLimitReachedType}`);
    if (bucket.spendControlReached === true) lines.push('Account spend control limit reached.');
  }
  if (response.ordinaryUsageAllowed === false) lines.push('Included usage currently unavailable.');
  if (response.rateLimitResetCredits) lines.push(`Available usage resets: ${response.rateLimitResetCredits.availableCount}`);
  lines.push('', 'Shared account used by this bot; not a per-Discord-user quota.');
  return lines.join('\n');
}

export const limitsUnavailable = 'Codex account usage limits are unavailable. Check npx codex login status and the network connection on the bot machine, then try /ai status provider:codex again.';

export interface LimitsOptions extends ContextState {
  includeContext?: boolean;
  workdir: string;
  timeoutMs?: number;
  // Local test override only.
  cliScript?: string;
}

// Read-only app-server handshake; never starts a thread, logs in or requests a model turn.
// Protocol: https://learn.chatgpt.com/docs/app-server
export async function readCodexLimits(options: LimitsOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [
      options.cliScript ?? codexScript(), 'app-server', '--stdio',
    ], {
      cwd: options.workdir, env: workerEnvironment(), shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const events = createInterface({ input: child.stdout });
    let contextText = options.sessionId ? contextUnavailable
      : options.contextRunning
        ? 'Current session context\nContext usage unavailable until the first task reports a session.'
        : 'Current session context\nNo active session. Send a task with /ai run provider:codex prompt:… to obtain context usage.';
    const contextAbort = new AbortController();
    let settled = false;
    let resultError: Error | undefined;
    let resultText: string | undefined;
    let cleanup: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      resultError = error && !options.includeContext ? error : undefined;
      resultText = options.includeContext
        ? `${contextText}\n\n${error ? limitsUnavailable : text ?? 'Usage data unavailable.'}` : text;
      contextAbort.abort();
      clearTimeout(timer);
      events.close();
      child.stdin.end();
      // EOF normally shuts down app-server. Terminate its tree if shutdown stalls.
      cleanup = setTimeout(() => {
        if (child.pid === undefined) return;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            shell: false, windowsHide: true, stdio: 'ignore',
          });
          killer.on('error', () => child.kill());
          killer.on('close', code => { if (code !== 0) child.kill(); });
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }, 1000);
      cleanup.unref();

    };
    const timer = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => finish(new Error('CODEX_LIMITS_TIMEOUT')), options.timeoutMs) : undefined;
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
    // Drain diagnostics, but never expose them or account emails/tokens in Discord.
    child.stderr.resume();
    child.stdin.on('error', () => finish(new Error('CODEX_LIMITS_UNAVAILABLE')));
    child.on('error', () => finish(new Error('CODEX_LIMITS_UNAVAILABLE')));
    child.on('close', () => {
      if (!settled) finish(new Error('CODEX_LIMITS_UNAVAILABLE'));
      clearTimeout(cleanup);
      // Wait for shutdown before resolving so Windows releases the working directory.
      if (resultError) reject(resultError);
      else resolve(resultText ?? 'Usage data unavailable.');
    });
    let expectedId = 0;
    events.on('line', async line => {
      if (settled) return;
      try {
        const message = JSON.parse(line);
        if (message.id !== expectedId) return;
        if (expectedId === 3) {
          contextText = message.error ? contextUnavailable
            : await threadContextStatus(message.result, options, contextAbort.signal);
          if (settled) return;
          expectedId = 1;
          send({ id: 1, method: 'account/read', params: { refreshToken: false } });
          return;
        }
        if (message.error) { finish(new Error('CODEX_LIMITS_UNAVAILABLE')); return; }
        if (!message.result || typeof message.result !== 'object') {
          finish(new Error('CODEX_LIMITS_UNAVAILABLE'));
          return;
        }
        if (expectedId === 0) {
          send({ method: 'initialized', params: {} });
          if (options.includeContext && options.sessionId) {
            expectedId = 3;
            send({ id: 3, method: 'thread/read', params: { threadId: options.sessionId, includeTurns: false } });
          } else {
            expectedId = 1;
            send({ id: 1, method: 'account/read', params: { refreshToken: false } });
          }
        } else if (expectedId === 1) {
          const account = message.result.account;
          if (!account) {
            finish(undefined, 'Codex is not logged in. Run npx codex login on the bot machine.');
          } else if (account.type !== 'chatgpt') {
            finish(undefined, 'ChatGPT usage limits are unavailable for this login/provider. API-key accounts use separate API billing and limits.');
          } else {
            expectedId = 2;
            send({ id: 2, method: 'account/rateLimits/read' });
          }
        } else {
          finish(undefined, formatCodexLimits(message.result));
        }
      } catch { finish(new Error('CODEX_LIMITS_UNAVAILABLE')); }
    });
    send({ id: 0, method: 'initialize', params: {
      clientInfo: { name: 'codex_discord', title: 'Codex Discord Bot', version: '1.0.0' },
    } });
  });
}

export async function codexLimitsStatus(options: LimitsOptions): Promise<string> {
  try { return await readCodexLimits(options); }
  catch {
    return options.includeContext ? `${contextUnavailable}

${limitsUnavailable}` : limitsUnavailable;
  }
}
