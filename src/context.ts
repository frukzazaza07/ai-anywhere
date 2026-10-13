import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';

export interface ContextUsage {
  usedTokens: number;
  windowTokens: number;
}
export interface ContextState {
  sessionId?: string;
  contextRunning?: boolean;
}

export const contextUnavailable = 'Current session context\nContext usage unavailable: Codex has not reported the current window.';

export function formatContextUsage(usage: ContextUsage, state: ContextState): string {
  // Match the pinned Codex CLI's context estimate, which reserves baseline instructions.
  // https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/protocol/src/protocol.rs
  const baseline = 12000;
  const effective = usage.windowTokens - baseline;
  const used = Math.max(0, usage.usedTokens - baseline);
  const percent = effective > 0 ? Math.round(Math.max(0, Math.min(1, (effective - used) / effective)) * 100) : 0;
  const remaining = Math.max(0, usage.windowTokens - usage.usedTokens);
  const number = (value: number) => value.toLocaleString('en-US');
  return [
    'Current session context',
    `Context remaining: ${percent}% (Codex estimate)`,
    `Tokens in context: ${number(usage.usedTokens)} / ${number(usage.windowTokens)}`,
    `Tokens remaining: ${number(remaining)}`,
    ...(state.sessionId ? [`Session: ${state.sessionId}`] : []),
    state.contextRunning
      ? 'Task running; showing the latest reported snapshot.'
      : 'Latest reported snapshot; context may change after the next response or compaction.',
  ].join('\n');
}

// Read only the tail of the exact rollout returned by thread/read, retaining numeric metadata.
// Never expose chat text, tool output or the rollout path.
export async function readContextUsage(path: string, signal?: AbortSignal): Promise<ContextUsage | undefined> {
  const size = (await stat(path)).size;
  const start = Math.max(0, size - 8 * 1024 * 1024);
  const stream = createReadStream(path, { start, signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let skipFragment = start > 0;
  let usage: ContextUsage | undefined;
  try {
    for await (const line of lines) {
      if (skipFragment) { skipFragment = false; continue; }
      try {
        const event = JSON.parse(line);
        if (event.type === 'compacted') { usage = undefined; continue; }
        if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
        const info = event.payload.info;
        // Rate-limit-only events have no token snapshot; keep the previous count.
        if (info == null) continue;
        const usedTokens = info.last_token_usage?.total_tokens;
        const windowTokens = info.model_context_window;
        usage = Number.isSafeInteger(usedTokens) && usedTokens >= 0
          && Number.isSafeInteger(windowTokens) && windowTokens > 0
          ? { usedTokens, windowTokens } : undefined;
      } catch { /* Skip partial or non-JSON rollout records. */ }
    }
    return usage;
  } finally {
    lines.close();
    stream.destroy();
  }
}

export async function threadContextStatus(
  result: unknown, state: ContextState, signal?: AbortSignal,
): Promise<string> {
  try {
    const thread = (result as { thread?: { id?: string; path?: string | null } } | null)?.thread;
    if (!state.sessionId || thread?.id !== state.sessionId
      || typeof thread.path !== 'string' || !isAbsolute(thread.path)) return contextUnavailable;
    const usage = await readContextUsage(thread.path, signal);
    return usage ? formatContextUsage(usage, state) : contextUnavailable;
  } catch { return contextUnavailable; }
}
