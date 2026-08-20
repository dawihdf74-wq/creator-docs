import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as player from './player.js';

/**
 * The playlist as something you can click.
 *
 * Discord allows five rows of five components, so ten tracks a page leaves
 * two rows of numbered buttons and one row for moving between pages.
 */
export const PAGE_SIZE = 10;

/** Every button carries what it does and what it does it to. */
export const ID = {
  next: (position) => `vpl:next:${position}`,
  page: (page) => `vpl:page:${page}`,
  skip: (page) => `vpl:skip:${page}`,
};

export const parseId = (customId) => {
  const [prefix, action, value] = String(customId ?? '').split(':');
  return prefix === 'vpl' ? { action, value: Number(value) || 0 } : null;
};

const clamp = (page, pages) => Math.min(Math.max(1, page || 1), pages);

/**
 * @returns {{embeds: any[], components: any[], page: number}} a message payload
 */
export function buildPlaylistView(guildId, page = 1, { name, note } = {}) {
  const current = player.nowPlaying(guildId);
  const queue = player.queued(guildId);
  const { loop, speed, volume, paused } = player.settings(guildId);

  const pages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
  const wanted = clamp(page, pages);
  const offset = (wanted - 1) * PAGE_SIZE;
  const slice = queue.slice(offset, offset + PAGE_SIZE);
  const badge = (track) => (track?.speed ? ` \`${track.speed}x\`` : '');

  const embed = new EmbedBuilder()
    .setColor(0xf2d02c) // the same yellow he is
    .setTitle(name ? `Playlist — ${name}` : 'Playlist')
    .setDescription(
      [
        current
          ? `▶ **${current.title}**${badge(current)}\n_asked for by ${current.requestedBy}_`
          : '▶ _nothing playing_',
        '',
        ...slice.map(
          (track, index) =>
            `**${offset + index + 1}.** ${track.title}${badge(track)} — _${track.requestedBy}_`,
        ),
        slice.length ? '' : '_nothing waiting_',
      ]
        .join('\n')
        .slice(0, 4000),
    );

  const flags = [
    queue.length ? `${queue.length} waiting` : '',
    pages > 1 ? `page ${wanted}/${pages}` : '',
    loop !== 'off' ? `loop ${loop}` : '',
    speed !== 1 ? `${speed}x` : '',
    volume !== 1 ? `${Math.round(volume * 100)}%` : '',
    paused ? 'paused' : '',
  ].filter(Boolean);

  // Discord rejects an empty footer, so only set one when there is something.
  const footer = [note, flags.join(' · '), slice.length ? '⏫ plays that one next' : '']
    .filter(Boolean)
    .join('  ·  ')
    .slice(0, 2048);
  if (footer) embed.setFooter({ text: footer });

  const components = [];
  for (let start = 0; start < slice.length; start += 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        slice.slice(start, start + 5).map((track, index) => {
          const position = offset + start + index + 1;
          return new ButtonBuilder()
            .setCustomId(ID.next(position))
            .setLabel(String(position))
            .setEmoji('⏫')
            .setStyle(ButtonStyle.Primary);
        }),
      ),
    );
  }

  if (pages > 1 || current) {
    const nav = new ActionRowBuilder();
    if (pages > 1) {
      nav.addComponents(
        new ButtonBuilder()
          .setCustomId(ID.page(wanted - 1))
          .setEmoji('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(wanted <= 1),
        new ButtonBuilder()
          .setCustomId(ID.page(wanted + 1))
          .setEmoji('▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(wanted >= pages),
      );
    }
    nav.addComponents(
      new ButtonBuilder()
        .setCustomId(ID.page(wanted))
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(ID.skip(wanted))
        .setEmoji('⏭')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!current),
    );
    components.push(nav);
  }

  return { embeds: [embed], components, page: wanted };
}
