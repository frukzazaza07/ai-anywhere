import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatCodexLimits, readCodexLimits, codexLimitsStatus } from '../src/limits.js';

const snapshot = {
  rateLimits: {
    limitId: 'codex', planType: 'plus',
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1800500000 },
    credits: { hasCredits: true, unlimited: false, balance: '12.5' },
  },
};

test('limits show remaining quota, actual window durations, localized resets and credits', () => {
  const text = formatCodexLimits(snapshot);
  assert.match(text, /Plan: plus/);
  assert.match(text, /5-hour limit: 75% remaining \(25% used\)/);
  assert.match(text, /1-week limit: 40% remaining/);
  assert.match(text, /<t:1800000000:F>/);
  assert.match(text, /<t:1800000000:R>/);
  assert.match(text, /Credits balance: 12.5/);
});

test('multiple buckets and backend restrictions are retained without inventing missing windows', () => {
  const text = formatCodexLimits({
    rateLimits: snapshot.rateLimits,
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 110, windowDurationMins: 10080 }, rateLimitReachedType: 'usageLimitReached' },
      other: { limitName: 'Other quota', credits: { hasCredits: true, unlimited: true } },
    },
    ordinaryUsageAllowed: false,
    rateLimitResetCredits: { availableCount: 2 },
  });
  assert.match(text, /1-week limit: 0% remaining/);
  assert.doesNotMatch(text, /5-hour/);
  assert.match(text, /Reset time: unavailable/);
  assert.match(text, /Other quota/);
  assert.match(text, /Usage windows unavailable/);
  assert.match(text, /Credits: unlimited/);
  assert.match(text, /Limit reached: usageLimitReached/);
  assert.match(text, /Included usage currently unavailable/);
  assert.match(text, /Available usage resets: 2/);
  assert.match(formatCodexLimits({}), /Usage data unavailable/);
});

async function withServer(mode: string, check: (dir: string, script: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-limits-test-'));
  const script = join(dir, 'server.mjs');
  try {
    await writeFile(script, `import { createInterface } from 'node:readline';
      import { writeFileSync } from 'node:fs';
      const mode = ${JSON.stringify(mode)};
      const methods = [];
      let initialized = false;
      const reply = message => process.stdout.write(JSON.stringify(message) + '\\n');
      createInterface({ input: process.stdin }).on('line', line => {
        const request = JSON.parse(line);
        methods.push(request.method);
        writeFileSync(${JSON.stringify(join(dir, 'calls.json'))}, JSON.stringify({
          methods, leaked: Object.keys(process.env).filter(key => key.startsWith('DISCORD_') || key === 'ALLOWED_USER_IDS'),
          args: process.argv.slice(2),
        }));
        if (mode === 'stall') return;
        if (request.method === 'initialize') reply({ id: request.id, result: {} });
        else if (request.method === 'initialized') initialized = true;
        else if (!initialized) process.exit(3);
        else if (request.method === 'account/read') reply({ id: request.id, result: {
          account: mode === 'logged-out' ? null : { type: mode === 'api' ? 'apiKey' : 'chatgpt', email: 'private@example.com' },
        } });
        else if (request.method === 'account/rateLimits/read') {
          if (mode === 'error') reply({ id: request.id, error: { message: 'private auth-token secret' } });
          else {
            if (mode === 'delayed') { setTimeout(() => reply({ id: request.id, result: {"rateLimits":{"primary":{"usedPercent":25,"windowDurationMins":300}}} }), 250); return; }
            reply({ method: 'account/updated', params: { email: 'private@example.com' } });
            const response = JSON.stringify({ id: request.id, result: ${JSON.stringify(snapshot)} }) + '\\n';
            process.stdout.write(response.slice(0, 20));
            process.stdout.write(response.slice(20));
          }
        } else process.exit(4);
      });
      if (mode === 'stall') setInterval(() => {}, 1000);
    `);
    await check(dir, script);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('app-server handshake fetches limits without model turns or Discord credentials', async () => {
  const oldToken = process.env.DISCORD_TOKEN;
  const oldUsers = process.env.ALLOWED_USER_IDS;
  process.env.DISCORD_TOKEN = 'test-secret';
  process.env.ALLOWED_USER_IDS = 'test-users';
  try {
    await withServer('success', async (dir, script) => {
      const text = await readCodexLimits({ workdir: dir, cliScript: script, timeoutMs: 5000 });
      assert.match(text, /75% remaining/);
      assert.doesNotMatch(text, /private@example.com/);
      const calls = JSON.parse(await readFile(join(dir, 'calls.json'), 'utf8'));
      assert.deepEqual(calls.methods, ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
      assert.deepEqual(calls.leaked, []);
      assert.deepEqual(calls.args, ['app-server', '--stdio']);
    });
  } finally {
    if (oldToken === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = oldToken;
    if (oldUsers === undefined) delete process.env.ALLOWED_USER_IDS; else process.env.ALLOWED_USER_IDS = oldUsers;
  }
});

test('API-key and logged-out accounts get an explicit explanation without a quota request', async () => {
  for (const mode of ['api', 'logged-out']) {
    await withServer(mode, async (dir, script) => {
      const text = await readCodexLimits({ workdir: dir, cliScript: script, timeoutMs: 5000 });
      assert.match(text, mode === 'api' ? /API-key accounts/ : /not logged in/);
      const calls = JSON.parse(await readFile(join(dir, 'calls.json'), 'utf8'));
      assert.ok(!calls.methods.includes('account/rateLimits/read'));
    });
  }
});

test('server failures do not leak diagnostics or invent remaining usage', async () => {
  await withServer('error', async (dir, script) => {
    const text = await codexLimitsStatus({ workdir: dir, cliScript: script, timeoutMs: 5000 });
    assert.match(text, /usage limits are unavailable/);
    assert.doesNotMatch(text, /secret|auth-token|remaining/);
  });
});

test('stalled account checks have a bounded timeout', async () => {
  await withServer('stall', async (dir, script) => {
    await assert.rejects(readCodexLimits({ workdir: dir, cliScript: script, timeoutMs: 200 }), /CODEX_LIMITS_TIMEOUT/);
  });
});

test('zero status deadline lets a delayed account response complete', async () => {
  await withServer('delayed', async (dir, script) => {
    const text = await readCodexLimits({ workdir: dir, cliScript: script, timeoutMs: 0 });
    assert.match(text, /75% remaining/);
  });
});
