/* Worldsmith - terrain material table.
 *
 * `terrain` stores the *ground surface material*. Water is deliberately NOT a
 * terrain type: it lives in its own `water` depth field so the fluid sim owns
 * one authoritative answer to "is there water here", and so a lake can drain
 * off a grass tile and leave grass behind. */
(function (WB) {
  'use strict';

  var T = {
    ROCK: 0,
    DIRT: 1,
    SAND: 2,
    GRASS: 3,
    FOREST: 4,
    JUNGLE: 5,
    SAVANNA: 6,
    TAIGA: 7,
    TUNDRA: 8,
    SNOW: 9,
    ICE: 10,
    SWAMP: 11,
    DESERT: 12,
    MOUNTAIN: 13,
    LAVA: 14,
    ASH: 15,
    SCORCHED: 16,
    FARM: 17,
    ROAD: 18,
    RUINS: 19,
    MUD: 20,
    SALT: 21,
    CORRUPT: 22,
    OBSIDIAN: 23,
  };

  /* Material families. The renderer draws a dark outline wherever two
   * neighbouring tiles belong to different families, which is what gives the
   * map crisp biome edges instead of soft gradients. Shades within one family
   * (grass into savanna) blend, so the outlines stay meaningful. */
  var G = {
    ROCK: 0,
    DIRT: 1,
    SAND: 2,
    GRASS: 3,
    FOREST: 4,
    SWAMP: 5,
    SNOW: 6,
    LAVA: 7,
    DEAD: 8,
    ROAD: 9,
  };

  /* name, base colour, per-tile colour jitter, fuel (max vegetation biomass),
   * fertility (food yield), speed (movement multiplier), buildable, family. */
  var DEFS = [];
  function def(id, name, color, jitter, fuel, fertility, speed, buildable, group) {
    DEFS[id] = {
      id: id,
      name: name,
      color: color,
      rgb: hexToRgb(color),
      jitter: jitter,
      fuel: fuel,
      fertility: fertility,
      speed: speed,
      buildable: buildable,
      group: group,
    };
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* Colours are deliberately saturated and a little brighter than life. A
   * naturalistic palette reads as a topographic map; this reads as a game. */
  def(T.ROCK, 'Rock', '#7d766b', 9, 4, 0.0, 0.8, true, G.ROCK);
  def(T.DIRT, 'Dirt', '#7d5a33', 9, 40, 0.35, 1.0, true, G.DIRT);
  def(T.SAND, 'Sand', '#ecd79b', 7, 6, 0.05, 0.85, true, G.SAND);
  def(T.GRASS, 'Grass', '#57ad3c', 10, 110, 0.7, 1.0, true, G.GRASS);
  def(T.FOREST, 'Forest', '#277d33', 12, 235, 0.5, 0.7, true, G.FOREST);
  def(T.JUNGLE, 'Jungle', '#0f6e2b', 13, 255, 0.6, 0.55, true, G.FOREST);
  def(T.SAVANNA, 'Savanna', '#bcae3e', 10, 90, 0.4, 1.0, true, G.GRASS);
  def(T.TAIGA, 'Taiga', '#2d7f5c', 11, 190, 0.3, 0.75, true, G.FOREST);
  def(T.TUNDRA, 'Tundra', '#97a58d', 8, 40, 0.15, 0.9, true, G.SNOW);
  def(T.SNOW, 'Snow', '#f2f8fc', 6, 8, 0.02, 0.7, true, G.SNOW);
  def(T.ICE, 'Ice', '#a8d8ee', 7, 0, 0.0, 0.9, false, G.SNOW);
  def(T.SWAMP, 'Swamp', '#456b34', 11, 160, 0.45, 0.5, false, G.SWAMP);
  def(T.DESERT, 'Desert', '#f0d489', 7, 2, 0.02, 0.8, true, G.SAND);
  def(T.MOUNTAIN, 'Mountain', '#9d9488', 11, 2, 0.0, 0.45, false, G.ROCK);
  def(T.LAVA, 'Lava', '#ff6a1f', 22, 0, 0.0, 0.15, false, G.LAVA);
  def(T.ASH, 'Ash', '#4e4945', 9, 12, 0.2, 0.95, true, G.DEAD);
  def(T.SCORCHED, 'Scorched', '#382f2b', 8, 4, 0.1, 1.0, true, G.DEAD);
  def(T.FARM, 'Farmland', '#c9a83e', 7, 60, 1.6, 1.0, true, G.GRASS);
  def(T.ROAD, 'Road', '#9a8869', 5, 0, 0.0, 1.9, true, G.ROAD);
  def(T.RUINS, 'Ruins', '#82796f', 11, 20, 0.05, 0.85, true, G.DEAD);
  def(T.MUD, 'Mud', '#63513a', 9, 30, 0.3, 0.6, false, G.SWAMP);
  def(T.SALT, 'Salt Flat', '#e6e1d3', 6, 0, 0.0, 1.0, true, G.SAND);
  def(T.CORRUPT, 'Corruption', '#7b2f68', 13, 30, 0.0, 1.1, false, G.DEAD);
  def(T.OBSIDIAN, 'Obsidian', '#2b2430', 8, 0, 0.0, 0.9, true, G.ROCK);

  /* Which materials burn away into ash rather than merely losing vegetation. */
  var CONSUMED_BY_FIRE = {};
  CONSUMED_BY_FIRE[T.FOREST] = T.SCORCHED;
  CONSUMED_BY_FIRE[T.JUNGLE] = T.SCORCHED;
  CONSUMED_BY_FIRE[T.TAIGA] = T.SCORCHED;
  CONSUMED_BY_FIRE[T.GRASS] = T.SCORCHED;
  CONSUMED_BY_FIRE[T.SAVANNA] = T.SCORCHED;
  CONSUMED_BY_FIRE[T.SWAMP] = T.MUD;
  CONSUMED_BY_FIRE[T.FARM] = T.SCORCHED;
  CONSUMED_BY_FIRE[T.RUINS] = T.SCORCHED;

  /* Succession: what a scorched/bare tile becomes as vegetation returns.
   * Resolved by climate, so this is only the fallback ordering. */
  var REGROW = {};
  REGROW[T.SCORCHED] = T.ASH;
  REGROW[T.ASH] = T.DIRT;
  REGROW[T.DIRT] = T.GRASS;
  REGROW[T.MUD] = T.SWAMP;
  REGROW[T.GRASS] = T.FOREST;

  WB.T = T;
  WB.TGROUP = G;
  WB.TERRAIN = DEFS;
  WB.TERRAIN_CONSUMED = CONSUMED_BY_FIRE;
  WB.TERRAIN_REGROW = REGROW;
  WB.hexToRgb = hexToRgb;
})(window.WB || (window.WB = {}));
