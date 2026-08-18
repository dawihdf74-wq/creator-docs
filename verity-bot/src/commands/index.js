import * as ask from './ask.js';
import * as prophecy from './prophecy.js';
import * as troll from './troll.js';
import * as verity from './verity.js';

export const commands = [verity, ask, troll, prophecy];

/** name -> module, for the interaction router. */
export const byName = new Map(commands.map((command) => [command.data.name, command]));
