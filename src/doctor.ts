import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { compatibleVersion } from './agent-runner.js';
import { codexScript, terminateWorker, workerEnvironment } from './runner.js';
import { type RuntimeSnapshot } from './runtime-config.js';

export interface Diagnostic { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface ProbeResult { code: number | null; output: string }
export type Probe = (executable: string, args: string[], cwd: string) => Promise<ProbeResult>;

/** Bounded, noninteractive probes. Raw output is parsed internally and never printed. */
export const probeCli: Probe = (executable, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { cwd, env: workerEnvironment(), shell: false,
    windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let bytes = 0;
  let failed = false;
  const timer = setTimeout(() => { failed = true; terminateWorker(child); }, 10000);
  const collect = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 65536) {
      if (!failed) { failed = true; terminateWorker(child); }
    } else if (!failed) output += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', () => { clearTimeout(timer); reject(new Error('AI_PROVIDER_UNAVAILABLE')); });
  child.on('close', code => {
    clearTimeout(timer);
    if (failed) reject(new Error('AI_DIAGNOSTIC_LIMIT'));
    else resolve({ code, output });
  });
});

export function supportedNode(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major! > 24 || (major === 24 && (minor! > 17 || (minor === 17 && patch! >= 0)));
}

async function geminiAuthentication(env: NodeJS.ProcessEnv, home: string): Promise<Diagnostic> {
  const result: Diagnostic = { name: 'gemini authentication', status: 'warn',
    detail: 'No local credential indicator found. Complete Gemini login as the bot OS user.' };
  if ([env.GEMINI_API_KEY, env.GOOGLE_API_KEY].some(key => key?.trim() && !key.startsWith('replace_with_'))) {
    result.detail = 'API key configured; validity and account access require operator verification.';
    return result;
  }
  if (env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || env.GOOGLE_APPLICATION_CREDENTIALS) {
    result.detail = 'Google Cloud authentication configured; verify credentials with your local Google Cloud tooling.';
    return result;
  }
  try {
    const credentials: unknown = JSON.parse(await readFile(join(home, '.gemini', 'oauth_creds.json'), 'utf8'));
    if (credentials && typeof credentials === 'object' && 'refresh_token' in credentials
      && typeof credentials.refresh_token === 'string' && credentials.refresh_token.trim()) {
      result.detail = 'Cached OAuth credential found; freshness and account access require operator verification.';
    }
  } catch { /* Missing or unreadable credentials are a warning; never print their contents. */ }
  return result;
}

export async function diagnose(runtime: RuntimeSnapshot, probe: Probe = probeCli,
  env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<Diagnostic[]> {
  const checks: Diagnostic[] = [];
  for (const [name, directory] of runtime.projects.directories) {
    let available = false;
    try { available = (await stat(directory)).isDirectory(); } catch { /* Report aliases only. */ }
    checks.push({ name: 'project ' + name, status: available ? 'pass' : 'fail',
      detail: available ? 'Directory exists.' : 'Directory is missing or inaccessible.' });
  }
  const cwd = runtime.projects.directories.get(runtime.projects.defaultProject)!;
  for (const provider of runtime.providers.enabled) {
    try {
      const executable = provider === 'claude' ? runtime.providers.claudeExecutable ?? 'claude' : process.execPath;
      const prefix = provider === 'codex' ? [codexScript()]
        : provider === 'gemini' ? [runtime.providers.geminiScript!] : [];
      const version = await probe(executable, [...prefix, '--version'], cwd);
      const semver = /(?:^|\s)(\d+\.\d+\.\d+)(?=\s|$)/.exec(version.output)?.[1];
      const compatible = version.code === 0 && !!semver && (provider === 'codex'
        ? semver === '0.162.1' : compatibleVersion(version.output, provider));
      checks.push({ name: provider + ' CLI', status: compatible ? 'pass' : 'fail',
        detail: compatible ? 'Compatible version ' + semver + '.' : 'Version unavailable or unsupported. Check the documented CLI version.' });
      if (!compatible) continue;
      if (provider === 'gemini') checks.push(await geminiAuthentication(env, home));
      else {
        const auth = await probe(executable, [...prefix, ...(provider === 'codex' ? ['login', 'status'] : ['auth', 'status'])], cwd);
        let authenticated = auth.code === 0;
        if (provider === 'claude') {
          const data: unknown = JSON.parse(auth.output);
          authenticated &&= !!data && typeof data === 'object' && 'loggedIn' in data && data.loggedIn === true;
        }
        checks.push({ name: provider + ' authentication', status: authenticated ? 'pass' : 'fail',
          detail: authenticated ? 'CLI reports logged in; model access was not tested.' : 'Login required for the bot OS user.' });
      }
    } catch {
      checks.push({ name: provider + ' probe', status: 'fail', detail: 'Probe failed or exceeded its limit. Check installation and local login.' });
    }
  }
  return checks;
}
