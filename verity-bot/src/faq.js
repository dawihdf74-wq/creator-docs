/**
 * Canned answers to the questions your server asks constantly.
 *
 * A match costs nothing: no model call, no quota, no waiting for a laptop to
 * think. Verity answers instantly and stays in character, which is usually
 * better than a small model improvising over the same question for the
 * fortieth time.
 */

const normalise = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/<@!?\d+>/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words too common to carry a match on their own. */
const NOISE = new Set([
  'the',
  'a',
  'an',
  'is',
  'do',
  'i',
  'to',
  'of',
  'you',
  'me',
  'it',
  'whats',
  'what',
]);

/**
 * An entry matches when every meaningful word of one of its triggers appears
 * in the message, in any order — so "server ip" answers "yo whats the ip for
 * the server again".
 *
 * @param {{triggers: string[], answer: string}[]} entries
 * @param {string} text
 */
export function match(entries, text) {
  const message = normalise(text);
  if (!message) return null;
  const words = new Set(message.split(' '));

  // Longest trigger first: a specific entry should win over a vague one.
  const ranked = entries
    .flatMap((entry) => entry.triggers.map((trigger) => ({ entry, trigger: normalise(trigger) })))
    .filter(({ trigger }) => trigger)
    .sort((a, b) => b.trigger.length - a.trigger.length);

  for (const { entry, trigger } of ranked) {
    if (message.includes(trigger)) return entry;

    const needed = trigger.split(' ').filter((word) => !NOISE.has(word));
    if (needed.length && needed.every((word) => words.has(word))) return entry;
  }
  return null;
}

/** `{user}` becomes whoever asked. */
export const fill = (answer, name) => String(answer).replaceAll('{user}', name);

export { normalise };
