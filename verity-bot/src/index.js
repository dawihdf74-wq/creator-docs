import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import * as store from './store.js';
import * as memory from './memory.js';
import * as quota from './quota.js';
import * as throttle from './throttle.js';
import { shouldSay } from './announce.js';
import { nextMood } from './persona.js';
import { glitch } from './glitch.js';
import { splitMessage } from './split.js';
import { byName } from './commands/index.js';
import { mentionsName } from './addressed.js';
import { looksLikeQuestion } from './question.js';
import { match as matchAnswer, fill } from './faq.js';
import { startConsole } from './console.js';
import { parse as parseMusic, handle as handleMusic, isDj, playTrigger } from './music/commands.js';
import { buildPlaylistView, parseId } from './music/view.js';
import * as musicPlayer from './music/player.js';
import { leave as leaveVoice } from './music/player.js';
import { isOwner } from './owners.js';
import { notice } from './reply.js';
import { inCharacterError, REFUSAL_LINE, speak } from './ai.js';

if (config.provider === 'openai' && !config.apiKey) {
  console.error(
    '[verity] VERITY_PROVIDER=openai but no API key is set. Put your key in VERITY_API_KEY.',
  );
  process.exit(1);
}
if (config.provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
  // The SDK can also pick up an `ant auth login` profile, so this one is a
  // warning rather than a hard stop.
  console.warn(
    '[verity] ANTHROPIC_API_KEY is not set — Verity can only speak if the SDK finds credentials elsewhere.',
  );
}

console.log(
  `[verity] provider: ${config.provider}${config.isLocal ? ' (local)' : ''} · models: ${config.models.join(' → ')}`,
);
console.log(
  config.owners.length
    ? `[verity] slash commands restricted to: ${config.owners.join(', ')}`
    : '[verity] slash commands are open to everyone (VERITY_OWNERS is empty)',
);

/**
 * Credentials are checked once at boot. Without this a bad key looks like a
 * healthy bot that fails every single message, which is a miserable way to
 * find out.
 */
try {
  const { listModels } = await import(
    config.provider === 'openai' ? './providers/openai.js' : './providers/anthropic.js'
  );
  const known = new Set((await listModels()).map((entry) => entry.id.replace(/^models\//, '')));
  console.log('[verity] model credentials look good.');

  const missing = config.models.filter((model) => !known.has(model));
  if (missing.length) {
    console.warn(`[verity] these models are not in your provider's list: ${missing.join(', ')}`);
    console.warn('[verity] Run `npm run models` to see what your key can actually call.');
  }
} catch (error) {
  if (error?.status === 401 || error?.status === 403) {
    console.error(
      `[verity] the model API rejected your key (${error.status}). Verity cannot speak.`,
    );
    console.error('[verity] Check VERITY_API_KEY / ANTHROPIC_API_KEY in .env.');
    process.exit(1);
  }
  console.warn('[verity] could not verify model credentials:', error?.message ?? error);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — enable it in the Developer Portal
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates, // needed to see which voice channel you are in
  ],
  partials: [Partials.Channel, Partials.Message], // needed to see DMs
});

/** Channels with a reply already in flight, so we never stack API calls. */
const busy = new Set();

/** People already told they are out of questions, so he only says it once. */
const warnedOfQuota = new Set();

client.once(Events.ClientReady, (ready) => {
  console.log(`[verity] the package has been opened. logged in as ${ready.user.tag}`);
  startConsole(client);
  ready.user.setPresence({
    status: 'online',
    activities: [{ name: 'you, mostly', type: ActivityType.Watching }],
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  // The playlist panel: a dropdown of songs, and the controls beside it.
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const press = parseId(interaction.customId);
    if (!press) return;

    if (!isDj(interaction.member, interaction.guildId)) {
      return interaction
        .reply({
          content: 'no. that list is not yours to rearrange. :|',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    const who = interaction.member?.displayName ?? interaction.user.username;
    let note;

    if (press.action === 'pick') {
      // The option carries the track's own id, so this is the song they read,
      // wherever it has drifted to in the queue since the list was drawn.
      const moved = musicPlayer.moveToFrontById(interaction.guildId, interaction.values?.[0]);
      note = moved ? `${moved.title} is next — ${who} picked it` : 'that one is already gone';
    }

    if (press.action === 'skip') {
      const skipped = musicPlayer.skip(interaction.guildId);
      note = skipped ? `${who} skipped ${skipped.title}` : 'nothing to skip';
    }

    // Redraw in place: the list has usually changed under the press.
    const { embeds, components } = buildPlaylistView(interaction.guildId, press.value || 1, {
      note,
    });
    return interaction.update({ embeds, components }).catch(() => {});
  }

  if (!interaction.isChatInputCommand()) return;

  const command = byName.get(interaction.commandName);
  if (!command) return;

  // The allowlist sits above Discord's own permission gating: even a server
  // owner does not get the commands unless they are on it.
  const openToAll = config.openCommands.includes(interaction.commandName);
  if (!openToAll && !isOwner(interaction.user, config.owners)) {
    console.log(
      `[verity] refused /${interaction.commandName} for @${interaction.user.username} (id ${interaction.user.id}) — not in VERITY_OWNERS`,
    );
    return interaction
      .reply(notice('no. the commands are not for you. go and be useless somewhere else :|'))
      .catch(() => {});
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[verity] /${interaction.commandName} failed:`, error);
    const payload = notice('something went wrong inside me. do not worry about it. :|');
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: payload.content }).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.system) return;
  if (!message.content?.trim()) return;

  // Music commands work anywhere he can see, not just his channels, and
  // never touch the model or anyone's question budget.
  const musicCommand = message.guildId && parseMusic(message.content);
  if (musicCommand) {
    try {
      const reply = await handleMusic(musicCommand, message);
      // A command may answer with a line, or with a whole embed to click on.
      if (reply) {
        await message.reply(
          typeof reply === 'string'
            ? { content: reply, allowedMentions: { repliedUser: false } }
            : { ...reply, allowedMentions: { repliedUser: false } },
        );
      }
    } catch (error) {
      console.error('[verity] music:', error);
      await message
        .reply({ content: error.message, allowedMentions: { repliedUser: false } })
        .catch(() => {});
    }
    return;
  }

  const isDm = !message.guildId;
  const settings = isDm ? config.defaults : store.getSettings(message.guildId);

  let mode = 'all';
  if (!isDm) {
    const channel = store.getChannel(message.guildId, message.channelId);
    if (!channel) return; // Verity was not invited into this channel.
    mode = channel.mode;
  } else if (!settings.replyInDms) {
    return;
  }

  const session = memory.getSession(message.channelId, settings.mood);
  const label = message.member?.displayName ?? message.author.username;

  // He hears everything in the channels he lives in, whether or not he answers.
  memory.remember(message.channelId, 'user', `[${label}]: ${message.content}`);

  if (settings.autoEscalate) {
    const { mood, reason } = nextMood(session.mood, message.content);
    if (reason) {
      session.mood = mood;
      console.log(`[verity] #${message.channel.name ?? 'dm'} mood -> ${mood} (${reason})`);
    }
  }

  const addressed = isDm || (await isAddressed(message));

  // Questions-only: he answers what he is asked and stays out of everything
  // else. Worth having when every reply costs a request or a lot of laptop.
  if (settings.questionsOnly && !looksLikeQuestion(message.content)) return;

  if (!addressed && !shouldButtIn(mode, settings, session)) return;
  // Phrases that put a song on. Checked before the canned answers, since a
  // phrase is a deliberate thing someone set up.
  const trigger = message.guildId
    ? matchAnswer(
        store
          .listTriggers(message.guildId)
          .map((entry) => ({ ...entry, triggers: [entry.phrase] })),
        message.content,
      )
    : null;

  if (trigger && shouldSay(message.channelId, `trigger:${trigger.phrase}`, 30_000)) {
    try {
      const reply = await playTrigger(trigger, message);
      if (reply) await message.reply({ ...reply, allowedMentions: { repliedUser: false } });
    } catch (error) {
      console.error('[verity] trigger:', error.message);
    }
    return;
  }

  // A canned answer costs nothing and arrives instantly, so it is checked
  // before the throttle, the quota and the model.
  const canned = matchAnswer(store.listAnswers(message.guildId ?? 'dm'), message.content);
  if (canned) {
    store.countAnswerHit(canned);
    const answer = fill(canned.answer, label);
    memory.remember(message.channelId, 'assistant', answer);
    memory.markReplied(message.channelId);
    await message
      .reply({ content: glitch(answer, session.mood), allowedMentions: { repliedUser: false } })
      .catch(() => {});
    return;
  }

  if (busy.has(message.channelId)) return;

  // Over the rate limit, or cooling off after the provider said no: say so
  // once, then stay quiet. Repeating the same apology after every message is
  // what made this unbearable in the first place.
  if (!throttle.take()) {
    if (shouldSay(message.channelId, 'throttled')) {
      await message
        .reply({
          content: `too many of you at once. give me ${throttle.waitSeconds()} seconds. do not go anywhere :|`,
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
    }
    return;
  }

  const windowMs = settings.quotaHours * 60 * 60 * 1000;
  const budget = quota.check(message.guildId, message.author.id, settings.questionLimit, windowMs);
  if (!budget.allowed) {
    // Say so once, then let them be — repeating it every message is worse
    // than silence.
    if (!warnedOfQuota.has(message.author.id)) {
      warnedOfQuota.add(message.author.id);
      setTimeout(() => warnedOfQuota.delete(message.author.id), 10 * 60 * 1000).unref();
      await message
        .reply({
          content: `that is all ${settings.questionLimit} of your questions, friend. i have to save some of myself for the others. you get more ${quota.resetTimestamp(budget.resetsAt)} :|`,
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
    }
    return;
  }

  busy.add(message.channelId);
  try {
    await message.channel.sendTyping();

    const { text, refused } = await speak({
      mood: session.mood,
      guildName: message.guild?.name,
      channelName: message.channel?.name,
      messages: session.messages,
    });

    const reply = refused || !text ? REFUSAL_LINE : glitch(text, session.mood);
    memory.remember(message.channelId, 'assistant', refused ? REFUSAL_LINE : text);
    memory.markReplied(message.channelId);
    quota.spend(message.guildId, message.author.id, settings.questionLimit, windowMs);

    const chunks = splitMessage(reply);
    // Reply to the person who spoke to him; drift into the channel otherwise.
    await (addressed && !isDm
      ? message.reply({ content: chunks[0], allowedMentions: { repliedUser: false } })
      : message.channel.send(chunks[0]));
    for (const chunk of chunks.slice(1)) await message.channel.send(chunk);
  } catch (error) {
    // One complaint per channel per five minutes, whatever went wrong.
    if (shouldSay(message.channelId, `error:${error?.status ?? 'unknown'}`)) {
      await message.channel.send(inCharacterError(error)).catch(() => {});
    } else {
      console.error('[verity] suppressed repeat error:', error?.message ?? error);
    }
  } finally {
    busy.delete(message.channelId);
  }
});

/** Pinged, replied to, or called by name. */
async function isAddressed(message) {
  if (message.mentions.has(client.user)) return true;
  if (mentionsName(message.content)) return true;

  const referenceId = message.reference?.messageId;
  if (!referenceId) return false;
  try {
    const referenced =
      message.channel.messages.cache.get(referenceId) ??
      (await message.channel.messages.fetch(referenceId));
    return referenced?.author?.id === client.user.id;
  } catch {
    return false;
  }
}

/** Unprompted interjections: only in "all" channels, rate-limited and rolled. */
function shouldButtIn(mode, settings, session) {
  if (mode !== 'all') return false;
  if (Date.now() - session.lastReply < settings.cooldown * 1000) return false;
  return Math.random() * 100 < settings.chattiness;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[verity] he does not want you to go.');
    for (const [guildId] of client.guilds.cache) leaveVoice(guildId);
    store.shutdown();
    client.destroy();
    process.exit(0);
  });
}

// A long-running bot should never die from one stray rejection.
process.on('unhandledRejection', (error) => {
  console.error('[verity] unhandled rejection:', error);
});

client.login(config.token).catch((error) => {
  console.error('[verity] could not log in:', error.message);
  console.error(
    '[verity] Check DISCORD_TOKEN in .env, and that MESSAGE CONTENT INTENT is enabled in the Developer Portal.',
  );
  process.exit(1);
});
