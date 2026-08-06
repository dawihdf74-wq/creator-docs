/* Worldsmith - the bestiary.
 *
 * One table drives spawning, rendering, the food chain and the inspector. A new
 * creature is one entry here plus (optionally) a sprite in the atlas. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var LIST = [];
  var BY_KEY = {};

  function species(def) {
    def.id = LIST.length;
    def.sprite = def.sprite || 'animal_sheep';
    def.hp = def.hp || 30;
    def.dmg = def.dmg || 2;
    def.speed = def.speed || 0.05;
    def.maxAge = def.maxAge || 9000;
    def.breed = def.breed === undefined ? 0.0012 : def.breed;
    def.scale = def.scale || 1;
    def.diet = def.diet || 'plant';
    def.habitat = def.habitat || 'land';
    def.klass = def.klass || 'animal';
    LIST.push(def);
    BY_KEY[def.key] = def;
    return def;
  }

  /* --- Civilised races ---------------------------------------------------
   * `biomes` weights village founding; `age` is the tech era they start in. */
  species({
    key: 'human',
    label: 'Human',
    klass: 'civ',
    sprite: 'unit_human',
    hp: 60,
    dmg: 6,
    speed: 0.055,
    maxAge: 24000,
    diet: 'both',
    breed: 0.0016,
    biomes: [T.GRASS, T.FOREST, T.SAVANNA, T.DIRT, T.FARM],
    color: '#4a8fd8',
  });
  species({
    key: 'elf',
    label: 'Elf',
    klass: 'civ',
    sprite: 'unit_elf',
    hp: 52,
    dmg: 7,
    speed: 0.065,
    maxAge: 48000,
    diet: 'plant',
    breed: 0.0009,
    biomes: [T.FOREST, T.JUNGLE, T.TAIGA],
    color: '#5ec46a',
  });
  species({
    key: 'orc',
    label: 'Orc',
    klass: 'civ',
    sprite: 'unit_orc',
    hp: 78,
    dmg: 10,
    speed: 0.05,
    maxAge: 18000,
    diet: 'meat',
    breed: 0.0022,
    biomes: [T.SAVANNA, T.DESERT, T.SCORCHED, T.ASH, T.SWAMP],
    color: '#c85a3a',
  });
  species({
    key: 'dwarf',
    label: 'Dwarf',
    klass: 'civ',
    sprite: 'unit_dwarf',
    hp: 72,
    dmg: 8,
    speed: 0.045,
    maxAge: 32000,
    diet: 'both',
    breed: 0.0011,
    biomes: [T.MOUNTAIN, T.ROCK, T.SNOW, T.TUNDRA],
    color: '#d8a23a',
  });

  /* --- Wildlife ---------------------------------------------------------- */
  species({
    key: 'sheep',
    label: 'Sheep',
    sprite: 'animal_sheep',
    hp: 26,
    dmg: 1,
    speed: 0.035,
    diet: 'plant',
    breed: 0.0026,
    color: '#e8e4dc',
  });
  species({
    key: 'deer',
    label: 'Deer',
    sprite: 'animal_deer',
    hp: 34,
    dmg: 2,
    speed: 0.075,
    diet: 'plant',
    breed: 0.0018,
    color: '#a87a48',
  });
  species({
    key: 'rabbit',
    label: 'Rabbit',
    sprite: 'animal_rabbit',
    hp: 12,
    dmg: 1,
    speed: 0.085,
    diet: 'plant',
    breed: 0.005,
    maxAge: 4000,
    color: '#b8a494',
  });
  species({
    key: 'boar',
    label: 'Boar',
    sprite: 'animal_boar',
    hp: 46,
    dmg: 6,
    speed: 0.055,
    diet: 'both',
    breed: 0.0016,
    color: '#5a4438',
  });
  species({
    key: 'wolf',
    label: 'Wolf',
    sprite: 'animal_wolf',
    hp: 44,
    dmg: 9,
    speed: 0.08,
    diet: 'meat',
    breed: 0.0009,
    color: '#7a7d84',
  });
  species({
    key: 'bear',
    label: 'Bear',
    sprite: 'animal_bear',
    hp: 95,
    dmg: 16,
    speed: 0.055,
    diet: 'both',
    breed: 0.0005,
    color: '#4a3428',
  });
  species({
    key: 'fish',
    label: 'Fish',
    sprite: 'animal_fish',
    hp: 8,
    dmg: 1,
    speed: 0.06,
    diet: 'plant',
    habitat: 'water',
    breed: 0.004,
    maxAge: 5000,
    color: '#4a9ac4',
  });
  species({
    key: 'bird',
    label: 'Bird',
    sprite: 'animal_bird',
    hp: 10,
    dmg: 1,
    speed: 0.1,
    diet: 'plant',
    habitat: 'air',
    breed: 0.002,
    maxAge: 5000,
    color: '#3a4a6a',
  });
  species({
    key: 'crab',
    label: 'Crab',
    sprite: 'animal_crab',
    hp: 20,
    dmg: 4,
    speed: 0.03,
    diet: 'both',
    breed: 0.0018,
    color: '#c4502a',
  });

  /* --- Monsters ---------------------------------------------------------- */
  species({
    key: 'dragon',
    label: 'Dragon',
    klass: 'monster',
    sprite: 'monster_dragon',
    hp: 900,
    dmg: 70,
    speed: 0.09,
    habitat: 'air',
    diet: 'meat',
    breed: 0.00004,
    maxAge: 200000,
    scale: 1.6,
    fireproof: true,
    breathesFire: true,
    color: '#8a2a2a',
  });
  species({
    key: 'demon',
    label: 'Demon',
    klass: 'monster',
    sprite: 'monster_demon',
    hp: 320,
    dmg: 34,
    speed: 0.07,
    diet: 'meat',
    breed: 0.0001,
    maxAge: 90000,
    scale: 1.3,
    fireproof: true,
    ignites: true,
    color: '#8a1f4a',
  });
  species({
    key: 'undead',
    label: 'Undead',
    klass: 'monster',
    sprite: 'monster_undead',
    hp: 90,
    dmg: 12,
    speed: 0.035,
    diet: 'meat',
    breed: 0,
    maxAge: 60000,
    scale: 1.1,
    infectious: true,
    color: '#9aa88a',
  });
  species({
    key: 'wraith',
    label: 'Wraith',
    klass: 'monster',
    sprite: 'monster_wraith',
    hp: 150,
    dmg: 24,
    speed: 0.085,
    habitat: 'air',
    diet: 'meat',
    breed: 0.00006,
    maxAge: 120000,
    scale: 1.2,
    color: '#5a4a8a',
  });
  species({
    key: 'kraken',
    label: 'Kraken',
    klass: 'monster',
    sprite: 'monster_kraken',
    hp: 700,
    dmg: 55,
    speed: 0.06,
    habitat: 'water',
    diet: 'meat',
    breed: 0.00003,
    maxAge: 200000,
    scale: 1.6,
    color: '#6a3a7a',
  });
  species({
    key: 'worm',
    label: 'Sand Worm',
    klass: 'monster',
    sprite: 'monster_worm',
    hp: 480,
    dmg: 45,
    speed: 0.05,
    diet: 'meat',
    breed: 0.00004,
    maxAge: 150000,
    scale: 1.5,
    burrows: true,
    color: '#a0704a',
  });

  var CIV_KEYS = ['human', 'elf', 'orc', 'dwarf'];
  var ANIMAL_KEYS = ['sheep', 'deer', 'rabbit', 'boar', 'wolf', 'bear', 'fish', 'bird', 'crab'];
  var MONSTER_KEYS = ['dragon', 'demon', 'undead', 'wraith', 'kraken', 'worm'];

  WB.Species = {
    list: LIST,
    byKey: function (k) {
      return BY_KEY[k];
    },
    byId: function (i) {
      return LIST[i];
    },
    id: function (k) {
      return BY_KEY[k] ? BY_KEY[k].id : 0;
    },
    CIV: CIV_KEYS,
    ANIMALS: ANIMAL_KEYS,
    MONSTERS: MONSTER_KEYS,
  };
})(window.WB || (window.WB = {}));
