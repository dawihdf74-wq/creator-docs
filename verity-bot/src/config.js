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

  // Who may use slash commands. IDs or usernames; blank means everyone.
  owners: (process.env.VERITY_OWNERS ?? 'areajoo,dangcanss')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  // Commands the allowlist does not apply to, so you can hand one back to the
  // channel without opening all of them, e.g. VERITY_OPEN_COMMANDS=ask,prophecy
  openCommands: (process.env.VERITY_OPEN_COMMANDS ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^\//, '').toLowerCase())
    .filter(Boolean),

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
  // Reasoning models (Gemini 3.x and friends) spend this budget on internal
  // thinking before they write a word, so the OpenAI-compatible path needs a
  // far bigger ceiling than Claude does or replies come back truncated.
  maxTokens: Number(
    process.env.VERITY_MAX_TOKENS ||
      ((process.env.VERITY_PROVIDER || 'claude').toLowerCase() === 'openai' ? 2000 : 700),
  ),
  // Anthropic only; ignored by OpenAI-compatible providers.
  effort: process.env.VERITY_EFFORT || 'low',
  // OpenAI-compatible only, and only sent when set: 'low' makes Gemini think
  // less and answer sooner. Some providers reject the parameter outright,
  // which is why it stays unset unless you ask for it.
  reasoningEffort: process.env.VERITY_REASONING_EFFORT || undefined,

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
    // Answered questions allowed per person per window. 0 disables the limit.
    questionLimit: Number(process.env.VERITY_QUESTION_LIMIT || 10),
    quotaHours: Number(process.env.VERITY_QUOTA_HOURS || 24),
  },
};
