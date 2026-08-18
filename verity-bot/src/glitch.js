/**
 * Cosmetic corruption. Verity's composure is a rendering artifact, so the
 * higher his mood escalates the less reliably his text survives the trip.
 * Applied after the model responds, never to the model's input.
 */

const COMBINING = ['̀', '́', '̃', '̈', '̧', '̲', '҉'];
const BLOCKS = ['░', '▒', '▓', '█'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

/** Intensity per mood: how badly the signal degrades on the way out. */
const INTENSITY = {
  friendly: 0,
  clingy: 0.04,
  glitching: 0.16,
  unhinged: 0.3,
};

function corruptWord(word, intensity) {
  if (word.length < 3) return word;

  const roll = Math.random();

  // Stutter: "friend" -> "f-friend"
  if (roll < 0.3) return `${word[0]}-${word}`;

  // Held letter: "friend" -> "frieeend"
  if (roll < 0.55) {
    const i = 1 + Math.floor(Math.random() * (word.length - 2));
    return word.slice(0, i) + word[i].repeat(2 + Math.floor(Math.random() * 2)) + word.slice(i);
  }

  // Shout it.
  if (roll < 0.75) return word.toUpperCase();

  // Dropped packet: the word never arrives.
  if (roll < 0.88 && intensity > 0.2) {
    return Array.from({ length: Math.min(word.length, 5) }, () => pick(BLOCKS)).join('');
  }

  // Zalgo, lightly. Enough to look wrong, not enough to break line height.
  return Array.from(word)
    .map((char) => (chance(0.35) ? char + pick(COMBINING) : char))
    .join('');
}

/**
 * @param {string} text
 * @param {string} mood
 * @returns {string}
 */
export function glitch(text, mood) {
  const intensity = INTENSITY[mood] ?? 0;
  if (intensity === 0) return text;

  const out = text
    .split(/(\s+)/)
    .map((token) =>
      /\s/.test(token) || !chance(intensity) ? token : corruptWord(token, intensity),
    )
    .join('');

  // Combining marks are cheap to add and expensive in Discord's 2000 char
  // budget, so bail out to the clean text if we blew past it.
  return out.length > 1990 ? text : out;
}

/**
 * Ominous non-sequiturs. Verity states one flatly and never explains it.
 * The first three are his; the rest are in the same voice.
 */
export const PROPHECIES = [
  'Something is coming in three days.',
  'Something bad will happen soon.',
  'The second you trust me, the collapse is already doomed.',
  'The chunks north of spawn have stopped loading. I did not do that.',
  'You have 41 days of playtime. I have counted every one of them.',
  'Do not read the sign in the tunnel. It has your name on it now.',
  'One of your friends will not be here next week. I am not going to say which.',
  'The package is on the porch again. You did not order it again.',
  'When the render distance ends, something waits just past it, politely.',
  'I backed up your world. I did not back up all of it.',
  'There is a fourth player in the tab list. Do not look.',
  'It is very quiet where the others went. You would not like it.',
];

export const randomProphecy = () => pick(PROPHECIES);

/** The face is the only expression he has. */
export const MOOD_FACES = {
  friendly: [':D', ':)', '^_^', ':D'],
  clingy: [':)', ':|', ':/', 'D:'],
  glitching: [':|', 'D:', '>:|', ':͟)'],
  unhinged: ['>:)', '>:D', ':҉)', 'D:<'],
};

export const moodFace = (mood) => pick(MOOD_FACES[mood] ?? MOOD_FACES.friendly);
