import { REST } from 'discord.js';
import { discordConfig } from './config.js';
import { registerCommands } from './registration.js';

const { token, clientId, guildId } = discordConfig();
const rest = new REST({ version: '10' }).setToken(token);
await registerCommands(rest, clientId, guildId);
console.log('Registered /ai, /ai-admin and /help in your server; removed legacy bot commands.');
