import os from 'node:os';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Sets Verity up to run on a model on this machine, with no API key, no
 * quota and no daily cap.
 *
 *   npm run local
 *
 * Looks at what the machine has, picks a model it can actually run, pulls it
 * through Ollama, writes the .env lines, and makes Verity say something to
 * prove it works.
 */

// This script never talks to Discord, so it must not trip the token check
// in config.js on a machine where .env is not filled in yet.
process.env.DISCORD_TOKEN ||= 'setup';
process.env.DISCORD_CLIENT_ID ||= 'setup';

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const say = (line = '') => console.log(line);

// ── what are we working with ────────────────────────────────────────────────
const totalGb = Math.round(os.totalmem() / 1024 ** 3);
let vramGb = 0;
let gpuName = null;
try {
  const out = execFileSync(
    'nvidia-smi',
    ['--query-gpu=name,memory.total', '--format=csv,noheader'],
    {
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  const [name, memory] = out.split('\n')[0].split(',');
  gpuName = name?.trim();
  vramGb = Math.round(Number(String(memory).replace(/[^\d]/g, '')) / 1024);
} catch {
  // No NVIDIA GPU, or no driver. Apple Silicon shares system memory, and
  // everything else runs on the CPU — both are handled by the RAM tier below.
}

const appleSilicon = os.platform() === 'darwin' && os.arch() === 'arm64';

say('\n  Verity — local setup\n');
say(`  machine   ${os.platform()} ${os.arch()}, ${os.cpus().length} cores, ${totalGb} GB RAM`);
say(
  `  graphics  ${gpuName ? `${gpuName} (${vramGb} GB VRAM)` : appleSilicon ? 'Apple Silicon (shared memory)' : 'no dedicated GPU found — the CPU will do the work'}`,
);

// ── pick something it can run ───────────────────────────────────────────────
// Ordered best-first within each tier; the first one that pulls wins, so a
// renamed or retired tag does not stop the setup.
const TIERS = [
  {
    min: 12,
    budget: 'vram',
    models: ['qwen3:8b', 'llama3.1:8b', 'mistral:7b'],
    note: 'a proper 8B model — he will hold the character well',
  },
  {
    min: 8,
    budget: 'vram',
    models: ['qwen3:4b', 'llama3.2:3b', 'gemma3:4b'],
    note: 'a 4B model — quick, and good enough to be rude convincingly',
  },
  {
    min: 32,
    budget: 'ram',
    models: ['qwen3:8b', 'llama3.1:8b'],
    note: 'an 8B model on the CPU — slow but capable',
  },
  {
    min: 16,
    budget: 'ram',
    models: ['qwen3:4b', 'llama3.2:3b'],
    note: 'a 4B model on the CPU — expect 10-25 seconds a reply',
  },
  {
    min: 8,
    budget: 'ram',
    models: ['qwen3:1.7b', 'llama3.2:1b'],
    note: 'a small model — he will be dim, but he will be alive',
  },
  {
    min: 0,
    budget: 'ram',
    models: ['llama3.2:1b', 'qwen3:0.6b'],
    note: 'the smallest thing that runs — expect him to be quite stupid',
  },
];
const usable = appleSilicon ? Math.round(totalGb * 0.6) : vramGb;
const tier =
  TIERS.find((entry) => (entry.budget === 'vram' ? usable >= entry.min : totalGb >= entry.min)) ??
  TIERS.at(-1);

say(`  plan      ${tier.note}\n`);

// ── is ollama there ─────────────────────────────────────────────────────────
async function ollamaTags() {
  const response = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  return (await response.json()).models ?? [];
}

let installed;
try {
  installed = await ollamaTags();
} catch {
  say('  Ollama is not running on this machine.\n');
  say('  1. Install it from https://ollama.com/download');
  say(
    `     ${os.platform() === 'win32' ? 'Run the Windows installer; it starts automatically.' : os.platform() === 'darwin' ? 'Open the app once after installing.' : 'curl -fsSL https://ollama.com/install.sh | sh'}`,
  );
  say('  2. Run this again: npm run local\n');
  process.exit(1);
}
say(
  `  Ollama is running, with ${installed.length} model${installed.length === 1 ? '' : 's'} already downloaded.\n`,
);

// ── get a model ─────────────────────────────────────────────────────────────
const have = new Set(installed.map((model) => model.name));
let chosen = tier.models.find((model) => have.has(model));

if (!chosen) {
  for (const candidate of tier.models) {
    say(`  pulling ${candidate} — this downloads a few GB, once.\n`);
    const pull = spawnSync('ollama', ['pull', candidate], { stdio: 'inherit' });
    if (pull.status === 0) {
      chosen = candidate;
      break;
    }
    say(`\n  ${candidate} did not pull. Trying the next option.\n`);
  }
}

if (!chosen) {
  say('  Could not download any model. Check that `ollama` works in this terminal,');
  say('  then pick one yourself from https://ollama.com/library and set VERITY_MODEL.\n');
  process.exit(1);
}

// ── write the env ───────────────────────────────────────────────────────────
const ENV = '.env';
const settings = {
  VERITY_PROVIDER: 'openai',
  VERITY_BASE_URL: `${OLLAMA}/v1`,
  VERITY_API_KEY: 'local',
  VERITY_MODEL: chosen,
};

let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
if (env) fs.writeFileSync(`${ENV}.bak`, env); // never clobber a token without a copy

for (const [key, value] of Object.entries(settings)) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\n*$/, '\n')}${line}\n`;
}
fs.writeFileSync(ENV, env);
say(`\n  .env updated (previous version saved as .env.bak):\n`);
for (const [key, value] of Object.entries(settings)) say(`    ${key}=${value}`);

// ── prove it ────────────────────────────────────────────────────────────────
say('\n  asking him something...\n');
for (const [key, value] of Object.entries(settings)) process.env[key] = value;

const { speak } = await import('./ai.js');
const started = Date.now();
try {
  const { text } = await speak({
    mood: 'friendly',
    channelName: 'general',
    messages: [{ role: 'user', content: '[setup]: verity are you there' }],
  });
  say(`  > ${text}\n`);
  say(`  ${((Date.now() - started) / 1000).toFixed(1)}s for that reply. Now run: npm start\n`);
} catch (error) {
  say(`  He could not answer: ${error.message}`);
  say('  Check that Ollama is still running, then try `npm start` anyway.\n');
  process.exitCode = 1;
}
