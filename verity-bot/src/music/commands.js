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
} from './resolve.js';
import * as player from './player.js';

const run = promisify(execFile);

/**
 * The music commands, one for one with the ones people already know from
 * other music bots, with `verity` in front instead of a punctuation prefix.
 */
const COMMAND =
  /^verity(song|play|p|skip|s|next|stop|pause|resume|unpause|queue|q|np|nowplaying|loop|repeat|shuffle|clear|remove|rm|speed|volume|vol|join|summon|leave|dc|disconnect|music|help)\b\s*(.*)$/is;

export const parse = (content) => {
  const match = String(content ?? '')
    .trim()
    .match(COMMAND);
  return match ? { command: match[1].toLowerCase(), argument: match[2].trim() } : null;
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
            open: (options) => streamDirect(source, options),
          },
        ],
        label: prettyName(source),
      };
    }

    case 'spotify': {
      if (target.type !== 'track') {
        // A playlist or an album: every track, in order.
        const items = await spotifyList(target);
        if (!ytdlpEnabled()) throw new Error(`that is ${items.length} tracks, and ${NO_SOURCE}`);
        return {
          tracks: items.map((item) => searchTrack(item.title, item.search, requestedBy)),
          label: `${items.length} tracks from that ${target.type}`,
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
        const items = await ytdlpList(target.url);
        if (items.length > 1) {
          return {
            tracks: items.map((item) =>
              resolvedTrack({ title: item.title, requestedBy, target: item.url }),
            ),
            label: `${items.length} tracks from that playlist`,
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

/** Kept for the console, which only ever wants one thing at a time. */
export async function trackFor(input, requestedBy) {
  const { tracks } = await tracksFor(input, requestedBy);
  return tracks[0];
}

const HELP = [
  '**veritysong** <link or search> — play it, or add it to the queue',
  '**verityskip** · **veritystop** · **veritypause** · **verityresume**',
  '**verityqueue** · **veritynp** · **verityshuffle** · **verityclear** · **verityremove** <n>',
  '**verityloop** off | track | queue',
  '**verityspeed** 2 — double speed. **verityvolume** 50',
  '**verityjoin** · **verityleave**',
].join('\n');

/**
 * Runs a music command for a message.
 * @returns {Promise<string|null>} what Verity should say, or null to stay quiet
 */
export async function handle({ command, argument }, message) {
  const guildId = message.guildId;

  // Everything, help included: the commands are not open to the channel.
  if (!isDj(message.member, guildId)) {
    return 'no. the music is not for you. ask someone to add you with /verity dj. :|';
  }

  if (command === 'help' || command === 'music') return HELP;

  const voiceChannel = message.member?.voice?.channel;

  switch (command) {
    case 'leave':
    case 'dc':
    case 'disconnect':
      return player.leave(guildId)
        ? 'fine. i did not want to be in there anyway. :|'
        : 'i am not in a channel.';

    case 'queue':
    case 'q': {
      const current = player.nowPlaying(guildId);
      const rest = player.queued(guildId);
      const { loop, speed, paused } = player.settings(guildId);
      if (!current && !rest.length) return 'nothing queued. the silence is nice, actually.';
      return [
        current ? `**now**: ${current.title} _(${current.requestedBy})_` : '**now**: nothing',
        ...rest
          .slice(0, 10)
          .map((track, index) => `${index + 1}. ${track.title} _(${track.requestedBy})_`),
        rest.length > 10 ? `…and ${rest.length - 10} more` : '',
        [
          loop !== 'off' ? `loop: ${loop}` : '',
          speed !== 1 ? `speed: ${speed}x` : '',
          paused ? 'paused' : '',
        ]
          .filter(Boolean)
          .join(' · '),
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'np':
    case 'nowplaying': {
      const current = player.nowPlaying(guildId);
      if (!current) return 'nothing. put something on.';
      const { speed, position } = player.settings(guildId);
      const minutes = Math.floor(position / 60);
      const seconds = Math.floor(position % 60)
        .toString()
        .padStart(2, '0');
      return `**${current.title}** — put on by ${current.requestedBy} · ${minutes}:${seconds}${speed !== 1 ? ` · ${speed}x` : ''}`;
    }

    case 'skip':
    case 's':
    case 'next': {
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
    case 'unpause':
      return player.resume(guildId) ? 'back on.' : 'nothing to resume.';

    case 'loop':
    case 'repeat': {
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
        ? `shuffled ${shuffled}. hope you liked the old order.`
        : 'nothing to shuffle.';
    }

    case 'clear': {
      const dropped = player.clear(guildId);
      return dropped
        ? `threw away ${dropped}. the one playing survives.`
        : 'the queue is already empty.';
    }

    case 'remove':
    case 'rm': {
      const removed = player.remove(guildId, Number(argument));
      return removed
        ? `removed **${removed.title}**.`
        : 'no track at that number. check `verityqueue`.';
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

    case 'volume':
    case 'vol': {
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
  if (!voiceChannel) return 'get into a voice channel first, obviously.';

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
    return `i am not allowed to speak in ${voiceChannel.name}. sort your permissions out.`;
  }

  if (command === 'join' || command === 'summon') {
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
    return `queued **${label}** — ${added} tracks${startedPlaying ? '' : ', behind what is already on'}.`;
  }

  const { position } = player.enqueue(guildId, tracks[0]);
  // Position 0 started immediately, and the playing event announces that.
  return position === 0 ? null : `**${label}** is number ${position} in the queue. wait your turn.`;
}

/** Playback events talk back to the channel the command came from. */
function events(message) {
  return (event) => {
    if (event.type === 'playing') {
      message.channel
        .send(
          `now playing **${event.track.title}**, because ${event.track.requestedBy} insisted. :|`,
        )
        .catch(() => {});
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
