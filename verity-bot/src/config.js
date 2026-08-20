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

const baseUrl = process.env.VERITY_BASE_URL || undefined;
/** A model running on this machine: no key, no quota, and much slower. */
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(
  baseUrl ?? '',
);

export const config = {
  isLocal,
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
  // A comma-separated fallback chain, best first. Free tiers meter per model,
  // so when the first one runs out of daily budget Verity steps to the next.
  models: (process.env.VERITY_MODEL || 'claude-opus-5')
    .split(',')
    .map((entry) => entry.trim().replace(/^models\//, ''))
    .filter(Boolean),
  get model() {
    return this.models[0];
  },
  baseUrl,
  apiKey:
    process.env.VERITY_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    // Local runtimes ignore the key, but the SDK insists on one.
    (isLocal ? 'local' : undefined),
  // Reasoning models (Gemini 3.x and friends) spend this budget on internal
  // thinking before they write a word, so the OpenAI-compatible path needs a
  // far bigger ceiling than Claude does or replies come back truncated.
  // Hard ceiling on model calls per minute across the whole bot. Free tiers
  // sit around 10-15 RPM, so this stays just under.
  maxRpm: Number(process.env.VERITY_MAX_RPM || (isLocal ? Infinity : 8)),
  // A laptop generating tokens on its own CPU is far slower than an API.
  timeoutMs: Number(process.env.VERITY_TIMEOUT_MS || (isLocal ? 300_000 : 60_000)),
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

  // Music. Spotify hands out track names, never audio — see music/resolve.js.
  spotify: {
    id: process.env.VERITY_SPOTIFY_ID || null,
    secret: process.env.VERITY_SPOTIFY_SECRET || null,
  },
  // Where audio actually comes from for links that are not already audio.
  // Unset means direct files, radio streams and local files only.
  ytdlp:
    !process.env.VERITY_YTDLP || process.env.VERITY_YTDLP === 'false'
      ? null
      : process.env.VERITY_YTDLP === 'true'
        ? 'yt-dlp'
        : process.env.VERITY_YTDLP,

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
    // Only answer messages that are actually asking him something.
    questionsOnly: process.env.VERITY_QUESTIONS_ONLY === 'true',
    // Answered questions allowed per person per window. 0 disables the limit.
    questionLimit: Number(process.env.VERITY_QUESTION_LIMIT || 10),
    quotaHours: Number(process.env.VERITY_QUOTA_HOURS || 24),
  },
};
