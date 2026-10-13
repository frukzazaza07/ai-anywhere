import { Routes, type REST } from 'discord.js';
import { createCommands } from './commands.js';

const legacy = new Map([
  ['codex', 'Run Codex tasks and manage your session'],
  ['new', 'Start a fresh Codex conversation with your next prompt'],
  ['status', 'Show your Codex session, worker state and configuration'],
  ['clear', 'Clear your current Codex conversation context'],
]);

export async function registerCommands(rest: Pick<REST, 'post' | 'get' | 'delete'>, clientId: string, guildId: string): Promise<void> {
  const route = Routes.applicationGuildCommands(clientId, guildId);
  for (const command of createCommands()) {
    await rest.post(route, { body: command.toJSON() });
  }

  // Match descriptions so unrelated commands with the same names remain untouched.
  const previous = await rest.get(route) as Array<{ id: string; name: string; description: string }>;
  for (const command of previous) {
    if (legacy.get(command.name) === command.description) {
      await rest.delete(Routes.applicationGuildCommand(clientId, guildId, command.id));
    }
  }
}
