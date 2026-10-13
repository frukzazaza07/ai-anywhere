import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { compatibleVersion, executeCli, geminiSettings } from './agent-runner.js';
import { isEffort } from './effort.js';
import { parseModelCatalog, type CliModel } from './model-catalog.js';
import { discoverCodexCatalog } from './model-discovery.js';
import { type ProviderId } from './providers.js';
import { terminateWorker, workerEnvironment } from './runner.js';

export interface ProviderDiscoveryOptions {
  workdir: string;
  claudeExecutable?: string;
  geminiScript?: string;
  timeoutMs?: number;
  // Fixed local fixture only, never received from Discord.
  cliScript?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Query metadata protocols without submitting a user message or a model turn. */
export async function discoverProviderModels(provider: ProviderId, options: ProviderDiscoveryOptions): Promise<CliModel[]> {
  if (provider === 'codex') return discoverCodexCatalog(options);
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 10000;
  const temporary = await mkdtemp(join(tmpdir(), 'ai-model-picker-'));
  try {
    const env = workerEnvironment();
    env.CI = 'true';
    env.NO_BROWSER = 'true';
    let executable: string;
    let args: string[];
    if (provider === 'claude') {
      executable = options.claudeExecutable ?? 'claude';
      args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--restricted', '--permission-mode', 'dontAsk', '--tools', '', '--disable-slash-commands',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--settings', '{"disableAllHooks":true}', '--no-session-persistence'];
    } else {
      if (!options.geminiScript && !options.cliScript) throw new Error('AI_MODELS_UNAVAILABLE');
      await geminiSettings(join(temporary, 'settings.json'), 'read-only', env, { workdir: temporary, sandbox: 'read-only' }, true);
      executable = process.execPath;
      args = [options.geminiScript!, '--acp', '--approval-mode', 'plan'];
    }
    if (options.cliScript) {
      executable = process.execPath;
      args = [options.cliScript, ...(provider === 'gemini' ? args.slice(1) : args)];
    }
    if (/\.(cmd|bat|ps1)$/i.test(executable)) throw new Error('AI_MODELS_UNAVAILABLE');
    const versionArgs = executable === process.execPath ? [args[0]!, '--version'] : ['--version'];
    const remaining = () => {
      const budget = timeoutMs - (Date.now() - started);
      if (budget <= 0) throw new Error('AI_MODELS_TIMEOUT');
      return budget;
    };
    const version = await executeCli(executable, versionArgs, env, '', { workdir: temporary,
      sandbox: 'read-only', timeoutMs: Math.min(remaining(), 10000) });
    if (!compatibleVersion(version, provider)) throw new Error('AI_CLI_VERSION');
    return await protocolModels(provider, executable, args, temporary, env, remaining());
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'AI_TIMEOUT') throw new Error('AI_MODELS_TIMEOUT');
      if (error.message === 'AI_OUTPUT_LIMIT') throw new Error('AI_MODELS_OUTPUT_LIMIT');
      if (['AI_MODELS_TIMEOUT', 'AI_MODELS_OUTPUT_LIMIT', 'AI_CLI_VERSION'].includes(error.message)) throw error;
    }
    throw new Error('AI_MODELS_UNAVAILABLE');
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
}

function protocolModels(provider: 'claude' | 'gemini', executable: string, args: string[], cwd: string,
  env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CliModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stopped = false;
    let result: CliModel[] | undefined;
    let failure: Error | undefined;
    let bytes = 0;
    let expectedId = 0;
    let cleanup: ReturnType<typeof setTimeout> | undefined;
    const events = createInterface({ input: child.stdout });
    const finish = (error?: Error) => {
      if (stopped) return;
      stopped = true; failure = error;
      clearTimeout(timer); events.close(); child.stdin.end();
      cleanup = setTimeout(() => terminateWorker(child), 250);
      cleanup.unref();
    };
    const timer = setTimeout(() => finish(new Error('AI_MODELS_TIMEOUT')), timeoutMs);
    const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
    const count = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) finish(new Error('AI_MODELS_OUTPUT_LIMIT'));
    };
    child.stdout.on('data', count); child.stderr.on('data', count);
    child.stdin.on('error', () => { if (!stopped) finish(new Error('AI_MODELS_UNAVAILABLE')); });
    child.on('error', () => finish(new Error('AI_MODELS_UNAVAILABLE')));
    child.on('close', () => {
      clearTimeout(cleanup);
      if (!stopped) finish(new Error('AI_MODELS_UNAVAILABLE'));
      clearTimeout(cleanup);
      if (failure || result === undefined) reject(failure ?? new Error('AI_MODELS_UNAVAILABLE'));
      else resolve(result);
    });
    events.on('line', line => {
      if (stopped) return;
      try {
        const response: unknown = JSON.parse(line);
        if (!record(response)) return;
        if (provider === 'claude') {
          if (response.type === 'control_request') {
            send({ type: 'control_response', response: { subtype: 'error', request_id: response.request_id, error: 'Metadata only' } });
            return;
          }
          if (response.type !== 'control_response' || !record(response.response) || response.response.request_id !== 'models') return;
          if (response.response.subtype !== 'success' || !record(response.response.response)
            || !Array.isArray(response.response.response.models)) throw new Error();
          result = parseModelCatalog(response.response.response.models.map(item => {
            if (!record(item) || (item.supportedEffortLevels !== undefined && !Array.isArray(item.supportedEffortLevels))) throw new Error();
            return { model: item.value, ...(item.supportsEffort === false ? { efforts: [] }
              : Array.isArray(item.supportedEffortLevels) ? { efforts: item.supportedEffortLevels.filter(isEffort) } : {}) };
          }));
        } else {
          if (typeof response.method === 'string' && response.id !== undefined) {
            send({ jsonrpc: '2.0', id: response.id, error: { code: -32601, message: 'Metadata only' } });
            return;
          }
          if (response.id !== expectedId) return;
          if (response.error || !record(response.result)) throw new Error();
          if (expectedId === 0) {
            if (response.result.protocolVersion !== 1) throw new Error();
            expectedId = 1;
            send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd, mcpServers: [] } });
            return;
          }
          if (!record(response.result.models) || !Array.isArray(response.result.models.availableModels)) throw new Error();
          result = parseModelCatalog(response.result.models.availableModels.map(item => {
            if (!record(item)) throw new Error();
            return { model: item.modelId };
          }));
        }
        finish();
      } catch { finish(new Error('AI_MODELS_UNAVAILABLE')); }
    });
    if (provider === 'claude') send({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize', hooks: null } });
    else send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
  });
}
