/**
 * Per-person question budget. Free API tiers have a hard daily ceiling, and
 * one enthusiastic person can drain it before lunch — this keeps any single
 * member to a fixed number of answered questions per window.
 *
 * In memory only: a restart hands everyone a fresh budget. Counters are keyed
 * per guild, so someone's spending in one server doesn't follow them to another.
 */
const buckets = new Map();

const key = (guildId, userId) => `${guildId ?? 'dm'}:${userId}`;

function bucket(guildId, userId, windowMs) {
  const id = key(guildId, userId);
  const now = Date.now();
  let entry = buckets.get(id);
  if (!entry || now - entry.start >= windowMs) {
    entry = { used: 0, start: now };
    buckets.set(id, entry);
  }
  return entry;
}

/**
 * Does this person have budget left? Read-only — call spend() to actually
 * take one. A limit of 0 means unlimited.
 *
 * @returns {{allowed: boolean, used: number, remaining: number, resetsAt: number}}
 */
export function check(guildId, userId, limit, windowMs) {
  if (!limit) return { allowed: true, used: 0, remaining: Infinity, resetsAt: 0 };
  const entry = bucket(guildId, userId, windowMs);
  return {
    allowed: entry.used < limit,
    used: entry.used,
    remaining: Math.max(0, limit - entry.used),
    resetsAt: entry.start + windowMs,
  };
}

/** Take one question off their budget. Call this only when Verity actually answers. */
export function spend(guildId, userId, limit, windowMs) {
  if (!limit) return;
  bucket(guildId, userId, windowMs).used += 1;
}

/** Wipe someone's counter, or the whole guild's when userId is omitted. */
export function reset(guildId, userId) {
  if (userId) return buckets.delete(key(guildId, userId));
  let cleared = 0;
  for (const id of buckets.keys()) {
    if (id.startsWith(`${guildId}:`)) {
      buckets.delete(id);
      cleared += 1;
    }
  }
  return cleared;
}

/** Discord renders this as a live countdown. */
export const resetTimestamp = (resetsAt) => `<t:${Math.round(resetsAt / 1000)}:R>`;
