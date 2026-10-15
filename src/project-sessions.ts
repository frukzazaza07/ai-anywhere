import { runAgent, type AgentRunOptions } from './agent-runner.js';
import { AiSessions } from './sessions.js';
import { ProjectPreferences, type ProjectConfig, type ProjectSelection } from './projects.js';
import { type ProviderConfig } from './providers.js';
import { type RuntimeConfig } from './runtime-config.js';
import { profileProject, type SelectedProfile } from './selection.js';

interface ProjectSessionOptions extends AgentRunOptions {
  projects: ProjectConfig;
  providers?: ProviderConfig;
  runtime?: RuntimeConfig;
}

/** One shared worker guard over independent provider sessions for each configured directory. */
export class ProjectSessions {
  private readonly sessions = new Map<string, AiSessions>();
  private readonly preferences: ProjectPreferences;
  private closing = false;
  private active?: Promise<string>;

  constructor(private readonly options: ProjectSessionOptions, private readonly run: typeof runAgent = runAgent) {
    this.preferences = new ProjectPreferences(() => options.runtime?.value.projects ?? options.projects);
  }

  get busy(): boolean { return [...this.sessions.values()].some(session => session.busy); }

  currentProject(key: string, override?: string | null, selection?: SelectedProfile): ProjectSelection {
    if (this.options.runtime?.value.source === 'setup') throw new Error('AI_SETUP_REQUIRED');
    return this.preferences.current(key, selection ? profileProject(selection, override) : override);
  }

  switchProject(key: string, name: string): ProjectSelection {
    if (this.options.runtime?.value.source === 'setup') throw new Error('AI_SETUP_REQUIRED');
    if (this.busy) throw new Error('CODEX_BUSY');
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

  contextState(key: string, selection: SelectedProfile, project?: string): { sessionId?: string; contextRunning: boolean } {
    return this.session(key, project, selection).contextState(key, selection);
  }

  reset(key: string, selection: SelectedProfile, project?: string): void {
    if (this.busy) throw new Error('CODEX_BUSY');
    this.session(key, project, selection).reset(key, selection);
  }

  result(key: string, selection: SelectedProfile, project?: string): string {
    const selected = this.currentProject(key, project, selection);
    return this.session(key, selected.project).result(key, selection, selection.project ? undefined : selected.project, selection.profile);
  }

  status(key: string, selection: SelectedProfile, project?: string): string {
    const selected = this.currentProject(key, project, selection);
    // The project-local worker may be idle while another project owns the shared worker.
    return 'Project: ' + selected.project + '\n'
      + (selection.profile ? 'Profile: ' + selection.profile + '\n' : '')
      + this.session(key, selected.project).status(key, selection)
        .replace(/^Worker: (busy|idle)$/m, 'Worker: ' + (this.busy ? 'busy' : 'idle'));
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    await this.active?.catch(() => {});
  }

  async prompt(key: string, prompt: string, selection: SelectedProfile, project?: string): Promise<string> {
    if (this.closing) throw new Error('AI_SHUTTING_DOWN');
    if (this.busy) throw new Error('CODEX_BUSY');
    // No await before the underlying session claims the worker.
    const result = this.session(key, project, selection).prompt(key, prompt, selection);
    this.active = result;
    // Register cleanup without creating an unhandled rejection on task failure.
    void result.then(() => { if (this.active === result) this.active = undefined; },
      () => { if (this.active === result) this.active = undefined; });
    return result;
  }
}
