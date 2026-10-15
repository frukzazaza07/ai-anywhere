import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { cliDefaultModel, type ProviderPreferences } from './provider-preferences.js';
import { isProviderId, providerEffortChoices, providerLabels, type ProviderId } from './providers.js';
import { authorized, type Access, type AccessConfig } from './selection.js';
import { type RuntimeConfig } from './runtime-config.js';
import { type ModelCatalogService } from './model-catalog-service.js';

export const configPickerPrefix = 'ai-cfg:';
const pageSize = 24;

export function configPicker(runtime: RuntimeConfig, preferences: ProviderPreferences, key: string,
  access: Access, auth: AccessConfig, provider?: string | null, page = 0, note?: string) {
  if (!authorized(access, auth)) throw new Error('AI_ADMIN_DENIED');
  const config = runtime.value;
  const selectedProvider = provider ?? preferences.selectedProvider(key) ?? config.providers.defaultProvider;
  if (!isProviderId(selectedProvider) || !config.providers.enabled.has(selectedProvider)) throw new Error('AI_PROVIDER_DISABLED');
  const saved = preferences.get(key, selectedProvider);
  // Without personal choices the shared default profile applies, including its effort.
  const profileEffort = provider == null && !preferences.selectedProvider(key) ? config.profiles.get(config.defaultProfile)?.effort : undefined;
  const selectedEffort = saved ? saved.effort ?? undefined : profileEffort;
  const selectedModel = saved && Object.hasOwn(saved, 'model') ? saved.model ?? undefined
    : provider == null && !preferences.selectedProvider(key) ? config.profiles.get(config.defaultProfile)?.model : config.providers.models[selectedProvider];
  const models = [...(config.providers.allowedModels?.[selectedProvider] ?? [])];
  const pages = Math.max(1, Math.ceil(models.length / pageSize));
  if (!Number.isInteger(page) || page < 0 || page >= pages) throw new Error('AI_CONFIG_INVALID');
  const id = (action: string) => configPickerPrefix + runtime.instanceId + ':' + config.revision + ':' + access.userId + ':' + action + ':' + selectedProvider;
  const menu = (action: string, placeholder: string, choices: Array<{ label: string; value: string; default?: boolean }>) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(id(action)).setPlaceholder(placeholder).addOptions(choices));
  const components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
    menu('provider', 'Choose provider', [...config.providers.enabled].map(value => ({ label: providerLabels[value], value, default: value === selectedProvider }))),
    menu('model', 'Choose model (page ' + (page + 1) + '/' + pages + ')', [
      { label: 'CLI default', value: cliDefaultModel, default: selectedModel === undefined },
      ...models.slice(page * pageSize, (page + 1) * pageSize).map((value, index) => ({ label: value.slice(0, 100),
        value: value.length > 100 ? '__index__' + (page * pageSize + index) : value, default: value === selectedModel })),
    ]),
    menu('effort', 'Choose effort', [{ label: 'CLI default', value: 'default', default: !selectedEffort },
      ...providerEffortChoices(config.providers, selectedProvider, selectedModel).map(value => ({ label: value, value, default: value === selectedEffort }))]),
  ];
  if (pages > 1) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id('page-' + Math.max(0, page - 1))).setLabel('Previous models').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(id('page-' + Math.min(pages - 1, page + 1))).setLabel('Next models').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
  ));
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id('refresh')).setLabel('Refresh models from CLI').setStyle(ButtonStyle.Secondary)));
  return { content: 'Your AI configuration for this channel\nProvider: ' + providerLabels[selectedProvider]
    + '\nModel: ' + (selectedModel ?? 'CLI default') + ' | Effort: ' + (selectedEffort ?? 'CLI default')
    + '\nEach selection is saved immediately. Omitted prompt options use your saved choices.'
    + '\nExplicit provider/model/effort options apply to one prompt; a named profile uses its own model.'
    + (note ? '\n' + note : '')
    + (models.length ? '' : '\nNo model choices available yet. Refresh models after logging in to this CLI locally.'),
  components, allowedMentions: { parse: [] as [] } };
}

export async function updateConfigPicker(runtime: RuntimeConfig, preferences: ProviderPreferences, key: string,
  access: Access, auth: AccessConfig, customId: string, value?: string, catalogs?: ModelCatalogService) {
  if (!authorized(access, auth)) throw new Error('AI_ADMIN_DENIED');
  const match = /^ai-cfg:([0-9a-f-]{36}):([1-9]\d*):(\d{17,20}):(provider|model|effort|refresh|page-\d+):(codex|claude|gemini)$/.exec(customId);
  if (!match || match[3] !== access.userId) throw new Error('AI_ADMIN_DENIED');
  if (match[1] !== runtime.instanceId || Number(match[2]) !== runtime.value.revision) throw new Error('AI_CONFIG_PICKER_STALE');
  let note: string | undefined;
  if (catalogs && (match[4] === 'provider' || match[4] === 'refresh')) {
    const provider = match[4] === 'provider' ? value : match[5];
    if (!provider || !isProviderId(provider)) throw new Error('AI_PROVIDER_DISABLED');
    note = await catalogs.refresh(provider, match[4] === 'refresh');
  }
  const revision = runtime.value.revision;
  return runtime.exclusive(async () => {
    if (revision !== runtime.value.revision) throw new Error('AI_CONFIG_PICKER_STALE');
    let provider = match[5] as ProviderId;
    const action = match[4]!;
    let page = 0;
    if (action.startsWith('page-')) page = Number(action.slice(5));
    else if (action !== 'refresh') {
      if (value === undefined) throw new Error('AI_CONFIG_INVALID');
      if (action === 'model' && /^__index__\d+$/.test(value)) {
        value = runtime.value.providers.allowedModels?.[provider]?.[Number(value.slice(9))];
        if (value === undefined) throw new Error('AI_MODEL_NOT_ALLOWED');
      }
      if (action === 'provider') {
        if (!isProviderId(value)) throw new Error('AI_PROVIDER_DISABLED');
        provider = value;
      }
      const initialModel = action === 'effort' && !preferences.selectedProvider(key)
        ? preferences.resolve(runtime.value, key).model ?? cliDefaultModel : undefined;
      await preferences.save(runtime.value, key, provider, action === 'model' ? { model: value }
        : action === 'effort' ? { effort: value, ...(initialModel ? { model: initialModel } : {}) } : {});
    }
    // Refresh/pagination preserve profile defaults; selections already persist their provider.
    return configPicker(runtime, preferences, key, access, auth, undefined, page, note);
  });
}
