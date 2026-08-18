import { config } from './config.js';
import { decayMood } from './persona.js';

/**
 * Per-channel conversation state. Deliberately in-memory: Verity forgetting
 * everything when he restarts is both cheap and in character.
 *
 * @typedef {{messages: import('@anthropic-ai/sdk').Anthropic.MessageParam[],
 *            mood: string, lastActivity: number, lastReply: number}} Session
 */
const sessions = new Map();

/** @returns {Session} */
export function getSession(channelId, fallbackMood = 'friendly') {
  let session = sessions.get(channelId);
  if (!session) {
    session = { messages: [], mood: fallbackMood, lastActivity: Date.now(), lastReply: 0 };
    sessions.set(channelId, session);
  }
  // Left alone long enough, he settles back down on his own.
  session.mood = decayMood(session.mood, Date.now() - session.lastActivity);
  return session;
}

export function remember(channelId, role, content) {
  const session = getSession(channelId);
  session.messages.push({ role, content });
  session.lastActivity = Date.now();

  const limit = config.memoryTurns;
  if (session.messages.length > limit) {
    session.messages = session.messages.slice(-limit);
    // The API requires the first message to be from the user.
    while (session.messages.length && session.messages[0].role !== 'user') {
      session.messages.shift();
    }
  }
}

export function forget(channelId) {
  const had = sessions.get(channelId)?.messages.length ?? 0;
  sessions.delete(channelId);
  return had;
}

export function setMood(channelId, mood) {
  getSession(channelId).mood = mood;
}

export function markReplied(channelId) {
  getSession(channelId).lastReply = Date.now();
}

export const sessionCount = () => sessions.size;
