import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildSystemPrompt } from '../persona.js';

// Built on first use so the module can be imported without credentials.
// Resolves them from the environment (ANTHROPIC_API_KEY, or an `ant auth
// login` profile). Never hardcode a key here.
let client;
const getClient = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 }));

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
  const response = await getClient().messages.create({
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

export const listModels = async () => (await getClient().models.list()).data;
