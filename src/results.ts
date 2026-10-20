import { AttachmentBuilder, type InteractionEditReplyOptions } from 'discord.js';
import { providerLabels, type ProviderId } from './providers.js';

export function taskErrorMessage(error: unknown, provider: ProviderId = 'codex'): string {
  const label = providerLabels[provider];
  if (error instanceof Error && error.message.startsWith('AI_')) {
    switch (error.message) {
      case 'AI_EFFORT_INVALID': return 'This effort is unavailable for the selected provider/model. Choose from effort autocomplete or /ai config, or use effort:default.';
      case 'AI_PREFERENCES_INVALID': return 'Unable to load personal AI settings. Check the local preferences file.';
      case 'AI_PREFERENCES_SAVE': return 'Unable to save your AI settings. Your previous choices remain active.';
      case 'AI_CONFIG_PICKER_STALE': return 'The configuration changed or the bot restarted. Reopen /ai config to choose current settings.';
      case 'AI_SETUP_REQUIRED': return 'Setup is required before running AI tasks. Ask an allowed admin to run /ai init in this server.';
      case 'AI_PROJECT_SETUP': return 'Run /ai init to create ai.config.json before adding projects.';
      case 'AI_PROJECT_LOCATION': return 'Choose exactly one location: directory for an absolute path on the bot host, or root for a configured root alias.';
      case 'AI_PROJECT_PATH': return 'Use an absolute directory path on the bot host, including its drive on Windows. Relative and empty paths are rejected.';
      case 'AI_PROJECT_NAME': return 'Use a project name starting with a lowercase letter, followed by lowercase letters, digits, underscores or hyphens (maximum 32 characters).';
      case 'AI_PROJECT_ROOT': return 'Choose a root alias from autocomplete. An admin must configure projectRoots in ai.config.json locally and run /ai-admin reload first.';
      case 'AI_PROJECT_EXISTS': return 'This project alias already exists. Choose a new alias; existing projects cannot be replaced with project-add.';
      case 'AI_PROJECT_DIRECTORY_EXISTS': return 'This folder already exists. Omit create or use create:false to register it, or choose another name.';
      case 'AI_PROJECT_DIRECTORY': return 'Project folder rejected. Check host filesystem permissions and use a directory without a symbolic link or junction at the target. With root, use an immediate child folder. To create missing folders, use create:true.';
      case 'AI_PROJECT_CONFIG_CHANGED': return 'Local configuration changed. Run /ai-admin reload and retry the project addition.';
      case 'AI_PROJECT_SAVE': return 'Unable to save the new project to ai.config.json. The previous configuration remains active. Check local storage permissions.';
      case 'AI_PROJECT_CLEANUP': return 'Project addition failed and its new folder could not be safely cleaned up. The previous configuration remains active. Check local storage before retrying.';
      case 'AI_INIT_STALE': return 'The configuration changed or the bot restarted while this setup form was open. Run /ai init again to use the current choices.';
      case 'AI_SHUTTING_DOWN': return 'The bot is shutting down. Try again after it restarts.';
      case 'AI_HOST_POWER_UNSUPPORTED': return 'Host shutdown is only supported when the bot runs on Windows.';
      case 'AI_HOST_POWER_DELAY': return 'Choose a shutdown delay from 1 to 60 minutes.';
      case 'AI_HOST_POWER_FAILED': return 'Windows rejected the shutdown request. Check that the bot account may shut down this computer.';
      case 'AI_TIMEOUT': return label + ' timeout';
      case 'AI_QUEUE_FULL': return 'The job queue is full. Try again after queued jobs finish, or remove one with /ai stop id:….';
      case 'AI_QUEUE_CANCELLED': return 'The queued job was removed before it started; it did not run.';
      case 'AI_CANCELLED': return label + ' task was stopped. Files it already changed are not reverted; the conversation resumes from the last completed turn.';
      case 'AI_PROVIDER_DISABLED': return 'This AI provider is not enabled in local configuration.';
      case 'AI_PROVIDER_SETUP': return 'Run /ai init to create ai.config.json before adding providers.';
      case 'AI_PROVIDER_EXISTS': return 'This provider is already registered. Use /ai-admin provider to enable it, /ai models to refresh models, or /ai-admin profile-add to create a profile.';
      case 'AI_PROVIDER_INSTALLATION': return 'Provider registration rejected. Check the host model setting and CLI installation: Claude uses PATH or local CLAUDE_EXECUTABLE; Gemini requires local GEMINI_CLI_SCRIPT. Restart after editing .env. Installation paths cannot be supplied through Discord.';
      case 'AI_PROVIDER_CONFIG_CHANGED': return 'Local configuration changed. Run /ai-admin reload and retry the provider addition.';
      case 'AI_PROVIDER_SAVE': return 'Unable to save the provider to ai.config.json. The previous configuration remains active. Check local storage permissions.';
      case 'AI_PROFILE_EXISTS': return 'This profile already exists. Choose a new name or use /ai-admin profile-set to replace it.';
      case 'AI_PROJECT_UNAVAILABLE': return 'Project is unavailable. Use /ai project name:… to select an enabled project.';
      case 'AI_SELECTION_CONFLICT': return 'Choose a profile OR provider/model options, using only one selection style.';
      case 'AI_PROFILE_PROJECT_CONFLICT': return 'This profile is bound to a different project. Use the profile alone, or choose provider/model/project explicitly.';
      case 'AI_MODEL_NOT_ALLOWED': return 'This model is not allowed for the selected provider. Use /ai models and choose a model from autocomplete.';
      case 'AI_ADMIN_DENIED': return 'คุณไม่มีสิทธิ์จัดการ config ของบอตนี้';
      case 'AI_PROFILE_UNAVAILABLE': return 'Profile is unavailable. Select a current profile.';
      case 'AI_CONFIG_INVALID': return 'Configuration rejected. Check local config and overrides, allowed models and enabled defaults. The previous configuration remains active.';
      case 'AI_CONFIG_SAVE': return 'Unable to save configuration overrides. The previous configuration remains active.';
      case 'AI_CONFIG_EXISTS': return 'ai.config.json already exists and was preserved. Use /ai-admin reload to validate and load your copied file.';
      case 'AI_INIT_SAVE': return 'Unable to create ai.config.json. Check local storage permissions or copy ai.config.example.json manually. Your current settings remain active.';
      case 'AI_INIT_DEFAULT_OVERRIDE': return 'Saved admin overrides select a different default. Use /ai-admin defaults to choose these defaults first, then retry /ai init.';
      case 'AI_CONFIG_JOBS_PENDING': return 'Configuration update blocked: unable to persist paused schedules. Check local storage and retry.';
      case 'AI_CONFIG_JOBS_APPLIED': return 'Configuration was saved and applied. Affected schedules are paused, but saving their state failed. Check local storage and retry before further configuration changes.';
      case 'AI_PROVIDER_UNAVAILABLE': return label + ' CLI is unavailable. Check its local installation and configuration.';
      case 'AI_PERMISSION_DENIED': return label + ' could not complete the task with the configured file permissions.';
      case 'AI_INVALID_SELECTION': return 'The provider or model configuration changed. Start a new task with the current configuration.';
      case 'AI_OUTPUT_LIMIT': return label + ' response exceeded the output limit.';
      case 'AI_INVALID_OUTPUT':
      case 'AI_INVALID_SESSION': return label + ' returned an invalid response or session. Check CLI compatibility.';
      case 'AI_GEMINI_SETTINGS': return 'Unable to safely load Gemini system settings. Check local settings are valid JSON.';
      case 'AI_CLI_VERSION': return label + ' CLI version is unsupported. Use Claude Code >=2.1.248 or Gemini CLI >=0.63.0 (stable releases).';
      default: return label + ' task failed. Check local CLI login, workdir and permissions.';
    }
  }
  if (error instanceof Error && error.message === 'CODEX_BUSY') return 'An AI worker is busy. Try again after the task finishes.';
  if (error instanceof Error && error.message === 'CODEX_TIMEOUT') return 'Codex timeout';
  if (error instanceof Error && error.message.includes('usage limit')) return 'Codex usage limit';
  return label + ' task failed. Check local CLI login, workdir and sandbox.';
}

interface TaskReply {
  content: string;
  files: AttachmentBuilder[];
  allowedMentions: { parse: [] };
}

export function taskReply(text: string, provider: ProviderId = 'codex'): TaskReply {
  return {
    content: text.length > 1700 ? `${text.slice(0, 1600)}\n\nอ่านผลเต็มในไฟล์แนบ` : text,
    files: text.length > 1700
      ? [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: provider + '-result.txt' })]
      : [],
    allowedMentions: { parse: [] },
  };
}

interface ReplyTarget {
  createdTimestamp: number;
  editReply: (reply: InteractionEditReplyOptions) => Promise<unknown>;
}

export async function deliverTaskReply(
  interaction: ReplyTarget, text: string, now = Date.now(), provider: ProviderId = 'codex',
): Promise<boolean> {
  // This is a Discord delivery expiry, not a deadline for the Codex process.
  if (now - interaction.createdTimestamp >= 15 * 60 * 1000) return false;
  try {
    await interaction.editReply(taskReply(text, provider));
    return true;
  } catch {
    // The completed outcome remains available through /ai result.
    return false;
  }
}
