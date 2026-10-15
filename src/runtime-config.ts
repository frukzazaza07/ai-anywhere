import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { readFile, writeFile, rename, rm, link } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { providerConfig } from './config.js';
import { isProjectName, prepareProjectDirectory, prepareProjectPath, projectConfig, type ProjectConfig } from './projects.js';
import { isModelName, isProviderId, providerIds, type ProviderConfig, type ProviderId } from './providers.js';
import { parseModelCatalog, type CliModel } from './model-catalog.js';

export interface Profile { provider: ProviderId; model?: string; project?: string }
interface LocalProject { directory: string; enabled: boolean }
interface LocalProvider { enabled: boolean; models: string[]; defaultModel?: string; executable?: string; script?: string }
interface BaseConfig {
  projectRoots?: Record<string, string>;
  projects: Record<string, LocalProject>;
  providers: Partial<Record<ProviderId, LocalProvider>>;
  profiles: Record<string, Profile>;
  defaultProject: string;
  defaultProfile: string;
}
export interface ConfigOverrides {
  catalogs?: Partial<Record<ProviderId, CliModel[]>>;
  projects?: Record<string, boolean>;
  providers?: Partial<Record<ProviderId, boolean>>;
  profiles?: Record<string, Profile | null>;
  defaultProject?: string;
  defaultProfile?: string;
}
export interface RuntimeSnapshot {
  revision: number;
  source: 'file' | 'environment' | 'setup';
  projects: ProjectConfig;
  projectRoots: ReadonlyMap<string, string>;
  providers: ProviderConfig;
  installedProviders: ReadonlySet<ProviderId>;
  profiles: ReadonlyMap<string, Profile>;
  defaultProfile: string;
}
export type ConfigChange =
  | { kind: 'add-project'; name: string; root?: string; directory?: string; create: boolean }
  | { kind: 'add-provider'; provider: ProviderId; models?: string; defaultModel?: string }
  | { kind: 'add-profile'; name: string; profile: Profile }
  | { kind: 'profile'; name: string; profile: Profile }
  | { kind: 'delete-profile'; name: string }
  | { kind: 'project'; name: string; enabled: boolean }
  | { kind: 'provider'; name: string; enabled: boolean }
  | { kind: 'defaults'; project?: string; profile?: string };

function invalid(): never { throw new Error('AI_CONFIG_INVALID'); }
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (keys && Object.keys(result).some(key => !keys.includes(key))) return invalid();
  return result;
}
function name(value: unknown): string { if (!isProjectName(value)) return invalid(); return value; }
function enabled(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function profile(value: unknown): Profile {
  const p = object(value, ['provider', 'model', 'project']);
  if (!isProviderId(p.provider) || (p.model !== undefined && !isModelName(p.model))) return invalid();
  return { provider: p.provider, ...(p.model !== undefined ? { model: p.model as string } : {}),
    ...(p.project !== undefined ? { project: name(p.project) } : {}) };
}
function parseBase(value: unknown, baseDirectory: string): BaseConfig {
  const data = object(value, ['version', 'projectRoots', 'projects', 'providers', 'profiles', 'defaultProject', 'defaultProfile']);
  if (data.version !== 1) return invalid();
  const projectRoots: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(data.projectRoots === undefined ? {} : object(data.projectRoots))) {
    name(key);
    if (typeof value !== 'string' || !value.trim()) return invalid();
    const directory = realpathSync(resolve(baseDirectory, value));
    if (!statSync(directory).isDirectory()) return invalid();
    projectRoots[key] = directory;
  }
  const projects: BaseConfig['projects'] = Object.create(null);
  for (const [key, value] of Object.entries(object(data.projects))) {
    name(key);
    const p = object(value, ['directory', 'enabled']);
    if (typeof p.directory !== 'string' || !p.directory.trim()) return invalid();
    const directory = realpathSync(resolve(baseDirectory, p.directory));
    if (!statSync(directory).isDirectory()) return invalid();
    projects[key] = { directory, enabled: p.enabled === undefined ? true : enabled(p.enabled) };
  }
  const providers: BaseConfig['providers'] = Object.create(null);
  for (const [key, value] of Object.entries(object(data.providers))) {
    if (!isProviderId(key)) return invalid();
    const p = object(value, ['enabled', 'models', 'defaultModel', 'executable', 'script']);
    if (!Array.isArray(p.models) || !p.models.every(isModelName) || new Set(p.models).size !== p.models.length
      || (p.defaultModel !== undefined && (!isModelName(p.defaultModel) || !p.models.includes(p.defaultModel)))) return invalid();
    if (p.executable !== undefined && (key !== 'claude' || typeof p.executable !== 'string'
      || !isAbsolute(p.executable) || /\.(cmd|bat|ps1|[cm]?js)$/i.test(p.executable) || !statSync(p.executable).isFile())) return invalid();
    if (p.script !== undefined && (key !== 'gemini' || typeof p.script !== 'string'
      || !isAbsolute(p.script) || !/\.[cm]?js$/i.test(p.script) || !statSync(p.script).isFile())) return invalid();
    if (key === 'gemini' && p.script === undefined) return invalid();
    providers[key] = { enabled: p.enabled === undefined ? true : enabled(p.enabled), models: [...p.models],
      defaultModel: p.defaultModel as string | undefined, executable: p.executable as string | undefined,
      script: p.script as string | undefined };
  }
  const profiles: BaseConfig['profiles'] = Object.create(null);
  for (const [key, value] of Object.entries(object(data.profiles))) profiles[name(key)] = profile(value);
  return { ...(data.projectRoots !== undefined ? { projectRoots } : {}),
    projects, providers, profiles, defaultProject: name(data.defaultProject), defaultProfile: name(data.defaultProfile) };
}
function parseOverrides(value: unknown): ConfigOverrides {
  const data = object(value, ['projects', 'providers', 'profiles', 'defaultProject', 'defaultProfile', 'catalogs']);
  const result: ConfigOverrides = {};
  if (data.catalogs !== undefined) {
    result.catalogs = {};
    for (const [key, value] of Object.entries(object(data.catalogs))) {
      if (!isProviderId(key)) return invalid();
      result.catalogs[key] = parseModelCatalog(value);
    }
  }
  if (data.projects !== undefined) result.projects = Object.fromEntries(Object.entries(object(data.projects))
    .map(([key, value]) => [name(key), enabled(value)]));
  if (data.providers !== undefined) {
    result.providers = {};
    for (const [key, value] of Object.entries(object(data.providers))) {
      if (!isProviderId(key)) return invalid();
      result.providers[key] = enabled(value);
    }
  }
  if (data.profiles !== undefined) result.profiles = Object.fromEntries(Object.entries(object(data.profiles))
    .map(([key, value]) => [name(key), value === null ? null : profile(value)]));
  if (data.defaultProject !== undefined) result.defaultProject = name(data.defaultProject);
  if (data.defaultProfile !== undefined) result.defaultProfile = name(data.defaultProfile);
  return result;
}
function legacyBase(env: NodeJS.ProcessEnv, directory: string): BaseConfig {
  const projects = projectConfig(env, directory);
  const providers = providerConfig(env);
  return {
    projects: Object.fromEntries([...projects.directories].map(([key, directory]) => [key, { directory, enabled: true }])),
    providers: Object.fromEntries([...providers.enabled].map(key => [key, { enabled: true,
      models: providers.models[key] ? [providers.models[key]!] : [], defaultModel: providers.models[key],
      executable: key === 'claude' ? providers.claudeExecutable : undefined,
      script: key === 'gemini' ? providers.geminiScript : undefined }])),
    profiles: Object.fromEntries([...providers.enabled].map(key => [key, { provider: key, model: providers.models[key] }])),
    defaultProject: projects.defaultProject, defaultProfile: providers.defaultProvider,
  };
}
function snapshot(base: BaseConfig, overrides: ConfigOverrides, revision: number, source: RuntimeSnapshot['source']): RuntimeSnapshot {
  const merged = structuredClone(base);
  const modelEfforts: NonNullable<ProviderConfig['modelEfforts']> = {};
  for (const [key, value] of Object.entries(overrides.catalogs ?? {})) {
    if (!isProviderId(key) || !merged.providers[key]) return invalid();
    const models = parseModelCatalog(value);
    merged.providers[key]!.models = [...new Set([...merged.providers[key]!.models, ...models.map(item => item.model)])];
    modelEfforts[key] = Object.fromEntries(models.filter(item => item.efforts !== undefined).map(item => [item.model, item.efforts!]));
  }
  for (const [key, value] of Object.entries(overrides.projects ?? {})) {
    if (!Object.hasOwn(merged.projects, key)) return invalid();
    merged.projects[key]!.enabled = value;
  }
  for (const [key, value] of Object.entries(overrides.providers ?? {})) {
    if (!isProviderId(key) || !merged.providers[key]) return invalid();
    merged.providers[key]!.enabled = value;
  }
  for (const [key, value] of Object.entries(overrides.profiles ?? {})) {
    // A stale deletion is also rejected on reload; local edits must reconcile overrides.
    if (value === null) { if (!Object.hasOwn(merged.profiles, key)) return invalid(); delete merged.profiles[key]; }
    else merged.profiles[key] = value;
  }
  merged.defaultProject = overrides.defaultProject ?? base.defaultProject;
  merged.defaultProfile = overrides.defaultProfile ?? base.defaultProfile;
  for (const p of Object.values(merged.profiles)) {
    const installed = merged.providers[p.provider];
    if (!installed || (p.model !== undefined && !installed.models.includes(p.model))
      || (p.project !== undefined && !Object.hasOwn(merged.projects, p.project))) return invalid();
  }
  const defaultProfile = merged.profiles[merged.defaultProfile];
  if (!Object.hasOwn(merged.projects, merged.defaultProject) || !merged.projects[merged.defaultProject]?.enabled
    || !Object.hasOwn(merged.profiles, merged.defaultProfile) || !defaultProfile
    || !merged.providers[defaultProfile.provider]?.enabled
    || (defaultProfile.project !== undefined && !merged.projects[defaultProfile.project]?.enabled)) return invalid();
  const models: ProviderConfig['models'] = {};
  const allowedModels: NonNullable<ProviderConfig['allowedModels']> = {};
  for (const id of providerIds) {
    const provider = merged.providers[id];
    if (provider) { models[id] = provider.defaultModel; allowedModels[id] = [...provider.models]; }
  }
  return { revision, source, defaultProfile: merged.defaultProfile,
    projectRoots: new Map(Object.entries(base.projectRoots ?? {})),
    projects: { directories: new Map(Object.entries(merged.projects).map(([key, p]) => [key, p.directory])),
      enabled: new Set(Object.keys(merged.projects).filter(key => merged.projects[key]!.enabled)), defaultProject: merged.defaultProject },
    providers: { enabled: new Set(providerIds.filter(id => merged.providers[id]?.enabled)),
      defaultProvider: defaultProfile.provider, models, allowedModels, modelEfforts,
      claudeExecutable: merged.providers.claude?.executable, geminiScript: merged.providers.gemini?.script },
    installedProviders: new Set(providerIds.filter(id => merged.providers[id])), profiles: new Map(Object.entries(merged.profiles)) };
}

export async function atomicConfigWrite(file: string, text: string, beforePublish?: () => Promise<void>): Promise<void> {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await beforePublish?.();
    await rename(temporary, file);
  }
  finally { await rm(temporary, { force: true }); }
}
export async function atomicConfigCreate(file: string, text: string): Promise<void> {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    // Publish the completed file without replacing an operator's concurrent copy.
    await link(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
export interface InitDefaults { project?: string; profile?: string; revision?: number }
interface RuntimeOptions {
  file: string;
  overridesFile: string;
  env?: NodeJS.ProcessEnv;
  allowSetup?: boolean;
  busy?: () => boolean;
  write?: typeof atomicConfigWrite;
  create?: typeof atomicConfigCreate;
}
/** Publishes a validated generation only after durable overrides are written. */
export class RuntimeConfig {
  readonly instanceId = randomUUID();
  private base!: BaseConfig;
  private baseText?: string;
  private overrides: ConfigOverrides = {};
  private current!: RuntimeSnapshot;
  private queue: Promise<unknown> = Promise.resolve();
  private changing = false;
  private readonly listeners: Array<() => Promise<void>> = [];
  constructor(private readonly options: RuntimeOptions) {}
  get value(): RuntimeSnapshot { return this.current; }
  get updating(): boolean { return this.changing; }
  onChange(listener: () => Promise<void>): void { this.listeners.push(listener); }
  exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.queue.catch(() => {}).then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  private async read(): Promise<{ base: BaseConfig; overrides: ConfigOverrides; source: RuntimeSnapshot['source']; text?: string }> {
    let base: BaseConfig;
    let source: RuntimeSnapshot['source'] = 'file';
    let text: string | undefined;
    try { text = await readFile(this.options.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (text === undefined) {
      source = 'environment';
      const env = this.options.env ?? process.env;
      const directory = dirname(this.options.file);
      let projectsValid = true;
      try { projectConfig(env, directory); } catch { projectsValid = false; }
      if (!projectsValid && this.options.allowSetup) {
        // This candidate is fixed on the host, never supplied through Discord.
        source = 'setup';
        base = legacyBase({ ...env, AI_PROJECTS: '', AI_WORKDIR: directory,
          CODEX_WORKDIR: '', AI_DEFAULT_PROJECT: 'default' }, directory);
      } else base = legacyBase(env, directory);
    }
    else base = parseBase(JSON.parse(text), dirname(this.options.file));
    let overrides: ConfigOverrides = {};
    try { overrides = parseOverrides(JSON.parse(await readFile(this.options.overridesFile, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { base, overrides, source, text };
  }
  async load(): Promise<void> { await this.reload(); }
  /** Trust only catalogs returned by fixed local metadata adapters, never chat-provided IDs. */
  async updateModelCatalog(provider: ProviderId, models: readonly CliModel[], revision = this.current.revision): Promise<void> {
    const catalog = parseModelCatalog(models);
    if (revision !== this.current.revision) throw new Error('AI_CONFIG_PICKER_STALE');
    if (!this.current.providers.enabled.has(provider)) throw new Error('AI_PROVIDER_DISABLED');
    if (JSON.stringify(this.overrides.catalogs?.[provider] ?? []) === JSON.stringify(catalog)) return;
    await this.mutate(async () => {
      if (revision !== this.current.revision) throw new Error('AI_CONFIG_PICKER_STALE');
      const overrides = structuredClone(this.overrides);
      (overrides.catalogs ??= {})[provider] = catalog;
      const next = snapshot(this.base, overrides, this.current.revision + 1, this.current.source);
      try { await (this.options.write ?? atomicConfigWrite)(this.options.overridesFile, JSON.stringify(overrides, null, 2) + '\n'); }
      catch { throw new Error('AI_CONFIG_SAVE'); }
      this.overrides = overrides; this.current = next;
    });
  }
  async reload(): Promise<void> {
    return this.mutate(async () => {
      let loaded: Awaited<ReturnType<RuntimeConfig['read']>>;
      let next: RuntimeSnapshot;
      try { loaded = await this.read(); next = snapshot(loaded.base, loaded.overrides, (this.current?.revision ?? 0) + 1, loaded.source); }
      catch { throw new Error('AI_CONFIG_INVALID'); }
      this.base = loaded.base; this.baseText = loaded.text; this.overrides = loaded.overrides; this.current = next;
    });
  }
  async initialize(defaults: InitDefaults = {}): Promise<boolean> {
    let created = false;
    await this.mutate(async () => {
      if (defaults.revision !== undefined && defaults.revision !== this.current.revision) throw new Error('AI_INIT_STALE');
      if (this.current.source === 'file') return;
      let loaded: Awaited<ReturnType<RuntimeConfig['read']>>;
      let base: BaseConfig;
      let next: RuntimeSnapshot;
      try {
        loaded = await this.read();
        if (loaded.source === 'file') throw new Error('AI_CONFIG_EXISTS');
        base = parseBase({ version: 1, ...loaded.base,
          defaultProject: defaults.project === undefined ? loaded.base.defaultProject : name(defaults.project),
          defaultProfile: defaults.profile === undefined ? loaded.base.defaultProfile : name(defaults.profile) }, dirname(this.options.file));
        next = snapshot(base, loaded.overrides, this.current.revision + 1, 'file');
        if ((defaults.project !== undefined && next.projects.defaultProject !== defaults.project)
          || (defaults.profile !== undefined && next.defaultProfile !== defaults.profile)) throw new Error('AI_INIT_DEFAULT_OVERRIDE');
      } catch (error) {
        if (error instanceof Error && ['AI_CONFIG_EXISTS', 'AI_INIT_DEFAULT_OVERRIDE'].includes(error.message)) throw error;
        throw new Error('AI_CONFIG_INVALID');
      }
      const text = JSON.stringify({ version: 1, ...base }, null, 2) + '\n';
      try {
        await (this.options.create ?? atomicConfigCreate)(this.options.file, text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('AI_CONFIG_EXISTS');
        throw new Error('AI_INIT_SAVE');
      }
      this.base = base; this.baseText = text; this.overrides = loaded.overrides; this.current = next;
      created = true;
    });
    return created;
  }
  private async mutate(operation: () => Promise<void>): Promise<void> {
    if (this.options.busy?.() || this.changing) throw new Error('CODEX_BUSY');
    this.changing = true;
    try {
      await this.exclusive(async () => {
        if (this.options.busy?.()) throw new Error('CODEX_BUSY');
        // Flush previously failed job pauses before persisting another config generation.
        try { for (const listener of this.listeners) await listener(); }
        catch { throw new Error('AI_CONFIG_JOBS_PENDING'); }
        await operation();
        // Pauses are applied before another dispatch can enter the gate.
        try { for (const listener of this.listeners) await listener(); }
        catch { throw new Error('AI_CONFIG_JOBS_APPLIED'); }
      });
    } finally { this.changing = false; }
  }
  async change(change: ConfigChange): Promise<void> {
    if (change.kind === 'add-project') return this.addProject(change);
    if (change.kind === 'add-provider') return this.addProvider(change);
    return this.mutate(async () => {
      const overrides = structuredClone(this.overrides);
      try {
        if (change.kind === 'add-profile' && this.current.profiles.has(change.name)) throw new Error('AI_PROFILE_EXISTS');
        if (change.kind === 'profile' || change.kind === 'add-profile') {
          (overrides.profiles ??= {})[name(change.name)] = profile(change.profile);
        }
        if (change.kind === 'delete-profile') {
          if (!this.current.profiles.has(change.name) || change.name === this.current.defaultProfile) return invalid();
          if (Object.hasOwn(this.base.profiles, change.name)) (overrides.profiles ??= {})[change.name] = null;
          else delete overrides.profiles?.[change.name];
        }
        if (change.kind === 'project') (overrides.projects ??= {})[name(change.name)] = enabled(change.enabled);
        if (change.kind === 'provider') {
          if (!isProviderId(change.name)) return invalid();
          (overrides.providers ??= {})[change.name] = enabled(change.enabled);
        }
        if (change.kind === 'defaults') {
          if (change.project !== undefined) overrides.defaultProject = name(change.project);
          if (change.profile !== undefined) overrides.defaultProfile = name(change.profile);
          if (change.project === undefined && change.profile === undefined) return invalid();
        }
        const next = snapshot(this.base, overrides, this.current.revision + 1, this.current.source);
        try { await (this.options.write ?? atomicConfigWrite)(this.options.overridesFile, JSON.stringify(overrides, null, 2) + '\n'); }
        catch { throw new Error('AI_CONFIG_SAVE'); }
        this.overrides = overrides; this.current = next;
      } catch (error) {
        if (error instanceof Error && ['AI_CONFIG_SAVE', 'AI_PROFILE_EXISTS'].includes(error.message)) throw error;
        throw new Error('AI_CONFIG_INVALID');
      }
    });
  }
  private async addProvider(change: Extract<ConfigChange, { kind: 'add-provider' }>): Promise<void> {
    return this.mutate(async () => {
      if (this.current.source !== 'file') throw new Error('AI_PROVIDER_SETUP');
      if (!isProviderId(change.provider)) throw new Error('AI_CONFIG_INVALID');
      if (this.current.installedProviders.has(change.provider)) throw new Error('AI_PROVIDER_EXISTS');
      const models = change.models === undefined ? [] : change.models.split(',').map(value => value.trim());
      if (!models.every(isModelName) || new Set(models).size !== models.length
        || (change.defaultModel !== undefined && !isModelName(change.defaultModel))) throw new Error('AI_CONFIG_INVALID');
      // Installation paths come exclusively from host settings, never Discord options.
      const env = this.options.env ?? process.env;
      const modelKey = change.provider.toUpperCase() + '_MODEL';
      let local: ProviderConfig;
      try {
        local = providerConfig({ AI_PROVIDERS: change.provider, AI_DEFAULT_PROVIDER: change.provider,
          [modelKey]: env[modelKey],
          ...(change.provider === 'claude' ? { CLAUDE_EXECUTABLE: env.CLAUDE_EXECUTABLE } : {}),
          ...(change.provider === 'gemini' ? { GEMINI_CLI_SCRIPT: env.GEMINI_CLI_SCRIPT } : {}) });
      } catch { throw new Error('AI_PROVIDER_INSTALLATION'); }
      const defaultModel = change.defaultModel ?? local.models[change.provider];
      if (defaultModel !== undefined && !models.includes(defaultModel)) models.push(defaultModel);
      const checkConfig = async () => {
        try {
          const loaded = await this.read();
          if (loaded.text !== this.baseText || !isDeepStrictEqual(loaded.base, this.base)
            || !isDeepStrictEqual(loaded.overrides, this.overrides)) throw new Error();
        } catch { throw new Error('AI_PROVIDER_CONFIG_CHANGED'); }
      };
      await checkConfig();
      const document = object(JSON.parse(this.baseText!));
      const providers = object(document.providers);
      providers[change.provider] = { enabled: true, models, ...(defaultModel !== undefined ? { defaultModel } : {}),
        ...(change.provider === 'claude' && local.claudeExecutable ? { executable: local.claudeExecutable } : {}),
        ...(change.provider === 'gemini' ? { script: local.geminiScript } : {}) };
      let base: BaseConfig;
      let next: RuntimeSnapshot;
      try {
        base = parseBase(document, dirname(this.options.file));
        next = snapshot(base, this.overrides, this.current.revision + 1, 'file');
      } catch { throw new Error('AI_CONFIG_INVALID'); }
      const text = JSON.stringify(document, null, 2) + '\n';
      try { await (this.options.write ?? atomicConfigWrite)(this.options.file, text, checkConfig); }
      catch (error) {
        if (error instanceof Error && error.message === 'AI_PROVIDER_CONFIG_CHANGED') throw error;
        throw new Error('AI_PROVIDER_SAVE');
      }
      this.base = base; this.baseText = text; this.current = next;
    });
  }
  private async addProject(change: Extract<ConfigChange, { kind: 'add-project' }>): Promise<void> {
    return this.mutate(async () => {
      if (this.current.source !== 'file') throw new Error('AI_PROJECT_SETUP');
      if (!isProjectName(change.name)) throw new Error('AI_PROJECT_NAME');
      if (typeof change.create !== 'boolean') throw new Error('AI_CONFIG_INVALID');
      if (this.current.projects.directories.has(change.name)) throw new Error('AI_PROJECT_EXISTS');
      if ((change.root === undefined) === (change.directory === undefined)) throw new Error('AI_PROJECT_LOCATION');
      const root = change.root === undefined ? undefined : this.current.projectRoots.get(change.root);
      if (change.root !== undefined && (!isProjectName(change.root) || !root)) throw new Error('AI_PROJECT_ROOT');
      const checkConfig = async () => {
        try {
          const loaded = await this.read();
          if (loaded.text !== this.baseText || !isDeepStrictEqual(loaded.base, this.base)
            || !isDeepStrictEqual(loaded.overrides, this.overrides)) {
            throw new Error('AI_PROJECT_CONFIG_CHANGED');
          }
        } catch { throw new Error('AI_PROJECT_CONFIG_CHANGED'); }
      };
      await checkConfig();
      const prepared = change.directory !== undefined ? prepareProjectPath(change.directory, change.create)
        : prepareProjectDirectory(root!, change.name, change.create);
      try {
        let directory = prepared.directory;
        const target = realpathSync.native(directory);
        // Preserve existing session/schedule identity for alternate Windows path spellings.
        for (const configured of this.current.projects.directories.values()) {
          if (realpathSync.native(configured) === target) { directory = configured; break; }
        }
        const document = object(JSON.parse(this.baseText!));
        const projects = object(document.projects);
        // Define a data property even for valid names such as constructor.
        Object.defineProperty(projects, change.name, { value: { directory, enabled: true },
          enumerable: true, configurable: true, writable: true });
        const base = parseBase(document, dirname(this.options.file));
        const next = snapshot(base, this.overrides, this.current.revision + 1, 'file');
        const text = JSON.stringify(document, null, 2) + '\n';
        const beforePublish = async () => { await checkConfig(); prepared.verify(); };
        await beforePublish();
        try { await (this.options.write ?? atomicConfigWrite)(this.options.file, text, beforePublish); }
        catch (error) {
          if (error instanceof Error && ['AI_PROJECT_CONFIG_CHANGED', 'AI_PROJECT_DIRECTORY'].includes(error.message)) throw error;
          throw new Error('AI_PROJECT_SAVE');
        }
        this.base = base; this.baseText = text; this.current = next;
      } catch (error) {
        prepared.rollback();
        if (error instanceof Error && error.message.startsWith('AI_')) throw error;
        throw new Error('AI_CONFIG_INVALID');
      }
    });
  }
  status(): string {
    const c = this.current;
    return ['Config source: ' + c.source + ' | Revision: ' + c.revision,
      ...(c.source === 'setup' ? ['Setup required: an admin must complete /ai init before tasks can run.',
        'Project default uses the bot startup directory. Configure other folders locally before setup.'] : []),
      'Default project: ' + c.projects.defaultProject + ' | Default profile: ' + c.defaultProfile,
      'Project roots: ' + ([...c.projectRoots.keys()].join(', ') || 'none'),
      'Projects: ' + [...c.projects.directories.keys()].map(key => key + (c.projects.enabled?.has(key) ? '' : ' (disabled)')).join(', '),
      'Providers: ' + [...c.installedProviders].map(key => key + (c.providers.enabled.has(key) ? '' : ' (disabled)')).join(', '),
      'Profiles:', ...[...c.profiles].map(([key, p]) => key + ': ' + p.provider + ' / ' + (p.model ?? 'CLI default')
        + ' / project: ' + (p.project ?? 'current project (legacy)'))].join('\n');
  }
}
