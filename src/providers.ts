import { effortChoices, validateEffort, type Effort } from './effort.js';

export const providerIds = ['codex', 'claude', 'gemini'] as const;
export type ProviderId = typeof providerIds[number];
export const cliDefaultModel = '__default__';

export const providerLabels: Record<ProviderId, string> = {
  codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI',
};

export interface ProviderSelection {
  provider: ProviderId;
  model?: string;
  effort?: Effort;
}

export interface ProviderConfig {
  enabled: ReadonlySet<ProviderId>;
  defaultProvider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  allowedModels?: Partial<Record<ProviderId, readonly string[]>>;
  modelEfforts?: Partial<Record<ProviderId, Readonly<Record<string, readonly Effort[]>>>>;
  claudeExecutable?: string;
  geminiScript?: string;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && providerIds.some(id => id === value);
}

export function isModelName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(value);
}

/** Resolve only an enabled provider and its operator-configured model. */
export function selectProvider(config: ProviderConfig, value?: string | null): ProviderSelection {
  const provider = value ?? config.defaultProvider;
  if (!isProviderId(provider) || !config.enabled.has(provider)) throw new Error('AI_PROVIDER_DISABLED');
  return { provider, model: config.models[provider] };
}

export function defaultProviderConfig(): ProviderConfig {
  return { enabled: new Set(['codex']), defaultProvider: 'codex', models: {} };
}

export function validateSelection(config: ProviderConfig, selection: ProviderSelection): ProviderSelection {
  if (!isProviderId(selection.provider) || !config.enabled.has(selection.provider)) throw new Error('AI_PROVIDER_DISABLED');
  const allowed = config.allowedModels?.[selection.provider];
  if (allowed ? selection.model !== undefined && !allowed.includes(selection.model)
    : selection.model !== config.models[selection.provider]) throw new Error('AI_INVALID_SELECTION');
  const effort = validateProviderEffort(config, selection.provider, selection.model, selection.effort);
  return { provider: selection.provider, model: selection.model, ...(effort !== undefined ? { effort } : {}) };
}

export function providerEffortChoices(config: ProviderConfig, provider: ProviderId, model?: string): readonly Effort[] {
  return (model !== undefined ? config.modelEfforts?.[provider]?.[model] : undefined) ?? effortChoices(provider, model);
}

export function validateProviderEffort(config: ProviderConfig, provider: ProviderId, model: string | undefined, value: unknown): Effort | undefined {
  const effort = validateEffort(provider, model, value);
  if (effort !== undefined && !providerEffortChoices(config, provider, model).includes(effort)) throw new Error('AI_EFFORT_INVALID');
  return effort;
}
