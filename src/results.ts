import { AttachmentBuilder, type InteractionEditReplyOptions } from 'discord.js';
import { providerLabels, type ProviderId } from './providers.js';

export function taskErrorMessage(error: unknown, provider: ProviderId = 'codex'): string {
  const label = providerLabels[provider];
  if (error instanceof Error && error.message.startsWith('AI_')) {
    switch (error.message) {
      case 'AI_TIMEOUT': return label + ' timeout';
      case 'AI_PROVIDER_DISABLED': return 'This AI provider is not enabled in local configuration.';
      case 'AI_PROJECT_UNAVAILABLE': return 'Project is unavailable. Use /ai project name:… to select an enabled project.';
      case 'AI_SELECTION_CONFLICT': return 'Choose either provider or profile, using only one.';
      case 'AI_ADMIN_DENIED': return 'คุณไม่มีสิทธิ์จัดการ config ของบอตนี้';
      case 'AI_PROFILE_UNAVAILABLE': return 'Profile is unavailable. Select a current profile.';
      case 'AI_CONFIG_INVALID': return 'Configuration rejected. Check local config and overrides, allowed models and enabled defaults. The previous configuration remains active.';
      case 'AI_CONFIG_SAVE': return 'Unable to save configuration overrides. The previous configuration remains active.';
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
