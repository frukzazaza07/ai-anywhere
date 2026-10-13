import { selectProvider, validateSelection, type ProviderSelection } from './providers.js';
import { type RuntimeSnapshot } from './runtime-config.js';

export interface SelectedProfile extends ProviderSelection { profile?: string }

export function selectCommand(config: RuntimeSnapshot, provider?: string | null,
  profile?: string | null): SelectedProfile {
  if (provider != null && profile != null) throw new Error('AI_SELECTION_CONFLICT');
  if (provider != null) return selectProvider(config.providers, provider);
  const selectedName = profile ?? config.defaultProfile;
  const selected = config.profiles.get(selectedName);
  if (!selected) throw new Error('AI_PROFILE_UNAVAILABLE');
  return { ...validateSelection(config.providers, selected), profile: selectedName };
}

export interface Access { guildId: string | null; userId: string }
export interface AccessConfig { guildId: string; allowedUsers: ReadonlySet<string>; adminUsers: ReadonlySet<string> }
export function authorized(access: Access, config: AccessConfig, admin = false): boolean {
  return access.guildId === config.guildId && config.allowedUsers.has(access.userId)
    && (!admin || config.adminUsers.has(access.userId));
}

/** Suggestions carry aliases only; typed values are independently validated at execution. */
export function autocomplete(config: RuntimeSnapshot, access: Access, auth: AccessConfig,
  command: string, option: string, query: string, provider?: string | null): Array<{ name: string; value: string }> {
  const admin = command === 'ai-admin';
  if (!authorized(access, auth, admin)) return [];
  let values: string[] = [];
  if (option === 'project' || (option === 'name' && !admin)) values = [...config.projects.directories.keys()]
    .filter(key => admin || !config.projects.enabled || config.projects.enabled.has(key));
  if (option === 'provider') values = [...(admin ? config.installedProviders : config.providers.enabled)];
  if (option === 'profile' || (option === 'name' && admin)) values = [...config.profiles]
    .filter(([, p]) => admin || config.providers.enabled.has(p.provider)).map(([key]) => key);
  if (option === 'model' && admin && provider && config.installedProviders.has(provider as ProviderSelection['provider'])) {
    values = [...(config.providers.allowedModels?.[provider as ProviderSelection['provider']] ?? [])];
  }
  return values.filter(value => value.length <= 100 && value.toLowerCase().includes(query.toLowerCase())).slice(0, 25)
    .map(value => ({ name: value, value }));
}
