import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverCodexModels } from './model-discovery.js';
import { modelCatalog, modelsText, type ModelCatalog } from './models.js';
import { isProviderId, type ProviderId } from './providers.js';
import { RuntimeConfig, type RuntimeSnapshot } from './runtime-config.js';
import { discoverProviderModels } from './provider-discovery.js';

export interface ModelsArguments { provider?: ProviderId; discover: boolean; json: boolean }
export function parseModelsArguments(args: readonly string[]): ModelsArguments {
  const result: ModelsArguments = { discover: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const provider = args[i + 1];
    if (arg === '--provider' && result.provider === undefined && isProviderId(provider)) {
      result.provider = provider;
      i++;
    }
    else if (arg === '--discover' && !result.discover) result.discover = true;
    else if (arg === '--json' && !result.json) result.json = true;
    else throw new Error('AI_MODELS_ARGUMENTS');
  }
  return result;
}

export async function listModels(config: RuntimeSnapshot, args: ModelsArguments,
  discover: typeof discoverCodexModels = discoverCodexModels,
  discoverProvider: typeof discoverProviderModels = discoverProviderModels): Promise<ModelCatalog[]> {
  const providers = args.provider ? [args.provider] : [...config.providers.enabled];
  // Validate every catalog before launching a probe.
  const catalogs = providers.map(provider => modelCatalog(config, provider));
  for (const catalog of catalogs) {
    if (!args.discover) continue;
    try {
      const options = { workdir: config.projects.directories.get(config.projects.defaultProject)!,
        claudeExecutable: config.providers.claudeExecutable, geminiScript: config.providers.geminiScript };
      catalog.discoveredModels = catalog.provider === 'codex' ? await discover(options)
        : (await discoverProvider(catalog.provider, options)).map(item => item.model);
      catalog.discoveryNote = 'CLI catalog loaded without a model turn. Use /ai config provider:' + catalog.provider
        + ' to load these models into Discord. Model/account access is checked when a task runs.';
    } catch {
      catalog.discoveryNote = 'CLI model discovery unavailable. Configured choices remain available; check local CLI installation and login.';
    }
  }
  return catalogs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run models -- [--provider codex|claude|gemini] [--discover] [--json]');
    return;
  }
  try {
    const options = parseModelsArguments(args);
    const runtime = new RuntimeConfig({ file: resolve('ai.config.json'), overridesFile: resolve('.ai-config-overrides.json') });
    await runtime.load();
    const catalogs = await listModels(runtime.value, options);
    console.log(options.json ? JSON.stringify(catalogs, null, 2) : catalogs.map(modelsText).join('\n\n'));
  } catch (error) {
    console.error(error instanceof Error && error.message === 'AI_MODELS_ARGUMENTS'
      ? 'Usage: npm run models -- [--provider codex|claude|gemini] [--discover] [--json]'
      : 'Unable to list models. Check local runtime config and enabled providers.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
