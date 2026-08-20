import { EmbedBuilder } from 'discord.js';

/**
 * The messages people see over and over, dressed properly.
 *
 * Verity's yellow down the side, the song as the title, and the fussy detail
 * (who asked for it, where it landed in the queue) small underneath — rather
 * than one long line of bold text in the middle of a busy channel.
 */
const YELLOW = 0xf2d02c;

const base = () => new EmbedBuilder().setColor(YELLOW);

const speedNote = (track) => (track?.speed ? ` · ${track.speed}x` : '');

/** What he says when a track actually starts. */
export const nowPlaying = (track, line) =>
  base()
    .setAuthor({ name: 'Now playing' })
    .setTitle(track.title.slice(0, 256))
    .setDescription(line)
    .setFooter({ text: `asked for by ${track.requestedBy}${speedNote(track)}` });

/** What he says when it goes behind something else. */
export const queued = (title, position, line) =>
  base()
    .setAuthor({ name: `Queued · #${position}` })
    .setTitle(String(title).slice(0, 256))
    .setDescription(line);

/** A whole playlist arriving at once. */
export const queuedMany = (name, count, startedPlaying) =>
  base()
    .setAuthor({ name: 'Playlist added' })
    .setTitle(String(name).slice(0, 256))
    .setDescription(
      startedPlaying
        ? `${count} tracks. starting now, since nothing else was on.`
        : `${count} tracks, waiting behind what is already playing.`,
    );

/** A playlist put away for later. */
export const saved = (name, count, how) =>
  base()
    .setAuthor({ name: 'Kept for later' })
    .setTitle(String(name).slice(0, 256))
    .setDescription(`${count} tracks. \`verityplaylist ${name}\` puts it back on.`)
    .setFooter({ text: how });

/** Something went wrong, and it is worth looking at. */
export const trouble = (line) => base().setColor(0xd9534f).setDescription(line);
