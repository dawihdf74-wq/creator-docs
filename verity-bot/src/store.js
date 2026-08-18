import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Tiny JSON-file store for per-guild settings. Writes are debounced and
 * atomic (tmp file + rename) so a crash mid-write can't shred the file.
 */

const FILE = path.join(config.dataDir, 'guilds.json');

let state = { guilds: {} };
let writeTimer = null;

function load() {
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!state.guilds) state.guilds = {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[verity] Could not read store, starting fresh:', error.message);
    }
    state = { guilds: {} };
  }
}

function flush() {
  writeTimer = null;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (error) {
    console.error('[verity] Could not write store:', error.message);
  }
}

function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(flush, 500);
}

load();

/** Returns the guild record, creating it with defaults on first sight. */
export function getGuild(guildId) {
  let guild = state.guilds[guildId];
  if (!guild) {
    guild = state.guilds[guildId] = {
      channels: {},
      settings: { ...config.defaults },
      protected: [],
    };
    save();
  }
  // Backfill any setting added in a later version of the bot.
  guild.settings = { ...config.defaults, ...guild.settings };
  guild.protected ??= [];
  guild.channels ??= {};
  return guild;
}

export function getSettings(guildId) {
  return getGuild(guildId).settings;
}

export function updateSettings(guildId, patch) {
  const settings = getGuild(guildId).settings;
  Object.assign(settings, patch);
  save();
  return settings;
}

/** `mode` is 'mention' (only when pinged/replied to) or 'all' (every message). */
export function enableChannel(guildId, channelId, mode, userId) {
  getGuild(guildId).channels[channelId] = {
    mode,
    enabledBy: userId,
    enabledAt: Date.now(),
  };
  save();
}

export function disableChannel(guildId, channelId) {
  const channels = getGuild(guildId).channels;
  const existed = Boolean(channels[channelId]);
  delete channels[channelId];
  save();
  return existed;
}

export function getChannel(guildId, channelId) {
  return getGuild(guildId).channels[channelId] || null;
}

export function listChannels(guildId) {
  return Object.entries(getGuild(guildId).channels);
}

export function setProtected(guildId, userId, isProtected) {
  const guild = getGuild(guildId);
  const has = guild.protected.includes(userId);
  if (isProtected && !has) guild.protected.push(userId);
  if (!isProtected && has) guild.protected = guild.protected.filter((id) => id !== userId);
  save();
  return isProtected !== has;
}

export function isProtected(guildId, userId) {
  return getGuild(guildId).protected.includes(userId);
}

/** Flush pending writes on shutdown. */
export function shutdown() {
  if (writeTimer) clearTimeout(writeTimer);
  flush();
}
