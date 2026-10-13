import { AttachmentBuilder, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { resolve } from 'node:path';
import { CodexScheduler, parseSchedule, schedulesText } from './scheduler.js';
import { discordConfig, workerConfig } from './config.js';
import { commandNames } from './commands.js';
import { ProjectSessions } from './project-sessions.js';
import { type ProjectSelection } from './projects.js';
import { providerLabels, isProviderId } from './providers.js';
import { RuntimeConfig, type ConfigChange } from './runtime-config.js';
import { autocomplete, authorized, selectCommand, type SelectedProfile } from './selection.js';
import { manageConfig } from './admin-config.js';
import { helpReply } from './help.js';
import { codexLimitsStatus } from './limits.js';
import { deliverTaskReply, taskErrorMessage, taskReply } from './results.js';

const discord = discordConfig();
let sessions: ProjectSessions;
const runtime = new RuntimeConfig({ file: resolve('ai.config.json'), overridesFile: resolve('.ai-config-overrides.json'),
  busy: () => sessions?.busy ?? false });
await runtime.load();
const worker = workerConfig(runtime.value);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
sessions = new ProjectSessions({ ...worker, runtime });
const auth = { guildId: discord.guildId, allowedUsers: worker.allowedUsers, adminUsers: worker.adminUsers };

const scheduler = new CodexScheduler({
  file: resolve('.codex-schedules.json'), workdir: worker.workdir, sandbox: worker.sandbox,
  guildId: discord.guildId, allowedUsers: worker.allowedUsers,
  providers: worker.providers,
  projects: worker.projects,
  runtime,
  busy: () => sessions.busy, run: (key, prompt, selection, project) => sessions.prompt(key, prompt, selection, project),
});
await scheduler.load();
client.once(Events.ClientReady, ready => {
  console.log('Ready as ' + ready.user.tag);
  scheduler.start();
});
client.on(Events.Error, () => console.error('Discord connection error.'));
client.on(Events.InteractionCreate, interaction => {
  void handle().catch(() => console.error('Unable to handle Discord interaction.'));
  async function handle() {
    const access = { guildId: interaction.guildId, userId: interaction.user.id };
    if (interaction.isAutocomplete()) {
      if (!commandNames.has(interaction.commandName)) return;
      const focused = interaction.options.getFocused(true);
      await interaction.respond(autocomplete(runtime.value, access, auth, interaction.commandName,
        focused.name, String(focused.value), interaction.options.getString('provider')));
      return;
    }
    if (!interaction.isChatInputCommand() || !commandNames.has(interaction.commandName)) return;
    if (!authorized(access, auth, interaction.commandName === 'ai-admin')) {
      await interaction.reply({ content: 'คุณไม่มีสิทธิ์ใช้บอตนี้', flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] } });
      return;
    }
    if (interaction.commandName === 'help') {
      await interaction.reply({ ...helpReply(interaction.options.getString('topic')), flags: MessageFlags.Ephemeral });
      return;
    }
    const action = interaction.options.getSubcommand(false) ?? 'run';
    const key = `${interaction.guildId}:${interaction.channelId}:${interaction.user.id}`;
    if (interaction.commandName === 'ai-admin') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        let adminAction: 'status' | 'reload' | ConfigChange;
        if (action === 'reload' || action === 'status') adminAction = action;
        else {
          let change: ConfigChange;
          if (action === 'profile-set') {
            const provider = interaction.options.getString('provider', true);
            if (!isProviderId(provider)) throw new Error('AI_CONFIG_INVALID');
            change = { kind: 'profile', name: interaction.options.getString('name', true),
              profile: { provider, model: interaction.options.getString('model') ?? undefined } };
          } else if (action === 'profile-delete') change = { kind: 'delete-profile', name: interaction.options.getString('name', true) };
          else if (action === 'project' || action === 'provider') change = { kind: action,
            name: interaction.options.getString(action, true), enabled: interaction.options.getBoolean('enabled', true) };
          else change = { kind: 'defaults', project: interaction.options.getString('project') ?? undefined,
            profile: interaction.options.getString('profile') ?? undefined };
          adminAction = change;
        }
        await interaction.editReply(taskReply(await manageConfig(runtime, access, auth, adminAction)));
      } catch (error) { await interaction.editReply(taskReply(taskErrorMessage(error))); }
      return;
    }
    if (action === 'projects' || action === 'project') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const content = await runtime.exclusive(() => action === 'projects' ? sessions.projectsText(key)
          : 'Current project: ' + sessions.switchProject(key, interaction.options.getString('name', true)).project);
        await interaction.editReply(taskReply(content));
      } catch (error) {
        await interaction.editReply(taskReply(taskErrorMessage(error)));
      }
      return;
    }
    // Listing/cancelling jobs remains available even with a stale project preference.
    if (action === 'schedules') {
      await interaction.reply({ ...taskReply(schedulesText(scheduler.list(key))), flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'cancel') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const cancelled = await scheduler.cancel(key, interaction.options.getString('id', true));
        await interaction.editReply({ content: cancelled ? 'Schedule cancelled. An already running task will finish.'
          : 'Schedule not found for this user/channel.', allowedMentions: { parse: [] } });
      } catch { await interaction.editReply(taskReply('Unable to save schedule cancellation. Try again.')); }
      return;
    }
    let selection: SelectedProfile;
    let project: ProjectSelection;
    const revision = runtime.value.revision;
    const checkRevision = () => { if (runtime.value.revision !== revision) throw new Error('AI_INVALID_SELECTION'); };
    try {
      selection = selectCommand(runtime.value, interaction.options.getString('provider'), interaction.options.getString('profile'));
      project = sessions.currentProject(key, interaction.options.getString('project'));
    } catch (error) {
      await interaction.reply({ ...taskReply(taskErrorMessage(error)), flags: MessageFlags.Ephemeral });
      return;
    }
    const label = providerLabels[selection.provider];
    const resultCommand = (selection.profile ? '/ai result profile:' + selection.profile
      : '/ai result provider:' + selection.provider)
      + ' project:' + project.project;
    if (action === 'status') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        checkRevision();
        const status = sessions.status(key, selection, project.project) + (selection.provider === 'codex' ? '\n\n' + await codexLimitsStatus({
          workdir: project.workdir, includeContext: true, ...sessions.contextState(key, selection, project.project),
        }) : '');
        await interaction.editReply({
          content: status.length > 1900 ? 'Read AI status in the attachment.' : status,
          files: status.length > 1900
            ? [new AttachmentBuilder(Buffer.from(status, 'utf8'), { name: selection.provider + '-status.txt' })]
            : [],
          allowedMentions: { parse: [] },
        });
      } catch (error) { await interaction.editReply(taskReply(taskErrorMessage(error, selection.provider))); }
      return;
    }
    if (action === 'result') {
      await interaction.reply({
        ...taskReply(sessions.result(key, selection, project.project), selection.provider), flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === 'run') {
      let timing;
      try {
        timing = parseSchedule({ at: interaction.options.getString('at'),
          after: interaction.options.getString('after'), every: interaction.options.getString('every') });
      } catch (error) {
        await interaction.reply({ content: error instanceof Error ? error.message : 'Invalid schedule.',
          flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        return;
      }
      if (timing) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const job = await runtime.exclusive(() => {
            checkRevision();
            return scheduler.add({ guildId: interaction.guildId!, channelId: interaction.channelId,
              userId: interaction.user.id }, interaction.options.getString('prompt', true), timing, selection, project.project, selection.profile);
          });
          await interaction.editReply({ content: 'Schedule saved. ID: ' + job.id
            + '\nNext run: <t:' + Math.floor(job.nextRun / 1000) + ':F>'
            + (job.intervalMs ? '\nRepeats every ' + job.intervalMs / 1000 + ' seconds.' : '\nRuns once.')
            + '\nProvider: ' + label + ' | Model: ' + (selection.model ?? 'CLI default')
            + '\nProject: ' + project.project
            + (selection.profile ? '\nProfile: ' + selection.profile : '')
            + '\nUse /ai schedules to inspect, /ai cancel id:… to cancel, and ' + resultCommand + ' after completion.',
            allowedMentions: { parse: [] } });
        } catch (error) {
          await interaction.editReply(taskReply(error instanceof Error && error.message.startsWith('Schedule limit')
            ? error.message : error instanceof Error && error.message.startsWith('AI_') ? taskErrorMessage(error)
              : 'Unable to save schedule. Check local storage and try again.'));
        }
        return;
      }
    }
    if (sessions.busy) {
      await interaction.reply({ content: 'An AI worker is busy. Try again after the task finishes.',
        flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    if (action === 'new' || action === 'clear') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await runtime.exclusive(() => { checkRevision(); sessions.reset(key, selection, project.project); });
      } catch (error) {
        await interaction.editReply(taskReply(taskErrorMessage(error)));
        return;
      }
      await interaction.editReply({
        content: action === 'new'
          ? label + ' is ready for a new conversation in project ' + project.project
            + '. Send a task with ' + resultCommand.replace(' result', ' run') + ' prompt:….'
          : label + ' conversation and saved result cleared in project ' + project.project + '. Project files and CLI history remain on disk.',
        allowedMentions: { parse: [] },
      });
      return;
    }
    try {
      // Acknowledge immediately; jobs may take several minutes.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({
        content: label + ' is running in project ' + project.project + '. Retrieve the saved result with ' + resultCommand + ' in this user/channel if this reply expires.',
        allowedMentions: { parse: [] },
      });
      const started = await runtime.exclusive(() => {
        checkRevision();
        return { result: sessions.prompt(key, interaction.options.getString('prompt', true), selection, project.project) };
      });
      const result = await started.result;
      if (!await deliverTaskReply(interaction, result, Date.now(), selection.provider)) {
        console.log('Task completed; retrieve the saved result from Discord.');
      }
    } catch (error) {
      // Keep raw CLI logs out of Discord because they can contain project information.
      console.error('AI task failed. Check local CLI login, workdir, permissions and timeout.');
      const content = taskErrorMessage(error, selection.provider);
      if (interaction.deferred) await deliverTaskReply(interaction, content, Date.now(), selection.provider);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }
});

await client.login(discord.token);
