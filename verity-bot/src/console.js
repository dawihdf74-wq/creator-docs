import readline from 'node:readline';
import { config } from './config.js';
import * as store from './store.js';
import * as memory from './memory.js';
import * as quota from './quota.js';
import * as throttle from './throttle.js';
import * as modelChain from './models.js';
import { MOODS } from './persona.js';
import { speak, inCharacterError } from './ai.js';
import { splitMessage } from './split.js';
import { match as matchAnswer } from './faq.js';

/**
 * A control console in the terminal Verity is running in.
 *
 * Everything the slash commands do, without Discord in the way: handy when
 * commands are locked to two people, when Discord has not caught up with a
 * command change, or when you just want to see what he is doing.
 */

const HELP = `
  status                 what he is doing right now
  channels               where he is installed
  say <#channel> <text>  post a message as Verity
  ask <text>             ask him something here, without touching Discord
  mood [<#channel>] <m>  ${MOODS.join(' | ')}
  wipe [<#channel>]      forget a channel's conversation
  faq                    list the canned answers
  faq add <trigger[, trigger]> = <answer>
  faq remove <n>         drop answer number n
  faq test <text>        see which answer a message would hit
  quota [reset]          who has spent their questions
  models                 the fallback chain and what is spent
  help                   this
  quit                   shut him down
`;

/**
 * The command dispatcher, separated from the terminal plumbing so it can be
 * driven directly in tests.
 *
 * @param {object} client a Discord client, or anything shaped like one
 * @param {(line?: string) => void} out where output goes
 */
export function createConsole(client, out = (line = '') => console.log(line), onQuit = () => {}) {
  /** The guild to act on: the only one he is in, unless there are several. */
  const guildId = () => client.guilds.cache.first()?.id ?? 'dm';

  /** Accepts <#id>, a raw id, or a channel name. */
  function findChannel(token) {
    if (!token) return null;
    const id = token.replace(/[<#>]/g, '');
    return (
      client.channels.cache.get(id) ??
      client.channels.cache.find((channel) => channel.name === token.replace(/^#/, '')) ??
      null
    );
  }

  async function run(line) {
    const [command, ...rest] = line.trim().split(/\s+/);
    const args = rest.join(' ');

    switch ((command ?? '').toLowerCase()) {
      case '':
        return;

      case 'help':
        return out(HELP);

      case 'status': {
        const guild = client.guilds.cache.first();
        out(`  provider   ${config.provider}${config.isLocal ? ' (local)' : ''}`);
        out(`  models     ${modelChain.available().join(' → ') || 'all spent'}`);
        out(
          `  server     ${guild?.name ?? 'none'} · ${store.listChannels(guildId()).length} channel(s)`,
        );
        out(`  uptime     ${Math.round(process.uptime() / 60)} min`);
        out(`  throttled  ${throttle.isCooling() ? `yes, ${throttle.waitSeconds()}s left` : 'no'}`);
        out(`  answers    ${store.listAnswers(guildId()).length} canned`);
        return;
      }

      case 'channels': {
        const channels = store.listChannels(guildId());
        if (!channels.length) return out('  nowhere yet — use /verity channel enable in Discord');
        for (const [id, entry] of channels) {
          const name = client.channels.cache.get(id)?.name ?? id;
          out(`  #${name} — ${entry.mode} — mood: ${memory.getSession(id).mood}`);
        }
        return;
      }

      case 'say': {
        const [target, ...words] = rest;
        const channel = findChannel(target);
        if (!channel) return out('  which channel? try: say #general hello');
        if (!words.length) return out('  say what?');
        for (const chunk of splitMessage(words.join(' '))) await channel.send(chunk);
        return out(`  sent to #${channel.name}`);
      }

      case 'ask': {
        if (!args) return out('  ask him what?');
        try {
          const { text } = await speak({
            mood: store.getSettings(guildId()).mood,
            messages: [{ role: 'user', content: `[console]: ${args}` }],
          });
          return out(`  > ${text}`);
        } catch (error) {
          return out(`  ${inCharacterError(error)}`);
        }
      }

      case 'mood': {
        const maybeChannel = findChannel(rest[0]);
        const mood = (maybeChannel ? rest[1] : rest[0])?.toLowerCase();
        if (!MOODS.includes(mood)) return out(`  pick one of: ${MOODS.join(', ')}`);
        if (maybeChannel) {
          memory.setMood(maybeChannel.id, mood);
          return out(`  #${maybeChannel.name} is now ${mood}`);
        }
        store.updateSettings(guildId(), { mood });
        for (const [id] of store.listChannels(guildId())) memory.setMood(id, mood);
        return out(`  everywhere is now ${mood}`);
      }

      case 'wipe': {
        const channel = findChannel(rest[0]);
        if (channel) {
          memory.forget(channel.id);
          return out(`  forgot #${channel.name}`);
        }
        for (const [id] of store.listChannels(guildId())) memory.forget(id);
        return out('  forgot everything');
      }

      case 'faq':
        return faq(rest, out, guildId);

      case 'quota': {
        if (rest[0] === 'reset') {
          const cleared = quota.reset(guildId());
          return out(`  cleared ${cleared} budget(s)`);
        }
        const settings = store.getSettings(guildId());
        return out(
          settings.questionLimit
            ? `  ${settings.questionLimit} answers per person every ${settings.quotaHours}h`
            : '  no question limit',
        );
      }

      case 'models': {
        const live = new Set(modelChain.available());
        for (const model of modelChain.all()) {
          out(
            `  ${live.has(model) ? '·' : '×'} ${model}${live.has(model) ? '' : '  (out of budget)'}`,
          );
        }
        return;
      }

      case 'quit':
      case 'exit':
      case 'stop':
        out('  he does not want you to go.');
        return onQuit();

      default:
        return out(`  no. try "help".`);
    }
  }

  function faq(rest, out, guildId) {
    const [sub, ...tail] = rest;
    const entries = store.listAnswers(guildId());

    if (!sub || sub === 'list') {
      if (!entries.length)
        return out('  no canned answers yet — faq add ip, server ip = play.example.com');
      entries.forEach((entry, index) => {
        out(
          `  ${index}. [${entry.triggers.join(', ')}] → ${entry.answer}  (${entry.hits ?? 0} hits)`,
        );
      });
      return;
    }

    if (sub === 'add') {
      const [triggerPart, ...answerParts] = tail.join(' ').split('=');
      const answer = answerParts.join('=').trim();
      const triggers = triggerPart
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean);
      if (!triggers.length || !answer) {
        return out(
          '  format: faq add server ip, whats the ip = the ip is play.example.com, {user}',
        );
      }
      store.addAnswer(guildId(), triggers, answer);
      return out(`  added. he will answer [${triggers.join(', ')}] instantly, for free.`);
    }

    if (sub === 'remove' || sub === 'rm') {
      const removed = store.removeAnswer(guildId(), Number(tail[0]));
      return out(removed ? `  removed "${removed.answer}"` : '  no answer with that number');
    }

    if (sub === 'test') {
      const hit = matchAnswer(entries, tail.join(' '));
      return out(hit ? `  → ${hit.answer}` : '  nothing matches — he would think about it instead');
    }

    return out('  faq | faq add <triggers> = <answer> | faq remove <n> | faq test <text>');
  }

  return { run, help: HELP };
}

/** Wires the dispatcher above to the terminal Verity is running in. */
export function startConsole(client) {
  // No TTY means this is running as a service, where a prompt is just noise.
  if (!process.stdin.isTTY) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'verity> ',
  });

  const { run } = createConsole(
    client,
    (line = '') => console.log(line),
    () => {
      rl.close();
      process.emit('SIGINT');
    },
  );

  rl.on('line', async (line) => {
    try {
      await run(line);
    } catch (error) {
      console.error('  console error:', error.message);
    }
    rl.prompt();
  });
  rl.on('SIGINT', () => process.emit('SIGINT'));

  console.log('\n  type "help" for the console commands\n');
  rl.prompt();
}
