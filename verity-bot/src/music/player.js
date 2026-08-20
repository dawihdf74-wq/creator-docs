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
 * Every track gets an id that stays with it.
 *
 * Queue positions move constantly — one press reorders everything below it —
 * so anything the user clicked has to be identified by what it *is*, not
 * where it happened to be sitting when the message was drawn.
 */
let counter = 0;
const identify = (track) => {
  track.id ??= `t${(counter += 1)}`;
  return track;
};

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
    lastPlayed: null,
    history: [],
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
    // A track can carry its own speed, set when someone lined it up.
    speed: track.speed ?? state.speed,
    volume: state.volume,
    bitrate: state.bitrate,
    seek,
  });
  const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
  state.current = { track, kill };
  state.lastPlayed = track;
  // Kept so autoplay does not immediately suggest what just finished.
  state.history = [track, ...state.history.filter((old) => old.id !== track.id)].slice(0, 30);
  state.resource = resource;
  state.seekBase = seek;
  state.player.play(resource);
}

function advance(state) {
  clearTimeout(state.idleTimer);

  const next = state.queue.shift();
  if (!next) {
    state.onEvent({ type: 'empty', last: state.lastPlayed, history: state.history });
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
  const rate = state.current?.track?.speed ?? state.speed;
  return state.seekBase + played * rate;
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
  state.queue.push(identify(track));

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
  state.queue.push(...tracks.map(identify));
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
/**
 * Moves a queued track to the front, so it plays next, optionally at a speed
 * of its own. Returns the track, or null if there is nothing at that number.
 */
export function moveToFront(guildId, position, speed = null) {
  const queue = sessions.get(guildId)?.queue;
  if (!queue || position < 1 || position > queue.length) return null;

  const [track] = queue.splice(position - 1, 1);
  if (speed) track.speed = speed;
  queue.unshift(track);
  return track;
}

/**
 * The same, but for a track the user picked out of a list. Positions shift
 * under people; an id does not.
 */
export function moveToFrontById(guildId, id, speed = null) {
  const queue = sessions.get(guildId)?.queue;
  const index = queue?.findIndex((track) => track.id === id) ?? -1;
  if (index < 0) return null;
  return moveToFront(guildId, index + 1, speed);
}

/** Skips straight to a queued track, dropping everything in front of it. */
export function jumpTo(guildId, position) {
  const state = sessions.get(guildId);
  const queue = state?.queue;
  if (!queue || position < 1 || position > queue.length) return null;

  const skipped = queue.splice(0, position - 1).length;
  const track = queue[0];
  const loop = state.loop;
  state.loop = 'off'; // do not loop the track we are jumping away from
  state.player.stop(true);
  state.loop = loop;
  return { track, skipped };
}

/** Sets (or clears) the speed for one queued track. */
export function setTrackSpeed(guildId, position, speed) {
  const queue = sessions.get(guildId)?.queue;
  if (!queue || position < 1 || position > queue.length) return null;
  const track = queue[position - 1];
  track.speed = speed || null;
  return track;
}

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
export const lastPlayed = (guildId) => sessions.get(guildId)?.lastPlayed ?? null;
export const history = (guildId) => [...(sessions.get(guildId)?.history ?? [])];
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
