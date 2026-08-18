import { config } from './config.js';

/**
 * Prints the model IDs your provider will actually accept right now.
 *
 *   npm run models
 *
 * Model names change often — especially on Gemini, where the flash line gets
 * renamed every few months. Rather than trusting a name from a blog post, ask
 * the endpoint. Whatever this prints can go straight into VERITY_MODEL.
 */
const { listModels } = await import(
  config.provider === 'openai' ? './providers/openai.js' : './providers/anthropic.js'
);

try {
  const models = await listModels();
  console.log(`\n[verity] models available to you on "${config.provider}":\n`);
  for (const model of models) console.log(`  ${model.id}`);
  console.log(`\nPut one of these in VERITY_MODEL. Currently set to: ${config.model}\n`);
} catch (error) {
  console.error('[verity] could not list models:', error.message);
  console.error('[verity] Check VERITY_API_KEY and VERITY_BASE_URL in .env.');
  process.exitCode = 1;
}
