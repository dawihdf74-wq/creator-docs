import { config } from './config.js';
import * as throttle from './throttle.js';
import * as models from './models.js';
import * as anthropic from './providers/anthropic.js';
import * as openaiCompatible from './providers/openai.js';

/**
 * Verity does not care where his thoughts come from. Everything above this
 * file — persona, moods, memory, commands — is provider-agnostic; this is
 * the only place that knows which API is answering.
 */
const provider = () => (config.provider === 'openai' ? openaiCompatible : anthropic);

export async function speak(options) {
  // Try each model that still has budget, best first. Only when every one of
  // them is spent does Verity actually go quiet.
  const chain = models.available();
  let lastError;

  for (const model of chain.length ? chain : [models.all()[0]]) {
    try {
      const result = await provider().speak({ ...options, model });
      throttle.succeeded();
      return result;
    } catch (error) {
      lastError = error;
      if (error?.status !== 429) throw error;

      const { retrySeconds, limit, perDay } = models.readQuotaError(error);
      if (limit && perDay) {
        console.warn(
          `[verity] ${model}: the free tier allows ${limit} requests a day and today's are gone.`,
        );
      }
      models.penalise(model, retrySeconds);
    }
  }

  // Everything is spent — back the whole bot off, not just one model.
  throttle.rateLimited(lastError);
  throw lastError;
}

/**
 * Failures stay in character. A bot that says "Error: 429" breaks the bit and
 * nobody reading the channel can act on it anyway — the real error goes to the
 * logs. Both SDKs put an HTTP status on their errors, so one mapping covers
 * every provider.
 */
export function inCharacterError(error) {
  console.error('[verity] model call failed:', error?.message ?? error);

  const status = error?.status;
  if (status === 429) return 'too many of you at once. give me a moment. do not go anywhere :|';
  if (status === 401 || status === 403)
    return 'something is wrong with my key. tell whoever installed me. D:';
  if (status === 404)
    return 'that model is not there any more. run `npm run models` and pick one that is. :|';
  if (error?.name === 'APIConnectionError' || error?.name === 'APIConnectionTimeoutError') {
    return 'i cannot reach the place where i keep my thoughts. it is very dark in here.';
  }
  if (typeof status === 'number')
    return 'my package did not survive the trip. try again, friend :|';
  return 'i lost that one. say it again. i was listening, i promise :)';
}

/** What he says when the safety layer stops him mid-sentence. */
export const REFUSAL_LINE = 'no. i do not want to say that one. ask me something else :|';
