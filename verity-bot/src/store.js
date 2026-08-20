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
      faq: [],
      dj: { users: [], roles: [] },
      playlists: {},
    };
    save();
  }
  // Backfill any setting added in a later version of the bot.
  guild.settings = { ...config.defaults, ...guild.settings };
  guild.protected ??= [];
  guild.faq ??= [];
  guild.dj ??= { users: [], roles: [] };
  guild.dj.users ??= [];
  guild.dj.roles ??= [];
  guild.playlists ??= {};
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

/** Canned answers, newest last. Triggers are matched loosely — see faq.js. */
export function addAnswer(guildId, triggers, answer) {
  const entry = { triggers, answer, added: Date.now(), hits: 0 };
  getGuild(guildId).faq.push(entry);
  save();
  return entry;
}

export function removeAnswer(guildId, index) {
  const faq = getGuild(guildId).faq;
  if (index < 0 || index >= faq.length) return null;
  const [removed] = faq.splice(index, 1);
  save();
  return removed;
}

export const listAnswers = (guildId) => getGuild(guildId).faq;

/** Bump the hit counter so you can see which ones are earning their place. */
export function countAnswerHit(entry) {
  entry.hits = (entry.hits ?? 0) + 1;
  save();
}

/**
 * Who may use the music commands. An empty list means everyone can — the DJ
 * list only starts restricting once something is on it.
 */
export function addDj(guildId, { userId, roleId }) {
  const dj = getGuild(guildId).dj;
  if (userId && !dj.users.includes(userId)) dj.users.push(userId);
  if (roleId && !dj.roles.includes(roleId)) dj.roles.push(roleId);
  save();
  return dj;
}

export function removeDj(guildId, { userId, roleId }) {
  const dj = getGuild(guildId).dj;
  if (userId) dj.users = dj.users.filter((id) => id !== userId);
  if (roleId) dj.roles = dj.roles.filter((id) => id !== roleId);
  save();
  return dj;
}

export const listDj = (guildId) => getGuild(guildId).dj;

export function clearDj(guildId) {
  const dj = getGuild(guildId).dj;
  const had = dj.users.length + dj.roles.length;
  dj.users = [];
  dj.roles = [];
  save();
  return had;
}

/**
 * Saved playlists. Only what is needed to rebuild a track is kept — its title
 * and where it came from — because a queued track is a live thing with child
 * processes attached and none of that survives being written to disk.
 */
export function savePlaylist(guildId, name, entries, by) {
  getGuild(guildId).playlists[name.toLowerCase()] = {
    name,
    entries,
    by,
    saved: Date.now(),
  };
  save();
  return entries.length;
}

export const getPlaylist = (guildId, name) => getGuild(guildId).playlists[String(name).toLowerCase()] ?? null;
export const listPlaylists = (guildId) => Object.values(getGuild(guildId).playlists);

export function deletePlaylist(guildId, name) {
  const playlists = getGuild(guildId).playlists;
  const key = String(name).toLowerCase();
  const existed = Boolean(playlists[key]);
  delete playlists[key];
  save();
  return existed;
}

/** Flush pending writes on shutdown. */
export function shutdown() {
  if (writeTimer) clearTimeout(writeTimer);
  flush();
}
