import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { authorized, type Access, type AccessConfig } from './selection.js';
import { type InitDefaults, type RuntimeConfig } from './runtime-config.js';
import { initializeConfig } from './init-config.js';

export const initDialogPrefix = 'ai-init:';

/** Show approved aliases without exposing the corresponding host directories. */
export function initializationDialog(runtime: RuntimeConfig, access: Access, auth: AccessConfig,
  defaults: InitDefaults = {}): ModalBuilder {
  if (!authorized(access, auth, true)) throw new Error('AI_ADMIN_DENIED');
  const config = runtime.value;
  const projects = [...config.projects.directories.keys()]
    .filter(key => !config.projects.enabled || config.projects.enabled.has(key));
  const profiles = [...config.profiles].filter(([, profile]) => config.providers.enabled.has(profile.provider))
    .map(([key]) => key);
  const field = (id: string, label: string, choices: string[], value: string) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
      .setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true)
      .setMaxLength(32).setPlaceholder(choices.join(', ').slice(0, 100)).setValue(value));
  return new ModalBuilder().setCustomId(initDialogPrefix + runtime.instanceId + ':' + config.revision).setTitle('AI setup')
    .addComponents(field('project', config.source === 'setup' ? 'Project (default = bot startup folder)' : 'Default project alias',
      projects, defaults.project ?? config.projects.defaultProject),
    field('profile', 'Default profile (' + profiles.join(', ').slice(0, 25) + ')',
      profiles, defaults.profile ?? config.defaultProfile));
}

/** Recheck authorization and the generation when a delayed form is submitted. */
export async function submitInitialization(runtime: RuntimeConfig, access: Access, auth: AccessConfig,
  customId: string, project: string, profile: string): Promise<string> {
  if (!authorized(access, auth, true)) throw new Error('AI_ADMIN_DENIED');
  const match = /^ai-init:([0-9a-f-]{36}):([1-9]\d*)$/.exec(customId);
  if (!match) throw new Error('AI_CONFIG_INVALID');
  if (match[1] !== runtime.instanceId) throw new Error('AI_INIT_STALE');
  const revision = Number(match[2]);
  if (!Number.isSafeInteger(revision)) throw new Error('AI_CONFIG_INVALID');
  return initializeConfig(runtime, access, auth, { project: project.trim(), profile: profile.trim(), revision });
}
