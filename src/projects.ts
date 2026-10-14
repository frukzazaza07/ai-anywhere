import { lstatSync, mkdirSync, realpathSync, rmdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ProjectConfig {
  directories: ReadonlyMap<string, string>;
  defaultProject: string;
  enabled?: ReadonlySet<string>;
}

export interface ProjectSelection { project: string; workdir: string }

export function isProjectName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

interface DirectoryIdentity { directory: string; dev: number; ino: number }

function prepareDirectory(root: string, directory: string, create: boolean): {
  directory: string; verify: () => void; rollback: () => void;
} {
  const created: DirectoryIdentity[] = [];
  const identity = (path: string): DirectoryIdentity => {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new Error('AI_PROJECT_DIRECTORY');
    return { directory: path, dev: stat.dev, ino: stat.ino };
  };
  const check = (expected: DirectoryIdentity) => {
    const current = identity(expected.directory);
    if (current.dev !== expected.dev || current.ino !== expected.ino) throw new Error('AI_PROJECT_DIRECTORY');
  };
  let rootIdentity: DirectoryIdentity;
  try { rootIdentity = identity(root); } catch { throw new Error('AI_PROJECT_DIRECTORY'); }
  const rollback = () => {
    if (!created.length) return;
    try {
      check(rootIdentity);
      for (const item of created) check(item);
      while (created.length) {
        // Never recurse: files added by another process must survive a failed save.
        rmdirSync(created.at(-1)!.directory);
        created.pop();
      }
    } catch { throw new Error('AI_PROJECT_CLEANUP'); }
  };
  try {
    if (create) {
      // An existing leaf (including a dangling link) is always a collision.
      try { lstatSync(directory); throw new Error('AI_PROJECT_DIRECTORY_EXISTS'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const suffix = relative(root, directory);
      if (!suffix || isAbsolute(suffix) || suffix.split(sep).includes('..')) throw new Error('AI_PROJECT_DIRECTORY');
      let path = root;
      for (const part of suffix.split(sep)) {
        check(rootIdentity);
        for (const item of created) check(item);
        path = resolve(path, part);
        try { mkdirSync(path); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('AI_PROJECT_DIRECTORY_EXISTS');
          throw error;
        }
        // If ownership cannot be verified after mkdir, leave the folder for inspection.
        try { created.push(identity(path)); }
        catch { throw new Error('AI_PROJECT_CLEANUP'); }
      }
    }
    const target = identity(directory);
    const verify = () => {
      try {
        check(rootIdentity);
        for (const item of created) check(item);
        check(target);
      } catch { throw new Error('AI_PROJECT_DIRECTORY'); }
    };
    verify();
    return { directory, verify, rollback };
  } catch (error) {
    rollback();
    if (error instanceof Error && ['AI_PROJECT_DIRECTORY_EXISTS', 'AI_PROJECT_CLEANUP'].includes(error.message)) throw error;
    throw new Error('AI_PROJECT_DIRECTORY');
  }
}

/** Resolve only immediate children of a canonical, locally configured root. */
export function prepareProjectDirectory(root: string, name: string, create: boolean): ReturnType<typeof prepareDirectory> {
  if (!isProjectName(name)) throw new Error('AI_PROJECT_NAME');
  const directory = resolve(root, name);
  if (dirname(directory) !== root) throw new Error('AI_PROJECT_DIRECTORY');
  return prepareDirectory(root, directory, create);
}

/** Admin-approved absolute paths may create a missing directory tree without shell commands. */
export function prepareProjectPath(value: string, create: boolean): ReturnType<typeof prepareDirectory> {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value.trim())
    || (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(value.trim()))) {
    throw new Error('AI_PROJECT_PATH');
  }
  const requested = resolve(value.trim());
  let ancestor = dirname(requested);
  try {
    if (!create) {
      const target = lstatSync(requested);
      if (!target.isDirectory() || target.isSymbolicLink()) throw new Error('AI_PROJECT_DIRECTORY');
      const directory = realpathSync.native(requested);
      const prepared = prepareDirectory(dirname(directory), directory, false);
      const current = lstatSync(requested);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== target.dev || current.ino !== target.ino) {
        throw new Error('AI_PROJECT_DIRECTORY');
      }
      return prepared;
    }
    while (true) {
      try {
        const root = realpathSync.native(ancestor);
        if (!statSync(root).isDirectory()) throw new Error('AI_PROJECT_DIRECTORY');
        return prepareDirectory(root, resolve(root, relative(ancestor, requested)), create);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
        ancestor = dirname(ancestor);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI_PROJECT_')) throw error;
    throw new Error('AI_PROJECT_DIRECTORY');
  }
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
