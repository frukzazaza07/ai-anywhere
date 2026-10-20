import { runAgent, type AgentRunOptions } from './agent-runner.js';
import { AiSessions, type SessionContextState, type TaskControl } from './sessions.js';
import { ProjectPreferences, type ProjectConfig, type ProjectSelection } from './projects.js';
import { type ProviderConfig } from './providers.js';
import { type RuntimeConfig } from './runtime-config.js';
import { profileProject, type SelectedProfile } from './selection.js';

interface ProjectSessionOptions extends AgentRunOptions {
  projects: ProjectConfig;
  providers?: ProviderConfig;
  runtime?: RuntimeConfig;
  // Concurrent tasks across directories; one task per directory. 1 keeps a single shared worker.
  maxWorkers?: number;
}

/** Worker limit over independent provider sessions for each configured directory (one task per directory). */
export class ProjectSessions {
  private readonly sessions = new Map<string, AiSessions>();
  private readonly preferences: ProjectPreferences;
  private closing = false;
  private readonly active = new Set<Promise<string>>();

  constructor(private readonly options: ProjectSessionOptions, private readonly run: typeof runAgent = runAgent) {
    this.preferences = new ProjectPreferences(() => options.runtime?.value.projects ?? options.projects);
  }

  get busy(): boolean { return [...this.sessions.values()].some(session => session.busy); }
  get maxWorkers(): number { return this.options.maxWorkers ?? 1; }
  get running(): number { return [...this.sessions.values()].filter(session => session.busy).length; }
  // With one worker, preference switches and resets wait for any active task, as before.
  private get shared(): boolean { return this.maxWorkers <= 1; }

  currentProject(key: string, override?: string | null, selection?: SelectedProfile): ProjectSelection {
    if (this.options.runtime?.value.source === 'setup') throw new Error('AI_SETUP_REQUIRED');
    return this.preferences.current(key, selection ? profileProject(selection, override) : override);
  }

  switchProject(key: string, name: string): ProjectSelection {
    if (this.options.runtime?.value.source === 'setup') throw new Error('AI_SETUP_REQUIRED');
    if (this.shared && this.busy) throw new Error('CODEX_BUSY');
    return this.preferences.switch(key, name);
  }

  projectsText(key: string): string { return this.preferences.list(key); }

  private session(key: string, project?: string, selection?: SelectedProfile): AiSessions {
    const { workdir } = this.currentProject(key, project, selection);
    let session = this.sessions.get(workdir);
    if (!session) {
      session = new AiSessions({ ...this.options, workdir,
        providerSource: () => this.options.runtime?.value.providers ?? this.options.providers }, this.run);
      this.sessions.set(workdir, session);
    }
    return session;
  }

  contextState(key: string, selection: SelectedProfile, project?: string): SessionContextState {
    return this.session(key, project, selection).contextState(key, selection);
  }

  reset(key: string, selection: SelectedProfile, project?: string): void {
    if (this.shared && this.busy) throw new Error('CODEX_BUSY');
    // The project's own session rejects resets while it runs a task.
    this.session(key, project, selection).reset(key, selection);
  }

  result(key: string, selection: SelectedProfile, project?: string): string {
    const selected = this.currentProject(key, project, selection);
    return this.session(key, selected.project).result(key, selection, selection.project ? undefined : selected.project, selection.profile);
  }

  status(key: string, selection: SelectedProfile, project?: string): string {
    const selected = this.currentProject(key, project, selection);
    // The project-local session may be idle while other projects use the workers.
    return 'Project: ' + selected.project + '\n'
      + (selection.profile ? 'Profile: ' + selection.profile + '\n' : '')
      + this.session(key, selected.project).status(key, selection)
        .replace(/^Worker: (busy|idle)$/m, this.shared ? 'Worker: ' + (this.busy ? 'busy' : 'idle')
          : 'Workers: ' + this.running + '/' + this.maxWorkers + ' busy');
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.active]);
  }

  async prompt(key: string, prompt: string, selection: SelectedProfile, project?: string, control: TaskControl = {}): Promise<string> {
    if (this.closing) throw new Error('AI_SHUTTING_DOWN');
    const session = this.session(key, project, selection);
    if (session.busy || this.running >= this.maxWorkers) throw new Error('CODEX_BUSY');
    // No await before the underlying session claims the worker.
    const result = session.prompt(key, prompt, selection, control);
    this.active.add(result);
    const settle = () => { this.active.delete(result); };
    // Register cleanup without creating an unhandled rejection on task failure.
    void result.then(settle, settle);
    return result;
  }
}
