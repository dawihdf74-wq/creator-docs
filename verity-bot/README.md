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
https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=274881137728&scope=bot%20applications.commands
```

That permission set is: View Channels, Send Messages, Send Messages in Threads,
Add Reactions, Embed Links, Read Message History, Connect, Speak.

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

## Running him on your own machine (no keys, no quotas)

```bash
npm run local
```

That looks at what your computer has, picks a model it can actually run, downloads it
through [Ollama](https://ollama.com/download), writes the `.env` lines, and makes Verity
say something to prove it worked. Install Ollama first — the command tells you where to
get it if it isn't there.

Nothing is metered after that: no API key, no daily cap, no rate limit, and nothing you
type leaves your computer. The costs are the honest ones — **the machine has to be awake
for Verity to be alive**, replies take longer (a few seconds on a gaming GPU, 10–25 on a
laptop CPU), and a model small enough to run at home is meaningfully dumber than Gemini
about Minecraft. The personality survives that much better than the facts do.

Model choice by machine, which `npm run local` picks for you:

| What you have | What it runs | Feel |
| --- | --- | --- |
| 12 GB+ VRAM | `qwen3:8b` | Fast, holds the character properly |
| 8 GB+ VRAM, or Apple Silicon | `qwen3:4b` | Quick, convincingly rude |
| 16 GB RAM, no GPU | `qwen3:4b` on the CPU | 10–25s a reply |
| 8 GB RAM | `qwen3:1.7b` | Dim, but alive |

If a tag has been renamed it tries the next one down the list rather than giving up.
`VERITY_MODEL` accepts any tag from [ollama.com/library](https://ollama.com/library).

**Answer questions only.** Especially useful locally, where every reply costs real
seconds: `/verity config questions-only:true` makes him reply only to messages that are
actually asking something — a question mark, or an opener like *how / why / can / does*.
Everything else he ignores completely.

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

## Music

Join a voice channel and type:

```
veritysong https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
veritysong https://cdn.example.com/song.mp3
veritysong http://ice1.somafm.com:80/groovesalad-128-mp3
```

| Command | |
| --- | --- |
| `veritysong <link or search>` | Play it. Something already on? It goes in the queue |
| `verityskip` · `veritystop` | Skip one · stop and clear the queue |
| `veritypause` · `verityresume` | Hold it · carry on |
| `verityqueue` · `veritynp` | What's waiting · what's on, and how far in |
| `verityshuffle` · `verityclear` · `verityremove <n>` | Reorder the queue |
| `verityloop track\|queue\|off` | Repeat one, repeat everything, or stop |
| `verityspeed 2` | Double speed. Anything from 0.25 to 4 |
| `verityvolume 50` | Percent, 0 to 200 |
| `verityjoin` · `verityleave` | Come in · get out |

Short forms work where they're obvious: `verityp`, `veritys`, `verityq`, `verityvol`,
`veritydc`.

**Playlists.** A Spotify playlist or album link queues every track on it (up to 50), and
so does a YouTube link carrying `list=`. Spotify playlists need the API credentials below —
the no-credentials fallback can only read single tracks.

**Who's allowed.** By default anyone can queue music. `/verity dj add role:@DJ` starts
restricting it: once anything is on the list, only those people and roles can use the
music commands. `/verity dj list` shows it, `/verity dj clear` opens it back up.

Those are **Discord** commands — type them in a channel, with yourself in a voice channel.
He joins whatever voice channel you are in, announces each track in the channel you typed
in, and leaves on his own after five minutes of nothing.

Speed and volume are applied by re-encoding the source, since Opus can't be stretched
after the fact. A file or radio stream picks up where it was; anything piped through the
resolver starts the track again, and he says so rather than quietly losing your place. The terminal console has the same
controls, where you name the voice channel yourself: `join #voice-chat` then `play <link>`. FFmpeg ships with the bot,
so nothing extra is needed for the sources below.

### About Spotify links

**Spotify does not serve full-track audio to anything but its own apps.** No Discord bot
plays audio from Spotify — not Jockie, not any of them. What they actually do, and what
this does, is read the track's name and artist off the link and then play *that song* from
somewhere else.

So a Spotify link needs two things: something to read the title (built in — better with
free API credentials in `VERITY_SPOTIFY_ID` / `VERITY_SPOTIFY_SECRET`) and something to
fetch audio.

### Setting it up on Windows

Settings live in the **`.env` file**, not in the terminal. Typing `VERITY_YTDLP=true` at a
PowerShell prompt sets nothing — PowerShell doesn't use that syntax, and the bot reads
`.env` anyway. Open `.env` in Notepad, add the line, save, restart him.

To install the resolver:

```powershell
winget install yt-dlp
```

Then `VERITY_YTDLP=true` in `.env`. If `yt-dlp` isn't on your PATH afterwards, put the
full path in instead: `VERITY_YTDLP=C:\Users\you\yt-dlp.exe`.

### Where audio comes from

Working out of the box, with nothing to install:

- **Direct audio files** — any `.mp3`, `.m4a`, `.ogg`, `.opus`, `.wav`, `.flac` URL
- **Radio streams** — Icecast/Shoutcast, `.m3u`, `.pls`
- **Local files** — a path on the machine running him

For YouTube links, Spotify links and plain searches, he needs a resolver:
`VERITY_YTDLP=true` if [yt-dlp](https://github.com/yt-dlp/yt-dlp) is on your PATH, or the
full path to it. Off by default, so nothing happens unless you turn it on.

That last part is the piece that makes it behave like Jockie, and it's worth knowing what
you're switching on: yt-dlp is a general-purpose downloader, but pointing it at YouTube
runs against YouTube's terms of service — that is exactly what got Rythm and Groovy shut
down, and it's why this ships off rather than on. Your server, your call.

---

## Controlling him from the terminal

The window running `npm start` is a control console. Type `help` for the list.

**Pick a channel and just type** — everything you write goes out as Verity:

```
verity> use #general
  anything you type now goes to #general as Verity. "use none" to stop.
verity #general> get back in the mine
  → #general
verity #general> use none
  back to commands only.
```

The prompt shows where your typing is going. For a single message without selecting
anything, `#general hello` works on its own — no verb needed.

```
verity> status
  provider   openai (local) · qwen3:4b
  server     Test SMP · 2 channel(s)
  throttled  no
  answers    6 canned

verity> mood #general unhinged
verity> ask what is the point of you
  > to be better than you at everything, obviously :D
verity> faq add server ip, whats the ip = play.example.com, {user}
verity> quit
```

Channel names match loosely, so `#general` finds `💬︱general-chat`, and a leading `/` is
fine if that is how your fingers work.

| Command | What it does |
| --- | --- |
| `status` | Provider, model chain, channels, whether he's throttled |
| `channels` | Where he's installed, and each channel's mood |
| `use #channel` | Speak as Verity in that channel — then just type. `use none` stops |
| `#channel <text>` | Post one message without selecting anything |
| `say <#channel> <text>` | The same, spelled out |
| `ask <text>` | Ask him something in the terminal, without touching Discord |
| `mood [<#channel>] <mood>` | Set the mood, everywhere or in one channel |
| `wipe [<#channel>]` | Make him forget a conversation |
| `faq …` | Manage canned answers, below |
| `join #voice-channel` | Get into a voice channel |
| `play <link or search>` | Play it there — `veritysong <link>` works here too |
| `skip` · `stop` · `pause` · `resume` | Playback |
| `queue` · `shuffle` · `clear` · `remove <n>` | The queue |
| `speed 2` · `volume 50` · `loop track` | Same controls as in Discord |
| `leave` | Get out of the voice channel |
| `quota [reset]` | Question budgets |
| `models` | The fallback chain and what's spent |
| `quit` | Shut him down |

None of it goes through Discord, so it works regardless of the slash-command allowlist
or whether Discord has caught up with a command change. When Verity runs as a background
service with no terminal attached, the console quietly does not start.

---

## Canned answers

Questions your server asks constantly don't need a model. A canned answer arrives
instantly, costs nothing, and never counts against anyone's quota — which matters most on
a laptop model, where the alternative is fifteen seconds of your CPU improvising over
"what's the ip" for the fortieth time.

From the console:

```
verity> faq add server ip, whats the ip = play.example.com, {user}
verity> faq test yo whats the ip for the server again
  → play.example.com, {user}
verity> faq                 # list them, with hit counts
verity> faq remove 0
```

Or in Discord: `/verity faq add`, `/verity faq list`, `/verity faq remove`.

Triggers match loosely — every meaningful word has to appear somewhere in the message, in
any order — so `server ip` catches "yo whats the ip for the server again". The most
specific trigger wins, so a `bedrock ip` entry beats a plain `ip` one. `{user}` becomes
whoever asked.

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
| `/verity say <message> [channel]` | Manage Server | Put words in his mouth. The confirmation is private, so the trick stays hidden. |
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
| `questions-only` | `false` | Only reply to messages that are actually asking him something. |
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
  models.js           the fallback chain and per-model budgets
  question.js         is this message actually asking him something
  console.js          the terminal control console
  faq.js              canned answers and their loose matching
  music/
    commands.js       veritysong and friends
    player.js         per-server queue and the voice connection
    resolve.js        what did you hand him, and how to get audio from it
  setup-local.js      `npm run local` — set him up on a model on this machine
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
