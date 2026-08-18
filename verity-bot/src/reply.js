import { MessageFlags } from 'discord.js';
import { config } from './config.js';

/**
 * Everything Verity says is public by default — command confirmations
 * included, so the whole channel sees what he was told to do.
 *
 * Set VERITY_PUBLIC_REPLIES=false to make admin/system notices visible only
 * to the person who ran the command.
 */
export function notice(content) {
  return config.publicReplies ? { content } : { content, flags: MessageFlags.Ephemeral };
}
