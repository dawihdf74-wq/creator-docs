import fs from 'node:fs';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../config.js';

/**
 * Works out what a user handed him and how to get audio out of it.
 *
 * A note on Spotify, since it is the usual surprise: Spotify does not serve
 * full-track audio to anyone but its own clients. No Discord bot plays audio
 * from Spotify — the ones that claim to read the track name off the link and
 * then play that song from somewhere else. This does the same: the link gives
 * us a title, and the title goes to whatever audio source is enabled.
 */

const AUDIO_EXTENSION = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|mp4)(\?|$)/i;
const SPOTIFY =
  /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/|spotify:(track|album|playlist):)([A-Za-z0-9]+)/i;

/** @returns {{kind: string, id?: string, url?: string, path?: string, query?: string}} */
export function classify(input) {
  const text = String(input ?? '')
    .trim()
    .replace(/^<|>$/g, '');
  if (!text) return { kind: 'empty' };

  const spotify = text.match(SPOTIFY);
  if (spotify) {
    return {
      kind: 'spotify',
      type: (spotify[1] ?? spotify[2]).toLowerCase(),
      id: spotify[3],
      url: text,
    };
  }

  if (/^https?:\/\//i.test(text)) {
    // Anything that is plainly an audio file, or a radio stream, ffmpeg can
    // open directly. Everything else needs a resolver to find the audio.
    if (
      AUDIO_EXTENSION.test(text) ||
      /\.(m3u8?|pls)(\?|$)/i.test(text) ||
      /:\d{2,5}(\/|$)/.test(text)
    ) {
      return { kind: 'direct', url: text };
    }
    return { kind: 'page', url: text };
  }

  if (fs.existsSync(text)) return { kind: 'file', path: text };

  return { kind: 'search', query: text };
}

/** Reads title and artist off a Spotify link. */
export async function spotifyTrack({ type, id, url }) {
  if (type !== 'track') {
    throw new Error(`he plays one song at a time. that is a ${type}, not a track.`);
  }

  // The proper route, when credentials are configured.
  if (config.spotify.id && config.spotify.secret) {
    const auth = Buffer.from(`${config.spotify.id}:${config.spotify.secret}`).toString('base64');
    const token = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    }).then((response) => response.json());

    const track = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    }).then((response) => response.json());

    if (track?.name) {
      const artists = (track.artists ?? []).map((artist) => artist.name).join(', ');
      return { title: track.name, artist: artists, search: `${artists} ${track.name}`.trim() };
    }
  }

  // No credentials: the public oEmbed endpoint still gives a title.
  const oembed = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(10_000),
  }).then((response) => (response.ok ? response.json() : null));

  if (!oembed?.title) {
    throw new Error('spotify would not tell me what that is. set VERITY_SPOTIFY_ID and _SECRET.');
  }
  return { title: oembed.title, artist: '', search: oembed.title };
}

/**
 * atempo only accepts 0.5-2.0 per pass, so anything more extreme is chained:
 * 4x becomes atempo=2,atempo=2.
 */
export function tempoFilter(speed) {
  let remaining = Number(speed) || 1;
  if (remaining === 1) return [];

  const stages = [];
  while (remaining > 2) {
    stages.push('atempo=2.0');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    stages.push('atempo=0.5');
    remaining *= 2;
  }
  stages.push(`atempo=${remaining.toFixed(3)}`);
  return stages;
}

const filters = ({ speed = 1, volume = 1 }) => {
  const chain = [...tempoFilter(speed), ...(volume === 1 ? [] : [`volume=${volume.toFixed(2)}`])];
  return chain.length ? ['-af', chain.join(',')] : [];
};

/** Every track on a Spotify playlist or album, in order. */
export async function spotifyList({ type, id }) {
  if (!config.spotify.id || !config.spotify.secret) {
    throw new Error(
      'playlists need spotify credentials. VERITY_SPOTIFY_ID and VERITY_SPOTIFY_SECRET in .env. :|',
    );
  }

  const auth = Buffer.from(`${config.spotify.id}:${config.spotify.secret}`).toString('base64');
  const token = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json());

  const endpoint =
    type === 'album'
      ? `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`
      : `https://api.spotify.com/v1/playlists/${id}/tracks?limit=50`;

  const page = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  }).then((response) => response.json());

  const items = (page?.items ?? [])
    .map((item) => item.track ?? item)
    .filter((track) => track?.name);
  if (!items.length) throw new Error('that list is empty, or spotify would not show it to me.');

  return items.map((track) => {
    const artists = (track.artists ?? []).map((artist) => artist.name).join(', ');
    return {
      title: [artists, track.name].filter(Boolean).join(' - '),
      search: `${artists} ${track.name}`.trim(),
    };
  });
}

/** Every entry of a playlist yt-dlp can see, without downloading any of it. */
export async function ytdlpList(url) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  const { stdout } = await run(
    config.ytdlp,
    ['--flat-playlist', '--print', '%(title)s\t%(url)s', '--quiet', '--no-warnings', url],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  );

  return stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([title, entry]) => title && entry)
    .map(([title, entry]) => ({ title: title.trim(), url: entry.trim() }));
}

/** ffmpeg turns anything it can open into the Ogg Opus that Discord wants. */
function encode(args, stdin) {
  const ffmpeg = spawn(
    ffmpegPath,
    [
      '-loglevel',
      'error',
      ...args,
      '-vn',
      '-acodec',
      'libopus',
      '-f',
      'opus',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-b:a',
      '96k',
      'pipe:1',
    ],
    { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] },
  );

  let errors = '';
  ffmpeg.stderr.on('data', (chunk) => (errors += chunk.toString().slice(0, 500)));
  ffmpeg.on('close', (code) => {
    if (code && code !== 255) console.error('[verity] ffmpeg exited', code, errors.trim());
  });
  if (stdin) stdin.pipe(ffmpeg.stdin).on('error', () => {});

  return ffmpeg;
}

/** Streams a URL or path straight through ffmpeg. */
export function streamDirect(target, options = {}) {
  const network = /^https?:\/\//i.test(target);
  const seek = Number(options.seek) || 0;
  const ffmpeg = encode([
    ...(network
      ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']
      : []),
    // Before -i, so ffmpeg jumps rather than decoding everything it skips.
    ...(seek > 0 ? ['-ss', String(seek)] : []),
    '-i',
    target,
    ...filters(options),
  ]);
  return { stream: ffmpeg.stdout, kill: () => ffmpeg.kill('SIGKILL') };
}

/**
 * The optional resolver: yt-dlp, when VERITY_YTDLP names it. Off by default.
 * It is a general-purpose downloader; what you point it at, and whether that
 * site's terms allow it, is your call to make.
 */
export function streamViaYtdlp(target, { search = false, ...options } = {}) {
  const ytdlp = spawn(
    config.ytdlp,
    [
      search ? `ytsearch1:${target}` : target,
      '-f',
      'bestaudio/best',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '-o',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let errors = '';
  ytdlp.stderr.on('data', (chunk) => (errors += chunk.toString().slice(0, 500)));
  ytdlp.on('error', (error) => console.error('[verity] yt-dlp could not start:', error.message));
  ytdlp.on('close', (code) => {
    if (code) console.error('[verity] yt-dlp exited', code, errors.trim());
  });

  // A pipe cannot be seeked cheaply, so a speed change restarts these.
  const ffmpeg = encode(['-i', 'pipe:0', ...filters(options)], ytdlp.stdout);
  return {
    stream: ffmpeg.stdout,
    kill: () => {
      ytdlp.kill('SIGKILL');
      ffmpeg.kill('SIGKILL');
    },
  };
}

export const ytdlpEnabled = () => Boolean(config.ytdlp);
