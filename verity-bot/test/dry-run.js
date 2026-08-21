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
import { looksLikeQuestion } from '../src/question.js';
import { match as matchAnswer, fill } from '../src/faq.js';
import { createConsole } from '../src/console.js';
import {
  parse as parseMusic,
  trackFor,
  tracksFor,
  isDj,
  rebuildTrack,
  playTrigger,
} from '../src/music/commands.js';
import {
  classify,
  tempoFilter,
  parseEmbedTracks,
  parseEmbedPlaylist,
  streamDirect as resolveDirect,
} from '../src/music/resolve.js';
import * as musicPlayer from '../src/music/player.js';
import { buildPlaylistView, parseId, PAGE_SIZE } from '../src/music/view.js';
import { handleDisconnect, REJOIN_LIMIT } from '../src/music/player.js';
import { resolveBitrate } from '../src/music/player.js';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { VoiceConnectionDisconnectReason } from '@discordjs/voice';
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

console.log('\nquestions-only mode');
await check('recognises a question', () => {
  for (const line of [
    'verity how do i get diamonds',
    'whats the best sword',
    'can you help',
    'is netherite better?',
    '<@123> why is my farm broken',
    'anyone know how redstone repeaters work',
  ]) {
    assert.ok(looksLikeQuestion(line), `should count as a question: ${line}`);
  }
});
await check('leaves ordinary chatter alone', () => {
  for (const line of ['hi', 'lol', 'verity you are stupid', 'im going to bed', '', null]) {
    assert.ok(!looksLikeQuestion(line), `should not count as a question: ${line}`);
  }
});
await check('it is off unless asked for', () => {
  assert.equal(config.defaults.questionsOnly, false);
});

console.log('\nlocal model mode');
await check('a localhost endpoint relaxes the API-shaped limits', async () => {
  // Fresh module instance: ESM caches by URL, so the query string re-reads env.
  process.env.VERITY_BASE_URL = 'http://localhost:11434/v1';
  process.env.VERITY_PROVIDER = 'openai';
  const local = (await import('../src/config.js?local=1')).config;
  delete process.env.VERITY_BASE_URL;

  assert.equal(local.isLocal, true, 'detected as local');
  assert.equal(local.apiKey, 'local', 'no key needed, but the SDK gets one');
  assert.equal(local.maxRpm, Infinity, 'no per-minute cap on your own machine');
  assert.ok(local.timeoutMs >= 300_000, 'patient enough for a laptop CPU');
});
await check('a remote endpoint keeps them', async () => {
  process.env.VERITY_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const remote = (await import('../src/config.js?remote=1')).config;
  delete process.env.VERITY_BASE_URL;

  assert.equal(remote.isLocal, false);
  assert.equal(remote.maxRpm, 8);
  assert.equal(remote.timeoutMs, 60_000);
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

console.log('\ncanned answers');
const faqEntries = [
  { triggers: ['server ip', 'whats the ip'], answer: 'play.example.com, {user}' },
  { triggers: ['how join'], answer: 'you just connect. obviously.' },
  { triggers: ['rules'], answer: 'do not be a dickhead.' },
];
await check('matches however the question is phrased', () => {
  for (const line of [
    'yo whats the ip for the server again',
    'server ip?',
    '<@1> ip address for server',
  ]) {
    assert.ok(matchAnswer(faqEntries, line), `should match: ${line}`);
  }
  assert.equal(matchAnswer(faqEntries, 'how do i join')?.answer, 'you just connect. obviously.');
});
await check('leaves unrelated messages alone', () => {
  for (const line of ['what version is the server', 'hello', '']) {
    assert.equal(matchAnswer(faqEntries, line), null, `should not match: ${line}`);
  }
});
await check('the more specific trigger wins', () => {
  const entries = [
    { triggers: ['ip'], answer: 'generic' },
    { triggers: ['bedrock ip'], answer: 'specific' },
  ];
  assert.equal(matchAnswer(entries, 'whats the bedrock ip').answer, 'specific');
});
await check('{user} is filled in', () => {
  assert.equal(fill('play.example.com, {user}', 'dave'), 'play.example.com, dave');
});
await check('answers persist per guild', () => {
  store.addAnswer('guild-faq', ['test trigger'], 'test answer');
  assert.equal(store.listAnswers('guild-faq').length, 1);
  assert.equal(
    matchAnswer(store.listAnswers('guild-faq'), 'test trigger please').answer,
    'test answer',
  );
  assert.equal(store.removeAnswer('guild-faq', 0).answer, 'test answer');
  assert.equal(store.listAnswers('guild-faq').length, 0);
  assert.equal(store.removeAnswer('guild-faq', 5), null, 'a bad index is refused');
});

console.log('\ncontrol console');
const sent = [];
const fakeChannel = {
  id: 'chan-console',
  name: 'general',
  send: async (content) => sent.push(content),
};
const fakeClient = {
  guilds: { cache: { first: () => ({ id: 'guild-console', name: 'Test SMP' }) } },
  channels: {
    cache: new Map([['chan-console', fakeChannel]]),
  },
};
fakeClient.channels.cache.find = (fn) => [...fakeClient.channels.cache.values()].find(fn);

const printed = [];
const { run, state } = createConsole(fakeClient, (line = '') => printed.push(line));
const lastOutput = () => printed.at(-1) ?? '';
const clear = () => (printed.length = 0);

await check('status reports what he is doing', async () => {
  clear();
  await run('status');
  const all = printed.join('\n');
  assert.match(all, /provider/);
  assert.match(all, /Test SMP/);
});
await check('faq add, list, test and remove all work', async () => {
  clear();
  await run('faq add server ip, whats the ip = play.example.com, {user}');
  assert.match(lastOutput(), /instantly/);

  clear();
  await run('faq');
  assert.match(printed.join('\n'), /play\.example\.com/);

  clear();
  await run('faq test yo whats the ip again');
  assert.match(lastOutput(), /play\.example\.com/);

  clear();
  await run('faq test what version is this');
  assert.match(lastOutput(), /nothing matches/);

  clear();
  await run('faq remove 0');
  assert.match(lastOutput(), /removed/);
});
await check('a malformed faq add is explained, not swallowed', async () => {
  clear();
  await run('faq add just a trigger with no answer');
  assert.match(lastOutput(), /format:/);
  assert.equal(store.listAnswers('guild-console').length, 0);
});
await check('a channel can be selected, then plain typing goes to it', async () => {
  sent.length = 0;
  clear();
  await run('use #general');
  assert.match(lastOutput(), /goes to #general/);

  await run('get in the mine');
  assert.deepEqual(sent, ['get in the mine'], 'plain text became a message');

  clear();
  await run('status'); // commands still work while a channel is selected
  assert.match(printed.join('\n'), /provider/);
  assert.equal(sent.length, 1, 'and are not posted to the channel');

  clear();
  await run('use none');
  assert.match(lastOutput(), /commands only/);
  await run('this should not be sent');
  assert.equal(sent.length, 1);
});
await check('a channel with emoji in its name still answers to its word', async () => {
  const decorated = { id: 'chan-emoji', name: '💬︱general-chat', send: async () => {} };
  fakeClient.channels.cache.set('chan-emoji', decorated);
  clear();
  await run('use general-chat');
  assert.match(lastOutput(), /general-chat/);
  await run('use none');
  fakeClient.channels.cache.delete('chan-emoji');
});
await check('#channel shorthand posts without any verb', async () => {
  sent.length = 0;
  clear();
  await run('#general oi');
  assert.deepEqual(sent, ['oi']);
});
await check('a leading slash is tolerated', async () => {
  clear();
  await run('/status');
  assert.match(printed.join('\n'), /provider/);
});
await check('a missed channel says so and lists the real ones', async () => {
  clear();
  await run('#nowhere hello');
  assert.match(printed.join('\n'), /no channel matching/);
  assert.match(printed.join('\n'), /#general/);
});
await check('unknown input suggests how to talk to him', async () => {
  clear();
  await run('hi');
  assert.match(lastOutput(), /ask hi/);
});
await check('pasted lines do not overlap and misfire', async () => {
  sent.length = 0;
  clear();
  // Fired without awaiting, exactly as readline delivers a pasted block.
  run('use #general');
  run('this one should go');
  run('use none');
  const settled = run('this one should not');
  await settled;

  assert.deepEqual(sent, ['this one should go'], 'only the line sent while selected');
  assert.equal(state.channel, null, 'and the selection ended up cleared');
});
await check('say posts to a channel', async () => {
  sent.length = 0;
  clear();
  await run('say #general get back in the mine');
  assert.deepEqual(sent, ['get back in the mine']);
  assert.match(lastOutput(), /sent to #general/);
});
await check('mood changes it everywhere', async () => {
  clear();
  await run('mood unhinged');
  assert.match(lastOutput(), /unhinged/);
  assert.equal(store.getSettings('guild-console').mood, 'unhinged');

  clear();
  await run('mood sideways');
  assert.match(lastOutput(), /pick one of/);
});
await check('veritysong typed in the console is understood, not rejected', async () => {
  clear();
  await run('veritysong https://open.spotify.com/track/abc');
  assert.doesNotMatch(lastOutput(), /not a command/, 'the Discord spelling works here too');
  assert.match(lastOutput(), /voice channel/, 'and says what is actually missing');
});
await check('play without a voice channel says how to get one', async () => {
  clear();
  await run('play something');
  assert.match(lastOutput(), /join #/);
});
await check('joining a text channel is refused with the real options', async () => {
  const voice = {
    id: 'vc1',
    name: 'Voice Chat',
    isVoiceBased: () => true,
    guild: { id: 'guild-console' },
  };
  fakeClient.channels.cache.set('vc1', voice);
  clear();
  await run('join #general'); // a text channel
  assert.match(printed.join('\n'), /not a voice channel/);
  assert.match(printed.join('\n'), /Voice Chat/, 'lists the voice channels he can see');
  fakeClient.channels.cache.delete('vc1');
});
await check('joining a voice channel he is already in does not reconnect', async () => {
  const voice = {
    id: 'vc1',
    name: 'Voice Chat',
    isVoiceBased: () => true,
    guild: { id: 'guild-console' },
  };
  fakeClient.channels.cache.set('vc1', voice);
  // Pre-seed the session as already connected there, so join() returns early
  // instead of opening a real voice connection.
  musicPlayer.__sessions.set('guild-console', {
    guildId: 'guild-console',
    connection: { joinConfig: { channelId: 'vc1' } },
    queue: [],
    current: null,
    idleTimer: null,
    player: { state: { status: 'idle' }, stop() {} },
    onEvent: () => {},
  });

  clear();
  await run('join #Voice Chat');
  assert.match(lastOutput(), /he is in Voice Chat/);

  clear();
  await run('queue');
  assert.match(lastOutput(), /nothing playing/);

  musicPlayer.__sessions.delete('guild-console');
  fakeClient.channels.cache.delete('vc1');
});
await check('nonsense points at help', async () => {
  clear();
  await run('summon the ancient one');
  assert.match(lastOutput(), /help/);
});
await check('quit hands control back rather than killing the process', async () => {
  let quit = false;
  const { run: run2 } = createConsole(
    fakeClient,
    () => {},
    () => (quit = true),
  );
  await run2('quit');
  assert.equal(quit, true);
});

console.log('\nmusic: what did you hand him');
await check('spotify links of every shape are recognised', () => {
  const link = classify('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x');
  assert.equal(link.kind, 'spotify');
  assert.equal(link.type, 'track');
  assert.equal(link.id, '4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(classify('spotify:track:abc123').kind, 'spotify');
  assert.equal(classify('https://open.spotify.com/intl-de/playlist/37i9dQ').type, 'playlist');
});
await check('audio files and radio streams play directly', () => {
  assert.equal(classify('https://example.com/song.mp3').kind, 'direct');
  assert.equal(classify('https://example.com/track.opus?x=1').kind, 'direct');
  assert.equal(classify('http://ice1.somafm.com:80/groovesalad-128-mp3').kind, 'direct');
});
await check('pages and bare words need a resolver', () => {
  assert.equal(classify('https://www.youtube.com/watch?v=abc').kind, 'page');
  assert.equal(classify('never gonna give you up').kind, 'search');
  assert.equal(classify('').kind, 'empty');
});
await check('a spotify link explains itself when nothing can fetch audio', async () => {
  // No VERITY_YTDLP in the test env, so this is the out-of-the-box behaviour.
  await assert.rejects(
    () => trackFor('https://www.youtube.com/watch?v=abc', 'dave'),
    /VERITY_YTDLP/,
    'says what is missing rather than failing silently',
  );
});
await check('a direct link becomes a playable track', async () => {
  const track = await trackFor('https://example.com/Some%20Song_Name.mp3', 'dave');
  assert.equal(track.title, 'Some Song Name', 'tidies the filename into a title');
  assert.equal(track.requestedBy, 'dave');
  assert.equal(typeof track.open, 'function');
});

console.log('\nmusic: reading a spotify list without credentials');
await check('reads the current embed shape', () => {
  const payload = {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              trackList: [
                { title: 'First Song', subtitle: 'Some Band' },
                { title: 'Second Song', subtitle: 'Another Band' },
              ],
            },
          },
        },
      },
    },
  };
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>`;
  const tracks = parseEmbedTracks(html);
  assert.equal(tracks.length, 2);
  assert.equal(
    tracks[0].title,
    'Some Band - First Song',
    'artist and title, the way a queue reads',
  );
  assert.equal(tracks[0].search, 'Some Band First Song', 'and a sensible thing to search for');
});
await check('reads the playlist name off the page', () => {
  const payload = {
    props: {
      pageProps: { state: { data: { entity: { trackList: [{ title: 'A', subtitle: 'B' }] } } } },
    },
  };
  const html = `<meta property="og:title" content="Moja playlista #4"><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`;
  const list = parseEmbedPlaylist(html);
  assert.equal(list.name, 'Moja playlista #4', 'so a saved playlist keeps its own name');
  assert.equal(list.tracks.length, 1);
  assert.deepEqual(parseEmbedTracks(html), list.tracks, 'the tracks-only view still works');
});
await check('a nameless page is still readable', () => {
  const html = '{"title":"Loose Song","subtitle":"Loose Band"}';
  const list = parseEmbedPlaylist(html);
  assert.equal(list.tracks.length, 1);
  assert.equal(typeof list.name, 'object', 'null rather than a guess');
});
await check('reads the older embed shape too', () => {
  const entity = {
    tracks: {
      items: [{ track: { name: 'Old Song', artists: [{ name: 'Old Band' }] } }],
    },
  };
  const html = `<script>Spotify.Entity = ${JSON.stringify(entity)};</script>`;
  assert.equal(parseEmbedTracks(html)[0].title, 'Old Band - Old Song');
});
await check('falls back to scanning when neither shape fits', () => {
  const html = 'garbage {"title":"Loose Song","subtitle":"Loose Band"} more garbage';
  assert.equal(parseEmbedTracks(html)[0].title, 'Loose Band - Loose Song');
});
await check('a page with nothing readable returns nothing, not junk', () => {
  for (const html of [
    '',
    '<html><body>no</body></html>',
    '<script id="__NEXT_DATA__">not json</script>',
  ]) {
    assert.deepEqual(parseEmbedTracks(html), [], `should find nothing in: ${html.slice(0, 30)}`);
  }
});
await check('escaped characters survive the scan', () => {
  const html = '{"title":"Song \\"Quoted\\"","subtitle":"Band"}';
  assert.equal(parseEmbedTracks(html)[0].title, 'Band - Song "Quoted"');
});

console.log('\nmusic: commands');
await check('every command resolves to one canonical name', () => {
  const expected = {
    'veritysong x': 'play',
    veritypls: 'view',
    verityplaylistsee: 'view',
    verityplaylist: 'playlist',
    verityqueue: 'queue',
    verityrandom: 'random',
    'veritysaveplaylist friday': 'save',
    'veritydeleteplaylist friday': 'delete',
    'veritynext 3': 'next',
    'verityjump 3': 'jump',
    verityskip: 'skip',
    veritystop: 'stop',
    veritypause: 'pause',
    verityresume: 'resume',
    veritynp: 'np',
    'verityloop queue': 'loop',
    verityshuffle: 'shuffle',
    verityclear: 'clear',
    'verityremove 3': 'remove',
    'verityspeed 2': 'speed',
    'verityvolume 50': 'volume',
    verityjoin: 'join',
    verityleave: 'leave',
  };
  for (const [input, command] of Object.entries(expected)) {
    assert.equal(parseMusic(input)?.command, command, `${input} should be ${command}`);
  }
});
await check('the short forms mean the same thing', () => {
  const shortcuts = {
    'verityp x': 'play',
    veritys: 'skip',
    'verityn 3': 'next',
    'verityj 3': 'jump',
    verityq: 'queue',
    'veritysp friday': 'save',
    'veritydp friday': 'delete',
    veritysh: 'shuffle',
    verityc: 'clear',
    'verityr 2': 'remove',
    'veritysd 2': 'speed',
    'verityv 50': 'volume',
    'verityl off': 'loop',
    veritypa: 'pause',
    verityre: 'resume',
    verityd: 'leave',
    verityh: 'help',
  };
  for (const [input, command] of Object.entries(shortcuts)) {
    assert.equal(parseMusic(input)?.command, command, `${input} should be ${command}`);
  }
});
await check('an unknown verity word is not a command', () => {
  for (const input of ['verityfoo', 'verityplaylisting', 'verity', 'verity song x']) {
    assert.equal(parseMusic(input), null, `${input} should not parse`);
  }
});
await check('speed is chained past what atempo allows alone', () => {
  assert.deepEqual(tempoFilter(1), [], 'normal speed adds no filter at all');
  assert.deepEqual(tempoFilter(2), ['atempo=2.000']);
  assert.equal(tempoFilter(4).length, 2, '4x needs two passes');
  assert.equal(tempoFilter(0.25).length, 2, 'and so does quarter speed');
  // Every stage has to sit inside ffmpeg's 0.5-2.0 window.
  for (const speed of [0.25, 0.5, 1.5, 2, 3, 4]) {
    for (const stage of tempoFilter(speed)) {
      const value = Number(stage.split('=')[1]);
      assert.ok(value >= 0.5 && value <= 2, `${stage} is outside what atempo accepts`);
    }
  }
});
await check('the prefix commands are shut by default', () => {
  const stranger = {
    id: 'u1',
    user: { id: 'u1', username: 'steve' },
    roles: { cache: { has: () => false } },
  };
  assert.equal(isDj(stranger, 'guild-dj'), false, 'nobody gets in without being named');
});
await check('the owners always have them', () => {
  for (const username of ['areajoo', 'dangcanss', 'AreaJoo']) {
    const owner = {
      id: 'o1',
      user: { id: 'o1', username },
      roles: { cache: { has: () => false } },
    };
    assert.equal(isDj(owner, 'guild-dj'), true, `${username} should be allowed`);
  }
});
await check('access is granted by user and by role', () => {
  const stranger = {
    id: 'u2',
    user: { id: 'u2', username: 'steve' },
    roles: { cache: { has: () => false } },
  };
  store.addDj('guild-dj', { userId: 'u2' });
  assert.equal(isDj(stranger, 'guild-dj'), true, 'named directly');

  const byRole = {
    id: 'u9',
    user: { id: 'u9', username: 'nobody' },
    roles: { cache: { has: (id) => id === 'r1' } },
  };
  assert.equal(isDj(byRole, 'guild-dj'), false, 'not until the role is added');
  store.addDj('guild-dj', { roleId: 'r1' });
  assert.equal(isDj(byRole, 'guild-dj'), true, 'now the role carries it');
});
await check('access can be taken back, and never from the owners', () => {
  const stranger = {
    id: 'u2',
    user: { id: 'u2', username: 'steve' },
    roles: { cache: { has: () => false } },
  };
  store.removeDj('guild-dj', { userId: 'u2' });
  assert.equal(isDj(stranger, 'guild-dj'), false);

  store.clearDj('guild-dj');
  const byRole = {
    id: 'u9',
    user: { id: 'u9', username: 'nobody' },
    roles: { cache: { has: () => true } },
  };
  assert.equal(isDj(byRole, 'guild-dj'), false, 'clearing leaves the owners only');
  assert.equal(
    isDj(
      { id: 'o1', user: { id: 'o1', username: 'areajoo' }, roles: { cache: { has: () => false } } },
      'guild-dj',
    ),
    true,
  );
});

await check('ordinary chat is not a music command', () => {
  for (const line of ['verity song x', 'hello', 'verity', 'song']) {
    assert.equal(parseMusic(line), null, `should not parse: ${line}`);
  }
});

console.log('\nmusic: the queue');
// A real two-second Opus tone, so the queue is driven through the actual
// audio player rather than a mock of it.
const tone = execFileSync(
  ffmpegPath,
  [
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-acodec',
    'libopus',
    '-f',
    'opus',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-loglevel',
    'error',
    'pipe:1',
  ],
  { maxBuffer: 10 * 1024 * 1024 },
);

const { Readable } = await import('node:stream');

/**
 * Ends a track the way a real one ends: having actually played. Stopping the
 * player outright looks identical to a source that produced nothing, which
 * the player now treats as a failure rather than a finish.
 */
// eslint-disable-next-line no-unused-vars
const finishTrack = async (guildId) => {
  const session = musicPlayer.__sessions.get(guildId);
  if (session?.resource) session.resource.playbackDuration = 30_000;
  session?.player.stop(true);
  await new Promise((resolve) => setTimeout(resolve, 150));
};
let killed = 0;
const fakeTrack = (title) => ({
  title,
  requestedBy: 'dave',
  open: () => ({ stream: Readable.from([tone]), kill: () => (killed += 1) }),
});

const events = [];
musicPlayer.__sessions.delete('guild-music');
assert.equal(musicPlayer.__sessions.get('guild-music'), undefined, 'starting clean');

await check('the first track plays and the rest queue behind it', () => {
  // enqueue creates the session on demand, exactly as a join would.
  const first = musicPlayer.enqueue('guild-music', fakeTrack('first song'));
  musicPlayer.__sessions.get('guild-music').onEvent = (event) => events.push(event);
  const second = musicPlayer.enqueue('guild-music', fakeTrack('second song'));
  const third = musicPlayer.enqueue('guild-music', fakeTrack('third song'));

  assert.equal(first.position, 0, 'the first one starts immediately');
  assert.equal(second.position, 1);
  assert.equal(third.position, 2);
  assert.equal(musicPlayer.nowPlaying('guild-music').title, 'first song');
  assert.deepEqual(
    musicPlayer.queued('guild-music').map((track) => track.title),
    ['second song', 'third song'],
  );
});
await check('skip moves to the next one and kills the old process', async () => {
  const before = killed;
  const skipped = musicPlayer.skip('guild-music');
  assert.equal(skipped.title, 'first song');

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(musicPlayer.nowPlaying('guild-music')?.title, 'second song', 'advanced to the next');
  assert.ok(killed > before, 'the skipped source was killed, not left running');
});
await check('a playlist queues in one go', () => {
  musicPlayer.__sessions.delete('guild-list');
  const list = ['one', 'two', 'three'].map((name) => fakeTrack(name));
  const { added, startedPlaying } = musicPlayer.enqueueAll('guild-list', list);
  assert.equal(added, 3);
  assert.equal(startedPlaying, true, 'the first one starts by itself');
  assert.equal(musicPlayer.nowPlaying('guild-list').title, 'one');
  assert.equal(musicPlayer.queued('guild-list').length, 2);

  musicPlayer.enqueueAll('guild-list', [fakeTrack('four')]);
  assert.deepEqual(
    musicPlayer.queued('guild-list').map((track) => track.title),
    ['two', 'three', 'four'],
    'a second playlist goes behind the first',
  );
  musicPlayer.leave('guild-list');
});
await check('remove and shuffle work on the waiting queue', () => {
  musicPlayer.__sessions.delete('guild-edit');
  ['a', 'b', 'c', 'd'].forEach((name) => musicPlayer.enqueue('guild-edit', fakeTrack(name)));
  // 'a' is playing; b, c, d are waiting.
  assert.equal(musicPlayer.remove('guild-edit', 1).title, 'b', 'positions match the queue display');
  assert.equal(musicPlayer.remove('guild-edit', 9), null, 'a bad position is refused');
  assert.deepEqual(
    musicPlayer.queued('guild-edit').map((track) => track.title),
    ['c', 'd'],
  );
  assert.equal(musicPlayer.shuffle('guild-edit'), 2);
  assert.equal(musicPlayer.clear('guild-edit'), 2);
  assert.equal(
    musicPlayer.nowPlaying('guild-edit').title,
    'a',
    'clearing leaves the current track',
  );
  musicPlayer.leave('guild-edit');
});
await check('looping a track puts it back in front when it ends', async () => {
  musicPlayer.__sessions.delete('guild-loop');
  musicPlayer.enqueue('guild-loop', fakeTrack('on repeat'));
  musicPlayer.setLoop('guild-loop', 'track');

  await finishTrack('guild-loop');
  assert.equal(musicPlayer.nowPlaying('guild-loop')?.title, 'on repeat', 'it came back round');

  musicPlayer.setLoop('guild-loop', 'off');
  assert.equal(musicPlayer.skip('guild-loop').title, 'on repeat');
  musicPlayer.leave('guild-loop');
});
await check('speed changes are remembered for the tracks that follow', () => {
  musicPlayer.__sessions.delete('guild-speed');
  const opened = [];
  musicPlayer.enqueue('guild-speed', {
    title: 'fast one',
    requestedBy: 'dave',
    seekable: true,
    open: (options) => {
      opened.push(options);
      return { stream: Readable.from([tone]), kill: () => {} };
    },
  });
  assert.equal(opened[0].speed, 1, 'starts at normal speed');

  const result = musicPlayer.setSpeed('guild-speed', 2);
  assert.equal(result.restarted, true, 'a seekable track is re-opened');
  assert.equal(opened.at(-1).speed, 2, 'through the doubled filter');
  assert.equal(musicPlayer.settings('guild-speed').speed, 2);
  musicPlayer.leave('guild-speed');
});
await check('an unseekable track restarts rather than pretending to seek', () => {
  musicPlayer.__sessions.delete('guild-pipe');
  musicPlayer.enqueue('guild-pipe', {
    title: 'from a pipe',
    requestedBy: 'dave',
    seekable: false,
    open: () => ({ stream: Readable.from([tone]), kill: () => {} }),
  });
  const result = musicPlayer.setSpeed('guild-pipe', 2);
  assert.equal(result.fromStart, true, 'and says so, rather than silently losing the position');
  musicPlayer.leave('guild-pipe');
});
await check('a track can be lined up next, at its own speed', () => {
  musicPlayer.__sessions.delete('guild-order');
  ['a', 'b', 'c', 'd'].forEach((name) => musicPlayer.enqueue('guild-order', fakeTrack(name)));
  // 'a' plays; b, c, d wait.
  const moved = musicPlayer.moveToFront('guild-order', 3, 2);
  assert.equal(moved.title, 'd', 'numbering matches what verityplaylist shows');
  assert.equal(moved.speed, 2, 'and it carries its own speed');
  assert.deepEqual(
    musicPlayer.queued('guild-order').map((track) => track.title),
    ['d', 'b', 'c'],
  );
  assert.equal(musicPlayer.moveToFront('guild-order', 99), null, 'a bad number is refused');
  musicPlayer.leave('guild-order');
});
await check('a per-track speed is used instead of the session speed', () => {
  musicPlayer.__sessions.delete('guild-tspeed');
  const opened = [];
  const spy = (title, speed) => ({
    title,
    requestedBy: 'dave',
    seekable: true,
    ...(speed ? { speed } : {}),
    open: (options) => {
      opened.push({ title, speed: options.speed });
      return { stream: Readable.from([tone]), kill: () => {} };
    },
  });
  musicPlayer.enqueue('guild-tspeed', spy('normal'));
  musicPlayer.setSpeed('guild-tspeed', 1.5); // session speed
  musicPlayer.enqueue('guild-tspeed', spy('its own', 3));
  musicPlayer.skip('guild-tspeed');

  return new Promise((resolve) => {
    setTimeout(() => {
      const last = opened.at(-1);
      assert.equal(last.title, 'its own');
      assert.equal(last.speed, 3, 'the track speed wins over the session speed');
      musicPlayer.leave('guild-tspeed');
      resolve();
    }, 150);
  });
});
await check('jumping drops everything in between', async () => {
  musicPlayer.__sessions.delete('guild-jump');
  ['a', 'b', 'c', 'd'].forEach((name) => musicPlayer.enqueue('guild-jump', fakeTrack(name)));
  const jumped = musicPlayer.jumpTo('guild-jump', 3);
  assert.equal(jumped.track.title, 'd');
  assert.equal(jumped.skipped, 2, 'b and c thrown out on the way');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(musicPlayer.nowPlaying('guild-jump')?.title, 'd');
  musicPlayer.leave('guild-jump');
});
await check('a queue can be saved and put back later', () => {
  const entries = [
    {
      title: 'Band - One',
      meta: { kind: 'resolved', target: 'Band One', search: true },
      speed: null,
    },
    { title: 'a-file', meta: { kind: 'direct', target: 'https://x.com/a.mp3' }, speed: 2 },
  ];
  assert.equal(store.savePlaylist('guild-save', 'friday', entries, 'dave'), 2);

  const saved = store.getPlaylist('guild-save', 'FRIDAY');
  assert.ok(saved, 'the name is not case sensitive');
  assert.equal(saved.entries.length, 2);
  assert.equal(store.listPlaylists('guild-save').length, 1);

  const rebuilt = saved.entries.map((entry) => rebuildTrack(entry, 'dave'));
  assert.equal(rebuilt[0].title, 'Band - One');
  assert.equal(rebuilt[0].seekable, false, 'a looked-up track still has to be looked up');
  assert.equal(rebuilt[1].seekable, true, 'a direct file is seekable straight away');
  assert.equal(rebuilt[1].speed, 2, 'and its saved speed comes back with it');
  assert.equal(typeof rebuilt[0].open, 'function', 'and both are playable again');

  assert.equal(store.deletePlaylist('guild-save', 'friday'), true);
  assert.equal(store.deletePlaylist('guild-save', 'friday'), false);
});
await check('a queued track carries what it needs to be saved', async () => {
  const { tracks } = await tracksFor('https://example.com/Some%20Song.mp3', 'dave');
  assert.deepEqual(tracks[0].meta, {
    kind: 'direct',
    target: 'https://example.com/Some%20Song.mp3',
  });
});

await check('a track that makes no sound is retried, then skipped', async () => {
  musicPlayer.__sessions.delete('guild-dead');
  const events = [];

  // A track holding a url resolved a while ago, which has since expired: it
  // opens fine and produces nothing.
  const dead = {
    title: 'expired link',
    requestedBy: 'dave',
    seekable: true,
    direct: 'https://example.com/expired',
    open: () => ({ stream: Readable.from([]), kill: () => {} }),
  };

  musicPlayer.enqueue('guild-dead', dead);
  musicPlayer.__sessions.get('guild-dead').onEvent = (event) => events.push(event);
  musicPlayer.enqueue('guild-dead', fakeTrack('the next one'));

  // The track ends having played nothing. (Without a voice connection the
  // player never drains a stream on its own, so the ending is driven here;
  // what is under test is the decision, not @discordjs/voice's buffering.)
  const died = async (guildId) => {
    const session = musicPlayer.__sessions.get(guildId);
    if (session?.resource) session.resource.playbackDuration = 0;
    session?.player.stop(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
  };

  await died('guild-dead'); // first attempt: stale url thrown away, retried
  await died('guild-dead'); // second: given up on, queue moves along

  assert.ok(
    events.some((event) => event.type === 'retrying'),
    'the stale url is thrown away and the track looked up again',
  );
  assert.equal(dead.direct, null, 'so the next attempt resolves it fresh');
  assert.ok(
    events.some((event) => event.type === 'failed'),
    'and when that fails too, the track is given up on',
  );
  assert.equal(
    musicPlayer.nowPlaying('guild-dead')?.title,
    'the next one',
    'the queue carries on by itself',
  );
  musicPlayer.leave('guild-dead');
});
await check('a dead track is never looped back round', async () => {
  musicPlayer.__sessions.delete('guild-dead-loop');
  const dead = {
    title: 'silent',
    requestedBy: 'dave',
    seekable: false,
    open: () => ({ stream: Readable.from([]), kill: () => {} }),
  };
  musicPlayer.enqueue('guild-dead-loop', dead);
  musicPlayer.setLoop('guild-dead-loop', 'track');

  const session = musicPlayer.__sessions.get('guild-dead-loop');
  if (session?.resource) session.resource.playbackDuration = 0;
  session?.player.stop(true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(musicPlayer.queued('guild-dead-loop').length, 0, 'or it would loop forever');
  assert.equal(musicPlayer.nowPlaying('guild-dead-loop'), null);
  musicPlayer.leave('guild-dead-loop');
});
await check('a skip is not mistaken for a broken track', async () => {
  musicPlayer.__sessions.delete('guild-skip-clean');
  const events = [];
  musicPlayer.enqueue('guild-skip-clean', fakeTrack('first'));
  musicPlayer.__sessions.get('guild-skip-clean').onEvent = (event) => events.push(event);
  musicPlayer.enqueue('guild-skip-clean', fakeTrack('second'));

  musicPlayer.skip('guild-skip-clean');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(
    !events.some((event) => event.type === 'failed'),
    'skipping early is deliberate, not a failure',
  );
  assert.equal(musicPlayer.nowPlaying('guild-skip-clean')?.title, 'second');
  musicPlayer.leave('guild-skip-clean');
});

await check('stop empties the queue', () => {
  const dropped = musicPlayer.stop('guild-music');
  assert.equal(dropped, 1, 'third song was still waiting');
  assert.deepEqual(musicPlayer.queued('guild-music'), []);
});
await check('leave tears the session down', () => {
  assert.equal(musicPlayer.leave('guild-music'), true);
  assert.equal(musicPlayer.__sessions.has('guild-music'), false);
  assert.equal(musicPlayer.leave('guild-music'), false, 'and says so if he was never there');
});

console.log('\nmusic: phrases and housekeeping');
await check('the phrase he ships with is there from the start', () => {
  const triggers = store.listTriggers('guild-trigger');
  assert.equal(triggers.length, 1, 'one, out of the box');
  assert.equal(triggers[0].phrase, 'dada put on that misery');
  assert.match(triggers[0].url, /open\.spotify\.com\/track\//);
});
await check('saying it anywhere in a message counts', () => {
  const entries = store
    .listTriggers('guild-trigger')
    .map((entry) => ({ ...entry, triggers: [entry.phrase] }));

  for (const line of [
    'dada put on that misery',
    'DADA PUT ON THAT MISERY please',
    'oi dada put on that misery again lol',
  ]) {
    assert.ok(matchAnswer(entries, line), `should trigger: ${line}`);
  }
  assert.equal(matchAnswer(entries, 'what a miserable day'), null, 'and ordinary talk does not');
});
await check('phrases can be added and taken away', () => {
  store.addTrigger('guild-trigger', 'play the thing', 'https://x.com/a.mp3', 'the thing');
  assert.equal(store.listTriggers('guild-trigger').length, 2);

  const entries = store
    .listTriggers('guild-trigger')
    .map((entry) => ({ ...entry, triggers: [entry.phrase] }));
  assert.equal(matchAnswer(entries, 'go on, play the thing').label, 'the thing');

  assert.equal(store.removeTrigger('guild-trigger', 1).phrase, 'play the thing');
  assert.equal(store.listTriggers('guild-trigger').length, 1);
  assert.equal(store.removeTrigger('guild-trigger', 9), null, 'a bad number is refused');
});
await check('removing every playlist says which ones went', () => {
  store.savePlaylist(
    'guild-wipe',
    'friday',
    [{ title: 'a', meta: { kind: 'direct', target: 'x' } }],
    'dave',
  );
  store.savePlaylist(
    'guild-wipe',
    'sunday',
    [{ title: 'b', meta: { kind: 'direct', target: 'y' } }],
    'dave',
  );
  assert.equal(store.listPlaylists('guild-wipe').length, 2);

  const names = store.clearPlaylists('guild-wipe');
  assert.deepEqual(names.sort(), ['friday', 'sunday'], 'so you know what you lost');
  assert.equal(store.listPlaylists('guild-wipe').length, 0);
  assert.deepEqual(store.clearPlaylists('guild-wipe'), [], 'and again is harmless');
});

await check('a phrase says what is missing rather than nothing at all', async () => {
  // The complaint that started this: saying the phrase did nothing visible.
  const reply = await playTrigger(
    { phrase: 'dada put on that misery', url: 'https://x.com/a.mp3' },
    { guildId: 'g', member: { voice: {} }, author: { username: 'dave' }, client: { user: {} } },
  );
  assert.equal(typeof reply, 'string', 'it answers');
  assert.match(reply, /voice channel/i, 'and says what to do about it');
});
await check('autoplay is off until asked for', () => {
  assert.equal(config.defaults.autoplay, false);
});
await check('what played is remembered, newest first', async () => {
  musicPlayer.__sessions.delete('guild-history');
  const events = [];
  musicPlayer.enqueue('guild-history', fakeTrack('first'));
  musicPlayer.__sessions.get('guild-history').onEvent = (event) => events.push(event);
  musicPlayer.enqueue('guild-history', fakeTrack('second'));

  await finishTrack('guild-history');

  const heard = musicPlayer.history('guild-history').map((track) => track.title);
  assert.deepEqual(heard, ['second', 'first'], 'most recent at the front');
  assert.equal(musicPlayer.lastPlayed('guild-history').title, 'second');
  musicPlayer.leave('guild-history');
});
await check('running dry reports what it ran dry after', async () => {
  musicPlayer.__sessions.delete('guild-empty');
  const events = [];
  musicPlayer.enqueue('guild-empty', fakeTrack('only one'));
  musicPlayer.__sessions.get('guild-empty').onEvent = (event) => events.push(event);

  await finishTrack('guild-empty');

  const empty = events.find((event) => event.type === 'empty');
  assert.ok(empty, 'the queue announces that it is empty');
  assert.equal(empty.last?.title, 'only one', 'and what it just finished — autoplay needs that');
  assert.ok(Array.isArray(empty.history), 'along with what has been heard already');
  musicPlayer.leave('guild-empty');
});

console.log('\nmusic: holding the voice connection');
// A stand-in for a VoiceConnection: enough of one to drive the handler.
const fakeConnection = (attempts = 0) => {
  const connection = { rejoinAttempts: attempts, rejoined: 0 };
  connection.rejoin = () => {
    connection.rejoined += 1;
    connection.rejoinAttempts += 1;
  };
  return connection;
};
const instantly = async () => {};

await check('an ordinary drop is rejoined, not abandoned', async () => {
  const connection = fakeConnection();
  let gaveUp = null;
  const outcome = await handleDisconnect(
    connection,
    { reason: 0 /* anything that is not a 4014 close */ },
    { giveUp: (why) => (gaveUp = why), wait: instantly },
  );
  assert.equal(outcome, 'rejoining', 'the common case keeps him in the channel');
  assert.equal(connection.rejoined, 1);
  assert.equal(gaveUp, null, 'and nothing is torn down');
});
await check('he keeps trying, then stops', async () => {
  const connection = fakeConnection(REJOIN_LIMIT);
  let gaveUp = null;
  const outcome = await handleDisconnect(
    connection,
    { reason: 0 },
    { giveUp: (why) => (gaveUp = why), wait: instantly },
  );
  assert.equal(outcome, 'gave up', 'a connection that will not come back is let go');
  assert.equal(connection.rejoined, 0);
  assert.match(gaveUp, new RegExp(String(REJOIN_LIMIT)), 'and says how hard it tried');
});
await check('being moved between channels is not a reason to leave', async () => {
  const connection = fakeConnection();
  let gaveUp = null;
  const outcome = await handleDisconnect(
    connection,
    { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 },
    { giveUp: (why) => (gaveUp = why), wait: instantly, awaitReconnect: async () => {} },
  );
  assert.equal(outcome, 'moved');
  assert.equal(gaveUp, null, 'he follows rather than quitting');
});
await check('a lost gateway session gets one rejoin before he believes it', async () => {
  // A dropped session and a real removal both arrive as a 4014 that does not
  // come back, so one rejoin is what tells them apart.
  const connection = fakeConnection();
  let gaveUp = null;
  const outcome = await handleDisconnect(
    connection,
    { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 },
    {
      giveUp: (why) => (gaveUp = why),
      wait: instantly,
      awaitReconnect: async () => {
        throw new Error('never came back');
      },
    },
  );
  assert.equal(outcome, 'rejoining', 'he tries once');
  assert.equal(connection.rejoined, 1);
  assert.equal(gaveUp, null);
});
await check('a rejoin that fails too means he really was removed', async () => {
  const connection = fakeConnection(1); // the rejoin above already happened
  let gaveUp = null;
  const outcome = await handleDisconnect(
    connection,
    { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 },
    {
      giveUp: (why) => (gaveUp = why),
      wait: instantly,
      awaitReconnect: async () => {
        throw new Error('never came back');
      },
    },
  );
  assert.equal(outcome, 'gave up');
  assert.match(gaveUp, /removed/);
});

console.log('\nmusic: playing kept playlists, and out of order');
await check('the queue and the kept playlists are different commands now', () => {
  assert.equal(parseMusic('verityplaylist').command, 'playlist', 'plays what you kept');
  assert.equal(parseMusic('verityplaylist 2').command, 'playlist', 'the second one');
  assert.equal(parseMusic('verityqueue').command, 'queue', 'shows what is lined up');
  assert.equal(parseMusic('verityrnd').command, 'random');
});
await check('random mode takes from anywhere in the queue', async () => {
  musicPlayer.__sessions.delete('guild-random');
  for (let i = 1; i <= 20; i += 1) musicPlayer.enqueue('guild-random', fakeTrack(`track ${i}`));
  musicPlayer.setRandom('guild-random', true);

  const played = [];
  for (let i = 0; i < 6; i += 1) {
    await finishTrack('guild-random');
    played.push(musicPlayer.nowPlaying('guild-random')?.title);
  }

  const inOrder = ['track 2', 'track 3', 'track 4', 'track 5', 'track 6', 'track 7'];
  assert.notDeepEqual(played, inOrder, 'not simply the next one each time');
  assert.equal(new Set(played).size, played.length, 'and never the same track twice');
  musicPlayer.leave('guild-random');
});
await check('order is restored when random is turned off', async () => {
  musicPlayer.__sessions.delete('guild-order-again');
  for (let i = 1; i <= 5; i += 1) musicPlayer.enqueue('guild-order-again', fakeTrack(`track ${i}`));
  musicPlayer.setRandom('guild-order-again', true);
  musicPlayer.setRandom('guild-order-again', false);

  await finishTrack('guild-order-again');
  assert.equal(musicPlayer.nowPlaying('guild-order-again')?.title, 'track 2', 'back to the front');
  assert.equal(musicPlayer.settings('guild-order-again').random, false);
  musicPlayer.leave('guild-order-again');
});

console.log('\nmusic: sending audio without touching it');
await check('an Opus source is passed through, not re-encoded', async () => {
  const source = '/tmp/verity-passthrough.webm';
  execFileSync(ffmpegPath, [
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-acodec',
    'libopus',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    '160k',
    '-f',
    'webm',
    '-loglevel',
    'error',
    source,
    '-y',
  ]);

  const drain = async (options) => {
    const { stream, kill } = resolveDirect(source, options);
    const bytes = await new Promise((resolve) => {
      let total = 0;
      stream.on('data', (chunk) => (total += chunk.length));
      stream.on('end', () => resolve(total));
      setTimeout(() => resolve(total), 5000);
    });
    kill();
    return bytes;
  };

  const copied = await drain({ copy: true });
  const encoded = await drain({ copy: false, bitrate: 96_000 });
  assert.ok(copied > 0 && encoded > 0, 'both produce audio');
  assert.ok(
    copied > encoded,
    `passthrough keeps the source bitrate (${copied} bytes) rather than squashing it (${encoded})`,
  );

  // A filter forces a decode, so passthrough has to stand down.
  const stretched = await drain({ copy: true, speed: 2 });
  assert.ok(stretched < copied, 'a speed change is re-encoded, not copied');

  fs.rmSync(source, { force: true });
});

console.log('\nmusic: the clickable panel');
// Assert against toJSON(), which is exactly what Discord receives.
const panel = (guildId, page) => {
  const view = buildPlaylistView(guildId, page);
  const components = view.components.map((row) => row.toJSON()).flatMap((row) => row.components);
  return {
    ...view,
    menu: components.find((component) => component.type === 3),
    buttons: components.filter((component) => component.type === 2),
  };
};

await check('an empty list still renders, with nothing to pick', () => {
  musicPlayer.__sessions.delete('guild-view');
  const view = panel('guild-view', 1);
  assert.equal(view.menu, undefined, 'no dropdown when nothing is waiting');
  assert.match(view.embeds[0].data.description, /nothing playing/);
});
await check('every waiting song is an option, by name', () => {
  musicPlayer.__sessions.delete('guild-view');
  for (let i = 1; i <= 5; i += 1) musicPlayer.enqueue('guild-view', fakeTrack(`song ${i}`));
  // song 1 plays; 2-5 wait
  const view = panel('guild-view', 1);

  assert.ok(view.menu, 'there is a dropdown');
  assert.equal(view.menu.options.length, 4, 'one option per waiting song');
  assert.deepEqual(
    view.menu.options.map((option) => option.label),
    ['song 2', 'song 3', 'song 4', 'song 5'],
    'labelled with the song, not a number',
  );
  assert.match(view.menu.options[0].description, /#1/, 'the number is still there as a hint');
  assert.match(view.menu.placeholder, /plays next/i, 'and it says what picking one does');
});
await check('picking a song gets that song, even after the numbers move', () => {
  const view = panel('guild-view', 1);
  // Whoever is reading picks "song 4".
  const chosen = view.menu.options.find((option) => option.label === 'song 4').value;

  // Meanwhile someone else reorders, so every position shifts.
  musicPlayer.moveToFront('guild-view', 3);

  const moved = musicPlayer.moveToFrontById('guild-view', chosen);
  assert.equal(moved.title, 'song 4', 'the id still points at the song they read');
  assert.equal(musicPlayer.queued('guild-view')[0].title, 'song 4', 'and it is next');
});
await check('a song that has since gone is refused, not confused', () => {
  assert.equal(musicPlayer.moveToFrontById('guild-view', 'no-such-track'), null);
  musicPlayer.leave('guild-view');
});
await check('long lists page, keeping the numbers honest', () => {
  musicPlayer.__sessions.delete('guild-view-long');
  for (let i = 1; i <= 60; i += 1) musicPlayer.enqueue('guild-view-long', fakeTrack(`song ${i}`));
  const second = panel('guild-view-long', 2);

  assert.equal(second.page, 2);
  assert.ok(second.menu.options.length <= 25, 'never more options than Discord accepts');
  assert.match(
    second.menu.options[0].description,
    new RegExp(`#${PAGE_SIZE + 1}`),
    'page two carries on from page one',
  );
  assert.ok(second.embeds[0].data.footer.text.includes('page 2'));
  assert.ok(
    second.buttons.some((button) => button.custom_id === 'vpl:page:1'),
    'and there is a way back',
  );

  const beyond = panel('guild-view-long', 99);
  assert.ok(beyond.page < 99, 'asking past the end lands on the last page');
  musicPlayer.leave('guild-view-long');
});
await check('very long titles are trimmed to what Discord allows', () => {
  musicPlayer.__sessions.delete('guild-title');
  musicPlayer.enqueue('guild-title', fakeTrack('playing'));
  musicPlayer.enqueue('guild-title', fakeTrack('x'.repeat(300)));
  const view = panel('guild-title', 1);
  assert.ok(view.menu.options[0].label.length <= 100, 'inside the 100 character limit');
  assert.match(view.menu.options[0].label, /…$/, 'and cut visibly rather than silently');
  musicPlayer.leave('guild-title');
});
await check('a press says what it is and what page it came from', () => {
  assert.deepEqual(parseId('vpl:pick:2'), { action: 'pick', value: 2 });
  assert.deepEqual(parseId('vpl:page:3'), { action: 'page', value: 3 });
  assert.equal(parseId('something:else:1'), null, 'other components are not his');
});

console.log('\nmusic: quality and loading');
await check('bitrate follows the voice channel by default', () => {
  assert.equal(config.bitrate, 'auto', 'shipped default');
  assert.equal(resolveBitrate({ bitrate: 64_000 }), 64_000, 'an ordinary channel');
  assert.equal(resolveBitrate({ bitrate: 384_000 }), 384_000, 'a level 3 boosted server');
  assert.equal(resolveBitrate(undefined), 64_000, 'and something sane when unknown');
});
await check('an explicit bitrate overrides it, within what opus allows', () => {
  const original = config.bitrate;
  config.bitrate = '128k';
  assert.equal(resolveBitrate({ bitrate: 64_000 }), 128_000, 'k suffix understood');
  config.bitrate = '256000';
  assert.equal(resolveBitrate({ bitrate: 64_000 }), 256_000);
  config.bitrate = '9999999';
  assert.equal(resolveBitrate({ bitrate: 64_000 }), 510_000, 'clamped to opus max');
  config.bitrate = 'nonsense';
  assert.equal(resolveBitrate({ bitrate: 64_000 }), 64_000, 'garbage falls back');
  config.bitrate = original;
});
await check('the encoder is handed the session bitrate', () => {
  musicPlayer.__sessions.delete('guild-rate');
  const seen = [];
  musicPlayer.enqueue('guild-rate', {
    title: 'loud one',
    requestedBy: 'dave',
    seekable: true,
    open: (options) => {
      seen.push(options);
      return { stream: Readable.from([tone]), kill: () => {} };
    },
  });
  assert.equal(typeof seen[0].bitrate, 'number', 'open() receives a bitrate to encode at');
  musicPlayer.leave('guild-rate');
});
await check('the next track is resolved while this one plays', async () => {
  musicPlayer.__sessions.delete('guild-prefetch');
  let prepared = 0;
  const lazy = {
    title: 'second',
    requestedBy: 'dave',
    seekable: false,
    prepare: async () => {
      prepared += 1;
    },
    open: () => ({ stream: Readable.from([tone]), kill: () => {} }),
  };

  musicPlayer.enqueue('guild-prefetch', fakeTrack('first'));
  musicPlayer.enqueue('guild-prefetch', lazy);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(prepared, 0, 'nothing to prefetch until something is playing ahead of it');

  // Starting the first track is what triggers the lookup for the second.
  await finishTrack('guild-prefetch');
  musicPlayer.leave('guild-prefetch');
});
await check('a failed prefetch does not lose the track', async () => {
  musicPlayer.__sessions.delete('guild-prefetch-fail');
  const broken = {
    title: 'awkward',
    requestedBy: 'dave',
    seekable: false,
    prepare: async () => {
      throw new Error('lookup failed');
    },
    open: () => ({ stream: Readable.from([tone]), kill: () => {} }),
  };
  musicPlayer.enqueue('guild-prefetch-fail', fakeTrack('first'));
  musicPlayer.enqueue('guild-prefetch-fail', broken);
  await finishTrack('guild-prefetch-fail');
  assert.equal(
    musicPlayer.nowPlaying('guild-prefetch-fail')?.title,
    'awkward',
    'it still plays, just the slow way',
  );
  musicPlayer.leave('guild-prefetch-fail');
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
