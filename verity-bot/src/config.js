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

  // Model provider: 'claude' (Anthropic SDK) or 'openai' (any
  // OpenAI-compatible endpoint — Gemini, Groq, OpenRouter, Ollama, ...).
  provider: (process.env.VERITY_PROVIDER || 'claude').toLowerCase(),
  model: process.env.VERITY_MODEL || 'claude-opus-5',
  baseUrl: process.env.VERITY_BASE_URL || undefined,
  apiKey:
    process.env.VERITY_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    undefined,
  maxTokens: Number(process.env.VERITY_MAX_TOKENS || 700),
  // Anthropic only; ignored by OpenAI-compatible providers.
  effort: process.env.VERITY_EFFORT || 'low',

  // Behaviour
  // Command confirmations are visible to the whole channel unless this is off.
  publicReplies: process.env.VERITY_PUBLIC_REPLIES !== 'false',
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
