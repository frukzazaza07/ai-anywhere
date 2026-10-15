import { runAgent, type AgentRunOptions } from './agent-runner.js';
import { cliDefaultModel, defaultProviderConfig, providerLabels, selectProvider, validateSelection, type ProviderConfig, type ProviderSelection } from './providers.js';
import { taskErrorMessage } from './results.js';

interface Session {
  id?: string;
  turns: number;
  lastCompleted?: string;
  contextWindows?: Record<string, number>;
}

/** Per-task cancellation and progress reporting; neither changes the CLI's permissions. */
export interface TaskControl { signal?: AbortSignal; onProgress?: (activity?: string) => void }

export interface SessionContextState { sessionId?: string; contextRunning: boolean; contextWindows?: Record<string, number> }

interface SessionOptions extends AgentRunOptions { providers?: ProviderConfig; providerSource?: () => ProviderConfig | undefined }

export class AiSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly results = new Map<string, string>();
  private active?: { key: string; started: number };
  private readonly started = Date.now();

  constructor(
    private readonly options: SessionOptions,
    private readonly run: typeof runAgent = runAgent,
  ) {}

  get busy(): boolean { return this.active !== undefined; }

  private identity(key: string, selection?: ProviderSelection): { key: string; selection: ProviderSelection } {
    const config = this.options.providerSource?.() ?? this.options.providers ?? defaultProviderConfig();
    const selected = selection ? validateSelection(config, selection) : selectProvider(config);
    return { key: JSON.stringify([key, selected.provider, selected.model ?? '']), selection: selected };
  }

  contextState(key: string, selection?: ProviderSelection): SessionContextState {
    key = this.identity(key, selection).key;
    const session = this.sessions.get(key);
    return { sessionId: session?.id, contextRunning: this.active?.key === key,
      ...(session?.contextWindows ? { contextWindows: session.contextWindows } : {}) };
  }

  reset(key: string, selection?: ProviderSelection): void {
    if (this.busy) throw new Error('CODEX_BUSY');
    key = this.identity(key, selection).key;
    this.sessions.delete(key);
    this.results.delete(key);
  }

  result(key: string, selection?: ProviderSelection, project?: string, profile?: string): string {
    const identity = this.identity(key, selection);
    const label = providerLabels[identity.selection.provider];
    const command = '/ai';
    const provider = (profile ? ' profile:' + profile : ' provider:' + identity.selection.provider + ' model:' + (identity.selection.model ?? cliDefaultModel))
      + (identity.selection.effort ? ' effort:' + identity.selection.effort : '')
      + (project ? ' project:' + project : '');
    if (this.active?.key === identity.key) return `${label} is still running. Try ${command} result${provider} again after the task finishes.`;
    return this.results.get(identity.key) ?? `No saved result for this user and channel. Send a task with ${command} run${provider} prompt:…, or find earlier jobs with /ai jobs.`;
  }

  status(key: string, selection?: ProviderSelection): string {
    const identity = this.identity(key, selection);
    key = identity.key;
    const session = this.sessions.get(key);
    const active = this.active;
    return [
      providerLabels[identity.selection.provider] + ' status',
      `Model: ${identity.selection.model ?? 'CLI default'}`,
      `Effort: ${identity.selection.effort ?? 'CLI default'}`,
      `Worker: ${active ? 'busy' : 'idle'}`,
      ...(active?.key === key ? [`Current task: ${Math.floor((Date.now() - active.started) / 1000)}s elapsed`] : []),
      `Session: ${session?.id ?? 'none (next prompt starts a new session)'}`,
      `Completed turns: ${session?.turns ?? 0}`,
      `Last completed: ${session?.lastCompleted ?? 'none'}`,
      `Sandbox: ${this.options.sandbox}`,
      ...(identity.selection.provider === 'codex' ? [] : [
        'Permissions: file tools only; shell tools and custom integrations disabled.',
        identity.selection.provider === 'claude' ? 'Account quota: unavailable for this provider. Context usage: /ai context.'
          : 'Account quota and context usage: unavailable for this provider.',
      ]),
      `Timeout: ${this.options.timeoutMs ? this.options.timeoutMs / 1000 + 's' : 'disabled'}`,
      `Bot uptime: ${Math.floor((Date.now() - this.started) / 1000)}s`,
      'Commands: /ai run | /ai jobs | /ai stop | /ai new | /ai status | /ai context | /ai clear | /ai result (select provider)',
    ].join('\n');
  }

  async prompt(key: string, prompt: string, selection?: ProviderSelection, control: TaskControl = {}): Promise<string> {
    if (this.busy) throw new Error('CODEX_BUSY');
    const identity = this.identity(key, selection);
    key = identity.key;
    this.active = { key, started: Date.now() };
    const session = this.sessions.get(key) ?? { turns: 0 };
    let id = session.id;
    let contextWindows = session.contextWindows;
    try {
      const result = await this.run(prompt, {
        ...this.options, ...identity.selection,
        claudeExecutable: (this.options.providerSource?.() ?? this.options.providers)?.claudeExecutable ?? this.options.claudeExecutable,
        geminiScript: (this.options.providerSource?.() ?? this.options.providers)?.geminiScript ?? this.options.geminiScript,
        sessionId: session.id, signal: control.signal, onProgress: control.onProgress, onSession: (sessionId, windows) => { id = sessionId; contextWindows = windows ?? contextWindows; },
      });
      this.sessions.set(key, { id, turns: session.turns + 1, lastCompleted: new Date().toISOString(),
        ...(contextWindows ? { contextWindows } : {}) });
      this.results.set(key, result);
      return result;
    } catch (error) {
      this.results.set(key, taskErrorMessage(error, identity.selection.provider));
      throw error;
    } finally { this.active = undefined; }
  }
}

// Preserve the existing local API while Discord uses the provider-neutral name.
export { AiSessions as CodexSessions };
