/**
 * Says a thing at most once per window per channel.
 *
 * Verity repeating "too many of you at once" after every single message is
 * worse than him saying nothing: the failure is already obvious, and the
 * repetition is just more noise on top of it.
 */
const lastSaid = new Map();

/**
 * @returns {boolean} true if the caller should actually send the message
 */
export function shouldSay(channelId, kind, windowMs = 5 * 60_000) {
  const key = `${channelId}:${kind}`;
  const now = Date.now();
  if (now - (lastSaid.get(key) ?? 0) < windowMs) return false;
  lastSaid.set(key, now);
  return true;
}

export const forget = (channelId, kind) => lastSaid.delete(`${channelId}:${kind}`);
