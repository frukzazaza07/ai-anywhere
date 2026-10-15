import { SlashCommandBuilder, type SlashCommandStringOption, type SlashCommandSubcommandBuilder } from 'discord.js';
import { helpTopics } from './help.js';

export const commandNames = new Set(['ai', 'ai-admin', 'help']);

function providerOption(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command.addStringOption(option => option
    .setName('provider').setDescription('Enabled AI CLI (choose provider or profile)')
    .setAutocomplete(true))
    .addStringOption(option => option.setName('profile').setDescription('Project/provider/model preset (omitted uses your defaults)')
      .setAutocomplete(true));
}

function sessionOptions(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return providerOption(command).addStringOption(option => option
    .setName('model').setDescription('Allowed model (choose provider/model or profile)')
    .setMaxLength(120).setAutocomplete(true)).addStringOption(option => option
    .setName('effort').setDescription('Reasoning effort (omitted uses saved config; default uses CLI default)')
    .setMaxLength(16).setAutocomplete(true)).addStringOption(option => option
    .setName('project').setDescription('Configured project (omitted uses your current project)')
    .setAutocomplete(true));
}

function jobOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option.setName('id').setDescription('Job ID from /ai jobs').setMinLength(8).setMaxLength(8).setAutocomplete(true);
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('ai').setDescription('Run AI tasks and manage your session')
    .addSubcommand(command => sessionOptions(command
      .setName('run').setDescription('Send a task to your local AI worker')
      .addStringOption(option => option
        .setName('prompt').setDescription('Task for AI')
        .setRequired(true).setMinLength(1).setMaxLength(4000))
      .addStringOption(option => option
        .setName('at').setDescription('Run once: YYYY-MM-DD HH:mm (Bangkok) or ISO date with timezone').setMaxLength(40))
      .addStringOption(option => option
        .setName('after').setDescription('Run once after a delay, e.g. 10m or 2 hours').setMaxLength(100))
      .addStringOption(option => option
        .setName('every').setDescription('Repeat at an interval, e.g. 30m, 2 hours or 1 day (minimum 1m)').setMaxLength(100)))
      .addBooleanOption(option => option
        .setName('queue').setDescription('If the worker is busy, wait in the queue instead of being rejected')))
    .addSubcommand(command => sessionOptions(command
      .setName('new').setDescription('Start a fresh AI conversation')))
    .addSubcommand(command => sessionOptions(command
      .setName('status').setDescription('Show worker/session status; Codex also shows account usage')))
    .addSubcommand(command => sessionOptions(command
      .setName('context').setDescription('Show context window usage for your current session (Claude, Codex)')))
    .addSubcommand(command => sessionOptions(command
      .setName('clear').setDescription('Clear your current AI conversation context')))
    .addSubcommand(command => sessionOptions(command
      .setName('result').setDescription('Retrieve your latest result, or a saved job by ID')).addStringOption(jobOption))
    .addSubcommand(command => command
      .setName('stop').setDescription('Stop a running or queued job (admins can stop any job); edits are not reverted')
      .addStringOption(jobOption))
    .addSubcommand(command => command
      .setName('jobs').setDescription('List your recent jobs with ID, state and duration'))
    .addSubcommand(command => command
      .setName('changes').setDescription('Show files and Git diff changed by a job (read-only)')
      .addStringOption(option => jobOption(option).setRequired(true))
      .addIntegerOption(option => option.setName('page').setDescription('Diff page (default 1)').setMinValue(1).setMaxValue(1000)))
    .addSubcommand(command => providerOption(command
      .setName('models').setDescription('List allowed models, selected default and matching profiles')))
    .addSubcommand(command => command.setName('config').setDescription('Choose and save your provider, model and effort for this channel')
      .addStringOption(option => option.setName('provider').setDescription('Enabled provider').setAutocomplete(true))
      .addStringOption(option => option.setName('model').setDescription('Allowed model; __default__ selects CLI default').setMaxLength(120).setAutocomplete(true))
      .addStringOption(option => option.setName('effort').setDescription('Provider effort; default selects CLI default').setMaxLength(16).setAutocomplete(true)))
    .addSubcommand(command => command
      .setName('schedules').setDescription('List all provider schedules for your current user and channel'))
    .addSubcommand(command => command
      .setName('cancel').setDescription('Cancel a schedule; use stop to end a running task')
      .addStringOption(option => option
        .setName('id').setDescription('Schedule ID from schedules').setRequired(true).setMaxLength(36)))
    .addSubcommand(command => command
      .setName('projects').setDescription('List configured project names and your current project'))
    .addSubcommand(command => command
      .setName('project').setDescription('Switch your current project for this user and channel')
      .addStringOption(option => option
        .setName('name').setDescription('Configured project name').setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(command => command
      .setName('init').setDescription('Admin: finish first-install setup without overwriting existing config')
      .addStringOption(option => option.setName('project').setDescription('Default project from locally configured folders')
        .setMaxLength(32).setAutocomplete(true))
      .addStringOption(option => option.setName('profile').setDescription('Default profile from locally configured providers')
        .setMaxLength(32).setAutocomplete(true)));
}

function adminCommand() {
  return new SlashCommandBuilder().setName('ai-admin').setDescription('Manage local AI runtime configuration')
    .addSubcommand(command => command.setName('status').setDescription('Inspect config without exposing local paths'))
    .addSubcommand(command => command.setName('reload').setDescription('Validate and reload local config and overrides'))
    .addSubcommand(command => command.setName('provider-add').setDescription('Register a supported CLI using its host installation settings')
      .addStringOption(option => option.setName('provider').setDescription('Supported CLI to register').setRequired(true)
        .addChoices({ name: 'Codex', value: 'codex' }, { name: 'Claude Code', value: 'claude' }, { name: 'Gemini CLI', value: 'gemini' }))
      .addStringOption(option => option.setName('models').setDescription('Allowed model IDs, separated by commas; omit to discover from CLI')
        .setMinLength(1).setMaxLength(2000))
      .addStringOption(option => option.setName('default-model').setDescription('Default model ID; added to allowed models; omit for host/CLI default')
        .setMinLength(1).setMaxLength(120)))
    .addSubcommand(command => command.setName('profile-add').setDescription('Create a project/provider/model profile')
      .addStringOption(option => option.setName('name').setDescription('New profile name').setRequired(true).setMinLength(1).setMaxLength(32))
      .addStringOption(option => option.setName('provider').setDescription('Registered provider').setRequired(true).setAutocomplete(true))
      .addStringOption(option => option.setName('project').setDescription('Project alias bound to this profile').setRequired(true).setAutocomplete(true))
      .addStringOption(option => option.setName('model').setDescription('Allowed model; omit for CLI default').setMaxLength(120).setAutocomplete(true)))
    .addSubcommand(command => command.setName('profile-set').setDescription('Create or replace a project/provider/model profile')
      .addStringOption(option => option.setName('name').setDescription('Profile name').setRequired(true).setMaxLength(32).setAutocomplete(true))
      .addStringOption(option => option.setName('provider').setDescription('Locally installed provider').setRequired(true).setAutocomplete(true))
      .addStringOption(option => option.setName('project').setDescription('Project alias bound to this profile').setRequired(true).setAutocomplete(true))
      .addStringOption(option => option.setName('model').setDescription('Allowed model; omit for CLI default').setAutocomplete(true)))
    .addSubcommand(command => command.setName('profile-delete').setDescription('Delete a profile after changing defaults')
      .addStringOption(option => option.setName('name').setDescription('Profile name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(command => command.setName('project').setDescription('Enable or disable a locally configured project')
      .addStringOption(option => option.setName('project').setDescription('Project alias').setRequired(true).setAutocomplete(true))
      .addBooleanOption(option => option.setName('enabled').setDescription('Enable this project').setRequired(true)))
    .addSubcommand(command => command.setName('project-add').setDescription('Register or create a project folder using a directory or root alias')
      .addStringOption(option => option.setName('name').setDescription('New project alias (also the child folder name with root)')
        .setRequired(true).setMinLength(1).setMaxLength(32))
      .addStringOption(option => option.setName('root').setDescription('Locally configured project root alias')
        .setMaxLength(32).setAutocomplete(true))
      .addStringOption(option => option.setName('directory').setDescription('Absolute folder path on the bot host; choose directory or root')
        .setMinLength(1).setMaxLength(1024))
      .addBooleanOption(option => option.setName('create').setDescription('Create a new empty folder; omit to register an existing folder')))
    .addSubcommand(command => command.setName('provider').setDescription('Enable or disable a locally installed provider')
      .addStringOption(option => option.setName('provider').setDescription('Provider name').setRequired(true).setAutocomplete(true))
      .addBooleanOption(option => option.setName('enabled').setDescription('Enable this provider').setRequired(true)))
    .addSubcommand(command => command.setName('defaults').setDescription('Change the default project and/or profile')
      .addStringOption(option => option.setName('project').setDescription('Enabled project alias').setAutocomplete(true))
      .addStringOption(option => option.setName('profile').setDescription('Usable profile').setAutocomplete(true)));
}

// Retain the previous local signature; the inventory no longer affects registration.
export function createCommands(_projects?: readonly string[]) {
  return [buildCommand(), adminCommand(), new SlashCommandBuilder()
    .setName('help').setDescription('Explain all bot commands, options and examples')
    .addStringOption(option => option.setName('topic').setDescription('Guide section (omitted shows all commands)')
      .addChoices(...helpTopics.map(value => ({ name: value === 'admin' ? 'Admin commands' : value, value }))))];
}

export const commands = createCommands();
