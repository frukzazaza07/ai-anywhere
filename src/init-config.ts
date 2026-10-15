import { authorized, type Access, type AccessConfig } from './selection.js';
import { type InitDefaults, type RuntimeConfig } from './runtime-config.js';

/** Only host-authorized administrators can publish first-install configuration. */
export async function initializeConfig(runtime: RuntimeConfig, access: Access, auth: AccessConfig,
  defaults: InitDefaults = {}): Promise<string> {
  if (!authorized(access, auth, true)) throw new Error('AI_ADMIN_DENIED');
  const created = await runtime.initialize(defaults);
  const boundProject = runtime.value.profiles.get(runtime.value.defaultProfile)?.project;
  return (created ? 'Setup complete! ai.config.json was created and is active. No restart is needed.'
    : 'ai.config.json is already configured. Your existing file was preserved. Use /ai-admin defaults to change defaults, or /ai-admin reload after local edits.')
    + '\n\n' + runtime.status()
    + '\n\nTry your first task:\n/ai run'
    + (boundProject ? '' : ' project:' + runtime.value.projects.defaultProject)
    + ' profile:' + runtime.value.defaultProfile + ' prompt:Summarize this project without changing files.'
    + '\nUse /help topic:admin for profiles and other configuration changes.';
}
