import { providerLabels, type ProviderId } from './providers.js';
import { type RuntimeSnapshot } from './runtime-config.js';
import { selectCommand, type SelectedProfile } from './selection.js';
import { type Effort } from './effort.js';

export interface ModelCatalog {
  provider: ProviderId;
  selectedModel?: string;
  selectedEffort?: Effort;
  allowedModels: string[];
  profiles: Array<{ name: string; model?: string; project?: string }>;
  discoveredModels?: string[];
  discoveryNote?: string;
}

export function modelCatalog(config: RuntimeSnapshot, provider?: string | null,
  profile?: string | null, selection?: SelectedProfile): ModelCatalog {
  const selected = selection ?? selectCommand(config, provider, profile);
  return { provider: selected.provider, selectedModel: selected.model,
    ...(selected.effort ? { selectedEffort: selected.effort } : {}),
    allowedModels: [...(config.providers.allowedModels?.[selected.provider] ?? [])],
    profiles: [...config.profiles].filter(([, p]) => p.provider === selected.provider)
      .map(([name, p]) => ({ name, model: p.model, ...(p.project ? { project: p.project } : {}) })) };
}

export function modelsText(catalog: ModelCatalog): string {
  const lines = [providerLabels[catalog.provider] + ' model choices',
    'Selected default: ' + (catalog.selectedModel ?? 'CLI default'),
    'Effort: ' + (catalog.selectedEffort ?? 'CLI default'), '', 'Allowed models:'];
  lines.push(...(catalog.allowedModels.length ? catalog.allowedModels.map(model => '- ' + model)
    : ['No explicit models configured. Use the selected default or a CLI-default profile.']));
  if (catalog.profiles.length) lines.push('', 'Profiles:',
    ...catalog.profiles.map(p => '- ' + p.name + ': ' + (p.model ?? 'CLI default')
      + ' / project: ' + (p.project ?? 'current project (legacy)')));
  if (catalog.discoveredModels) lines.push('', providerLabels[catalog.provider] + ' CLI catalog (account access is not verified):',
    ...catalog.discoveredModels.map(model => '- ' + model + (catalog.allowedModels.includes(model) ? ' (allowed)' : ' (not allowed locally)')));
  if (catalog.discoveryNote) lines.push('', catalog.discoveryNote);
  lines.push('', 'Choose /ai run provider:' + catalog.provider + ' model:MODEL prompt:YOUR_TASK.',
    'Use /ai config provider:' + catalog.provider + ' to save your model and effort for later prompts.',
    'Use the same provider/model for status, result, new and clear. Omit model to use personal settings, otherwise the provider/profile default.',
    'Profiles choose their own project and model; choose a profile OR provider/model/project options. Legacy profiles without a project use your current project.',
    'Use Refresh models from CLI in /ai config to reload model choices. Local providers.' + catalog.provider + '.models entries remain available.');
  return lines.join('\n');
}
