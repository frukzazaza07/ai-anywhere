import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { codexScript, terminateWorker, workerEnvironment } from './runner.js';
import { isModelName } from './providers.js';
import { isEffort } from './effort.js';
import { parseModelCatalog, type CliModel } from './model-catalog.js';

interface DiscoveryOptions {
  workdir: string;
  timeoutMs?: number;
  // Local test override only; never supplied through Discord.
  cliScript?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Ask the installed CLI for picker-visible models without starting a thread or turn. */
export async function discoverCodexCatalog(options: DiscoveryOptions): Promise<CliModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [options.cliScript ?? codexScript(), 'app-server', '--stdio'], {
      cwd: options.workdir, env: workerEnvironment(), shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let error: Error | undefined;
    let expectedId = 0;
    let pages = 0;
    let bytes = 0;
    const models = new Map<string, CliModel>();
    const cursors = new Set<string>();
    let cleanup: ReturnType<typeof setTimeout> | undefined;
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      error = failure;
      clearTimeout(timer);
      events.close();
      child.stdin.end();
      cleanup = setTimeout(() => terminateWorker(child), 250);
      cleanup.unref();
    };
    const timer = setTimeout(() => finish(new Error('AI_MODELS_TIMEOUT')), options.timeoutMs ?? 10000);
    // Count before readline buffers input, including diagnostics that are never displayed.
    const count = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) finish(new Error('AI_MODELS_OUTPUT_LIMIT'));
    };
    child.stdout.on('data', count);
    child.stderr.on('data', count);
    const events = createInterface({ input: child.stdout });
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
    const nextPage = (cursor?: string) => {
      if (++pages > 20) { finish(new Error('AI_MODELS_OUTPUT_LIMIT')); return; }
      expectedId++;
      send({ id: expectedId, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
    };
    child.stdin.on('error', () => finish(new Error('AI_MODELS_UNAVAILABLE')));
    child.on('error', () => finish(new Error('AI_MODELS_UNAVAILABLE')));
    child.on('close', code => {
      if (!settled) finish(new Error('AI_MODELS_UNAVAILABLE'));
      clearTimeout(cleanup);
      // Wait for process exit so the workdir is released on Windows.
      if (error) reject(error);
      else if (code !== 0) reject(new Error('AI_MODELS_UNAVAILABLE'));
      else resolve(parseModelCatalog([...models.values()]));
    });
    events.on('line', line => {
      if (settled) return;
      try {
        const response: unknown = JSON.parse(line);
        if (!record(response) || response.id !== expectedId) return;
        if (response.error || !record(response.result)) throw new Error('AI_MODELS_UNAVAILABLE');
        if (expectedId === 0) {
          send({ method: 'initialized', params: {} });
          nextPage();
          return;
        }
        const result = response.result;
        if (!Array.isArray(result.data) || result.data.length > 100
          || (result.nextCursor != null && (typeof result.nextCursor !== 'string'
            || !result.nextCursor.length || result.nextCursor.length > 4096))) throw new Error('AI_MODELS_UNAVAILABLE');
        for (const item of result.data) {
          if (!record(item) || !isModelName(item.model)
            || (item.hidden !== undefined && typeof item.hidden !== 'boolean')) throw new Error('AI_MODELS_UNAVAILABLE');
          if (item.supportedReasoningEfforts !== undefined && !Array.isArray(item.supportedReasoningEfforts)) throw new Error('AI_MODELS_UNAVAILABLE');
          if (!item.hidden) models.set(item.model, { model: item.model,
            ...(Array.isArray(item.supportedReasoningEfforts) ? { efforts: item.supportedReasoningEfforts
              .filter(record).map(level => level.reasoningEffort).filter(isEffort) } : {}) });
        }
        if (typeof result.nextCursor === 'string') {
          if (cursors.has(result.nextCursor)) throw new Error('AI_MODELS_UNAVAILABLE');
          cursors.add(result.nextCursor);
          nextPage(result.nextCursor);
        } else finish();
      } catch { finish(new Error('AI_MODELS_UNAVAILABLE')); }
    });
    send({ id: 0, method: 'initialize', params: {
      clientInfo: { name: 'codex_discord_models', title: 'Discord Model Catalog', version: '1.0.0' },
    } });
  });
}

/** Preserve the local string-only listing API. */
export async function discoverCodexModels(options: DiscoveryOptions): Promise<string[]> {
  return (await discoverCodexCatalog(options)).map(item => item.model);
}
