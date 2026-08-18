/**
 * Verity answers to his name. Word-boundary matched and case-insensitive, so
 * "verity", "Verity!" and "hey verity?" all reach him, while "severity" and
 * "veritys" do not.
 */
const NAME = /\bverity('?s)?\b/i;

export const mentionsName = (content) => NAME.test(content ?? '');
