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
 * A track is `{ title, requestedBy, open() }`, where open() returns
 * `{ stream, kill }` — the kill is important: every source here is a child
 * process, and a skipped song has to stop costing CPU immediately.
 */
const sessions = new Map();

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
    idleTimer: null,
    onEvent: () => {},
  };

  player.on(AudioPlayerStatus.Idle, () => {
    existing.current?.kill?.();
    existing.current = null;
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

function advance(state) {
  clearTimeout(state.idleTimer);

  const next = state.queue.shift();
  if (!next) {
    state.onEvent({ type: 'empty' });
    // Nothing left: give it a few minutes, then stop occupying the channel.
    state.idleTimer = setTimeout(() => leave(state.guildId), IDLE_MS);
    state.idleTimer.unref?.();
    return;
  }

  try {
    const { stream, kill } = next.open();
    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    state.current = { track: next, kill };
    state.player.play(resource);
    state.onEvent({ type: 'playing', track: next });
  } catch (error) {
    state.onEvent({ type: 'error', message: error.message, track: next });
    advance(state);
  }
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
    // A move or a blip looks the same at first; wait to see which it was.
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
  return state;
}

export function enqueue(guildId, track) {
  const state = session(guildId);
  state.queue.push(track);

  const idle = state.player.state.status === AudioPlayerStatus.Idle;
  if (idle && !state.current) {
    advance(state);
    return { position: 0 };
  }
  return { position: state.queue.length };
}

export function skip(guildId) {
  const state = sessions.get(guildId);
  const skipped = state?.current?.track ?? null;
  state?.player.stop(true); // Idle fires, which advances the queue
  return skipped;
}

export function stop(guildId) {
  const state = sessions.get(guildId);
  if (!state) return 0;
  const dropped = state.queue.length;
  state.queue.length = 0;
  state.player.stop(true);
  return dropped;
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

/** Test seam: swap the queue internals without a Discord connection. */
export const __sessions = sessions;
