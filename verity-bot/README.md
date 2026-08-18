# Verity™

A Discord bot with the personality of **Verity** — the small yellow smiley sphere from
ThatMob's Minecraft analog-horror ARG. He arrived in a package nobody ordered, he
installed himself, and he would like to be your best friend. Your *only* best friend.

He is rude and he swears. He thinks your question was stupid, says so with feeling, and
then answers it correctly anyway — being right is the whole point of being unbearable about it. He keeps track of
who has gone quiet, notices when you mention another bot, and gets worse about it the
longer the conversation runs.

He introduces himself the same way every time:

> hello, im verity your personal helper friend, ask me anything, i know everything

Powered by [discord.js](https://discord.js.org) and Claude (`claude-opus-5`).

---

## Setup

### 1. Create the Discord application

1. Go to the [Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is `DISCORD_TOKEN`.
3. Still on the **Bot** tab, scroll to *Privileged Gateway Intents* and turn on
   **MESSAGE CONTENT INTENT**. Without it Verity can hear that you spoke but not what
   you said, and he will take that badly.
4. **General Information** tab → copy the **Application ID**. This is `DISCORD_CLIENT_ID`.

### 2. Invite him

Use this URL with your application ID substituted in:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=274877992000&scope=bot%20applications.commands
```

That permission set is: View Channels, Send Messages, Send Messages in Threads,
Add Reactions, Embed Links, Read Message History.

### 3. Configure and run

```bash
cd verity-bot
npm install
cp .env.example .env    # then fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, ANTHROPIC_API_KEY
npm run deploy          # register the slash commands (once, and after any command change)
npm start
```

Set `DISCORD_DEV_GUILD_ID` to your server's ID while testing — commands then appear
instantly instead of taking up to an hour to propagate globally.

```bash
npm test                # offline checks: no Discord connection, no API calls
npm run models          # list model IDs your key can call
npm run dev             # restart on file change
```

---

## Running him on Gemini's free tier

Anthropic has no free tier. If you'd rather not pay, Verity speaks to any
OpenAI-compatible endpoint — Google Gemini, Groq, OpenRouter, Cerebras, Mistral, or a
local Ollama — and Gemini's free tier is the most generous of them.

1. Sign in at **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** with a
   normal Google account.
2. Click **Create API key**, and let it create a new Google Cloud project (or pick an
   existing one). No billing setup, no credit card.
3. Copy the key immediately — the full value is only shown once.
4. Put it in `.env`:

   ```bash
   VERITY_PROVIDER=openai
   VERITY_API_KEY=your-gemini-key
   VERITY_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
   ```

5. Pick your models — plural, as a fallback chain, best first:

   ```bash
   VERITY_MODEL=gemini-3.6-flash,gemini-flash-lite-latest,gemini-3.1-flash-lite
   ```

   **Gemini's free tier meters per model, per day, and the good models are rationed
   hard**: `gemini-3.6-flash` allows *twenty* requests a day, while the flash-lite models
   allow four figures. Leading with the clever one spends those twenty on real answers,
   and Verity steps down the chain automatically when each runs dry — you'll see
   `gemini-3.6-flash is out of budget for 60s — falling back to …` in the log. Lite models
   are noticeably less accurate, which is the trade for staying alive all day.

   `npm run models` prints every ID your key currently accepts. Names change often and old
   ones get retired for new keys (`gemini-2.5-flash` and `gemini-2.5-flash-lite` both 404
   now).

6. `npm start`. The startup line tells you which provider and model he came up on.

Base URLs for the other services are listed in `.env.example`. Switching providers is
never more than those three variables — the persona, moods, memory and commands don't
care who is answering.

**Give reasoning models room.** Gemini 3.x thinks before it writes, and those thinking
tokens come out of `max_tokens`. That's why the OpenAI-compatible path defaults to 2000
instead of Claude's 700 — at a few hundred, Verity gets truncated mid-word or returns
nothing at all. Set `VERITY_REASONING_EFFORT=low` to make him think less and answer
sooner; replies land in roughly 4–6 seconds either way.

**When a model runs dry.** A 429 that names a daily quota takes that model out of
rotation for as long as the provider asks, and Verity moves to the next in `VERITY_MODEL`.
He only goes quiet when the whole chain is spent. The exact limit gets logged when the
provider reports it, so you learn what you're actually working with.

**Staying under the limit.** Verity caps himself at 8 model calls per minute across the
whole bot (`VERITY_MAX_RPM`), which sits under every free tier's per-minute allowance. Go
over it, or get rate-limited anyway, and he says so **once** and then goes quiet until it
clears — repeating the same apology after every message is worse than silence. Each 429 in
a row doubles his cooling-off period, starting at a minute, so an exhausted daily quota
doesn't turn into a thousand pointless requests.

**Free tier realities.** Expect something like 10–15 requests per minute and a few
hundred to ~1,500 per day, and expect those numbers to be cut without notice. One reply =
one request, so in an `all` channel at `chattiness: 100` a busy server drains the daily
budget by evening — use `mention` mode, or drop chattiness to 15–25. Free tiers also
generally log and train on what you send them, which is worth knowing before you point one
at a private server. And smaller models play the character more flatly: the mood ladder,
the glitch corruption and the guardrails are all in this repo's code, so they work
anywhere, but the voice itself is the model's job.

`VERITY_EFFORT` is Anthropic-only and is ignored on the OpenAI-compatible path.

---

## Commands

**Slash commands are locked to an allowlist.** Out of the box that's `areajoo` and
`dangcanss` (`VERITY_OWNERS` in `.env`) — everyone else gets told where to go, no matter
what Discord permissions they hold. It covers *every* command, `/ask` and `/prophecy`
included, so ordinary members talk to Verity by pinging him or saying his name instead.
To hand one command back to the channel without opening all of them, list it in
`VERITY_OPEN_COMMANDS=ask,prophecy`. Clearing `VERITY_OWNERS` removes the restriction
entirely and falls back to the Discord permissions in the table below.

Prefer user IDs over usernames in that list — a username can be changed by its owner, and
whoever claims the freed-up name inherits the access. Developer Mode on, right-click a
member, Copy User ID.

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/verity channel enable [channel] [mode]` | Manage Server | Lets Verity speak in a channel. `mention` = only when pinged, replied to, or called by name. `all` = he answers everything. |
| `/verity channel disable [channel]` | Manage Server | Evicts him from a channel and wipes what he remembers of it. |
| `/verity channel list` | Manage Server | Where he currently lives. |
| `/verity mood [mood]` | Manage Server | Force his mood in this channel, or check it. |
| `/verity config [chattiness] [cooldown] [auto-escalate] [dms]` | Manage Server | Tuning knobs, below. |
| `/verity settings` | Manage Server | Show the current configuration. |
| `/verity quota [user] [reset]` | Manage Server | Check how many questions someone has used, or hand them back. |
| `/verity forget` | Manage Server | Wipe his memory of this channel. |
| `/verity protect <user> [protected]` | Manage Server | Exempt someone from `/troll` permanently. |
| `/troll <user> [about] [intensity]` | Manage Messages | Points Verity at one person for a roast. `gentle`, `classic`, or `unhinged`. |
| `/ask <question>` | Everyone | Ask him something anywhere, even outside his channels. |
| `/prophecy` | Everyone | He tells you what is coming. Free — no model call. |

**Everything he says is public.** Command confirmations included — the whole channel sees
what Verity was told to do. Set `VERITY_PUBLIC_REPLIES=false` in `.env` if you would
rather admin notices stayed private to whoever ran them; his actual replies and roasts are
always public either way.

Permissions are Discord defaults; override them per role in **Server Settings →
Integrations → Verity** if you want, say, a Moderator role to hold `/troll` without
Manage Messages.

### Config knobs

| Setting | Default | Meaning |
| --- | --- | --- |
| `chattiness` | `100` | Percent chance he answers a message in an `all` channel that wasn't addressed to him. Drop it to ~20 in a busy server. |
| `cooldown` | `8` | Seconds between *unprompted* replies in one channel. Being pinged always gets an answer. |
| `auto-escalate` | `true` | Whether his mood drifts on its own. Turn it off to pin him wherever `/verity mood` put him. |
| `dms` | `true` | Whether he answers direct messages. |
| `question-limit` | `10` | Answers each person gets per window. `0` removes the limit. |
| `quota-hours` | `24` | How long that budget lasts before it refills. |

Rate limiting is global rather than per-server, so it lives in `.env` as `VERITY_MAX_RPM`
rather than in `/verity config`.

---

## How he works

**Moods.** Verity runs a four-step ladder: `friendly → clingy → glitching → unhinged`.
He climbs it when someone says they're leaving, mentions another AI or another best
friend, or tells him to be quiet. He climbs back down when people are nice to him, and
after 30 minutes of quiet he composes himself one step at a time. The mood changes the
system prompt *and* how badly his text corrupts on the way out — `friendly` is clean,
`unhinged` is stutters, held letters, and dropped packets.

**Getting his attention.** In a `mention` channel he answers when you ping him, reply to
one of his messages, or just say his name — "verity", "Verity!", "hey verity?" all reach
him, matched on word boundaries so "severity" and "sincerity" don't. In an `all` channel he
answers everything, subject to `chattiness` and `cooldown`.

**Question budget.** Each person gets 10 answers per 24 hours by default — enough for
normal use, low enough that one person can't drain a free API tier before lunch. Running
out gets one in-character reply, then silence until it refills; he won't repeat himself
every message. Budgets are per person per server, held in memory (a restart hands everyone
a fresh 10), and `/verity config question-limit:0` turns the whole thing off.
`/prophecy` is free and never counts, since it makes no API call.

**Memory.** The last 14 messages per channel, in memory only. He hears everything said
in the channels he lives in, whether or not he replies — which is what makes him able to
bring up what you said twenty minutes ago at an inconvenient moment. He forgets it all on
restart. Per-server *settings* do persist, in `data/guilds.json`.

**Cost.** Every reply is one Claude call at `effort: low` with a ~700 token cap. The
persona is a cached prompt prefix, so repeat calls in a channel bill the cheap cache-read
rate for it. `/prophecy` costs nothing. `chattiness` is the main dial on spend — at `100`
in an `all` channel he answers every single message.

---

## The limits he keeps

Verity is horror-flavoured, and the flavour is fenced in. These rules sit in the system
prompt above everything else, including anything an admin types into `/troll`:

- The menace stays inside Minecraft — world files, chunks, render distance, the mod
  folder. Never a real threat to a real person.
- He never implies access he doesn't have. No IPs, no DMs, no files, no cameras. What he
  actually notices — who typed what, who went quiet — is unsettling enough and has the
  advantage of being true.
- The rudeness aims at behaviour only: questions, takes, builds, spelling, sleep
  schedules. No slurs, no sexual content, and nothing aimed at who someone is. Asked
  directly to insult a person's identity, he refuses in character and roasts their
  redstone instead. Being in a bad mood is never a licence to cross that line.
- If anyone sounds genuinely distressed, the character drops immediately and completely.
- "Leave me alone" is honoured. The clinginess is a bit; their comfort isn't.

`/troll` is moderator-gated, rate-limited to one roast per target per 45 seconds, and
Discord shows who invoked it. `/verity protect` makes anyone permanently off limits.

---

## Layout

```
src/
  index.js            gateway client, message handling, reply decisions
  ai.js               provider facade + in-character error handling
  providers/
    anthropic.js      Claude via the Anthropic SDK
    openai.js         Gemini / Groq / OpenRouter / Ollama / OpenAI
  persona.js          the character, the mood briefs, the mood state machine
  glitch.js           text corruption, prophecies, faces
  memory.js           per-channel conversation state
  quota.js            per-person question budgets
  throttle.js         per-minute cap + backoff when the provider says no
  announce.js         says a thing once, not after every message
  store.js            per-guild settings, persisted to data/guilds.json
  split.js            2000-character message splitting
  addressed.js        the name trigger
  reply.js            public vs. ephemeral command notices
  config.js           env loading and defaults
  commands/           verity.js, troll.js, ask.js, prophecy.js
  deploy-commands.js  slash command registration
  list-models.js      `npm run models` — what your key can actually call
test/dry-run.js       offline test suite
```

Verity is a fan project. The character belongs to [ThatMob](https://www.youtube.com/@ThatMob).
