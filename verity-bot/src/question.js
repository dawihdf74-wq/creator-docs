/**
 * Is this message actually asking Verity something?
 *
 * Used by questions-only mode, where he answers questions and otherwise keeps
 * out of the conversation — worth having when each reply costs a request, or
 * several seconds of a laptop's CPU.
 */
const OPENERS =
  /^(what|whats|what's|how|how's|why|who|whos|who's|where|when|which|can|could|would|will|should|do|does|did|is|are|am|was|were|has|have|any|anyone|tell me|explain|help|whats?up)\b/i;

export function looksLikeQuestion(text) {
  const clean = String(text ?? '')
    // Drop mentions and his name so "verity how do i..." still reads as a question.
    .replace(/<@!?\d+>/g, '')
    .replace(/\bverity('?s)?\b/gi, '')
    .trim();

  if (!clean) return false;
  if (clean.includes('?')) return true;
  return OPENERS.test(clean);
}
