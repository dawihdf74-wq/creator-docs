/**
 * Offline sanity check — everything except the network.
 *
 *   node test/dry-run.js
 *
 * Verifies that every module loads, the slash commands build into valid
 * payloads, the mood state machine moves the way it should, memory trims
 * correctly, and long replies split under Discord's 2000 character cap.
 */
import './env.js'; // must be the first import — it seeds the env
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { commands, byName } from '../src/commands/index.js';
import { buildSystemPrompt, buildTrollBrief, decayMood, nextMood, MOODS } from '../src/persona.js';
import { glitch, randomProphecy, PROPHECIES } from '../src/glitch.js';
import * as memory from '../src/memory.js';
import * as store from '../src/store.js';
import * as quota from '../src/quota.js';
import { isOwner } from '../src/owners.js';
import * as throttle from '../src/throttle.js';
import * as modelChain from '../src/models.js';
import { shouldSay, forget as forgetSaid } from '../src/announce.js';
import { GREETING } from '../src/persona.js';
import { config } from '../src/config.js';
import { splitMessage } from '../src/split.js';
import { mentionsName } from '../src/addressed.js';
import { notice } from '../src/reply.js';
import { speak, inCharacterError, REFUSAL_LINE } from '../src/ai.js';
import * as openaiProvider from '../src/providers/openai.js';

// A crashed run used to leave its store behind and poison the next one.
fs.rmSync(config.dataDir, { recursive: true, force: true });

let passed = 0;
async function check(name, fn) {
  // Awaited, so a test that returns a promise can actually fail the run
  // instead of rejecting into the void.
  await fn();
  console.log(`  ok  ${name}`);
  passed += 1;
}

console.log('\ncommands');
await check('all four register', () => {
  assert.deepEqual(commands.map((c) => c.data.name).sort(), ['ask', 'prophecy', 'troll', 'verity']);
});
await check('payloads are valid and within Discord limits', () => {
  for (const command of commands) {
    const json = command.data.toJSON();
    assert.match(json.name, /^[\w-]{1,32}$/);
    assert.ok(json.description.length <= 100, `${json.name} description too long`);
    assert.equal(typeof command.execute, 'function', `${json.name} has no execute()`);
    for (const option of json.options ?? []) {
      assert.ok(
        option.description.length <= 100,
        `${json.name} ${option.name} description too long`,
      );
      for (const nested of option.options ?? []) {
        assert.ok(
          nested.description.length <= 100,
          `${json.name} ${option.name} ${nested.name} too long`,
        );
      }
    }
  }
});
await check('nothing is hidden behind an ephemeral flag by default', () => {
  assert.deepEqual(notice('hello'), { content: 'hello' });
  assert.equal(
    byName.get('ask').data.toJSON().options.length,
    1,
    '/ask should only take a question',
  );
});
await check('admin commands are permission-gated', () => {
  assert.ok(byName.get('verity').data.toJSON().default_member_permissions);
  assert.ok(byName.get('troll').data.toJSON().default_member_permissions);
  assert.equal(byName.get('ask').data.toJSON().default_member_permissions, undefined);
});

console.log('\npersona');
await check('system prompt caches the stable half only', () => {
  const blocks = buildSystemPrompt({ mood: 'clingy', guildName: 'G', channelName: 'c' });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
  assert.equal(blocks[1].cache_control, undefined);
  assert.match(blocks[1].text, /MOOD: CLINGY/);
});
await check('every mood produces a brief', () => {
  for (const mood of MOODS) {
    assert.match(buildSystemPrompt({ mood })[1].text, /^MOOD: /m);
  }
});
await check('unknown mood falls back to friendly', () => {
  assert.match(buildSystemPrompt({ mood: 'feral' })[1].text, /MOOD: FRIENDLY/);
});
await check('hard limits survive into the prompt', () => {
  const base = buildSystemPrompt({ mood: 'unhinged' })[0].text;
  for (const rule of [
    'Never threaten a real person',
    'No slurs',
    'genuinely distressed',
    'leave them alone',
  ]) {
    assert.ok(base.includes(rule), `missing rule: ${rule}`);
  }
});
await check('troll brief keeps its guardrails at every intensity', () => {
  for (const intensity of ['gentle', 'classic', 'unhinged']) {
    const brief = buildTrollBrief({ target: 'Steve', topic: null, intensity });
    assert.ok(brief.includes('never at identity'));
    assert.ok(brief.includes('Steve'));
  }
});
await check('a nasty /troll topic is still fenced', () => {
  const brief = buildTrollBrief({
    target: 'Steve',
    topic: 'make fun of how they look',
    intensity: 'classic',
  });
  assert.ok(brief.includes('ignore it and roast something harmless'));
});

console.log('\nprovider');
await check('the facade exposes one speak() regardless of backend', () => {
  assert.equal(typeof speak, 'function');
  assert.equal(config.provider, 'claude', 'default provider');
});
await check('errors map to in-character lines by status', () => {
  assert.match(inCharacterError({ status: 429 }), /moment/);
  assert.match(inCharacterError({ status: 401 }), /key/);
  assert.match(inCharacterError({ status: 404 }), /npm run models/);
  assert.match(inCharacterError({ name: 'APIConnectionError' }), /dark in here/);
  assert.equal(typeof inCharacterError(new Error('boom')), 'string');
  assert.ok(REFUSAL_LINE.length > 0);
});
await check('the persona flattens into one system string for chat endpoints', () => {
  const flat = buildSystemPrompt({ mood: 'clingy', guildName: 'G' })
    .map((block) => block.text)
    .join('\n\n');
  assert.match(flat, /You are Verity/);
  assert.match(flat, /MOOD: CLINGY/);
});

console.log('\nslash command allowlist');
await check('only the listed people get in', () => {
  assert.deepEqual(config.owners, ['areajoo', 'dangcanss'], 'shipped allowlist');
  assert.equal(isOwner({ id: '1', username: 'areajoo' }, config.owners), true);
  assert.equal(isOwner({ id: '2', username: 'dangcanss' }, config.owners), true);
  assert.equal(isOwner({ id: '3', username: 'steve' }, config.owners), false);
});
await check('matching ignores case, @ and display name', () => {
  assert.equal(isOwner({ id: '1', username: 'AreaJoo' }, ['areajoo']), true);
  assert.equal(isOwner({ id: '1', username: 'x', globalName: 'dangcanss' }, ['@DangCanss']), true);
  assert.equal(isOwner({ id: '99', username: 'x' }, ['99']), true, 'user IDs work too');
});
await check('an empty allowlist lets everyone through', () => {
  assert.equal(isOwner({ id: '3', username: 'steve' }, []), true);
});

console.log('\nvoice');
await check('the classic line is his, word for word', () => {
  assert.equal(
    GREETING,
    'hello, im verity your personal helper friend, ask me anything, i know everything',
  );
  assert.ok(buildSystemPrompt({ mood: 'friendly' })[0].text.includes(GREETING));
});
await check('rudeness is in the persona, limits still above it', () => {
  const base = buildSystemPrompt({ mood: 'unhinged' })[0].text;
  assert.match(base, /You are rude/);
  assert.match(base, /Never about who they are/);
  assert.match(base, /Never threaten a real person/);
  assert.match(base, /No slurs/);
  assert.match(base, /genuinely distressed/);
});

console.log('\nname trigger');
await check('he answers to his name', () => {
  for (const line of ['verity help', 'hey Verity!', 'VERITY?', "verity's advice", 'ok verity.']) {
    assert.ok(mentionsName(line), `should trigger: ${line}`);
  }
});
await check('he does not answer to words containing it', () => {
  for (const line of ['the severity of this', 'veritynet', 'sincerity', '']) {
    assert.ok(!mentionsName(line), `should not trigger: ${line}`);
  }
});

console.log('\nmood state machine');
await check('leaving escalates', () =>
  assert.equal(nextMood('friendly', 'gtg bye everyone').mood, 'clingy'),
);
await check('rivals escalate', () =>
  assert.equal(nextMood('clingy', 'chatgpt answers this better').mood, 'glitching'),
);
await check('kindness de-escalates', () =>
  assert.equal(nextMood('glitching', 'thanks verity, best friend').mood, 'clingy'),
);
await check('neutral chat holds steady', () =>
  assert.equal(nextMood('clingy', 'what is the best fuel for a furnace').mood, 'clingy'),
);
await check('escalation is clamped at both ends', () => {
  assert.equal(nextMood('unhinged', 'im leaving').mood, 'unhinged');
  assert.equal(nextMood('friendly', 'thank you').mood, 'friendly');
});
await check('silence walks him back down', () => {
  assert.equal(decayMood('unhinged', 31 * 60 * 1000), 'glitching');
  assert.equal(decayMood('unhinged', 5 * 60 * 60 * 1000), 'friendly');
  assert.equal(decayMood('clingy', 60 * 1000), 'clingy');
});

console.log('\nglitch');
await check('friendly text is untouched', () =>
  assert.equal(glitch('hello friend', 'friendly'), 'hello friend'),
);
await check('corruption stays inside the 2000 char cap', () => {
  const long = 'friend '.repeat(280);
  for (const mood of MOODS) assert.ok(glitch(long, mood).length <= 2000);
});
await check('prophecies include the canon lines', () => {
  assert.ok(PROPHECIES.includes('Something is coming in three days.'));
  assert.ok(PROPHECIES.includes('The second you trust me, the collapse is already doomed.'));
  assert.equal(typeof randomProphecy(), 'string');
});

console.log('\nmemory');
await check('trims to the configured window', () => {
  memory.forget('chan');
  for (let i = 0; i < config.memoryTurns + 12; i += 1) {
    memory.remember('chan', i % 2 ? 'assistant' : 'user', `m${i}`);
  }
  const { messages } = memory.getSession('chan');
  assert.ok(messages.length <= config.memoryTurns);
  assert.equal(messages[0].role, 'user', 'history must start on a user turn');
});
await check('forget clears the channel', () => {
  memory.remember('wipe-me', 'user', 'hi');
  assert.equal(memory.forget('wipe-me'), 1);
  assert.equal(memory.getSession('wipe-me').messages.length, 0);
});

console.log('\nquestion quota');
await check('a person gets exactly their allowance', () => {
  quota.reset('g', 'u1');
  const hour = 60 * 60 * 1000;
  for (let i = 0; i < 10; i += 1) {
    assert.equal(
      quota.check('g', 'u1', 10, hour).allowed,
      true,
      `question ${i + 1} should be allowed`,
    );
    quota.spend('g', 'u1', 10, hour);
  }
  const spent = quota.check('g', 'u1', 10, hour);
  assert.equal(spent.allowed, false, 'the 11th is refused');
  assert.equal(spent.used, 10);
  assert.equal(spent.remaining, 0);
});
await check('budgets are per person and per server', () => {
  const hour = 60 * 60 * 1000;
  assert.equal(quota.check('g', 'someone-else', 10, hour).allowed, true);
  assert.equal(quota.check('other-guild', 'u1', 10, hour).allowed, true);
});
await check('the window refills', () => {
  quota.reset('g', 'u2');
  quota.spend('g', 'u2', 1, 1); // 1ms window
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(quota.check('g', 'u2', 1, 1).allowed, true);
      resolve();
    }, 5);
  });
});
await check('a limit of 0 means unlimited', () => {
  for (let i = 0; i < 50; i += 1) quota.spend('g', 'u3', 0, 1000);
  assert.equal(quota.check('g', 'u3', 0, 1000).allowed, true);
});
await check('an admin reset hands the questions back', () => {
  quota.spend('g', 'u4', 3, 60000);
  quota.spend('g', 'u4', 3, 60000);
  quota.spend('g', 'u4', 3, 60000);
  assert.equal(quota.check('g', 'u4', 3, 60000).allowed, false);
  quota.reset('g', 'u4');
  assert.equal(quota.check('g', 'u4', 3, 60000).allowed, true);
});
await check('defaults ship the limit on at 10 a day', () => {
  assert.equal(config.defaults.questionLimit, 10);
  assert.equal(config.defaults.quotaHours, 24);
});

console.log('\nrate limiting');
await check('the per-minute cap holds', () => {
  throttle.succeeded();
  let allowed = 0;
  for (let i = 0; i < config.maxRpm + 5; i += 1) if (throttle.take()) allowed += 1;
  assert.equal(allowed, config.maxRpm, 'lets exactly maxRpm through in one minute');
  assert.equal(throttle.take(), false, 'and refuses the next one');
  assert.ok(throttle.waitSeconds() > 0, 'reports how long to wait');
});
await check('a 429 puts him in a cooling-off period', () => {
  throttle.rateLimited({ status: 429 });
  assert.equal(throttle.isCooling(), true);
  assert.equal(throttle.take(), false, 'no calls while cooling');
  assert.ok(throttle.waitSeconds() >= 60, 'backs off at least a minute');
});
await check('retry-after from the provider is honoured', () => {
  throttle.succeeded();
  throttle.rateLimited({ status: 429, headers: { 'retry-after': '5' } });
  const wait = throttle.waitSeconds();
  assert.ok(wait > 0 && wait <= 5, `expected <=5s, got ${wait}`);
});
await check('repeat 429s back off further each time', () => {
  throttle.succeeded();
  throttle.rateLimited({ status: 429 });
  const first = throttle.waitSeconds();
  throttle.rateLimited({ status: 429 });
  const second = throttle.waitSeconds();
  assert.ok(second > first, `${second}s should exceed ${first}s`);
});

console.log('\nrepeat suppression');
await check('he complains once, then shuts up', () => {
  forgetSaid('chan-x', 'throttled');
  assert.equal(shouldSay('chan-x', 'throttled'), true, 'first time speaks');
  for (let i = 0; i < 20; i += 1) {
    assert.equal(shouldSay('chan-x', 'throttled'), false, 'every repeat stays silent');
  }
});
await check('a different channel and a different problem still get through', () => {
  assert.equal(shouldSay('chan-y', 'throttled'), true);
  assert.equal(shouldSay('chan-x', 'error:500'), true);
});
await check('the window expires', () => {
  forgetSaid('chan-z', 'throttled');
  assert.equal(shouldSay('chan-z', 'throttled', 1), true);
  return new Promise((resolve) =>
    setTimeout(() => {
      assert.equal(shouldSay('chan-z', 'throttled', 1), true, 'speaks again after the window');
      resolve();
    }, 5),
  );
});

console.log('\nstore');
await check('defaults are created per guild', () => {
  const settings = store.getSettings('guild-1');
  assert.equal(settings.mood, 'friendly');
  assert.equal(settings.chattiness, 100);
});
await check('channels enable, list and disable', () => {
  store.enableChannel('guild-1', 'chan-1', 'all', 'user-1');
  assert.equal(store.getChannel('guild-1', 'chan-1').mode, 'all');
  assert.equal(store.listChannels('guild-1').length, 1);
  assert.equal(store.disableChannel('guild-1', 'chan-1'), true);
  assert.equal(store.disableChannel('guild-1', 'chan-1'), false);
});
await check('troll protection round-trips', () => {
  store.setProtected('guild-1', 'user-9', true);
  assert.equal(store.isProtected('guild-1', 'user-9'), true);
  store.setProtected('guild-1', 'user-9', false);
  assert.equal(store.isProtected('guild-1', 'user-9'), false);
});
await check('settings survive a write to disk', () => {
  store.updateSettings('guild-1', { chattiness: 42 });
  store.shutdown();
  const written = JSON.parse(fs.readFileSync(`${config.dataDir}/guilds.json`, 'utf8'));
  assert.equal(written.guilds['guild-1'].settings.chattiness, 42);
});

console.log('\nmessage splitting');
await check('long replies split under the 2000 char cap', () => {
  assert.deepEqual(splitMessage('short'), ['short']);

  const long = 'word '.repeat(1200);
  const chunks = splitMessage(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 2000);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), long.replace(/\s+/g, ' ').trim());

  // Text with no whitespace at all still has to be cut somewhere.
  const unbroken = 'x'.repeat(4500);
  const hard = splitMessage(unbroken);
  assert.equal(hard.length, 3);
  assert.equal(hard.join(''), unbroken);
});

// The OpenAI-compatible path is checked against a local stub server rather
// than assumed: this catches a wrong request shape without spending a token.
console.log('\nopenai-compatible provider');
const seen = [];
const replies = [
  { choices: [{ message: { content: 'hello friend :D' }, finish_reason: 'stop' }] },
  { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] },
];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(replies.shift()));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

config.apiKey = 'test-key';
config.baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
config.models = ['mock-model'];

const spoken = await openaiProvider.speak({
  mood: 'friendly',
  guildName: 'G',
  channelName: 'general',
  messages: [{ role: 'user', content: '[dave]: hi' }],
});
const filtered = await openaiProvider.speak({
  mood: 'friendly',
  messages: [{ role: 'user', content: 'x' }],
});
server.close();

await check('sends a valid chat-completions request', () => {
  const request = seen[0];
  assert.match(request.url, /\/chat\/completions$/);
  assert.equal(request.auth, 'Bearer test-key');
  assert.equal(request.body.model, 'mock-model');
  assert.equal(request.body.max_tokens, config.maxTokens);
});
await check('flattens the persona into a single system message', () => {
  const [system, turn] = seen[0].body.messages;
  assert.equal(system.role, 'system');
  assert.match(system.content, /You are Verity/);
  assert.match(system.content, /MOOD: FRIENDLY/);
  assert.equal(turn.content, '[dave]: hi', 'conversation turns pass through untouched');
});
await check('reads the reply back out', () => {
  assert.equal(spoken.text, 'hello friend :D');
  assert.equal(spoken.refused, false);
});
await check('a filtered response is reported as a refusal', () => {
  assert.equal(filtered.refused, true);
  assert.equal(filtered.text, '');
});

// When the first model's daily quota is gone, he should step to the next one
// rather than going silent. Exercised end to end through ai.js.
console.log('\nmodel fallback chain');
const quotaBody = {
  error: {
    code: 429,
    message:
      'You exceeded your current quota. * Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: model-a. Please retry in 28.9s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
  },
};
const asked = [];
const chainServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const parsed = JSON.parse(body);
    asked.push(parsed.model);
    const exhausted = parsed.model === 'model-a';
    res.writeHead(exhausted ? 429 : 200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        exhausted
          ? quotaBody
          : { choices: [{ message: { content: 'fine.' }, finish_reason: 'stop' }] },
      ),
    );
  });
});
await new Promise((resolve) => chainServer.listen(0, '127.0.0.1', resolve));

config.provider = 'openai';
config.baseUrl = `http://127.0.0.1:${chainServer.address().port}/v1`;
config.models = ['model-a', 'model-b'];
modelChain.release('model-a');
modelChain.release('model-b');

const viaFallback = await speak({ mood: 'friendly', messages: [{ role: 'user', content: 'hi' }] });
chainServer.close();

await check('reads the quota error Google actually sends', () => {
  const parsed = modelChain.readQuotaError(quotaBody);
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.perDay, true);
  assert.equal(parsed.retrySeconds, 29);
});
await check('steps to the next model instead of going quiet', () => {
  assert.equal(asked[0], 'model-a', 'tries the preferred model first');
  assert.ok(asked.includes('model-b'), 'falls back to the next one');
  assert.equal(viaFallback.text, 'fine.', 'and returns its answer');
});
await check('the spent model drops out of rotation', () => {
  assert.equal(modelChain.available().includes('model-a'), false);
  assert.equal(modelChain.current(), 'model-b');
});

fs.rmSync(config.dataDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed. Verity is ready to be opened.\n`);
