import { authorized, type Access, type AccessConfig } from './selection.js';
import { type ConfigChange, type RuntimeConfig } from './runtime-config.js';

/** The management boundary requires both the ordinary allowlist and the admin allowlist. */
export async function manageConfig(runtime: RuntimeConfig, access: Access, auth: AccessConfig,
  action: 'status' | 'reload' | ConfigChange): Promise<string> {
  if (!authorized(access, auth, true)) throw new Error('AI_ADMIN_DENIED');
  if (typeof action === 'object' && action.kind === 'add-provider') {
    await runtime.change(action);
    return 'Provider ' + action.provider + ' added and enabled.\nUse /ai models provider:' + action.provider
      + ' to discover models, then /ai-admin profile-add to create a profile. No restart is needed.';
  }
  if (typeof action === 'object' && action.kind === 'add-profile') {
    await runtime.change(action);
    return 'Profile ' + action.name + ' added (effort: ' + (action.profile.effort ?? 'CLI default') + ').\nUse /ai run profile:' + action.name + ' prompt:YOUR_TASK to select it. No restart is needed.';
  }
  if (typeof action === 'object' && action.kind === 'add-project') {
    await runtime.change(action);
    return 'Project ' + action.name + ' added' + (action.create ? ' with a new empty folder.' : ' from an existing folder.')
      + '\nUse /ai project name:' + action.name + ' to select it. No restart is needed.';
  }
  if (action === 'reload') await runtime.reload();
  else if (action !== 'status') await runtime.change(action);
  const note = typeof action === 'object' && action.kind === 'defaults' && action.profile !== undefined
    ? 'Personal /ai config choices saved under a previous default no longer apply; users get profile '
      + runtime.value.defaultProfile + ' until they choose again.\n' : '';
  return (action === 'status' ? '' : 'Configuration updated.\n') + note + runtime.status();
}
