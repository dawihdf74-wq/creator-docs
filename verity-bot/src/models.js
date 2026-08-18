import { config } from './config.js';

/**
 * A fallback chain of model names.
 *
 * Free tiers meter per model — gemini-3.6-flash allows twenty requests a day,
 * and once they are gone that model is simply closed for the night. Rather
 * than going silent, Verity steps down the list and keeps talking on whatever
 * still has budget.
 *
 * VERITY_MODEL takes a comma-separated list, best first.
 */
const exhausted = new Map();

export const all = () => config.models;

/** The first model that is not currently rate limited, or the first one. */
export function current() {
  const now = Date.now();
  return config.models.find((model) => (exhausted.get(model) ?? 0) <= now) ?? config.models[0];
}

/** Models still worth trying this minute, in preference order. */
export function available() {
  const now = Date.now();
  return config.models.filter((model) => (exhausted.get(model) ?? 0) <= now);
}

/**
 * Take a model out of rotation. Google returns a retryDelay on quota errors;
 * a daily quota reports a short one and then refuses again, so the floor is
 * generous enough not to spend the whole allowance rediscovering that.
 */
export function penalise(model, seconds) {
  const wait = Math.max(Number(seconds) || 0, 60) * 1000;
  exhausted.set(model, Date.now() + wait);
  const next = available()[0];
  console.warn(
    `[verity] ${model} is out of budget for ${Math.round(wait / 1000)}s` +
      (next && next !== model ? ` — falling back to ${next}` : ' — nothing left to fall back to'),
  );
}

/** Pull the retry delay and the daily limit out of a Google quota error. */
export function readQuotaError(error) {
  const body = JSON.stringify(error?.error ?? error?.message ?? '');
  const retry = body.match(/retry in ([\d.]+)s/i) ?? body.match(/"retryDelay":\s*"(\d+)s"/);
  const limit = body.match(/limit:\s*(\d+)/);
  const perDay = /PerDay/i.test(body);
  return {
    retrySeconds: retry ? Math.ceil(Number(retry[1])) : null,
    limit: limit ? Number(limit[1]) : null,
    perDay,
  };
}

export const release = (model) => exhausted.delete(model);
