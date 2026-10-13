import { discoverProviderModels, type ProviderDiscoveryOptions } from './provider-discovery.js';
import { isProviderId, providerLabels, type ProviderId } from './providers.js';
import { type RuntimeConfig } from './runtime-config.js';

/** Coalesce bounded metadata probes; startup never depends on installed CLI availability. */
export class ModelCatalogService {
  private readonly pending = new Map<ProviderId, Promise<string>>();
  private readonly refreshed = new Map<ProviderId, { revision: number; time: number; note: string }>();
  constructor(private readonly runtime: RuntimeConfig, private readonly discover = discoverProviderModels,
    private readonly busy = () => false, private readonly now = Date.now) {}

  async refresh(provider: string, force = false): Promise<string> {
    if (!isProviderId(provider) || !this.runtime.value.providers.enabled.has(provider)) throw new Error('AI_PROVIDER_DISABLED');
    if (this.busy() || this.runtime.updating) return 'The AI worker is busy. Showing saved model choices; refresh after it finishes.';
    const pending = this.pending.get(provider);
    if (pending) return pending;
    const cached = this.refreshed.get(provider);
    if (!force && cached?.revision === this.runtime.value.revision && this.now() - cached.time < 60000) return cached.note;
    const operation = this.probe(provider);
    this.pending.set(provider, operation);
    try { return await operation; } finally { if (this.pending.get(provider) === operation) this.pending.delete(provider); }
  }

  private async probe(provider: ProviderId): Promise<string> {
    const config = this.runtime.value;
    let note: string;
    if (this.busy() || this.runtime.updating) note = 'The AI worker is busy. Showing saved model choices; refresh after it finishes.';
    else {
      const options: ProviderDiscoveryOptions = { workdir: config.projects.directories.get(config.projects.defaultProject)!,
        claudeExecutable: config.providers.claudeExecutable, geminiScript: config.providers.geminiScript };
      try {
        const models = await this.discover(provider, options);
        await this.runtime.updateModelCatalog(provider, models, config.revision);
        note = 'Model choices loaded from ' + providerLabels[provider] + ' CLI. Account access is checked when a task runs.';
      } catch (error) {
        if (error instanceof Error && error.message === 'CODEX_BUSY') return 'The AI worker is busy. Showing saved model choices; refresh after it finishes.';
        if (error instanceof Error && ['AI_CONFIG_PICKER_STALE', 'AI_PROVIDER_DISABLED', 'AI_CONFIG_INVALID', 'AI_CONFIG_SAVE', 'AI_CONFIG_JOBS_PENDING', 'AI_CONFIG_JOBS_APPLIED'].includes(error.message)) throw error;
        note = providerLabels[provider] + ' CLI model discovery unavailable. Showing saved/configured choices. Check local CLI installation and login, then refresh.';
      }
    }
    this.refreshed.set(provider, { revision: this.runtime.value.revision, time: this.now(), note });
    return note;
  }
}
