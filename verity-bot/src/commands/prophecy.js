import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { glitch, randomProphecy } from '../glitch.js';
import * as memory from '../memory.js';

export const data = new SlashCommandBuilder()
  .setName('prophecy')
  .setDescription('Ask Verity what is coming. He always has an answer ready.')
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );

export async function execute(interaction) {
  // No model call: these are canned, instant, and free.
  const mood = memory.getSession(interaction.channelId).mood;
  return interaction.reply(glitch(randomProphecy(), mood));
}
