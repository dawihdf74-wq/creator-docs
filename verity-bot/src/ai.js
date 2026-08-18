import { config } from './config.js';
import * as throttle from './throttle.js';
import * as anthropic from './providers/anthropic.js';
import * as openaiCompatible from './providers/openai.js';

/**
 * Verity does not care where his thoughts come from. Everything above this
 * file — persona, moods, memory, commands — is provider-agnostic; this is
 * the only place that knows which API is answering.
 */
const provider = config.provider === 'openai' ? openaiCompatible : anthropic;

export async function speak(options) {
  try {
    const result = await provider.speak(options);
    throttle.succeeded();
    return result;
  } catch (error) {
    if (error?.status === 429) throttle.rateLimited(error);
    throw error;
  }
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
