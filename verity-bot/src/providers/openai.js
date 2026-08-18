import OpenAI from 'openai';
import { config } from '../config.js';
import { buildSystemPrompt } from '../persona.js';

/**
 * Any OpenAI-compatible chat-completions endpoint: Google Gemini, Groq,
 * OpenRouter, Cerebras, Mistral, GitHub Models, a local Ollama, or OpenAI
 * itself. Set VERITY_BASE_URL, VERITY_API_KEY and VERITY_MODEL to pick one.
 */
let client;
function getClient() {
  if (!client) {
    if (!config.apiKey) {
      throw new Error('VERITY_API_KEY is not set — Verity has no way to reach the model.');
    }
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      // Retries 429s and 5xx with backoff, honouring retry-after. Kept low
      // on purpose: a burst of retries feeds the same limit we are dodging,
      // and throttle.js handles the sustained case.
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  return client;
}

export async function speak({
  mood,
  messages,
  guildName,
  channelName,
  extra,
  maxTokens = config.maxTokens,
}) {
  // These endpoints take one plain system string, so the cached-prefix split
  // that Anthropic uses gets flattened back into a single message.
  const system = buildSystemPrompt({ mood, guildName, channelName, extra })
    .map((block) => block.text)
    .join('\n\n');

  const completion = await getClient().chat.completions.create({
    // Gemini lists its models as "models/gemini-…" but wants the bare id here.
    model: config.model.replace(/^models\//, ''),
    max_tokens: maxTokens,
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    messages: [{ role: 'system', content: system }, ...messages],
  });

  const choice = completion.choices?.[0];
  const text = choice?.message?.content?.trim() ?? '';
  const refused = Boolean(choice?.message?.refusal) || choice?.finish_reason === 'content_filter';

  return { text, refused: refused && !text, usage: completion.usage };
}

export const listModels = async () => (await getClient().models.list()).data;
