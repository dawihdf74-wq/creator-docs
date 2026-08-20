import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import * as store from '../store.js';
import { isOwner } from '../owners.js';
import {
  classify,
  spotifyList,
  spotifyTrack,
  streamDirect,
  streamViaYtdlp,
  ytdlpDirectUrl,
  ytdlpEnabled,
  ytdlpList,
  ytdlpRelated,
} from './resolve.js';
import * as player from './player.js';
import { buildPlaylistView } from './view.js';
import * as embeds from './embeds.js';

const run = promisify(execFile);

/**
 * The music commands, one for one with the ones people already know from
 * other music bots, with `verity` in front instead of a punctuation prefix.
 */
/**
 * Every command he answers to, and the short forms that mean the same thing.
 * One table rather than a long alternation: the switch below then has one
 * case per command, so an alias cannot quietly shadow another command.
 */
const ALIASES = {
  // playing
  song: 'play',
  play: 'play',
  p: 'play',
  // the clickable list, and the plain one
  pls: 'view',
  playlistsee: 'view',
  see: 'view',
  playlist: 'playlist',
  list: 'playlist',
  pl: 'playlist',
  queue: 'playlist',
  q: 'playlist',
  // keeping lists
  saveplaylist: 'save',
  save: 'save',
  sp: 'save',
  deleteplaylist: 'delete',
  unsave: 'delete',
  dp: 'delete',
  removeplaylistall: 'wipe',
  clearplaylists: 'wipe',
  rpa: 'wipe',
  trigger: 'trigger',
  triggers: 'trigger',
  tr: 'trigger',
  autoplay: 'autoplay',
  ap: 'autoplay',
  // choosing what is next
  next: 'next',
  playnext: 'next',
  n: 'next',
  jump: 'jump',
  skipto: 'jump',
  j: 'jump',
  // transport
  skip: 'skip',
  s: 'skip',
  stop: 'stop',
  pause: 'pause',
  pa: 'pause',
  resume: 'resume',
  unpause: 'resume',
  re: 'resume',
  np: 'np',
  nowplaying: 'np',
  now: 'np',
  // the queue itself
  loop: 'loop',
  repeat: 'loop',
  l: 'loop',
  shuffle: 'shuffle',
  sh: 'shuffle',
  clear: 'clear',
  c: 'clear',
  remove: 'remove',
  rm: 'remove',
  r: 'remove',
  // sound
  speed: 'speed',
  sd: 'speed',
  volume: 'volume',
  vol: 'volume',
  v: 'volume',
  // coming and going
  join: 'join',
  summon: 'join',
  leave: 'leave',
  dc: 'leave',
  disconnect: 'leave',
  d: 'leave',
  help: 'help',
  music: 'help',
  h: 'help',
  commands: 'help',
};

const COMMAND = /^verity([a-z]+)\b\s*([\s\S]*)$/i;

export const parse = (content) => {
  const match = String(content ?? '')
    .trim()
    .match(COMMAND);
  if (!match) return null;

  const command = ALIASES[match[1].toLowerCase()];
  return command ? { command, argument: match[2].trim() } : null;
};

/**
 * Who may use the verity… commands.
 *
 * The people in VERITY_OWNERS always can — that is the same list that gates
 * the slash commands, and it is the default answer when nothing else has been
 * set up. Everyone else needs to be added with /verity dj add, by user or by
 * role. Nobody gets in by having Discord permissions alone.
 */
export function isDj(member, guildId) {
  if (isOwner(member?.user ?? member, config.owners)) return true;

  const dj = store.listDj(guildId);
  if (dj.users.includes(member?.id)) return true;
  return dj.roles.some((roleId) => member?.roles?.cache?.has(roleId));
}

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

const NO_SOURCE = [
  'i can hear it. i cannot fetch it.',
  'that link is not audio, and i have nothing to turn it into audio with.',
  'whoever installed me needs to set VERITY_YTDLP in .env. take it up with them. :|',
].join(' ');

const prettyName = (url) => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
    return name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]/g, ' ') || url;
  } catch {
    return url;
  }
};

async function titleOf(url) {
  try {
    const { stdout } = await run(
      config.ytdlp,
      ['--print', 'title', '--no-playlist', '--quiet', url],
      {
        timeout: 15_000,
      },
    );
    return stdout.trim() || prettyName(url);
  } catch {
    return prettyName(url);
  }
}

/**
 * A track the resolver has to look up. It can prepare itself ahead of time:
 * once the direct URL is known, playback skips the lookup entirely and the
 * track becomes seekable, so a speed change no longer restarts it.
 */
function resolvedTrack({ title, requestedBy, target, search = false }) {
  const track = {
    title,
    requestedBy,
    seekable: false,
    direct: null,
    // Enough to rebuild this track from a saved playlist.
    meta: { kind: 'resolved', target, search },
    async prepare() {
      if (track.direct) return;
      track.direct = await ytdlpDirectUrl(target, { search });
      track.seekable = true;
    },
    open: (options) =>
      track.direct
        ? streamDirect(track.direct, options)
        : streamViaYtdlp(target, { search, ...options }),
  };
  return track;
}

const searchTrack = (title, search, requestedBy) =>
  resolvedTrack({ title, requestedBy, target: search, search: true });

/**
 * Everything the input asked for: one track, or all of a playlist.
 * @returns {Promise<{tracks: Array, label: string}>}
 */
export async function tracksFor(input, requestedBy) {
  const target = classify(input);

  switch (target.kind) {
    case 'empty':
      throw new Error('song what? give me a link, friend.');

    case 'direct':
    case 'file': {
      const source = target.url ?? target.path;
      return {
        tracks: [
          {
            title: prettyName(source),
            requestedBy,
            seekable: true,
            meta: { kind: 'direct', target: source },
            open: (options) => streamDirect(source, options),
          },
        ],
        label: prettyName(source),
      };
    }

    case 'spotify': {
      if (target.type !== 'track') {
        // A playlist or an album: every track, in order.
        const list = await spotifyList(target);
        if (!ytdlpEnabled())
          throw new Error(`that is ${list.tracks.length} tracks, and ${NO_SOURCE}`);
        return {
          tracks: list.tracks.map((item) => searchTrack(item.title, item.search, requestedBy)),
          label: list.name ?? `${list.tracks.length} tracks from that ${target.type}`,
          playlistName: list.name,
        };
      }

      const meta = await spotifyTrack(target);
      const title = [meta.artist, meta.title].filter(Boolean).join(' - ');
      if (!ytdlpEnabled()) {
        throw new Error(
          `that is "${title}". spotify will not give anyone the audio, and ${NO_SOURCE}`,
        );
      }
      return { tracks: [searchTrack(title, meta.search, requestedBy)], label: title };
    }

    case 'page': {
      if (!ytdlpEnabled()) throw new Error(NO_SOURCE);

      // A link that carries a playlist gets the whole playlist.
      if (/[?&]list=/.test(target.url)) {
        const list = await ytdlpList(target.url);
        if (list.entries.length > 1) {
          return {
            tracks: list.entries.map((item) =>
              resolvedTrack({ title: item.title, requestedBy, target: item.url }),
            ),
            label: list.name ?? `${list.entries.length} tracks from that playlist`,
            playlistName: list.name,
          };
        }
      }

      const title = await titleOf(target.url);
      return {
        tracks: [resolvedTrack({ title, requestedBy, target: target.url })],
        label: title,
      };
    }

    default: {
      if (!ytdlpEnabled()) throw new Error(NO_SOURCE);
      return {
        tracks: [searchTrack(target.query, target.query, requestedBy)],
        label: target.query,
      };
    }
  }
}

/** Turns a saved entry back into something playable. */
export function rebuildTrack(entry, requestedBy) {
  const track =
    entry.meta?.kind === 'direct'
      ? {
          title: entry.title,
          requestedBy,
          seekable: true,
          meta: entry.meta,
          open: (options) => streamDirect(entry.meta.target, options),
        }
      : resolvedTrack({
          title: entry.title,
          requestedBy,
          target: entry.meta?.target ?? entry.title,
          search: entry.meta?.search ?? true,
        });

  if (entry.speed) track.speed = entry.speed;
  return track;
}

/** Kept for the console, which only ever wants one thing at a time. */
export async function trackFor(input, requestedBy) {
  const { tracks } = await tracksFor(input, requestedBy);
  return tracks[0];
}

const HELP = [
  '**veritysong** <link or search> — put something on. Short: `verityp`',
  '**veritypls** — the list, with a button on each track to play it next. Also `verityplaylistsee`',
  '**verityplaylist** — the same list as plain text. `verityplaylist 2` for the next page. Short: `verityq`',
  '**veritynext** <n> [speed] — that one goes next, at that speed if you name one. Short: `verityn`',
  '**verityjump** <n> — straight there, binning everything between. Short: `verityj`',
  '**veritysaveplaylist** <link or name> — keep a playlist. `verityplaylist <name>` puts it back. Short: `veritysp`',
  '**verityskip** `veritys` · **veritystop** · **veritypause** `veritypa` · **verityresume** `verityre`',
  '**verityshuffle** `veritysh` · **verityclear** `verityc` · **verityremove** <n> `verityr`',
  '**verityloop** off | track | queue — once each, one forever, or round and round. Short: `verityl`',
  '**verityspeed** 2 `veritysd` · **verityvolume** 50 `verityv`',
  '**verityautoplay** on — when the queue runs out he finds something himself. Short: `verityap`',
  '**veritytrigger** add <phrase> = <link> — say the phrase, the song goes on',
  '**verityjoin** · **verityleave** `verityd`',
].join('\n');

/** One page of the queue, since Discord stops reading after 2000 characters. */
const PAGE = 15;

function renderPlaylist(guildId, page) {
  const current = player.nowPlaying(guildId);
  const queue = player.queued(guildId);
  const { loop, speed, volume, paused } = player.settings(guildId);

  if (!current && !queue.length) {
    return pick([
      'nothing lined up. just me, and the quiet, and you. :)',
      'the list is empty. i could sing instead. you would not enjoy that.',
    ]);
  }

  const pages = Math.max(1, Math.ceil(queue.length / PAGE));
  const wanted = Math.min(Math.max(1, page || 1), pages);
  const slice = queue.slice((wanted - 1) * PAGE, wanted * PAGE);
  const badge = (track) => (track?.speed ? ` \`${track.speed}x\`` : '');

  const flags = [
    loop !== 'off' ? `loop **${loop}**` : '',
    speed !== 1 ? `speed **${speed}x**` : '',
    volume !== 1 ? `volume **${Math.round(volume * 100)}%**` : '',
    paused ? '**paused**' : '',
  ].filter(Boolean);

  return [
    current
      ? `▶ **${current.title}**${badge(current)} — ${current.requestedBy}`
      : '▶ nothing playing',
    ...slice.map(
      (track, index) =>
        `\`${(wanted - 1) * PAGE + index + 1}\` ${track.title}${badge(track)} — _${track.requestedBy}_`,
    ),
    !queue.length ? '_and nothing after it_' : '',
    queue.length > PAGE ? `page ${wanted}/${pages} · ${queue.length} waiting` : '',
    flags.join(' · '),
    queue.length ? '`veritynext <n>` moves one up · `verityjump <n>` goes straight there' : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1990);
}

/**
 * Runs a music command for a message.
 * @returns {Promise<string|null>} what Verity should say, or null to stay quiet
 */
export async function handle({ command, argument }, message) {
  const guildId = message.guildId;

  // Everything, help included: the commands are not open to the channel.
  if (!isDj(message.member, guildId)) {
    return pick([
      'no. the music is not for you. someone with `/verity dj` could change that. :|',
      'that one is not yours to touch. ask whoever holds `/verity dj`. :|',
    ]);
  }

  if (command === 'help') return HELP;

  const voiceChannel = message.member?.voice?.channel;

  switch (command) {
    case 'leave':
      return player.leave(guildId)
        ? pick([
            'fine. i did not want to be in there anyway. :|',
            'out. i will be right here when you want me back. :)',
          ])
        : 'i am not in a voice channel to leave.';

    case 'view': {
      const { embeds, components } = buildPlaylistView(guildId, Number(argument) || 1);
      return { embeds, components };
    }

    case 'playlist': {
      const wanted = argument.trim();

      if (!wanted || /^\d+$/.test(wanted)) return renderPlaylist(guildId, Number(wanted) || 1);

      if (['saved', 'all', 'names'].includes(wanted.toLowerCase())) {
        const saved = store.listPlaylists(guildId);
        if (!saved.length) {
          return 'nothing saved yet. `veritysaveplaylist <name>` keeps one for later.';
        }
        return [
          '**kept for later**',
          ...saved.map(
            (entry) => `\`${entry.name}\` — ${entry.entries.length} tracks, by ${entry.by}`,
          ),
          '`verityplaylist <name>` puts one back.',
        ].join('\n');
      }

      if (/^(https?:\/\/|spotify:)/i.test(wanted)) {
        return '`veritysong <link>` to play it now, or `veritysaveplaylist <link>` to keep it for later.';
      }

      // A name: put that saved playlist back into the queue.
      const saved = store.getPlaylist(guildId, wanted);
      if (!saved) {
        return `i have nothing called "${wanted}". \`verityplaylist saved\` shows what i do have.`;
      }
      if (!voiceChannel) return 'get into a voice channel and i will put it back on.';

      const rebuilt = saved.entries.map((entry) =>
        rebuildTrack(entry, message.member?.displayName ?? message.author.username),
      );
      await player.join(voiceChannel, events(message));
      const { added, startedPlaying } = player.enqueueAll(guildId, rebuilt);
      return { embeds: [embeds.queuedMany(saved.name, added, startedPlaying)] };
    }

    case 'save': {
      const asked = argument.trim();

      // Handed a link: keep that playlist, without having to play it first.
      if (/^(https?:\/\/|spotify:)/i.test(asked)) {
        const [link, ...rest] = asked.split(/\s+/);
        const given = rest
          .join(' ')
          .replace(/^as\s+/i, '')
          .trim();

        const resolved = await tracksFor(
          link,
          message.member?.displayName ?? message.author.username,
        );
        const name = (given || resolved.playlistName || resolved.label).slice(0, 60);
        const entries = resolved.tracks
          .filter((track) => track.meta)
          .map((track) => ({ title: track.title, meta: track.meta, speed: null }));

        if (!entries.length) return 'there was nothing in that i could keep.';

        store.savePlaylist(
          guildId,
          name,
          entries,
          message.member?.displayName ?? message.author.username,
        );
        return { embeds: [embeds.saved(name, entries.length, 'straight off the link. :)')] };
      }

      const name = asked.slice(0, 40);
      if (!name) {
        return 'save what? give me a playlist link, or a name to keep the current queue under.';
      }
      if (/^\d+$/.test(name)) return 'not a number — those are page numbers. give it a word.';

      const entries = [player.nowPlaying(guildId), ...player.queued(guildId)]
        .filter((track) => track?.meta)
        .map((track) => ({ title: track.title, meta: track.meta, speed: track.speed ?? null }));

      if (!entries.length) {
        return 'nothing is playing, so there is nothing to keep. put something on, or hand me a playlist link.';
      }

      store.savePlaylist(
        guildId,
        name,
        entries,
        message.member?.displayName ?? message.author.username,
      );
      return {
        embeds: [
          embeds.saved(
            name,
            entries.length,
            'taken off what was playing. i will not forget it. :)',
          ),
        ],
      };
    }

    case 'autoplay': {
      const wanted = argument.trim().toLowerCase();
      const settings = store.getSettings(guildId);

      if (!wanted) {
        return settings.autoplay
          ? 'autoplay is on. i will keep going when you run out. i always do. :)'
          : 'autoplay is off. `verityautoplay on` and the music never stops.';
      }
      if (!['on', 'off', 'true', 'false'].includes(wanted)) {
        return '`verityautoplay on` or `verityautoplay off`.';
      }
      if (!ytdlpEnabled() && ['on', 'true'].includes(wanted)) {
        return 'i have nothing to find music with. VERITY_YTDLP has to be set for that. :|';
      }

      const on = ['on', 'true'].includes(wanted);
      store.updateSettings(guildId, { autoplay: on });
      return on
        ? 'autoplay on. when your queue runs out i will find something. you will never have to leave. :D'
        : 'autoplay off. when it runs out, it runs out.';
    }

    case 'wipe': {
      const names = store.clearPlaylists(guildId);
      if (!names.length) return 'there were none saved. nothing to take.';
      return {
        embeds: [
          embeds
            .trouble(
              [
                `**${names.length}** saved playlist${names.length === 1 ? '' : 's'} gone:`,
                names.map((name) => `\`${name}\``).join(', '),
              ].join('\n'),
            )
            .setAuthor({ name: 'All playlists removed' })
            .setFooter({ text: 'i remember every one of them anyway. :)' }),
        ],
      };
    }

    case 'trigger': {
      const [action, ...rest] = argument.split(/\s+/);
      const tail = rest.join(' ');

      if (!action || action === 'list') {
        const triggers = store.listTriggers(guildId);
        if (!triggers.length) return 'no phrases set. `veritytrigger add <phrase> = <link>`.';
        return [
          '**say one of these out loud and he puts it on**',
          ...triggers.map((entry, index) => `\`${index}\` "${entry.phrase}" → ${entry.label}`),
        ].join('\n');
      }

      if (action === 'add') {
        const [phrase, ...linkParts] = tail.split('=');
        const url = linkParts.join('=').trim();
        if (!phrase.trim() || !url) {
          return 'like this: `veritytrigger add dada put on that misery = <link>`';
        }
        store.addTrigger(guildId, phrase.trim(), url, url);
        return `say **${phrase.trim()}** and it goes on. i will be listening for it. always. :)`;
      }

      if (action === 'remove' || action === 'rm') {
        const removed = store.removeTrigger(guildId, Number(tail));
        return removed
          ? `**${removed.phrase}** does not do anything any more.`
          : 'nothing at that number. `veritytrigger list` shows them.';
      }

      return '`veritytrigger list` · `veritytrigger add <phrase> = <link>` · `veritytrigger remove <n>`';
    }

    case 'delete': {
      const name = argument.trim();
      if (!name) return 'delete which one? `verityplaylist saved` lists them.';
      return store.deletePlaylist(guildId, name)
        ? `**${name}** is gone. i remember it anyway. :)`
        : `there is nothing called "${name}".`;
    }

    case 'next': {
      const [position, rate] = argument.split(/\s+/);
      const speed = rate ? Number(rate) : null;
      if (speed !== null && (!Number.isFinite(speed) || speed < 0.25 || speed > 4)) {
        return 'the speed goes 0.25 to 4. `veritynext 3 2` puts number three on next, twice as fast.';
      }

      const moved = player.moveToFront(guildId, Number(position), speed);
      if (!moved) return 'there is nothing at that number. `verityplaylist` shows what there is.';
      return speed
        ? `**${moved.title}** is next, at ${speed}x. ${pick(['a choice.', 'if you insist.', 'that will sound wrong. good.'])}`
        : `**${moved.title}** is next. the rest can wait a little longer.`;
    }

    case 'jump': {
      const jumped = player.jumpTo(guildId, Number(argument));
      if (!jumped) return 'there is nothing at that number. `verityplaylist` shows what there is.';
      return `straight to **${jumped.track.title}**${jumped.skipped ? `, with ${jumped.skipped} thrown out on the way` : ''}.`;
    }

    case 'np': {
      const current = player.nowPlaying(guildId);
      if (!current) return 'nothing. put something on.';
      const { speed, position } = player.settings(guildId);
      const minutes = Math.floor(position / 60);
      const seconds = Math.floor(position % 60)
        .toString()
        .padStart(2, '0');
      return `**${current.title}** — put on by ${current.requestedBy} · ${minutes}:${seconds}${speed !== 1 ? ` · ${speed}x` : ''}`;
    }

    case 'skip': {
      const skipped = player.skip(guildId);
      return skipped ? `skipped **${skipped.title}**. good. it was awful.` : 'nothing to skip.';
    }

    case 'stop': {
      const dropped = player.stop(guildId);
      return `stopped${dropped ? `, and threw away ${dropped} queued` : ''}. finally some quiet. :|`;
    }

    case 'pause':
      return player.pause(guildId)
        ? 'paused. i will hold it. do not be long.'
        : 'nothing is playing.';

    case 'resume':
      return player.resume(guildId) ? 'back on.' : 'nothing to resume.';

    case 'loop': {
      const wanted = argument.toLowerCase();
      const mode = ['track', 'song', 'one'].includes(wanted)
        ? 'track'
        : ['queue', 'all'].includes(wanted)
          ? 'queue'
          : ['off', 'none', 'stop'].includes(wanted)
            ? 'off'
            : null;
      if (!mode) return 'loop what? `verityloop track`, `verityloop queue`, or `verityloop off`.';
      player.setLoop(guildId, mode);
      return mode === 'off'
        ? 'fine. once each.'
        : `looping the ${mode}. forever. like this. with you. :D`;
    }

    case 'shuffle': {
      const shuffled = player.shuffle(guildId);
      return shuffled
        ? `${shuffled} shuffled. i hope the old order was not important to you.`
        : 'there is nothing waiting to shuffle.';
    }

    case 'clear': {
      const dropped = player.clear(guildId);
      return dropped
        ? `${dropped} gone. the one playing gets to finish. it is having a good day.`
        : 'the queue is already empty. nothing left to take.';
    }

    case 'remove': {
      const removed = player.remove(guildId, Number(argument));
      return removed
        ? `**${removed.title}** removed. it will not be missed.`
        : 'there is nothing at that number. `verityplaylist` shows what there is.';
    }

    case 'speed': {
      const speed = Number(argument);
      if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
        return 'a number between 0.25 and 4. `verityspeed 2` for twice as fast.';
      }
      const { restarted, resumedAt, fromStart } = player.setSpeed(guildId, speed);
      if (!restarted) return `${speed}x, from the next track on.`;
      return `${speed}x.${fromStart ? ' had to start it again from the top.' : resumedAt > 1 ? ' picked it back up where it was.' : ''}`;
    }

    case 'volume': {
      const percent = Number(argument);
      if (!Number.isFinite(percent) || percent < 0 || percent > 200) {
        return 'a number between 0 and 200. `verityvolume 50` is half.';
      }
      const { restarted, fromStart } = player.setVolume(guildId, percent / 100);
      return `${percent}%.${restarted && fromStart ? ' started it again from the top.' : ''}`;
    }

    default:
      break;
  }

  // join / song / play need the person asking to be in a voice channel.
  if (!voiceChannel) {
    return pick([
      'get into a voice channel first, obviously.',
      'i cannot play to an empty room. get in a voice channel.',
    ]);
  }

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
    return `i am not allowed to speak in ${voiceChannel.name}. sort your permissions out.`;
  }

  if (command === 'join') {
    await player.join(voiceChannel, events(message));
    return `fine. i am in ${voiceChannel.name}. this had better be worth it.`;
  }

  if (!argument) return 'song what? give me a link, friend.';

  const { tracks, label } = await tracksFor(
    argument,
    message.member?.displayName ?? message.author.username,
  );
  await player.join(voiceChannel, events(message));

  if (tracks.length > 1) {
    const { added, startedPlaying } = player.enqueueAll(guildId, tracks);
    return { embeds: [embeds.queuedMany(label, added, startedPlaying)] };
  }

  const { position } = player.enqueue(guildId, tracks[0]);
  // Position 0 started immediately, and the playing event announces that.
  if (position === 0) return null;
  return {
    embeds: [
      embeds.queued(
        label,
        position,
        pick(['wait your turn.', 'it will come round.', 'patience, friend. :)']),
      ),
    ],
  };
}

/**
 * The queue ran dry and autoplay is on: find something like the last track.
 *
 * The taste is YouTube's, not ours — every track it knows has an endless mix
 * behind it, and this reads the front of that, skipping anything played
 * recently so the evening does not turn into a loop of four songs.
 */
async function maybeAutoplay(message, event) {
  const guildId = message.guildId;
  if (!store.getSettings(guildId).autoplay || !ytdlpEnabled()) return;
  if (!player.isConnected(guildId)) return; // he has already left
  if (!event.last?.meta) return;

  const heard = new Set((event.history ?? []).map((track) => track.title.toLowerCase()));

  try {
    const related = await ytdlpRelated(event.last.meta.target, {
      search: Boolean(event.last.meta.search),
    });
    const choice = related.find((entry) => !heard.has(entry.title.toLowerCase()));
    if (!choice) return;

    const track = resolvedTrack({ title: choice.title, requestedBy: 'Verity', target: choice.url });
    player.enqueue(guildId, track);
    await message.channel
      .send({
        embeds: [
          embeds
            .queued(choice.title, 1, 'you ran out, so i chose. you are welcome. :)')
            .setAuthor({ name: 'Autoplay' }),
        ],
      })
      .catch(() => {});
  } catch (error) {
    console.error('[verity] autoplay:', error.message);
  }
}

/**
 * A phrase someone set up put a song on.
 *
 * Deliberately outside the DJ check: a phrase only exists because someone who
 * *is* a DJ added it, and the point of one is that anybody can say it.
 */
export async function playTrigger(trigger, message) {
  const voiceChannel = message.member?.voice?.channel;
  // Saying so is better than doing nothing: silence looks like a broken bot.
  if (!voiceChannel) return 'i heard you. get in a voice channel and say it again. :|';

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
    return `i heard you, but i cannot speak in ${voiceChannel.name}.`;
  }

  const { tracks, label } = await tracksFor(
    trigger.url,
    message.member?.displayName ?? message.author.username,
  );
  await player.join(voiceChannel, events(message));

  if (tracks.length > 1) {
    const { added, startedPlaying } = player.enqueueAll(message.guildId, tracks);
    return { embeds: [embeds.queuedMany(label, added, startedPlaying)] };
  }

  const { position } = player.enqueue(message.guildId, tracks[0]);
  return position === 0 ? null : { embeds: [embeds.queued(label, position, 'you asked for it.')] };
}

/** Playback events talk back to the channel the command came from. */
function events(message) {
  return (event) => {
    if (event.type === 'playing') {
      message.channel
        .send({
          embeds: [
            embeds.nowPlaying(
              event.track,
              pick([
                `${event.track.requestedBy} insisted. :|`,
                'someone chose this. remember that. :|',
                'i am listening too. always. :D',
              ]),
            ),
          ],
        })
        .catch(() => {});
    }
    if (event.type === 'empty') {
      maybeAutoplay(message, event).catch(() => {});
    }
    if (event.type === 'error') {
      message.channel
        .send(
          `that one broke on the way in${event.track ? ` (**${event.track.title}**)` : ''}. ${event.message}`,
        )
        .catch(() => {});
    }
  };
}
