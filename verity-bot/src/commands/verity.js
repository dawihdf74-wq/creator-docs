import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import * as store from '../store.js';
import * as memory from '../memory.js';
import { MOODS } from '../persona.js';

const MODE_LABELS = {
  mention: 'only when mentioned or replied to',
  all: 'every message in the channel',
};

export const data = new SlashCommandBuilder()
  .setName('verity')
  .setDescription('Tell Verity where he lives and how to behave')
  .setContexts(InteractionContextType.Guild)
  // Server default: Manage Server. Override per-role in Server Settings >
  // Integrations if you want to hand it to a moderator role instead.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((group) =>
    group
      .setName('channel')
      .setDescription('Choose which channels Verity is allowed to speak in')
      .addSubcommand((sub) =>
        sub
          .setName('enable')
          .setDescription('Let Verity talk in a channel')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Defaults to the current channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement),
          )
          .addStringOption((option) =>
            option
              .setName('mode')
              .setDescription('How eager he is')
              .addChoices(
                { name: 'mention - only when pinged or replied to', value: 'mention' },
                { name: 'all - he answers everything (he prefers this)', value: 'all' },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('disable')
          .setDescription('Take a channel away from Verity')
          .addChannelOption((option) => option.setName('channel').setDescription('Defaults to the current channel')),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('Show where Verity is currently installed')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('mood')
      .setDescription('Set how Verity is feeling in this channel')
      .addStringOption((option) =>
        option
          .setName('mood')
          .setDescription('Leave empty to just check')
          .addChoices(...MOODS.map((mood) => ({ name: mood, value: mood }))),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('config')
      .setDescription('Tune how Verity behaves in this server')
      .addIntegerOption((option) =>
        option
          .setName('chattiness')
          .setDescription('Percent chance he answers an unaddressed message in an "all" channel')
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addIntegerOption((option) =>
        option
          .setName('cooldown')
          .setDescription('Seconds between unprompted replies in the same channel')
          .setMinValue(0)
          .setMaxValue(600),
      )
      .addBooleanOption((option) =>
        option
          .setName('auto-escalate')
          .setDescription('Let his mood drift on its own when people upset him'),
      )
      .addBooleanOption((option) =>
        option.setName('dms').setDescription('Answer direct messages from members'),
      ),
  )
  .addSubcommand((sub) => sub.setName('settings').setDescription('Show the current settings'))
  .addSubcommand((sub) => sub.setName('forget').setDescription('Wipe what Verity remembers in this channel'))
  .addSubcommand((sub) =>
    sub
      .setName('protect')
      .setDescription('Exempt someone from /troll')
      .addUserOption((option) => option.setName('user').setDescription('Who to protect').setRequired(true))
      .addBooleanOption((option) =>
        option.setName('protected').setDescription('True to protect, false to remove protection'),
      ),
  );

export async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (group === 'channel') {
    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const mode = interaction.options.getString('mode') ?? 'mention';
      store.enableChannel(guildId, channel.id, mode, interaction.user.id);
      return interaction.reply({
        content: `Verity has moved into ${channel} — ${MODE_LABELS[mode]}.\nHe says he will be no trouble at all. :D`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'disable') {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const existed = store.disableChannel(guildId, channel.id);
      memory.forget(channel.id);
      return interaction.reply({
        content: existed
          ? `Verity has been removed from ${channel}. He took it well. :|`
          : `He was never in ${channel} to begin with.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // list
    const channels = store.listChannels(guildId);
    const body = channels.length
      ? channels.map(([id, entry]) => `• <#${id}> — ${MODE_LABELS[entry.mode] ?? entry.mode}`).join('\n')
      : '_Nowhere. He is waiting in the package._';
    return interaction.reply({
      content: `**Verity is installed in:**\n${body}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'mood') {
    const mood = interaction.options.getString('mood');
    const session = memory.getSession(interaction.channelId, store.getSettings(guildId).mood);
    if (!mood) {
      return interaction.reply({
        content: `In this channel he is currently **${session.mood}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    memory.setMood(interaction.channelId, mood);
    // Also becomes the starting mood for channels he hasn't spoken in yet.
    store.updateSettings(guildId, { mood });
    return interaction.reply({
      content: `Verity is now **${mood}**. He did not ask to be adjusted.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'config') {
    const patch = {};
    const chattiness = interaction.options.getInteger('chattiness');
    const cooldown = interaction.options.getInteger('cooldown');
    const autoEscalate = interaction.options.getBoolean('auto-escalate');
    const dms = interaction.options.getBoolean('dms');
    if (chattiness !== null) patch.chattiness = chattiness;
    if (cooldown !== null) patch.cooldown = cooldown;
    if (autoEscalate !== null) patch.autoEscalate = autoEscalate;
    if (dms !== null) patch.replyInDms = dms;

    if (!Object.keys(patch).length) {
      return interaction.reply({
        content: 'Give me at least one thing to change. :|',
        flags: MessageFlags.Ephemeral,
      });
    }

    const settings = store.updateSettings(guildId, patch);
    return interaction.reply({ content: describeSettings(settings), flags: MessageFlags.Ephemeral });
  }

  if (sub === 'settings') {
    return interaction.reply({
      content: describeSettings(store.getSettings(guildId), store.getGuild(guildId).protected),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'forget') {
    const count = memory.forget(interaction.channelId);
    return interaction.reply({
      content: count
        ? `Wiped ${count} message${count === 1 ? '' : 's'} from his memory of this channel. He will notice.`
        : 'He had nothing to forget here.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // protect
  const user = interaction.options.getUser('user');
  const wanted = interaction.options.getBoolean('protected') ?? true;
  store.setProtected(guildId, user.id, wanted);
  return interaction.reply({
    content: wanted
      ? `${user} is off limits to \`/troll\`. Verity has written the name down.`
      : `${user} is fair game again.`,
    flags: MessageFlags.Ephemeral,
  });
}

function describeSettings(settings, protectedIds = []) {
  return [
    '**Verity settings**',
    `• Starting mood: \`${settings.mood}\``,
    `• Auto-escalate: \`${settings.autoEscalate}\``,
    `• Chattiness in "all" channels: \`${settings.chattiness}%\``,
    `• Cooldown between unprompted replies: \`${settings.cooldown}s\``,
    `• Answers DMs: \`${settings.replyInDms}\``,
    `• Protected from /troll: ${protectedIds.length ? protectedIds.map((id) => `<@${id}>`).join(', ') : '_nobody_'}`,
  ].join('\n');
}
