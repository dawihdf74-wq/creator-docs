import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as store from '../store.js';
import * as memory from '../memory.js';
import * as quota from '../quota.js';
import * as throttle from '../throttle.js';
import { config } from '../config.js';
import { nextMood } from '../persona.js';
import { glitch } from '../glitch.js';
import { inCharacterError, REFUSAL_LINE, speak } from '../ai.js';

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
  const limits = interaction.guildId ? store.getSettings(interaction.guildId) : config.defaults;
  const windowMs = limits.quotaHours * 60 * 60 * 1000;

  const budget = quota.check(
    interaction.guildId,
    interaction.user.id,
    limits.questionLimit,
    windowMs,
  );
  if (!budget.allowed) {
    return interaction.reply(
      `that is all ${limits.questionLimit} of your questions, friend. you get more ${quota.resetTimestamp(budget.resetsAt)} :|`,
    );
  }

  if (!throttle.take()) {
    return interaction.reply(
      `not right now. i am rationed. try again in ${throttle.waitSeconds()} seconds :|`,
    );
  }

  // Always public: whatever he says, the channel sees it.
  await interaction.deferReply();

  const session = memory.getSession(interaction.channelId, limits.mood);

  if (limits.autoEscalate) {
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
    quota.spend(interaction.guildId, interaction.user.id, limits.questionLimit, windowMs);

    return interaction.editReply(glitch(text, session.mood).slice(0, 2000));
  } catch (error) {
    return interaction.editReply(inCharacterError(error));
  }
}
