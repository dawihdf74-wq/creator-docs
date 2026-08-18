import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[verity] Missing required environment variable: ${name}`);
    console.error('[verity] Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return value;
}

export const config = {
  // Discord
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  // Optional: register commands to a single guild (instant) instead of globally (~1h).
  devGuildId: process.env.DISCORD_DEV_GUILD_ID || null,

  // Claude
  model: process.env.VERITY_MODEL || 'claude-opus-5',
  maxTokens: Number(process.env.VERITY_MAX_TOKENS || 700),
  effort: process.env.VERITY_EFFORT || 'low',

  // Behaviour
  memoryTurns: Number(process.env.VERITY_MEMORY_TURNS || 14),
  dataDir: process.env.VERITY_DATA_DIR || 'data',

  // Defaults applied to a guild the first time Verity sees it.
  defaults: {
    mood: 'friendly',
    autoEscalate: true,
    // Chance (0-100) that Verity butts into a message in an "all" channel
    // that wasn't addressed to him.
    chattiness: 100,
    // Seconds between unprompted replies in the same channel.
    cooldown: 8,
    replyInDms: true,
  },
};
