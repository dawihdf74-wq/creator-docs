import readline from 'node:readline';
import { config } from './config.js';
import * as store from './store.js';
import * as memory from './memory.js';
import * as quota from './quota.js';
import * as throttle from './throttle.js';
import * as modelChain from './models.js';
import { MOODS } from './persona.js';
import { speak, inCharacterError } from './ai.js';
import { splitMessage } from './split.js';
import { match as matchAnswer } from './faq.js';
import * as musicPlayer from './music/player.js';
import { trackFor } from './music/commands.js';

/**
 * A control console in the terminal Verity is running in.
 *
 * Everything the slash commands do, without Discord in the way: handy when
 * commands are locked to two people, when Discord has not caught up with a
 * command change, or when you just want to see what he is doing.
 */

const HELP = `
  Pick a channel and then just type — everything you type goes out as Verity.

  use #general                 speak as Verity in #general from now on
  use none                     stop, back to plain commands
  #general hello everyone      post one message without selecting anything
  say #general hello           the same thing, spelled out
  ask why are you like this    ask him something here, no Discord involved

  status                       what he is doing right now
  channels                     where he is installed
  mood unhinged                ${MOODS.join(' | ')}
  mood #general clingy         just that channel
  wipe #general                make him forget that conversation

  join #voice-channel          get into a voice channel
  play <link or search>        play it there (veritysong works too)
  skip · stop · queue · leave  the rest of the music controls

  faq                          list the canned answers
  faq add server ip, whats the ip = play.example.com
  faq test whats the server ip
  faq remove 0

  quota                        who has spent their questions
  models                       the fallback chain and what is spent
  quit                         shut him down
`;

/**
 * The command dispatcher, separated from the terminal plumbing so it can be
 * driven directly in tests.
 *
 * @param {object} client a Discord client, or anything shaped like one
 * @param {(line?: string) => void} out where output goes
 */
export function createConsole(client, out = (line = '') => console.log(line), onQuit = () => {}) {
  /** The channel currently being spoken into, if any. */
  const state = { channel: null, voice: null };
  /** The guild to act on: the only one he is in, unless there are several. */
  const guildId = () => client.guilds.cache.first()?.id ?? 'dm';

  /**
   * Accepts <#id>, a raw id, "#general", or "general" — and matches loosely,
   * because a channel called "💬︱general" should still answer to "general".
   */
  const plain = (text) =>
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  function findChannel(token) {
    if (!token) return null;

    const id = token.replace(/[<#>]/g, '');
    const byId = client.channels.cache.get(id);
    if (byId) return byId;

    const wanted = plain(token);
    if (!wanted) return null;

    const channels = [...client.channels.cache.values()].filter((channel) => channel.name);
    return (
      channels.find((channel) => plain(channel.name) === wanted) ??
      channels.find((channel) => plain(channel.name).includes(wanted)) ??
      null
    );
  }

  const musicGuildId = () => state.voice?.guild?.id ?? guildId();

  /** Playback news goes to whoever is watching the terminal. */
  const musicEvents = (event) => {
    if (event.type === 'playing') out(`  ♪ now playing ${event.track.title}`);
    if (event.type === 'error') out(`  ♪ that one broke: ${event.message}`);
  };

  const voiceList = () =>
    [...client.channels.cache.values()]
      .filter((channel) => channel.isVoiceBased?.())
      .map((channel) => `#${channel.name}`)
      .join(', ') || 'none he can see';

  /** Names the channels he can actually see, for when a guess misses. */
  const channelList = () =>
    [...client.channels.cache.values()]
      .filter((channel) => channel.name)
      .map((channel) => `#${channel.name}`)
      .join(', ') || 'none he can see';

  async function dispatch(line) {
    // People copy the help text literally, brackets and all. Take it anyway.
    const cleaned = line.trim().replace(/^<(.+)>$/, '$1');
    const [rawCommand, ...rest] = cleaned.split(/\s+/);
    // "/help" and "help" are the same thing here.
    const command = rawCommand
      .replace(/^\//, '')
      // The Discord commands are muscle memory by now; accept them here too.
      .replace(/^verity(?=(song|play|skip|next|stop|queue|q|np|nowplaying|join|leave|dc)$)/i, '')
      .toLowerCase();
    const args = rest.join(' ').replace(/^<(.+)>$/, '$1');

    switch (command) {
      case '':
        return;

      case 'help':
        return out(HELP);

      case 'status': {
        const guild = client.guilds.cache.first();
        out(`  provider   ${config.provider}${config.isLocal ? ' (local)' : ''}`);
        out(`  models     ${modelChain.available().join(' → ') || 'all spent'}`);
        out(
          `  server     ${guild?.name ?? 'none'} · ${store.listChannels(guildId()).length} channel(s)`,
        );
        out(`  uptime     ${Math.round(process.uptime() / 60)} min`);
        out(`  throttled  ${throttle.isCooling() ? `yes, ${throttle.waitSeconds()}s left` : 'no'}`);
        out(`  answers    ${store.listAnswers(guildId()).length} canned`);
        return;
      }

      case 'use':
      case 'select':
      case 'speak': {
        const target = rest[0];
        if (!target) {
          return out(
            state.channel
              ? `  speaking as Verity in #${state.channel.name}. "use none" to stop.`
              : '  no channel selected. try: use #general',
          );
        }
        if (['none', 'off', 'stop', 'clear'].includes(target.toLowerCase())) {
          state.channel = null;
          return out('  back to commands only.');
        }
        const channel = findChannel(target);
        if (!channel) {
          out(`  no channel matching "${target}".`);
          return out(`  he can see: ${channelList()}`);
        }
        state.channel = channel;
        return out(
          `  anything you type now goes to #${channel.name} as Verity. "use none" to stop.`,
        );
      }

      case 'join': {
        const channel = findChannel(rest[0]);
        if (!channel?.isVoiceBased?.()) {
          out(`  "${rest[0] ?? ''}" is not a voice channel.`);
          return out(`  voice channels: ${voiceList()}`);
        }
        await musicPlayer.join(channel, musicEvents);
        state.voice = channel;
        return out(`  he is in ${channel.name}. "play <link>" to put something on.`);
      }

      case 'play':
      case 'song': {
        if (!state.voice) return out('  he is not in a voice channel. try: join #general');
        if (!args) return out('  play what? give me a link or something to search for.');
        const track = await trackFor(args, 'the console');
        await musicPlayer.join(state.voice, musicEvents);
        const { position } = musicPlayer.enqueue(state.voice.guild.id, track);
        return out(
          position === 0 ? `  playing ${track.title}` : `  queued ${track.title} at ${position}`,
        );
      }

      case 'skip':
      case 'next': {
        const skipped = musicPlayer.skip(musicGuildId());
        return out(skipped ? `  skipped ${skipped.title}` : '  nothing playing');
      }

      case 'stop': {
        const dropped = musicPlayer.stop(musicGuildId());
        return out(`  stopped${dropped ? `, dropped ${dropped} queued` : ''}`);
      }

      case 'queue':
      case 'q':
      case 'np':
      case 'nowplaying': {
        const current = musicPlayer.nowPlaying(musicGuildId());
        const rest2 = musicPlayer.queued(musicGuildId());
        if (!current && !rest2.length) return out('  nothing playing');
        out(`  now: ${current?.title ?? 'nothing'}`);
        rest2.forEach((track, index) => out(`  ${index + 1}. ${track.title}`));
        return;
      }

      case 'leave':
      case 'dc': {
        const left = musicPlayer.leave(musicGuildId());
        state.voice = null;
        return out(left ? '  out.' : '  he is not in a voice channel.');
      }

      case 'channels': {
        const channels = store.listChannels(guildId());
        if (!channels.length) return out('  nowhere yet — use /verity channel enable in Discord');
        for (const [id, entry] of channels) {
          const name = client.channels.cache.get(id)?.name ?? id;
          out(`  #${name} — ${entry.mode} — mood: ${memory.getSession(id).mood}`);
        }
        return;
      }

      case 'say': {
        const [target, ...words] = rest;
        const channel = findChannel(target);
        if (!channel) {
          out(`  no channel matching "${target ?? ''}".`);
          return out(`  he can see: ${channelList()}`);
        }
        const text = words.join(' ').replace(/^<(.+)>$/, '$1');
        if (!text) return out(`  say what? try: say #${channel.name} hello`);
        for (const chunk of splitMessage(text)) await channel.send(chunk);
        return out(`  sent to #${channel.name}`);
      }

      case 'ask': {
        if (!args) return out('  ask him what?');
        try {
          const { text } = await speak({
            mood: store.getSettings(guildId()).mood,
            messages: [{ role: 'user', content: `[console]: ${args}` }],
          });
          return out(`  > ${text}`);
        } catch (error) {
          return out(`  ${inCharacterError(error)}`);
        }
      }

      case 'mood': {
        const maybeChannel = findChannel(rest[0]);
        const mood = (maybeChannel ? rest[1] : rest[0])?.toLowerCase();
        if (!MOODS.includes(mood)) return out(`  pick one of: ${MOODS.join(', ')}`);
        if (maybeChannel) {
          memory.setMood(maybeChannel.id, mood);
          return out(`  #${maybeChannel.name} is now ${mood}`);
        }
        store.updateSettings(guildId(), { mood });
        for (const [id] of store.listChannels(guildId())) memory.setMood(id, mood);
        return out(`  everywhere is now ${mood}`);
      }

      case 'wipe': {
        const channel = findChannel(rest[0]);
        if (channel) {
          memory.forget(channel.id);
          return out(`  forgot #${channel.name}`);
        }
        for (const [id] of store.listChannels(guildId())) memory.forget(id);
        return out('  forgot everything');
      }

      case 'faq':
        return faq(rest, out, guildId);

      case 'quota': {
        if (rest[0] === 'reset') {
          const cleared = quota.reset(guildId());
          return out(`  cleared ${cleared} budget(s)`);
        }
        const settings = store.getSettings(guildId());
        return out(
          settings.questionLimit
            ? `  ${settings.questionLimit} answers per person every ${settings.quotaHours}h`
            : '  no question limit',
        );
      }

      case 'models': {
        const live = new Set(modelChain.available());
        for (const model of modelChain.all()) {
          out(
            `  ${live.has(model) ? '·' : '×'} ${model}${live.has(model) ? '' : '  (out of budget)'}`,
          );
        }
        return;
      }

      case 'quit':
      case 'exit':
      case 'stop':
        out('  he does not want you to go.');
        return onQuit();

      default: {
        // With a channel selected, plain typing is Verity talking. Held in a
        // local so a later "use none" cannot redirect a message mid-send.
        const selected = state.channel;
        if (selected) {
          for (const chunk of splitMessage(cleaned)) await selected.send(chunk);
          return out(`  → #${selected.name}`);
        }

        // "#general hello" is the obvious thing to type, so make it work.
        const channel = findChannel(command);
        if (channel && args) {
          for (const chunk of splitMessage(args)) await channel.send(chunk);
          return out(`  sent to #${channel.name}`);
        }
        if (command.startsWith('#')) {
          out(`  no channel matching "${command}".`);
          return out(`  he can see: ${channelList()}`);
        }
        return out(
          `  not a command. "help" for the list, or "ask ${cleaned}" to put that to Verity.`,
        );
      }
    }
  }

  function faq(rest, out, guildId) {
    const [sub, ...tail] = rest;
    const entries = store.listAnswers(guildId());

    if (!sub || sub === 'list') {
      if (!entries.length)
        return out('  no canned answers yet — faq add ip, server ip = play.example.com');
      entries.forEach((entry, index) => {
        out(
          `  ${index}. [${entry.triggers.join(', ')}] → ${entry.answer}  (${entry.hits ?? 0} hits)`,
        );
      });
      return;
    }

    if (sub === 'add') {
      const [triggerPart, ...answerParts] = tail.join(' ').split('=');
      const answer = answerParts.join('=').trim();
      const triggers = triggerPart
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean);
      if (!triggers.length || !answer) {
        return out(
          '  format: faq add server ip, whats the ip = the ip is play.example.com, {user}',
        );
      }
      store.addAnswer(guildId(), triggers, answer);
      return out(`  added. he will answer [${triggers.join(', ')}] instantly, for free.`);
    }

    if (sub === 'remove' || sub === 'rm') {
      const removed = store.removeAnswer(guildId(), Number(tail[0]));
      return out(removed ? `  removed "${removed.answer}"` : '  no answer with that number');
    }

    if (sub === 'test') {
      const hit = matchAnswer(entries, tail.join(' '));
      return out(hit ? `  → ${hit.answer}` : '  nothing matches — he would think about it instead');
    }

    return out('  faq | faq add <triggers> = <answer> | faq remove <n> | faq test <text>');
  }

  // Lines run strictly one at a time. Typed input arrives slowly enough not
  // to care, but pasting a block delivers every line at once, and overlapping
  // handlers can send a message to a channel that was deselected in between.
  let queue = Promise.resolve();
  const run = (line) => {
    queue = queue.then(
      () => dispatch(line),
      () => dispatch(line),
    );
    return queue;
  };

  return { run, help: HELP, state };
}

/** Wires the dispatcher above to the terminal Verity is running in. */
export function startConsole(client) {
  // No TTY means this is running as a service, where a prompt is just noise.
  if (!process.stdin.isTTY) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'verity> ',
  });

  const { run, state } = createConsole(
    client,
    (line = '') => console.log(line),
    () => {
      rl.close();
      process.emit('SIGINT');
    },
  );

  rl.on('line', async (line) => {
    try {
      await run(line);
    } catch (error) {
      console.error('  console error:', error.message);
    }
    // The prompt shows where your typing is going.
    rl.setPrompt(state.channel ? `verity #${state.channel.name}> ` : 'verity> ');
    rl.prompt();
  });
  rl.on('SIGINT', () => process.emit('SIGINT'));

  console.log('\n  type "help" for the console commands\n');
  rl.prompt();
}
