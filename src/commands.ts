import { SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { helpTopics } from './help.js';

export const commandNames = new Set(['ai', 'ai-admin', 'help']);

function providerOption(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return command.addStringOption(option => option
    .setName('provider').setDescription('Enabled AI CLI (choose provider or profile)')
    .setAutocomplete(true))
    .addStringOption(option => option.setName('profile').setDescription('Profile (omitted uses the default profile)')
      .setAutocomplete(true));
}

function sessionOptions(command: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return providerOption(command).addStringOption(option => option
    .setName('project').setDescription('Configured project (omitted uses your current project)')
    .setAutocomplete(true));
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
        .setName('every').setDescription('Repeat at an interval, e.g. 30m, 2 hours or 1 day (minimum 1m)').setMaxLength(100))))
    .addSubcommand(command => sessionOptions(command
      .setName('new').setDescription('Start a fresh AI conversation')))
    .addSubcommand(command => sessionOptions(command
      .setName('status').setDescription('Show worker/session status; Codex also shows account usage')))
    .addSubcommand(command => sessionOptions(command
      .setName('clear').setDescription('Clear your current AI conversation context')))
    .addSubcommand(command => sessionOptions(command
      .setName('result').setDescription('Retrieve your latest completed AI task result')))
    .addSubcommand(command => command
      .setName('schedules').setDescription('List all provider schedules for your current user and channel'))
    .addSubcommand(command => command
      .setName('cancel').setDescription('Cancel a schedule; a running task will finish')
      .addStringOption(option => option
        .setName('id').setDescription('Schedule ID from schedules').setRequired(true).setMaxLength(36)))
    .addSubcommand(command => command
      .setName('projects').setDescription('List configured project names and your current project'))
    .addSubcommand(command => command
      .setName('project').setDescription('Switch your current project for this user and channel')
      .addStringOption(option => option
        .setName('name').setDescription('Configured project name').setRequired(true)
        .setAutocomplete(true)));
}

function adminCommand() {
  return new SlashCommandBuilder().setName('ai-admin').setDescription('Manage local AI runtime configuration')
    .addSubcommand(command => command.setName('status').setDescription('Inspect config without exposing local paths'))
    .addSubcommand(command => command.setName('reload').setDescription('Validate and reload local config and overrides'))
    .addSubcommand(command => command.setName('profile-set').setDescription('Create or replace a profile with allowed provider/model')
      .addStringOption(option => option.setName('name').setDescription('Profile name').setRequired(true).setMaxLength(32).setAutocomplete(true))
      .addStringOption(option => option.setName('provider').setDescription('Locally installed provider').setRequired(true).setAutocomplete(true))
      .addStringOption(option => option.setName('model').setDescription('Allowed model; omit for CLI default').setAutocomplete(true)))
    .addSubcommand(command => command.setName('profile-delete').setDescription('Delete a profile after changing defaults')
      .addStringOption(option => option.setName('name').setDescription('Profile name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(command => command.setName('project').setDescription('Enable or disable a locally configured project')
      .addStringOption(option => option.setName('project').setDescription('Project alias').setRequired(true).setAutocomplete(true))
      .addBooleanOption(option => option.setName('enabled').setDescription('Enable this project').setRequired(true)))
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
