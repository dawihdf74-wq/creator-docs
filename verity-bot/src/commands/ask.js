import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as store from '../store.js';
import * as memory from '../memory.js';
import { nextMood } from '../persona.js';
import { glitch } from '../glitch.js';
import { inCharacterError, REFUSAL_LINE, speak } from '../claude.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask Verity something. He is always awake.')
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  )
  .addStringOption((option) =>
    option
      .setName('question')
      .setDescription('What do you want to ask him?')
      .setRequired(true)
      .setMaxLength(1500),
  );

export async function execute(interaction) {
  const question = interaction.options.getString('question');

  // Always public: whatever he says, the channel sees it.
  await interaction.deferReply();

  const settings = interaction.guildId
    ? store.getSettings(interaction.guildId)
    : { mood: 'friendly', autoEscalate: true };
  const session = memory.getSession(interaction.channelId, settings.mood);

  if (settings.autoEscalate) {
    const { mood, reason } = nextMood(session.mood, question);
    if (reason) session.mood = mood;
  }

  const name = interaction.member?.displayName ?? interaction.user.username;
  const turn = { role: 'user', content: `[${name}]: ${question}` };

  try {
    const { text, refused } = await speak({
      mood: session.mood,
      guildName: interaction.guild?.name,
      channelName: interaction.channel?.name,
      messages: [...session.messages, turn],
    });

    if (refused || !text) return interaction.editReply(REFUSAL_LINE);

    memory.remember(interaction.channelId, 'user', turn.content);
    memory.remember(interaction.channelId, 'assistant', text);
    memory.markReplied(interaction.channelId);

    return interaction.editReply(glitch(text, session.mood).slice(0, 2000));
  } catch (error) {
    return interaction.editReply(inCharacterError(error));
  }
}
