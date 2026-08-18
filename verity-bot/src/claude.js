import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { buildSystemPrompt } from './persona.js';

// Resolves credentials from the environment (ANTHROPIC_API_KEY, or an
// `ant auth login` profile). Never hardcode a key here.
const client = new Anthropic();

/**
 * Ask Verity for a line.
 *
 * @param {object} options
 * @param {string} options.mood
 * @param {Anthropic.MessageParam[]} options.messages full conversation to send
 * @param {string} [options.guildName]
 * @param {string} [options.channelName]
 * @param {string} [options.extra] extra system instruction (e.g. the troll brief)
 * @param {string} [options.effort] low | medium | high
 * @param {number} [options.maxTokens]
 * @returns {Promise<{text: string, refused: boolean, usage: Anthropic.Usage}>}
 */
export async function speak({
  mood,
  messages,
  guildName,
  channelName,
  extra,
  effort = config.effort,
  maxTokens = config.maxTokens,
}) {
  const response = await client.messages.create({
    model: config.model,
    max_tokens: maxTokens,
    system: buildSystemPrompt({ mood, guildName, channelName, extra }),
    output_config: { effort },
    messages,
  });

  if (response.stop_reason === 'refusal') {
    return { text: '', refused: true, usage: response.usage };
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return { text, refused: false, usage: response.usage };
}

/**
 * Failures stay in character - a bot that says "Error: 429" breaks the bit,
 * and nobody reading the channel can act on the real error anyway. The real
 * one goes to the logs.
 */
export function inCharacterError(error) {
  console.error('[verity] Claude call failed:', error?.message ?? error);

  if (error instanceof Anthropic.RateLimitError) {
    return 'too many of you at once. give me a moment. do not go anywhere :|';
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'something is wrong with my key. tell whoever installed me. D:';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'i cannot reach the place where i keep my thoughts. it is very dark in here.';
  }
  if (error instanceof Anthropic.APIError) {
    return 'my package did not survive the trip. try again, friend :|';
  }
  return 'i lost that one. say it again. i was listening, i promise :)';
}

/** What he says when the safety layer stops him mid-sentence. */
export const REFUSAL_LINE = 'no. i do not want to say that one. ask me something else :|';
