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

  /* name, base colour, per-tile colour jitter, fuel (max vegetation biomass),
   * fertility (food yield), speed (movement multiplier), buildable. */
  var DEFS = [];
  function def(id, name, color, jitter, fuel, fertility, speed, buildable) {
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
    };
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  def(T.ROCK, 'Rock', '#6e6a63', 10, 4, 0.0, 0.8, true);
  def(T.DIRT, 'Dirt', '#6b4f33', 10, 40, 0.35, 1.0, true);
  def(T.SAND, 'Sand', '#d9c48b', 9, 6, 0.05, 0.85, true);
  def(T.GRASS, 'Grass', '#5c9a3f', 11, 110, 0.7, 1.0, true);
  def(T.FOREST, 'Forest', '#2f6b32', 13, 235, 0.5, 0.7, true);
  def(T.JUNGLE, 'Jungle', '#1d5c2b', 14, 255, 0.6, 0.55, true);
  def(T.SAVANNA, 'Savanna', '#9c9a4e', 11, 90, 0.4, 1.0, true);
  def(T.TAIGA, 'Taiga', '#3c6b57', 12, 190, 0.3, 0.75, true);
  def(T.TUNDRA, 'Tundra', '#8a9384', 9, 40, 0.15, 0.9, true);
  def(T.SNOW, 'Snow', '#e8eef2', 7, 8, 0.02, 0.7, true);
  def(T.ICE, 'Ice', '#b3d6e8', 8, 0, 0.0, 0.9, false);
  def(T.SWAMP, 'Swamp', '#4a5c3a', 12, 160, 0.45, 0.5, false);
  def(T.DESERT, 'Desert', '#e0c98f', 9, 2, 0.02, 0.8, true);
  def(T.MOUNTAIN, 'Mountain', '#8b8578', 12, 2, 0.0, 0.45, false);
  def(T.LAVA, 'Lava', '#ff6a1f', 22, 0, 0.0, 0.15, false);
  def(T.ASH, 'Ash', '#4a4642', 10, 12, 0.2, 0.95, true);
  def(T.SCORCHED, 'Scorched', '#3a3330', 9, 4, 0.1, 1.0, true);
  def(T.FARM, 'Farmland', '#b39a4a', 8, 60, 1.6, 1.0, true);
  def(T.ROAD, 'Road', '#8a7a63', 6, 0, 0.0, 1.9, true);
  def(T.RUINS, 'Ruins', '#77706a', 12, 20, 0.05, 0.85, true);
  def(T.MUD, 'Mud', '#5a4a38', 10, 30, 0.3, 0.6, false);
  def(T.SALT, 'Salt Flat', '#ddd8cc', 7, 0, 0.0, 1.0, true);
  def(T.CORRUPT, 'Corruption', '#6b2b5a', 14, 30, 0.0, 1.1, false);
  def(T.OBSIDIAN, 'Obsidian', '#2b2430', 9, 0, 0.0, 0.9, true);

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
  WB.TERRAIN = DEFS;
  WB.TERRAIN_CONSUMED = CONSUMED_BY_FIRE;
  WB.TERRAIN_REGROW = REGROW;
  WB.hexToRgb = hexToRgb;
})(window.WB || (window.WB = {}));
