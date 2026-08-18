/**
 * Discord hard-caps a message at 2000 characters. Break longer replies on a
 * line break where possible, a word boundary otherwise, and only mid-word as
 * a last resort.
 *
 * @param {string} text
 * @param {number} [limit]
 * @returns {string[]}
 */
export function splitMessage(text, limit = 2000) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
