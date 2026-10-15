import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runCodex, terminateWorker, workerEnvironment, type RunOptions } from './runner.js';
import { isModelName, isProviderId, type ProviderId } from './providers.js';
import { validateEffort } from './effort.js';
import { claudeContextWindows } from './claude-context.js';

export interface AgentRunOptions extends RunOptions {
  provider?: ProviderId;
  claudeExecutable?: string;
  geminiScript?: string;
}

const sessionPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const maxOutputBytes = 2_000_000;

export function executeCli(executable: string, args: string[], env: NodeJS.ProcessEnv,
  prompt: string, options: RunOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.workdir, env, shell: false,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: string | undefined;
    const timer = options.timeoutMs && options.timeoutMs > 0 ? setTimeout(() => {
      failure ??= 'AI_TIMEOUT';
      terminateWorker(child);
    }, options.timeoutMs) : undefined;
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        if (!failure) { failure = 'AI_OUTPUT_LIMIT'; terminateWorker(child); }
      } else if (!failure) chunks.push(chunk);
    });
    // Drain diagnostics without storing project content or credentials.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('AI_PROVIDER_UNAVAILABLE')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(new Error(failure ?? 'AI_TASK_FAILED'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(prompt, 'utf8');
  });
}

export function compatibleVersion(text: string, provider: 'claude' | 'gemini'): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?=\s|$)/.exec(text.trim());
  if (!match) return false;
  const version = match.slice(1, 4).map(Number);
  const minimum = provider === 'claude' ? [2, 1, 248] : [0, 63, 0];
  for (let index = 0; index < minimum.length; index++) {
    if (version[index]! > minimum[index]!) return true;
    if (version[index]! < minimum[index]!) return false;
  }
  return true;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_INVALID_OUTPUT');
  return value as Record<string, unknown>;
}

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !sessionPattern.test(value)) throw new Error('AI_INVALID_OUTPUT');
  return value;
}

function parseClaude(text: string): { answer: string; id: string; contextWindows?: Record<string, number> } {
  const result = record(JSON.parse(text));
  if (result.type !== 'result' || result.subtype !== 'success' || result.is_error === true) {
    throw new Error('AI_TASK_FAILED');
  }
  if (Array.isArray(result.permission_denials) && result.permission_denials.length) {
    throw new Error('AI_PERMISSION_DENIED');
  }
  if (typeof result.result !== 'string') throw new Error('AI_INVALID_OUTPUT');
  return { answer: result.result, id: sessionId(result.session_id), contextWindows: claudeContextWindows(result.modelUsage) };
}

function parseGemini(text: string): { answer: string; id: string } {
  let id: string | undefined;
  let answer = '';
  let completed = false;
  for (const line of text.split(/\r?\n/).filter(line => line.trim())) {
    const event = record(JSON.parse(line));
    if (completed) throw new Error('AI_INVALID_OUTPUT');
    if (event.type === 'init') id = sessionId(event.session_id);
    if (event.type === 'message' && event.role === 'assistant') {
      if (typeof event.content !== 'string') throw new Error('AI_INVALID_OUTPUT');
      answer = event.delta === true ? answer + event.content : event.content;
    }
    if (event.type === 'result') {
      if (event.status !== 'success' || event.error) throw new Error('AI_TASK_FAILED');
      completed = true;
    }
  }
  if (!completed || !id) throw new Error('AI_INVALID_OUTPUT');
  return { answer, id };
}

export async function geminiSettings(file: string, sandbox: RunOptions['sandbox'], env: NodeJS.ProcessEnv,
  options: RunOptions, metadataOnly = false): Promise<void> {
  // Preserve installed system policy/auth settings before narrowing available tools.
  const systemPath = env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? (process.platform === 'win32'
    ? 'C:/ProgramData/gemini-cli/settings.json'
    : process.platform === 'darwin' ? '/Library/Application Support/GeminiCli/settings.json'
      : '/etc/gemini-cli/settings.json');
  let system: Record<string, unknown> = {};
  try { system = record(JSON.parse(await readFile(systemPath, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('AI_GEMINI_SETTINGS');
  }
  const tools = ['list_directory', 'read_file', 'read_many_files', 'glob', 'grep_search'];
  if (sandbox === 'workspace-write') tools.push('replace', 'write_file');
  const existingTools = system.tools === undefined ? {} : record(system.tools);
  const core = Array.isArray(existingTools.core)
    ? tools.filter(tool => (existingTools.core as unknown[]).includes(tool)) : tools;
  if (!core.length) throw new Error('AI_PERMISSION_DENIED');
  const existingAdmin = system.admin === undefined ? {} : record(system.admin);
  const modelConfigs = system.modelConfigs === undefined ? {} : record(system.modelConfigs);
  let effortOverrides: object[] = [];
  if (options.effort) {
    const thinkingConfig = options.model?.startsWith('gemini-2.5-')
      ? { thinkingBudget: { low: 1024, medium: 8192, high: 24576 }[options.effort as 'low' | 'medium' | 'high'] }
      : { thinkingLevel: options.effort.toUpperCase() };
    effortOverrides = [{ match: { model: options.model }, modelConfig: { generateContentConfig: { thinkingConfig } } }];
  }
  await writeFile(file, JSON.stringify({
    ...system,
    ...(metadataOnly ? { experimental: { ...(system.experimental === undefined ? {} : record(system.experimental)), autoMemory: false } } : {}),
    ...(options.effort ? { modelConfigs: { ...modelConfigs,
      customOverrides: [...(Array.isArray(modelConfigs.customOverrides) ? modelConfigs.customOverrides : []), ...effortOverrides] } } : {}),
    tools: { ...existingTools, core, discoveryCommand: '', callCommand: '' },
    hooksConfig: { enabled: false }, skills: { enabled: false },
    admin: { ...existingAdmin, extensions: { enabled: false }, mcp: { enabled: false }, skills: { enabled: false } },
    advanced: { ...(system.advanced === undefined ? {} : record(system.advanced)), ignoreLocalEnv: true,
      ...(metadataOnly ? { autoConfigureMemory: false } : {}) },
  }), { mode: 0o600 });
  env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ??= join(dirname(systemPath), 'system-defaults.json');
  env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = file;
}

/** Run an explicitly selected local CLI. User text is always delivered through stdin. */
export async function runAgent(prompt: string, options: AgentRunOptions): Promise<string> {
  const provider = options.provider ?? 'codex';
  if (!isProviderId(provider) || (options.model !== undefined && !isModelName(options.model))) {
    throw new Error('AI_INVALID_SELECTION');
  }
  validateEffort(provider, options.model, options.effort);
  if (!prompt.trim() || prompt.length > 4000) throw new Error('AI_INVALID_PROMPT');
  if (options.sessionId !== undefined && !sessionPattern.test(options.sessionId)) throw new Error('AI_INVALID_SESSION');
  if (provider === 'codex') return runCodex(prompt, options);

  const started = Date.now();
  const temporary = await mkdtemp(join(tmpdir(), 'discord-ai-'));
  try {
    const env = workerEnvironment();
    const common = [...(options.model ? ['--model', options.model] : []),
      ...(options.sessionId ? ['--resume', options.sessionId] : [])];
    let executable: string;
    let args: string[];
    if (provider === 'claude') {
      const tools = options.sandbox === 'workspace-write' ? 'Read,Glob,Grep,Edit,Write' : 'Read,Glob,Grep';
      executable = options.claudeExecutable ?? 'claude';
      args = ['--print', '--output-format', 'json', '--restricted', '--permission-mode', 'dontAsk',
        '--tools', tools, '--allowedTools', tools, '--disable-slash-commands',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--settings', '{"disableAllHooks":true}', ...(options.effort ? ['--effort', options.effort] : []), ...common];
    } else {
      if (!options.geminiScript && !options.cliScript) throw new Error('AI_PROVIDER_UNAVAILABLE');
      await geminiSettings(join(temporary, 'gemini-settings.json'), options.sandbox, env, options);
      executable = process.execPath;
      args = [options.geminiScript!, '--output-format', 'stream-json',
        '--approval-mode', options.sandbox === 'workspace-write' ? 'auto_edit' : 'plan', ...common];
    }
    // Test overrides are local-only; transport never supplies them.
    if (options.cliScript) {
      executable = process.execPath;
      args = [options.cliScript, ...(provider === 'gemini' ? args.slice(1) : args)];
    }
    if (/\.(cmd|bat|ps1)$/i.test(executable)) throw new Error('AI_PROVIDER_UNAVAILABLE');

    // Older Gemini releases may silently ignore security settings they do not recognize.
    const versionArgs = executable === process.execPath ? [args[0]!, '--version'] : ['--version'];
    const version = await executeCli(executable, versionArgs, env, '', { ...options,
      timeoutMs: options.timeoutMs ? Math.min(options.timeoutMs, 10000) : 10000 });
    if (!compatibleVersion(version, provider)) throw new Error('AI_CLI_VERSION');
    const remaining = options.timeoutMs ? options.timeoutMs - (Date.now() - started) : 0;
    if (options.timeoutMs && remaining <= 0) throw new Error('AI_TIMEOUT');
    const output = await executeCli(executable, args, env, prompt, { ...options, timeoutMs: remaining });
    let parsed: { answer: string; id: string; contextWindows?: Record<string, number> };
    try { parsed = provider === 'claude' ? parseClaude(output) : parseGemini(output); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('AI_INVALID_OUTPUT');
      throw error;
    }
    const answer = parsed.answer.trim() || 'The CLI finished without a text response.';
    if (Buffer.byteLength(answer, 'utf8') > 1_000_000) throw new Error('AI_OUTPUT_LIMIT');
    if (options.sessionId && parsed.id !== options.sessionId) throw new Error('AI_INVALID_SESSION');
    options.onSession?.(parsed.id, parsed.contextWindows);
    return answer;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
