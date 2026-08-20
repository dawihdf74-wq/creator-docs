import { config } from '../config.js';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';

/**
 * One queue per server, and the voice connection that plays it.
 *
 * A track is `{ title, requestedBy, seekable, open(options) }`, where open()
 * returns `{ stream, kill }`. The kill matters: every source is a child
 * process, and a skipped song has to stop costing CPU immediately.
 *
 * Speed and volume are applied by re-opening the source with an ffmpeg filter,
 * because Opus arrives already encoded and cannot be stretched afterwards.
 * Sources that can seek resume where they were; the rest start again.
 */
const sessions = new Map();

/**
 * What listeners actually receive is capped by the voice channel's own
 * bitrate — 64 kbps by default, more on a boosted server — so encoding above
 * it just burns CPU, and encoding below it throws away quality for nothing.
 * 'auto' follows the channel; a number (or "128k") overrides it.
 */
export function resolveBitrate(voiceChannel) {
  const setting = String(config.bitrate ?? 'auto').toLowerCase();
  const wanted =
    setting === 'auto'
      ? (voiceChannel?.bitrate ?? 64_000)
      : Number(setting.replace(/k$/, '')) * (setting.endsWith('k') ? 1000 : 1);

  if (!Number.isFinite(wanted)) return 64_000;
  return Math.min(510_000, Math.max(8_000, Math.round(wanted)));
}

/** Leave on his own after this long doing nothing, rather than idling forever. */
const IDLE_MS = 5 * 60 * 1000;

function session(guildId) {
  let existing = sessions.get(guildId);
  if (existing) return existing;

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  existing = {
    guildId,
    player,
    connection: null,
    queue: [],
    current: null,
    resource: null,
    seekBase: 0,
    speed: 1,
    volume: 1,
    bitrate: 64_000,
    loop: 'off', // off | track | queue
    restarting: false,
    idleTimer: null,
    onEvent: () => {},
  };

  player.on(AudioPlayerStatus.Idle, () => {
    // A restart stops the player on purpose; that is not the track ending.
    if (existing.restarting) return;

    const finished = existing.current?.track;
    existing.current?.kill?.();
    existing.current = null;
    existing.resource = null;
    existing.seekBase = 0;

    if (finished && existing.loop === 'track') existing.queue.unshift(finished);
    else if (finished && existing.loop === 'queue') existing.queue.push(finished);

    advance(existing);
  });

  player.on('error', (error) => {
    console.error('[verity] audio error:', error.message);
    existing.onEvent({ type: 'error', message: error.message, track: existing.current?.track });
    existing.current?.kill?.();
    existing.current = null;
    advance(existing);
  });

  sessions.set(guildId, existing);
  return existing;
}

function start(state, track, seek = 0) {
  const { stream, kill } = track.open({
    speed: state.speed,
    volume: state.volume,
    bitrate: state.bitrate,
    seek,
  });
  const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
  state.current = { track, kill };
  state.resource = resource;
  state.seekBase = seek;
  state.player.play(resource);
}

function advance(state) {
  clearTimeout(state.idleTimer);

  const next = state.queue.shift();
  if (!next) {
    state.onEvent({ type: 'empty' });
    state.idleTimer = setTimeout(() => leave(state.guildId), IDLE_MS);
    state.idleTimer.unref?.();
    return;
  }

  try {
    start(state, next);
    state.onEvent({ type: 'playing', track: next });
    prefetch(state);
  } catch (error) {
    state.onEvent({ type: 'error', message: error.message, track: next });
    advance(state);
  }
}

/**
 * Resolves the next track while this one plays, so its several seconds of
 * page-fetching are spent during music rather than during silence.
 */
function prefetch(state) {
  const next = state.queue[0];
  if (!next?.prepare || next.prepared) return;
  next.prepared = true;
  Promise.resolve(next.prepare()).catch((error) => {
    // A failed prefetch is not a failed track: it just plays the slow way.
    next.prepared = false;
    console.error('[verity] could not prepare the next track:', error.message);
  });
}

/** How far into the source we are, in seconds, allowing for playback speed. */
function elapsed(state) {
  const played = (state.resource?.playbackDuration ?? 0) / 1000;
  return state.seekBase + played * state.speed;
}

/** Connects to a voice channel, reusing the connection if he is already there. */
export async function join(voiceChannel, onEvent) {
  const state = session(voiceChannel.guild.id);
  state.onEvent = onEvent ?? state.onEvent;

  if (state.connection && state.connection.joinConfig.channelId === voiceChannel.id) {
    return state;
  }

  state.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // A move and a dropped connection look the same at first.
    try {
      await Promise.race([
        entersState(state.connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(state.connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      leave(state.guildId);
    }
  });

  await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
  state.connection.subscribe(state.player);
  state.bitrate = resolveBitrate(voiceChannel);
  return state;
}

export function enqueue(guildId, track) {
  const state = session(guildId);
  state.queue.push(track);

  if (!state.current && state.player.state.status === AudioPlayerStatus.Idle) {
    advance(state);
    return { position: 0 };
  }
  return { position: state.queue.length };
}

/** Adds a whole playlist, starting the first one if nothing is playing. */
export function enqueueAll(guildId, tracks) {
  const state = session(guildId);
  const startedEmpty = !state.current && state.player.state.status === AudioPlayerStatus.Idle;
  state.queue.push(...tracks);
  if (startedEmpty) advance(state);
  return { added: tracks.length, startedPlaying: startedEmpty };
}

export function skip(guildId) {
  const state = sessions.get(guildId);
  const skipped = state?.current?.track ?? null;
  // Skipping past a looping track should not loop it back round again.
  const loop = state?.loop;
  if (state) state.loop = 'off';
  state?.player.stop(true);
  if (state) state.loop = loop;
  return skipped;
}

export function stop(guildId) {
  const state = sessions.get(guildId);
  if (!state) return 0;
  const dropped = state.queue.length;
  state.queue.length = 0;
  state.loop = 'off';
  state.player.stop(true);
  return dropped;
}

export function pause(guildId) {
  return sessions.get(guildId)?.player.pause() ?? false;
}

export function resume(guildId) {
  return sessions.get(guildId)?.player.unpause() ?? false;
}

/**
 * Re-opens the current track through a new filter chain. Seekable sources
 * pick up where they were; piped ones start over.
 */
export function setSpeed(guildId, speed) {
  const state = session(guildId);
  state.speed = speed;
  return restart(state);
}

export function setVolume(guildId, volume) {
  const state = session(guildId);
  state.volume = volume;
  return restart(state);
}

function restart(state) {
  const track = state.current?.track;
  if (!track) return { restarted: false, resumedAt: 0 };

  const at = track.seekable ? elapsed(state) : 0;
  state.restarting = true;
  state.current.kill?.();
  state.player.stop(true);
  try {
    start(state, track, at);
  } finally {
    state.restarting = false;
  }
  return { restarted: true, resumedAt: at, fromStart: !track.seekable };
}

export function setLoop(guildId, mode) {
  const state = session(guildId);
  state.loop = mode;
  return mode;
}

export function shuffle(guildId) {
  const queue = sessions.get(guildId)?.queue;
  if (!queue?.length) return 0;
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue.length;
}

export function clear(guildId) {
  const state = sessions.get(guildId);
  const dropped = state?.queue.length ?? 0;
  if (state) state.queue.length = 0;
  return dropped;
}

/** Removes one queued track by its 1-based position, as shown in the queue. */
export function remove(guildId, position) {
  const queue = sessions.get(guildId)?.queue;
  if (!queue || position < 1 || position > queue.length) return null;
  return queue.splice(position - 1, 1)[0];
}

export function leave(guildId) {
  const state = sessions.get(guildId);
  if (!state) return false;

  clearTimeout(state.idleTimer);
  state.queue.length = 0;
  state.current?.kill?.();
  state.player.stop(true);
  try {
    state.connection?.destroy();
  } catch {
    // Already gone.
  }
  sessions.delete(guildId);
  return true;
}

export const nowPlaying = (guildId) => sessions.get(guildId)?.current?.track ?? null;
export const queued = (guildId) => [...(sessions.get(guildId)?.queue ?? [])];
export const isConnected = (guildId) => Boolean(sessions.get(guildId)?.connection);
export const settings = (guildId) => {
  const state = sessions.get(guildId);
  return {
    bitrate: state?.bitrate ?? 64_000,
    speed: state?.speed ?? 1,
    volume: state?.volume ?? 1,
    loop: state?.loop ?? 'off',
    paused: state?.player.state.status === AudioPlayerStatus.Paused,
    position: state ? elapsed(state) : 0,
  };
};

/** Test seam: reach the queue internals without a Discord connection. */
export const __sessions = sessions;
