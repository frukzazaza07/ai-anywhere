import { authorized, type Access, type AccessConfig } from './selection.js';
import { type ConfigChange, type RuntimeConfig } from './runtime-config.js';

/** The management boundary requires both the ordinary allowlist and the admin allowlist. */
export async function manageConfig(runtime: RuntimeConfig, access: Access, auth: AccessConfig,
  action: 'status' | 'reload' | ConfigChange): Promise<string> {
  if (!authorized(access, auth, true)) throw new Error('AI_ADMIN_DENIED');
  if (typeof action === 'object' && action.kind === 'add-project') {
    await runtime.change(action);
    return 'Project ' + action.name + ' added' + (action.create ? ' with a new empty folder.' : ' from an existing folder.')
      + '\nUse /ai project name:' + action.name + ' to select it. No restart is needed.';
  }
  if (action === 'reload') await runtime.reload();
  else if (action !== 'status') await runtime.change(action);
  return (action === 'status' ? '' : 'Configuration updated.\n') + runtime.status();
}
