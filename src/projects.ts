import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ProjectConfig {
  directories: ReadonlyMap<string, string>;
  defaultProject: string;
  enabled?: ReadonlySet<string>;
}

export interface ProjectSelection { project: string; workdir: string }

export function isProjectName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

export function projectConfig(env: NodeJS.ProcessEnv = process.env, baseDirectory = process.cwd()): ProjectConfig {
  const directories = new Map<string, string>();
  const add = (name: string, value: unknown) => {
    if (!isProjectName(name) || typeof value !== 'string' || !value.trim()
      || value.trim().startsWith('replace_with_')) throw new Error('Invalid project name or directory in AI_PROJECTS');
    let directory: string;
    try {
      directory = realpathSync(resolve(baseDirectory, value.trim()));
      if (!statSync(directory).isDirectory()) throw new Error('Not a directory');
    } catch { throw new Error('Project ' + name + ' must reference an existing accessible directory'); }
    directories.set(name, directory);
  };
  if (env.AI_PROJECTS?.trim()) {
    let value: unknown;
    try { value = JSON.parse(env.AI_PROJECTS); }
    catch { throw new Error('AI_PROJECTS must be a JSON object mapping names to directories'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_PROJECTS must be a JSON object');
    const entries = Object.entries(value);
    if (!entries.length) throw new Error('Configure at least one project in AI_PROJECTS');
    for (const [name, directory] of entries) add(name, directory);
  }
  const fallback = env.AI_WORKDIR?.trim() || env.CODEX_WORKDIR?.trim();
  if (fallback && !directories.has('default')) add('default', fallback);
  if (!directories.size) throw new Error('Set AI_PROJECTS, AI_WORKDIR or CODEX_WORKDIR');
  const defaultProject = env.AI_DEFAULT_PROJECT?.trim() || (directories.has('default') ? 'default' : directories.keys().next().value!);
  if (!directories.has(defaultProject)) throw new Error('AI_DEFAULT_PROJECT must be configured in AI_PROJECTS');
  return { directories, defaultProject };
}

/** Select only an operator-configured alias, never a path received from chat. */
export function selectProject(config: ProjectConfig, name?: string | null): ProjectSelection {
  const project = name ?? config.defaultProject;
  const workdir = config.directories.get(project);
  if (!isProjectName(project) || !workdir || (config.enabled && !config.enabled.has(project))) throw new Error('AI_PROJECT_UNAVAILABLE');
  return { project, workdir };
}

export class ProjectPreferences {
  private readonly selected = new Map<string, string>();
  constructor(private readonly source: ProjectConfig | (() => ProjectConfig)) {}
  private get config(): ProjectConfig { return typeof this.source === 'function' ? this.source() : this.source; }

  current(key: string, override?: string | null): ProjectSelection {
    return selectProject(this.config, override ?? this.selected.get(key));
  }

  switch(key: string, name: string): ProjectSelection {
    const selection = selectProject(this.config, name);
    this.selected.set(key, selection.project);
    return selection;
  }

  list(key: string): string {
    let current: string;
    try { current = this.current(key).project; }
    catch { current = 'unavailable; select an enabled project'; }
    return 'Current project: ' + current + '\nConfigured projects:\n'
      + [...this.config.directories.keys()].filter(name => !this.config.enabled || this.config.enabled.has(name)).map(name => '- ' + name).join('\n')
      + '\nUse /ai project name:… to switch, or project:… on a session command for one request.';
  }
}
