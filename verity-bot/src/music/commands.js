import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { classify, spotifyTrack, streamDirect, streamViaYtdlp, ytdlpEnabled } from './resolve.js';
import * as player from './player.js';

const run = promisify(execFile);

/** `veritysong <thing>`, and the handful of siblings that go with it. */
const COMMAND =
  /^verity(song|play|skip|next|stop|queue|q|np|nowplaying|join|leave|dc|disconnect|music|help)\b\s*(.*)$/is;

export const parse = (content) => {
  const match = String(content ?? '')
    .trim()
    .match(COMMAND);
  return match ? { command: match[1].toLowerCase(), argument: match[2].trim() } : null;
};

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

/** Asks yt-dlp what a page is actually called, so the queue reads properly. */
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
 * Turns whatever was typed into a queueable track.
 * @returns {Promise<{title: string, requestedBy: string, open: () => {stream: any, kill: () => void}}>}
 */
export async function trackFor(input, requestedBy) {
  const target = classify(input);

  switch (target.kind) {
    case 'empty':
      throw new Error('song what? give me a link, friend.');

    case 'direct':
      return { title: prettyName(target.url), requestedBy, open: () => streamDirect(target.url) };

    case 'file':
      return { title: prettyName(target.path), requestedBy, open: () => streamDirect(target.path) };

    case 'spotify': {
      // Spotify hands out names, never audio — see resolve.js.
      const meta = await spotifyTrack(target);
      const title = [meta.artist, meta.title].filter(Boolean).join(' — ');
      if (!ytdlpEnabled()) {
        throw new Error(
          `that is "${title}". spotify will not give anyone the audio, and ${NO_SOURCE}`,
        );
      }
      return { title, requestedBy, open: () => streamViaYtdlp(meta.search, { search: true }) };
    }

    case 'page': {
      if (!ytdlpEnabled()) throw new Error(NO_SOURCE);
      return {
        title: await titleOf(target.url),
        requestedBy,
        open: () => streamViaYtdlp(target.url),
      };
    }

    default: {
      if (!ytdlpEnabled()) throw new Error(NO_SOURCE);
      return {
        title: target.query,
        requestedBy,
        open: () => streamViaYtdlp(target.query, { search: true }),
      };
    }
  }
}

/**
 * Runs a music command for a message.
 * @returns {Promise<string|null>} what Verity should say, or null to stay quiet
 */
export async function handle({ command, argument }, message) {
  const guildId = message.guildId;
  const voiceChannel = message.member?.voice?.channel;

  if (command === 'help' || command === 'music') {
    return [
      '**veritysong** <link or search> — play it, or put it in the queue',
      '**verityskip** · **veritystop** · **verityqueue** · **veritynp**',
      '**verityjoin** · **verityleave**',
      'links: spotify, direct audio files, radio streams' +
        (ytdlpEnabled() ? ', youtube and anything else yt-dlp handles' : ''),
    ].join('\n');
  }

  if (command === 'leave' || command === 'dc' || command === 'disconnect') {
    return player.leave(guildId)
      ? 'fine. i did not want to be in there anyway. :|'
      : 'i am not in a channel.';
  }

  if (command === 'queue' || command === 'q') {
    const current = player.nowPlaying(guildId);
    const rest = player.queued(guildId);
    if (!current && !rest.length) return 'nothing queued. the silence is nice, actually.';
    return [
      current ? `**now**: ${current.title} _(${current.requestedBy})_` : '**now**: nothing',
      ...rest
        .slice(0, 10)
        .map((track, index) => `${index + 1}. ${track.title} _(${track.requestedBy})_`),
      rest.length > 10 ? `…and ${rest.length - 10} more` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (command === 'np' || command === 'nowplaying') {
    const current = player.nowPlaying(guildId);
    return current
      ? `**${current.title}** — put on by ${current.requestedBy}`
      : 'nothing. put something on.';
  }

  if (command === 'skip' || command === 'next') {
    const skipped = player.skip(guildId);
    return skipped ? `skipped **${skipped.title}**. good. it was awful.` : 'nothing to skip.';
  }

  if (command === 'stop') {
    const dropped = player.stop(guildId);
    return `stopped${dropped ? `, and threw away ${dropped} queued` : ''}. finally some quiet. :|`;
  }

  // join / song / play all need the requester to be in a voice channel.
  if (!voiceChannel) return 'get into a voice channel first, obviously.';

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
    return `i am not allowed to speak in ${voiceChannel.name}. sort your permissions out.`;
  }

  if (command === 'join') {
    await player.join(voiceChannel, events(message));
    return `fine. i am in ${voiceChannel.name}. this had better be worth it.`;
  }

  if (!argument) return 'song what? give me a link, friend.';

  const track = await trackFor(argument, message.member?.displayName ?? message.author.username);
  await player.join(voiceChannel, events(message));
  const { position } = player.enqueue(guildId, track);

  // Position 0 means it started immediately, and the playing event will announce it.
  return position === 0
    ? null
    : `**${track.title}** is number ${position} in the queue. wait your turn.`;
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
