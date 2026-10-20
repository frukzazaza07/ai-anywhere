import 'dotenv/config';
import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';
import { isModelName, isProviderId, providerIds, type ProviderConfig, type ProviderId } from './providers.js';
import { projectConfig, type ProjectConfig } from './projects.js';
import { type RuntimeSnapshot } from './runtime-config.js';

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('replace_with_')) throw new Error(`Set ${name} in .env`);
  return value;
}

export function discordConfig() {
  const token = required('DISCORD_TOKEN');
  const clientId = required('DISCORD_CLIENT_ID');
  const guildId = required('DISCORD_GUILD_ID');
  for (const [name, value] of Object.entries({ clientId, guildId })) {
    if (!/^\d{17,20}$/.test(value)) throw new Error(`Invalid Discord ${name}`);
  }
  return { token, clientId, guildId };
}

export function taskTimeoutMs(value?: string): number {
  const seconds = Number(value?.trim() || 0);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 2147483) {
    throw new Error('CODEX_TIMEOUT_SECONDS must be 0 (disabled) or a positive integer up to 2147483');
  }
  return seconds * 1000;
}

export const maxWorkerLimit = 8;

/** Concurrent AI jobs; 1 keeps a single shared worker. Each project directory still runs one job at a time. */
export function maxWorkers(value?: string): number {
  const workers = Number(value?.trim() || 1);
  if (!Number.isInteger(workers) || workers < 1 || workers > maxWorkerLimit) {
    throw new Error('AI_MAX_WORKERS must be an integer from 1 to ' + maxWorkerLimit);
  }
  return workers;
}

export function adminUserIds(value = process.env.ADMIN_USER_IDS): Set<string> {
  if (!value?.trim()) return new Set();
  const ids = value.split(',').map(id => id.trim());
  if (ids.some(id => !/^\d{17,20}$/.test(id))) throw new Error('Invalid ADMIN_USER_IDS');
  return new Set(ids);
}

export function workerConfig(runtime?: RuntimeSnapshot): {
  allowedUsers: Set<string>;
  adminUsers: Set<string>;
  workdir: string;
  sandbox: 'read-only' | 'workspace-write';
  timeoutMs: number;
  maxWorkers: number;
  providers: ProviderConfig;
  projects: ProjectConfig;
} {
  const ids = required('ALLOWED_USER_IDS').split(',').map(value => value.trim());
  if (ids.some(value => !/^\d{17,20}$/.test(value))) throw new Error('Invalid ALLOWED_USER_IDS');
  const projects = runtime?.projects ?? projectConfig();
  const workdir = projects.directories.get(projects.defaultProject)!;
  const sandbox = process.env.CODEX_SANDBOX ?? 'read-only';
  if (sandbox !== 'read-only' && sandbox !== 'workspace-write') {
    throw new Error('CODEX_SANDBOX must be read-only or workspace-write');
  }
  return { allowedUsers: new Set(ids), adminUsers: adminUserIds(), workdir, sandbox,
    timeoutMs: taskTimeoutMs(process.env.CODEX_TIMEOUT_SECONDS), maxWorkers: maxWorkers(process.env.AI_MAX_WORKERS), providers: runtime?.providers ?? providerConfig(), projects };
}

export function providerConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const values = (env.AI_PROVIDERS ?? 'codex').split(',').map(value => value.trim());
  const enabled = new Set<ProviderId>();
  for (const value of values) {
    if (!isProviderId(value)) throw new Error('AI_PROVIDERS must contain codex, claude or gemini');
    enabled.add(value);
  }
  const defaultProvider = env.AI_DEFAULT_PROVIDER?.trim() || 'codex';
  if (!isProviderId(defaultProvider) || !enabled.has(defaultProvider)) {
    throw new Error('AI_DEFAULT_PROVIDER must be enabled in AI_PROVIDERS');
  }
  const models: ProviderConfig['models'] = {};
  for (const provider of providerIds) {
    const name = provider.toUpperCase() + '_MODEL';
    const model = env[name]?.trim();
    if (model && !isModelName(model)) throw new Error('Invalid ' + name);
    if (model) models[provider] = model;
  }
  const claudeExecutable = env.CLAUDE_EXECUTABLE?.trim() || undefined;
  const geminiScript = env.GEMINI_CLI_SCRIPT?.trim() || undefined;
  if (enabled.has('claude') && claudeExecutable
    && (!isAbsolute(claudeExecutable) || /\.(cmd|bat|ps1|[cm]?js)$/i.test(claudeExecutable)
      || !statSync(claudeExecutable).isFile())) {
    throw new Error('CLAUDE_EXECUTABLE must be an absolute native executable path');
  }
  if (enabled.has('gemini') && (!geminiScript || !isAbsolute(geminiScript)
    || !/\.[cm]?js$/i.test(geminiScript) || !statSync(geminiScript).isFile())) {
    throw new Error('GEMINI_CLI_SCRIPT must be an absolute path to the installed Gemini CLI JavaScript entry point');
  }
  return { enabled, defaultProvider, models, claudeExecutable, geminiScript };
}
