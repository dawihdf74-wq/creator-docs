/* Worldsmith - name generation.
 *
 * Syllable chains per culture. Every person, village and kingdom gets a name so
 * the chronicle can talk about them by name, which is most of what makes a
 * sandbox feel like a world rather than a screensaver. */
(function (WB) {
  'use strict';

  var SETS = {
    human: {
      start: [
        'Al',
        'Bran',
        'Cor',
        'Dun',
        'El',
        'Gar',
        'Hal',
        'Jor',
        'Kel',
        'Mar',
        'Ned',
        'Ost',
        'Rob',
        'Sel',
        'Tor',
        'Wil',
      ],
      mid: ['a', 'e', 'i', 'o', 'ar', 'en', 'il', 'or', 'um', 'and'],
      end: ['ric', 'wyn', 'don', 'mar', 'ley', 'ton', 'ard', 'is', 'a', 'os', 'en', 'ith'],
    },
    elf: {
      start: ['Ae', 'Cel', 'El', 'Fae', 'Gal', 'Ith', 'Lyr', 'Mel', 'Nym', 'Sil', 'Thae', 'Var'],
      mid: ['la', 'ri', 'thi', 'ae', 'lo', 'ni', 'ea', 'wy'],
      end: ['riel', 'las', 'wen', 'dor', 'thil', 'nor', 'ys', 'ael', 'ien'],
    },
    orc: {
      start: ['Bru', 'Dro', 'Gash', 'Gor', 'Kra', 'Mog', 'Nar', 'Rok', 'Sna', 'Thok', 'Urz', 'Zug'],
      mid: ['ag', 'ur', 'ok', 'ba', 'gr', 'um'],
      end: ['gul', 'nak', 'zog', 'dak', 'rak', 'mash', 'grim', 'tuk'],
    },
    dwarf: {
      start: ['Bal', 'Dur', 'Bro', 'Grim', 'Hal', 'Kaz', 'Mor', 'Nor', 'Thra', 'Thor', 'Vol', 'Dwal'],
      mid: ['a', 'o', 'ur', 'ad', 'ki', 'un'],
      end: ['in', 'or', 'ek', 'dur', 'bur', 'grim', 'foot', 'beard', 'axe'],
    },
  };

  var KINGDOM_PREFIX = [
    'Vael',
    'Thorn',
    'Iron',
    'Storm',
    'Ash',
    'Gold',
    'Grey',
    'Red',
    'High',
    'Black',
    'Sun',
    'Moon',
    'Frost',
    'Ember',
    'Silver',
    'Deep',
    'Wild',
    'Old',
  ];
  var KINGDOM_SUFFIX = [
    'hold',
    'gard',
    'mere',
    'reach',
    'fell',
    'crest',
    'vale',
    'march',
    'spire',
    'watch',
    'haven',
    'moor',
    'wood',
    'stead',
    'ford',
    'cliff',
  ];
  var KINGDOM_TITLE = [
    'Kingdom',
    'Realm',
    'Dominion',
    'Empire',
    'Confederacy',
    'Union',
    'League',
    'Sovereignty',
    'Hegemony',
    'Free States',
  ];

  var VILLAGE_PRE = [
    'Green',
    'Stone',
    'River',
    'Lake',
    'Pine',
    'Wind',
    'Fair',
    'Cold',
    'Long',
    'Bright',
    'Dark',
    'Salt',
    'Elm',
    'Rook',
    'Bell',
    'Fox',
  ];
  var VILLAGE_SUF = [
    'brook',
    'field',
    'bury',
    'ton',
    'ham',
    'wick',
    'dale',
    'ridge',
    'gate',
    'well',
    'shire',
    'bend',
    'hollow',
    'row',
    'cross',
  ];

  var EPITHETS = [
    'the Brave',
    'the Cruel',
    'the Wise',
    'the Mad',
    'the Bold',
    'the Quiet',
    'the Red',
    'the Grim',
    'the Kind',
    'the Fat',
    'the Swift',
    'the Cursed',
    'the Blessed',
    'the Unlucky',
    'the Great',
    'the Younger',
  ];

  function pick(rng, arr) {
    return arr[Math.floor(rng.next() * arr.length) % arr.length];
  }

  var Names = {};

  Names.person = function (rng, race) {
    var set = SETS[race] || SETS.human;
    var n = pick(rng, set.start);
    if (rng.chance(0.55)) n += pick(rng, set.mid);
    n += pick(rng, set.end);
    return n;
  };

  Names.titled = function (rng, race) {
    var n = Names.person(rng, race);
    if (rng.chance(0.25)) n += ' ' + pick(rng, EPITHETS);
    return n;
  };

  Names.kingdom = function (rng) {
    return pick(rng, KINGDOM_TITLE) + ' of ' + pick(rng, KINGDOM_PREFIX) + pick(rng, KINGDOM_SUFFIX);
  };

  Names.kingdomShort = function (rng) {
    return pick(rng, KINGDOM_PREFIX) + pick(rng, KINGDOM_SUFFIX);
  };

  Names.village = function (rng) {
    return pick(rng, VILLAGE_PRE) + pick(rng, VILLAGE_SUF);
  };

  Names.creature = function (rng, species) {
    var syll = ['Gro', 'Vex', 'Zar', 'Mor', 'Kha', 'Ny', 'Ul', 'Ser', 'Ob', 'Ith'];
    var tail = ['ax', 'oth', 'ura', 'ax', 'ith', 'ok', 'ara', 'ux'];
    return pick(rng, syll) + pick(rng, tail);
  };

  WB.Names = Names;
})(window.WB || (window.WB = {}));
