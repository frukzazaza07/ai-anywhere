import { readFile } from 'node:fs/promises';
import { atomicConfigWrite, type RuntimeSnapshot } from './runtime-config.js';
import { cliDefaultModel, isModelName, isProviderId, validateProviderEffort, validateSelection, type ProviderId } from './providers.js';
import { isEffort, validateEffort, type Effort } from './effort.js';
import { selectCommand, type SelectedProfile } from './selection.js';
import { isProjectName } from './projects.js';

export interface ProviderPreference { model?: string | null; effort?: Effort | null }
// defaultProfile records the shared default in effect when the choices were saved.
interface Preferences { provider: ProviderId; providers: Partial<Record<ProviderId, ProviderPreference>>; defaultProfile?: string }
export { cliDefaultModel } from './providers.js';

/**
 * Personal defaults are durable, scoped exactly like Discord conversations.
 * When an admin changes the shared default profile, choices saved under the previous default
 * (or before this was recorded) stop applying until the user saves new ones.
 */
export class ProviderPreferences {
  private entries: Record<string, Preferences> = Object.create(null);
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly write = atomicConfigWrite,
    private readonly currentDefault?: () => string | undefined) {}

  private entry(key: string): Preferences | undefined {
    const entry = this.entries[key];
    if (!entry || !this.currentDefault) return entry;
    return entry.defaultProfile === this.currentDefault() ? entry : undefined;
  }

  async load(): Promise<void> {
    let text: string;
    try { text = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('AI_PREFERENCES_INVALID'); }
    try {
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      const parsed = data as Record<string, unknown>;
      if (parsed.version !== 1 || Object.keys(parsed).some(key => !['version', 'entries'].includes(key))
        || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) throw new Error();
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (!/^\d{17,20}:\d{17,20}:\d{17,20}$/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const entry = value as Record<string, unknown>;
        if (!isProviderId(entry.provider) || Object.keys(entry).some(key => !['provider', 'providers', 'defaultProfile'].includes(key))
          || (entry.defaultProfile !== undefined && !isProjectName(entry.defaultProfile))
          || !entry.providers || typeof entry.providers !== 'object' || Array.isArray(entry.providers)) throw new Error();
        for (const [provider, item] of Object.entries(entry.providers)) {
          if (!isProviderId(provider) || !item || typeof item !== 'object' || Array.isArray(item)) throw new Error();
          const fields = item as Record<string, unknown>;
          if (Object.keys(fields).some(key => !['model', 'effort'].includes(key))
            || (fields.model != null && !isModelName(fields.model))
            || (fields.effort != null && !isEffort(fields.effort))) throw new Error();
        }
      }
      this.entries = parsed.entries as Record<string, Preferences>;
    } catch { throw new Error('AI_PREFERENCES_INVALID'); }
  }

  selectedProvider(key: string): ProviderId | undefined { return this.entry(key)?.provider; }
  get(key: string, provider: ProviderId): ProviderPreference | undefined {
    const value = this.entry(key)?.providers[provider];
    return value ? { ...value } : undefined;
  }

  resolve(config: RuntimeSnapshot, key: string, provider?: string | null, profile?: string | null,
    model?: string | null, effort?: string | null): SelectedProfile {
    if (profile != null) return selectCommand(config, provider, profile, model, effort);
    const selectedProvider = provider ?? this.selectedProvider(key);
    const selected = selectCommand(config, selectedProvider, null, model);
    const saved = this.get(key, selected.provider);
    // Without personal choices, keep the default profile's model, effort and project binding.
    if (!saved) return effort == null ? selected : selectCommand(config, selectedProvider, null, model, effort);
    const chosenModel = model === cliDefaultModel ? undefined
      : model ?? (saved && Object.hasOwn(saved, 'model') ? saved.model ?? undefined : selected.model);
    const chosenEffort = effort === 'default' ? undefined : effort ?? saved?.effort ?? undefined;
    if (chosenModel !== undefined && !config.providers.allowedModels?.[selected.provider]?.includes(chosenModel)) throw new Error('AI_MODEL_NOT_ALLOWED');
    return validateSelection(config.providers, { provider: selected.provider, model: chosenModel,
      ...(chosenEffort !== undefined ? { effort: validateEffort(selected.provider, chosenModel, chosenEffort) } : {}) });
  }

  async save(config: RuntimeSnapshot, key: string, provider: string, change: { model?: string; effort?: string } = {}): Promise<void> {
    const operation = this.queue.catch(() => {}).then(async () => {
      if (!/^\d{17,20}:\d{17,20}:\d{17,20}$/.test(key)) throw new Error('AI_PREFERENCES_INVALID');
      if (!isProviderId(provider) || !config.providers.enabled.has(provider)) throw new Error('AI_PROVIDER_DISABLED');
      const value = this.get(key, provider) ?? {};
      if (change.model !== undefined) {
        if (change.model !== cliDefaultModel && !config.providers.allowedModels?.[provider]?.includes(change.model)) throw new Error('AI_MODEL_NOT_ALLOWED');
        value.model = change.model === cliDefaultModel ? null : change.model;
        // A model's previous effort can be incompatible with the newly chosen model.
        try { validateProviderEffort(config.providers, provider, value.model ?? undefined, value.effort ?? undefined); } catch { value.effort = null; }
      }
      const model = Object.hasOwn(value, 'model') ? value.model ?? undefined : config.providers.models[provider];
      if (change.effort !== undefined) value.effort = change.effort === 'default' ? null : validateProviderEffort(config.providers, provider, model, change.effort);
      const next = structuredClone(this.entries);
      // Choices saved under an earlier default profile are not carried forward.
      next[key] = { provider, providers: { ...this.entry(key)?.providers, [provider]: value }, defaultProfile: config.defaultProfile };
      try { await this.write(this.file, JSON.stringify({ version: 1, entries: next }, null, 2) + '\n'); }
      catch { throw new Error('AI_PREFERENCES_SAVE'); }
      this.entries = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
