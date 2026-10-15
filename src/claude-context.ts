import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type ContextState } from './context.js';

export interface ClaudeContextUsage {
  model?: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}
export interface ClaudeContextState extends ContextState {
  workdir: string;
  // Reported by the CLI result's modelUsage, keyed by model ID.
  contextWindows?: Record<string, number>;
  // Local test override only.
  configDir?: string;
}

const sessionPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const claudeContextUnavailable = 'Claude context details\nContext usage unavailable: Claude Code has not recorded usage for this session.';

/** Collect per-model context windows from a Claude Code JSON result, ignoring malformed entries. */
export function claudeContextWindows(modelUsage: unknown): Record<string, number> | undefined {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return undefined;
  const windows: Record<string, number> = {};
  for (const [model, usage] of Object.entries(modelUsage)) {
    const window = (usage as { contextWindow?: unknown } | null)?.contextWindow;
    if (typeof window === 'number' && Number.isSafeInteger(window) && window > 0) windows[model] = window;
  }
  return Object.keys(windows).length ? windows : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// Claude Code stores transcripts under projects/<cwd with non-alphanumerics replaced by '-'>.
// Long or canonicalized paths may be stored differently, so fall back to locating the session file.
export async function claudeTranscript(workdir: string, sessionId: string, configDir?: string): Promise<string | undefined> {
  if (!sessionPattern.test(sessionId)) return undefined;
  const projects = join(configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  const file = sessionId + '.jsonl';
  const isFile = async (path: string) => { try { return (await stat(path)).isFile(); } catch { return false; } };
  const direct = join(projects, workdir.replace(/[^a-zA-Z0-9]/g, '-'), file);
  if (await isFile(direct)) return direct;
  try {
    for (const entry of await readdir(projects, { withFileTypes: true })) {
      if (entry.isDirectory() && await isFile(join(projects, entry.name, file))) return join(projects, entry.name, file);
    }
  } catch { /* No local Claude history. */ }
  return undefined;
}

// Read only the tail of the transcript, retaining numeric usage metadata and the model ID.
// Never expose chat text, tool output or the transcript path.
export async function readClaudeContextUsage(path: string, signal?: AbortSignal): Promise<ClaudeContextUsage | undefined> {
  const size = (await stat(path)).size;
  const start = Math.max(0, size - 8 * 1024 * 1024);
  const stream = createReadStream(path, { start, signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let skipFragment = start > 0;
  let usage: ClaudeContextUsage | undefined;
  try {
    for await (const line of lines) {
      if (skipFragment) { skipFragment = false; continue; }
      try {
        const event = JSON.parse(line);
        if (event.type === 'system' && event.subtype === 'compact_boundary') { usage = undefined; continue; }
        // Subagent and synthetic error messages do not occupy the main conversation window.
        if (event.type !== 'assistant' || event.isSidechain === true || event.isApiErrorMessage === true) continue;
        const message = event.message;
        if (!message?.usage || message.model === '<synthetic>') continue;
        usage = {
          model: typeof message.model === 'string' ? message.model : undefined,
          inputTokens: count(message.usage.input_tokens),
          cacheCreationTokens: count(message.usage.cache_creation_input_tokens),
          cacheReadTokens: count(message.usage.cache_read_input_tokens),
          outputTokens: count(message.usage.output_tokens),
        };
      } catch { /* Skip partial or non-JSON transcript records. */ }
    }
    return usage;
  } finally {
    lines.close();
    stream.destroy();
  }
}

export function formatClaudeContext(usage: ClaudeContextUsage, state: ClaudeContextState): string {
  const number = (value: number) => value.toLocaleString('en-US');
  const used = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens + usage.outputTokens;
  const windows = state.contextWindows ?? {};
  const window = (usage.model ? windows[usage.model] : undefined)
    ?? (Object.values(windows).length ? Math.max(...Object.values(windows)) : undefined);
  return [
    'Claude context details',
    `Model: ${usage.model ?? 'unknown'}`,
    ...(window ? [
      `Context used: ${Math.round(Math.min(1, used / window) * 100)}% (${number(used)} / ${number(window)} tokens)`,
      `Tokens remaining: ${number(Math.max(0, window - used))}`,
    ] : [`Tokens in context: ${number(used)}`, 'Context window: not reported by the CLI.']),
    'Latest request breakdown:',
    `- Cache read: ${number(usage.cacheReadTokens)}`,
    `- Cache write: ${number(usage.cacheCreationTokens)}`,
    `- Uncached input: ${number(usage.inputTokens)}`,
    `- Output: ${number(usage.outputTokens)}`,
    ...(state.sessionId ? [`Session: ${state.sessionId}`] : []),
    state.contextRunning
      ? 'Task running; showing the latest recorded snapshot.'
      : 'Latest recorded snapshot; Claude Code compacts automatically before the window fills.',
  ].join('\n');
}

export async function claudeContextStatus(state: ClaudeContextState, signal?: AbortSignal): Promise<string> {
  if (!state.sessionId) {
    return state.contextRunning
      ? 'Claude context details\nContext usage unavailable until the first task reports a session.'
      : 'Claude context details\nNo active session. Send a task with /ai run provider:claude prompt:… to obtain context usage.';
  }
  try {
    const path = await claudeTranscript(state.workdir, state.sessionId, state.configDir);
    const usage = path ? await readClaudeContextUsage(path, signal) : undefined;
    return usage ? formatClaudeContext(usage, state) : claudeContextUnavailable;
  } catch { return claudeContextUnavailable; }
}
