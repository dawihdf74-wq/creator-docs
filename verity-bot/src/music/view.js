import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import * as player from './player.js';

/**
 * The playlist as something you can click.
 *
 * A dropdown of song titles rather than numbered buttons, for two reasons a
 * numbered panel got wrong: a button labelled "4" does not tell you which
 * song it is, and queue numbers move the instant anyone reorders anything,
 * so the same number means a different song a moment later. Each option
 * carries the track's own id, so picking one always gets the song you read.
 */
export const PAGE_SIZE = 25; // Discord's ceiling for a select menu

export const ID = {
  pick: (page) => `vpl:pick:${page}`,
  page: (page) => `vpl:page:${page}`,
  skip: (page) => `vpl:skip:${page}`,
};

export const parseId = (customId) => {
  const [prefix, action, value] = String(customId ?? '').split(':');
  return prefix === 'vpl' ? { action, value: Number(value) || 0 } : null;
};

/** Discord truncates hard, so do it here where an ellipsis can be added. */
const fit = (text, limit) => {
  const clean =
    String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim() || '—';
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
};

/**
 * @returns {{embeds: any[], components: any[], page: number}} a message payload
 */
export function buildPlaylistView(guildId, page = 1, { name, note } = {}) {
  const current = player.nowPlaying(guildId);
  const queue = player.queued(guildId);
  const { loop, speed, volume, paused } = player.settings(guildId);

  const pages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
  const wanted = Math.min(Math.max(1, page || 1), pages);
  const offset = (wanted - 1) * PAGE_SIZE;
  const slice = queue.slice(offset, offset + PAGE_SIZE);
  const badge = (track) => (track?.speed ? ` \`${track.speed}x\`` : '');

  const embed = new EmbedBuilder()
    .setColor(0xf2d02c)
    .setTitle(name ? `Playlist — ${name}` : 'Playlist')
    .setDescription(
      [
        current
          ? `▶ **${current.title}**${badge(current)}\n_put on by ${current.requestedBy}_`
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

  const footer = [note, flags.join(' · ')].filter(Boolean).join('  ·  ').slice(0, 2048);
  if (footer) embed.setFooter({ text: footer });

  const components = [];

  if (slice.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ID.pick(wanted))
          .setPlaceholder('Pick a song — it plays next')
          .addOptions(
            slice.map((track, index) =>
              new StringSelectMenuOptionBuilder()
                // The song's own name is the label, so you click what you read.
                .setLabel(fit(track.title, 100))
                .setDescription(
                  fit(
                    `#${offset + index + 1} · asked for by ${track.requestedBy}${track.speed ? ` · ${track.speed}x` : ''}`,
                    100,
                  ),
                )
                .setValue(track.id ?? `pos:${offset + index + 1}`),
            ),
          ),
      ),
    );
  }

  const controls = new ActionRowBuilder();
  if (pages > 1) {
    controls.addComponents(
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
  controls.addComponents(
    new ButtonBuilder()
      .setCustomId(ID.page(wanted))
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(ID.skip(wanted))
      .setEmoji('⏭')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!current),
  );
  components.push(controls);

  return { embeds: [embed], components, page: wanted };
}
