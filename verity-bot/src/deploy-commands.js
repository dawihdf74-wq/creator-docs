import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';

/**
 * Registers the slash commands with Discord. Run this once after inviting the
 * bot, and again whenever a command definition changes.
 *
 *   npm run deploy
 *
 * With DISCORD_DEV_GUILD_ID set, commands land in that one server instantly.
 * Without it they register globally, which can take up to an hour to appear.
 */
const body = commands.map((command) => command.data.toJSON());
const rest = new REST().setToken(config.token);

const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

try {
  const data = await rest.put(route, { body });
  console.log(
    `[verity] registered ${data.length} commands ${config.devGuildId ? `in guild ${config.devGuildId}` : 'globally (may take up to an hour to appear)'}:`,
  );
  for (const command of data) console.log(`  /${command.name}`);
} catch (error) {
  console.error('[verity] failed to register commands:', error);
  process.exitCode = 1;
}
