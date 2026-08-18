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
import { isOwner } from './owners.js';
import { notice } from './reply.js';
import { inCharacterError, REFUSAL_LINE, speak } from './ai.js';

if (!process.env.ANTHROPIC_API_KEY) {
  // The SDK can also pick up an `ant auth login` profile, so this is a
  // warning rather than a hard stop.
  console.warn(
    '[verity] ANTHROPIC_API_KEY is not set — Verity will only be able to speak if the SDK finds credentials elsewhere.',
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — enable it in the Developer Portal
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message], // needed to see DMs
});

/** Channels with a reply already in flight, so we never stack API calls. */
const busy = new Set();

/** People already told they are out of questions, so he only says it once. */
const warnedOfQuota = new Set();

client.once(Events.ClientReady, (ready) => {
  console.log(`[verity] the package has been opened. logged in as ${ready.user.tag}`);
  ready.user.setPresence({
    status: 'online',
    activities: [{ name: 'you, mostly', type: ActivityType.Watching }],
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
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
  if (!addressed && !shouldButtIn(mode, settings, session)) return;
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
