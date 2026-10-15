import { cliDefaultModel, providerEffortChoices, selectProvider, validateProviderEffort, validateSelection, type ProviderSelection } from './providers.js';
import { type RuntimeSnapshot } from './runtime-config.js';
import { selectProject } from './projects.js';

export interface SelectedProfile extends ProviderSelection { profile?: string; project?: string }

/** Bound profiles keep the same target across run, status, result and resets. */
export function profileProject(selection: SelectedProfile, project?: string | null): string | undefined {
  if (selection.project !== undefined && project != null && project !== selection.project) {
    throw new Error('AI_PROFILE_PROJECT_CONFLICT');
  }
  return selection.project ?? project ?? undefined;
}

export function selectCommand(config: RuntimeSnapshot, provider?: string | null,
  profile?: string | null, model?: string | null, effort?: string | null): SelectedProfile {
  if (effort != null) {
    const selected = selectCommand(config, provider, profile, model);
    const chosenEffort = effort === 'default' ? undefined : validateProviderEffort(config.providers, selected.provider, selected.model, effort);
    return { ...selected, ...(chosenEffort !== undefined ? { effort: chosenEffort } : {}) };
  }
  if (profile != null && (provider != null || model != null)) throw new Error('AI_SELECTION_CONFLICT');
  if (provider != null) {
    const selected = selectProvider(config.providers, provider);
    if (model != null && model !== cliDefaultModel && !config.providers.allowedModels?.[selected.provider]?.includes(model)) throw new Error('AI_MODEL_NOT_ALLOWED');
    return validateSelection(config.providers, { ...selected, model: model === cliDefaultModel ? undefined : model ?? selected.model });
  }
  const selectedName = profile ?? config.defaultProfile;
  const selected = config.profiles.get(selectedName);
  if (!selected) throw new Error('AI_PROFILE_UNAVAILABLE');
  if (model != null) {
    if (model !== cliDefaultModel && !config.providers.allowedModels?.[selected.provider]?.includes(model)) throw new Error('AI_MODEL_NOT_ALLOWED');
    return validateSelection(config.providers, { provider: selected.provider, model: model === cliDefaultModel ? undefined : model });
  }
  if (selected.project !== undefined) selectProject(config.projects, selected.project);
  return { ...validateSelection(config.providers, selected), profile: selectedName,
    ...(selected.project !== undefined ? { project: selected.project } : {}) };
}

export interface Access { guildId: string | null; userId: string }
export interface AccessConfig { guildId: string; allowedUsers: ReadonlySet<string>; adminUsers: ReadonlySet<string> }
export function authorized(access: Access, config: AccessConfig, admin = false): boolean {
  return access.guildId === config.guildId && config.allowedUsers.has(access.userId)
    && (!admin || config.adminUsers.has(access.userId));
}

/** Suggestions carry aliases only; typed values are independently validated at execution. */
export function autocomplete(config: RuntimeSnapshot, access: Access, auth: AccessConfig,
  command: string, option: string, query: string, provider?: string | null, adminOnly = false,
  profile?: string | null, model?: string | null): Array<{ name: string; value: string }> {
  const admin = command === 'ai-admin';
  if (!authorized(access, auth, admin || adminOnly)) return [];
  let values: string[] = [];
  if (option === 'root' && admin) values = [...config.projectRoots.keys()];
  if (option === 'effort') {
    try {
      const selected = selectCommand(config, provider, profile, model);
      values = ['default', ...providerEffortChoices(config.providers, selected.provider, selected.model)];
    } catch { return []; }
  }
  if (option === 'project' || (option === 'name' && !admin)) values = [...config.projects.directories.keys()]
    .filter(key => admin || !config.projects.enabled || config.projects.enabled.has(key));
  if (option === 'provider') values = [...(admin ? config.installedProviders : config.providers.enabled)];
  if (option === 'profile' || (option === 'name' && admin)) values = [...config.profiles]
    .filter(([, p]) => admin || (config.providers.enabled.has(p.provider)
      && (p.project === undefined || (config.projects.directories.has(p.project)
        && (!config.projects.enabled || config.projects.enabled.has(p.project)))))).map(([key]) => key);
  if (option === 'model' && admin && provider && config.installedProviders.has(provider as ProviderSelection['provider'])) {
    values = [...(config.providers.allowedModels?.[provider as ProviderSelection['provider']] ?? [])];
  }
  if (option === 'model' && !admin && !adminOnly) {
    try {
      // Autocomplete is local and immediate; it never launches a CLI or changes permissions.
      if (profile != null) return [];
      const selected = selectCommand(config, provider);
      values = [...(config.providers.allowedModels?.[selected.provider] ?? [])];
    } catch { return []; }
  }
  return values.filter(value => value.length <= 100 && value.toLowerCase().includes(query.toLowerCase())).slice(0, 25)
    .map(value => ({ name: value, value }));
}
