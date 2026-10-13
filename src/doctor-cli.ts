import { resolve } from 'node:path';
import { discordConfig, workerConfig } from './config.js';
import { diagnose, supportedNode, type Diagnostic } from './doctor.js';
import { RuntimeConfig } from './runtime-config.js';

const checks: Diagnostic[] = [{ name: 'Node.js', status: supportedNode(process.version) ? 'pass' : 'fail',
  detail: supportedNode(process.version) ? process.version : 'Use Node.js >=24.17.0.' }];
try {
  discordConfig();
  checks.push({ name: 'Discord configuration', status: 'pass', detail: 'Required settings present; credentials and server access were not tested.' });
} catch {
  checks.push({ name: 'Discord configuration', status: 'fail', detail: 'Check DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID in .env.' });
}
try {
  const runtime = new RuntimeConfig({ file: resolve('ai.config.json'), overridesFile: resolve('.ai-config-overrides.json'), allowSetup: true });
  await runtime.load();
  const worker = workerConfig(runtime.value);
  const adminsAllowed = [...worker.adminUsers].every(id => worker.allowedUsers.has(id));
  checks.push({ name: 'Worker configuration', status: adminsAllowed ? 'pass' : 'fail',
    detail: adminsAllowed ? 'Runtime configuration, allowlists, permissions and timeout are valid.'
      : 'Every ADMIN_USER_IDS entry must also appear in ALLOWED_USER_IDS.' });
  if (runtime.value.source === 'setup') checks.push({ name: 'Initial setup', status: worker.adminUsers.size ? 'warn' : 'fail',
    detail: worker.adminUsers.size ? 'The bot can start. Run /ai init to configure its startup-folder project, or configure project folders locally.'
      : 'Set ADMIN_USER_IDS to an allowed user, then start the bot and run /ai init.' });
  checks.push(...await diagnose(runtime.value));
} catch {
  checks.push({ name: 'Worker configuration', status: 'fail',
    detail: 'Check project directories, providers, profiles, overrides, ALLOWED_USER_IDS, CODEX_SANDBOX and CODEX_TIMEOUT_SECONDS.' });
}
for (const check of checks) console.log('[' + check.status.toUpperCase() + '] ' + check.name + ': ' + check.detail);
console.log('No model requests were made. Authentication checks do not prove model access or quota.');
if (checks.some(check => check.status === 'fail')) process.exitCode = 1;
