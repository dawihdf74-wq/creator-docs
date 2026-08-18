import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as store from '../store.js';
import * as memory from '../memory.js';
import { buildTrollBrief, MOODS } from '../persona.js';
import { glitch } from '../glitch.js';
import { notice } from '../reply.js';
import { inCharacterError, REFUSAL_LINE, speak } from '../claude.js';

/** Minimum mood the roast is delivered in, per intensity. */
const MOOD_FLOOR = { gentle: 'friendly', classic: 'clingy', unhinged: 'unhinged' };

const COOLDOWN_MS = 45_000;
const lastTrolled = new Map();

export const data = new SlashCommandBuilder()
  .setName('troll')
  .setDescription('Point Verity at someone. He has been waiting to be asked.')
  .setContexts(InteractionContextType.Guild)
  // Server default: Manage Messages, i.e. moderators. Adjust per-role in
  // Server Settings > Integrations.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((option) =>
    option.setName('user').setDescription('The lucky friend').setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('about')
      .setDescription('What to tease them about (behaviour only)')
      .setMaxLength(200),
  )
  .addStringOption((option) =>
    option
      .setName('intensity')
      .setDescription('How much Verity to use')
      .addChoices(
        { name: 'gentle - affectionate teasing', value: 'gentle' },
        { name: 'classic - a proper roast', value: 'classic' },
        { name: 'unhinged - full analog horror', value: 'unhinged' },
      ),
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user');
  const topic = interaction.options.getString('about');
  const intensity = interaction.options.getString('intensity') ?? 'classic';

  if (target.bot) {
    return interaction.reply(
      notice(
        target.id === interaction.client.user.id
          ? 'no.'
          : 'i do not talk to the other ones. you should not either. :|',
      ),
    );
  }

  if (store.isProtected(interaction.guildId, target.id)) {
    return interaction.reply(
      notice(
        `${target.username} is protected. Verity has agreed to leave them alone, and he is being very good about it.`,
      ),
    );
  }

  const since = Date.now() - (lastTrolled.get(target.id) ?? 0);
  if (since < COOLDOWN_MS) {
    return interaction.reply(
      notice(
        `He just did. Give ${target.username} ${Math.ceil((COOLDOWN_MS - since) / 1000)}s to recover.`,
      ),
    );
  }

  await interaction.deferReply();

  const settings = store.getSettings(interaction.guildId);
  const session = memory.getSession(interaction.channelId, settings.mood);
  const floor = MOOD_FLOOR[intensity] ?? 'clingy';
  const mood = MOODS.indexOf(session.mood) > MOODS.indexOf(floor) ? session.mood : floor;

  const displayName =
    interaction.guild?.members.cache.get(target.id)?.displayName ?? target.username;

  try {
    const { text, refused } = await speak({
      mood,
      guildName: interaction.guild?.name,
      channelName: interaction.channel?.name,
      extra: buildTrollBrief({ target: displayName, topic, intensity }),
      effort: 'medium', // roasts are worth a little more thinking than chatter
      maxTokens: 500,
      messages: [
        ...session.messages,
        {
          role: 'user',
          content: `[${interaction.user.username} (server admin)]: Verity. ${displayName} is right there. Say something to them.`,
        },
      ],
    });

    if (refused || !text) {
      return interaction.editReply(REFUSAL_LINE);
    }

    lastTrolled.set(target.id, Date.now());
    memory.remember(interaction.channelId, 'assistant', text);

    return interaction.editReply({
      content: `${target} ${glitch(text, mood)}`,
      allowedMentions: { users: [target.id] },
    });
  } catch (error) {
    return interaction.editReply(inCharacterError(error));
  }
}
