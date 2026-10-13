import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext } from 'node:test';
import { RuntimeConfig } from '../src/runtime-config.js';

export const owner = { guildId: '111111111111111111', channelId: '222222222222222222', userId: '333333333333333333' };
export const auth = { guildId: owner.guildId, allowedUsers: new Set([owner.userId]), adminUsers: new Set([owner.userId]) };
export const access = { guildId: owner.guildId, userId: owner.userId };
export async function runtimeFixture(t: TestContext, options: { busy?: () => boolean; write?: (file: string, text: string) => Promise<void> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'api'));
  const file = join(directory, 'ai.config.json');
  const overridesFile = join(directory, 'overrides.json');
  const config = {
    version: 1, projects: { web: { directory: '.' }, api: { directory: './api' } },
    providers: { codex: { models: ['m1', 'm2'], defaultModel: 'm1' }, claude: { models: ['sonnet'] } },
    profiles: { review: { provider: 'codex', model: 'm2' }, fast: { provider: 'codex', model: 'm1' },
      plain: { provider: 'codex' }, writer: { provider: 'claude', model: 'sonnet' } },
    defaultProject: 'web', defaultProfile: 'review',
  };
  const save = () => writeFile(file, JSON.stringify(config));
  await save();
  const runtimeOptions = { file, overridesFile, ...options };
  const runtime = new RuntimeConfig(runtimeOptions);
  await runtime.load();
  return { directory, file, overridesFile, config, save, runtimeOptions, runtime };
}
