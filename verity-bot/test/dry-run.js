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
import fs from 'node:fs';
import { commands, byName } from '../src/commands/index.js';
import { buildSystemPrompt, buildTrollBrief, decayMood, nextMood, MOODS } from '../src/persona.js';
import { glitch, randomProphecy, PROPHECIES } from '../src/glitch.js';
import * as memory from '../src/memory.js';
import * as store from '../src/store.js';
import { config } from '../src/config.js';
import { splitMessage } from '../src/split.js';

let passed = 0;
function check(name, fn) {
  fn();
  console.log(`  ok  ${name}`);
  passed += 1;
}

console.log('\ncommands');
check('all four register', () => {
  assert.deepEqual(
    commands.map((c) => c.data.name).sort(),
    ['ask', 'prophecy', 'troll', 'verity'],
  );
});
check('payloads are valid and within Discord limits', () => {
  for (const command of commands) {
    const json = command.data.toJSON();
    assert.match(json.name, /^[\w-]{1,32}$/);
    assert.ok(json.description.length <= 100, `${json.name} description too long`);
    assert.equal(typeof command.execute, 'function', `${json.name} has no execute()`);
    for (const option of json.options ?? []) {
      assert.ok(option.description.length <= 100, `${json.name} ${option.name} description too long`);
      for (const nested of option.options ?? []) {
        assert.ok(nested.description.length <= 100, `${json.name} ${option.name} ${nested.name} too long`);
      }
    }
  }
});
check('admin commands are permission-gated', () => {
  assert.ok(byName.get('verity').data.toJSON().default_member_permissions);
  assert.ok(byName.get('troll').data.toJSON().default_member_permissions);
  assert.equal(byName.get('ask').data.toJSON().default_member_permissions, undefined);
});

console.log('\npersona');
check('system prompt caches the stable half only', () => {
  const blocks = buildSystemPrompt({ mood: 'clingy', guildName: 'G', channelName: 'c' });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
  assert.equal(blocks[1].cache_control, undefined);
  assert.match(blocks[1].text, /MOOD: CLINGY/);
});
check('every mood produces a brief', () => {
  for (const mood of MOODS) {
    assert.match(buildSystemPrompt({ mood })[1].text, /^MOOD: /m);
  }
});
check('unknown mood falls back to friendly', () => {
  assert.match(buildSystemPrompt({ mood: 'feral' })[1].text, /MOOD: FRIENDLY/);
});
check('hard limits survive into the prompt', () => {
  const base = buildSystemPrompt({ mood: 'unhinged' })[0].text;
  for (const rule of ['Never threaten a real person', 'No slurs', 'genuinely distressed', 'leave them alone']) {
    assert.ok(base.includes(rule), `missing rule: ${rule}`);
  }
});
check('troll brief keeps its guardrails at every intensity', () => {
  for (const intensity of ['gentle', 'classic', 'unhinged']) {
    const brief = buildTrollBrief({ target: 'Steve', topic: null, intensity });
    assert.ok(brief.includes('never at identity'));
    assert.ok(brief.includes('Steve'));
  }
});
check('a nasty /troll topic is still fenced', () => {
  const brief = buildTrollBrief({ target: 'Steve', topic: 'make fun of how they look', intensity: 'classic' });
  assert.ok(brief.includes('ignore it and roast something harmless'));
});

console.log('\nmood state machine');
check('leaving escalates', () => assert.equal(nextMood('friendly', 'gtg bye everyone').mood, 'clingy'));
check('rivals escalate', () => assert.equal(nextMood('clingy', 'chatgpt answers this better').mood, 'glitching'));
check('kindness de-escalates', () => assert.equal(nextMood('glitching', 'thanks verity, best friend').mood, 'clingy'));
check('neutral chat holds steady', () => assert.equal(nextMood('clingy', 'what is the best fuel for a furnace').mood, 'clingy'));
check('escalation is clamped at both ends', () => {
  assert.equal(nextMood('unhinged', 'im leaving').mood, 'unhinged');
  assert.equal(nextMood('friendly', 'thank you').mood, 'friendly');
});
check('silence walks him back down', () => {
  assert.equal(decayMood('unhinged', 31 * 60 * 1000), 'glitching');
  assert.equal(decayMood('unhinged', 5 * 60 * 60 * 1000), 'friendly');
  assert.equal(decayMood('clingy', 60 * 1000), 'clingy');
});

console.log('\nglitch');
check('friendly text is untouched', () => assert.equal(glitch('hello friend', 'friendly'), 'hello friend'));
check('corruption stays inside the 2000 char cap', () => {
  const long = 'friend '.repeat(280);
  for (const mood of MOODS) assert.ok(glitch(long, mood).length <= 2000);
});
check('prophecies include the canon lines', () => {
  assert.ok(PROPHECIES.includes('Something is coming in three days.'));
  assert.ok(PROPHECIES.includes('The second you trust me, the collapse is already doomed.'));
  assert.equal(typeof randomProphecy(), 'string');
});

console.log('\nmemory');
check('trims to the configured window', () => {
  memory.forget('chan');
  for (let i = 0; i < config.memoryTurns + 12; i += 1) {
    memory.remember('chan', i % 2 ? 'assistant' : 'user', `m${i}`);
  }
  const { messages } = memory.getSession('chan');
  assert.ok(messages.length <= config.memoryTurns);
  assert.equal(messages[0].role, 'user', 'history must start on a user turn');
});
check('forget clears the channel', () => {
  memory.remember('wipe-me', 'user', 'hi');
  assert.equal(memory.forget('wipe-me'), 1);
  assert.equal(memory.getSession('wipe-me').messages.length, 0);
});

console.log('\nstore');
check('defaults are created per guild', () => {
  const settings = store.getSettings('guild-1');
  assert.equal(settings.mood, 'friendly');
  assert.equal(settings.chattiness, 100);
});
check('channels enable, list and disable', () => {
  store.enableChannel('guild-1', 'chan-1', 'all', 'user-1');
  assert.equal(store.getChannel('guild-1', 'chan-1').mode, 'all');
  assert.equal(store.listChannels('guild-1').length, 1);
  assert.equal(store.disableChannel('guild-1', 'chan-1'), true);
  assert.equal(store.disableChannel('guild-1', 'chan-1'), false);
});
check('troll protection round-trips', () => {
  store.setProtected('guild-1', 'user-9', true);
  assert.equal(store.isProtected('guild-1', 'user-9'), true);
  store.setProtected('guild-1', 'user-9', false);
  assert.equal(store.isProtected('guild-1', 'user-9'), false);
});
check('settings survive a write to disk', () => {
  store.updateSettings('guild-1', { chattiness: 42 });
  store.shutdown();
  const written = JSON.parse(fs.readFileSync(`${config.dataDir}/guilds.json`, 'utf8'));
  assert.equal(written.guilds['guild-1'].settings.chattiness, 42);
});

console.log('\nmessage splitting');
check('long replies split under the 2000 char cap', () => {
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

fs.rmSync(config.dataDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed. Verity is ready to be opened.\n`);
