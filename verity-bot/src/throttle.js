import { config } from './config.js';

/**
 * Keeps Verity under the model provider's rate limit instead of discovering
 * it one 429 at a time.
 *
 * Two parts:
 *  - a sliding window that caps requests per minute across the whole bot
 *  - a cooling-off period that kicks in when the provider rate-limits us
 *    anyway, so a burst of angry messages doesn't turn into a burst of
 *    identical apologies
 */
const calls = [];
let coolingUntil = 0;
let consecutive429s = 0;

const MINUTE = 60_000;

/** Is he allowed to make a model call right now? Records it if so. */
export function take() {
  const now = Date.now();
  if (now < coolingUntil) return false;

  while (calls.length && now - calls[0] > MINUTE) calls.shift();
  if (calls.length >= config.maxRpm) return false;

  calls.push(now);
  return true;
}

/** How long until he can speak again, in seconds. */
export function waitSeconds() {
  const now = Date.now();
  if (now < coolingUntil) return Math.ceil((coolingUntil - now) / 1000);
  if (!calls.length) return 0;
  return Math.max(1, Math.ceil((MINUTE - (now - calls[0])) / 1000));
}

/**
 * The provider said no. Back off hard and get further out of the way each
 * time it happens in a row — a daily quota that has run out will not recover
 * in sixty seconds, and hammering it helps nobody.
 */
export function rateLimited(error) {
  consecutive429s += 1;
  const retryAfter = Number(
    error?.headers?.['retry-after'] ?? error?.headers?.get?.('retry-after'),
  );
  const backoff =
    Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30 * MINUTE, MINUTE * 2 ** (consecutive429s - 1));

  coolingUntil = Date.now() + backoff;
  console.warn(
    `[verity] rate limited by the model provider (${consecutive429s} in a row) — going quiet for ${Math.round(backoff / 1000)}s`,
  );
}

/** A call went through, so whatever we were backing off from has passed. */
export function succeeded() {
  consecutive429s = 0;
}

export const isCooling = () => Date.now() < coolingUntil;
