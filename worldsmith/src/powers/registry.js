/* Worldsmith - the god powers.
 *
 * Every tool in the game is one entry in this registry: an id, how to draw its
 * button, and an apply() that receives the world position and brush radius. The
 * toolbar is generated from this list, so adding a power is a single object and
 * nothing else in the UI has to change. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var K = WB.PKIND;

  var list = [];
  var byId = {};

  var GROUPS = [
    { key: 'terrain', label: 'Terrain', icon: 'mountain' },
    { key: 'nature', label: 'Nature', icon: 'tree' },
    { key: 'disasters', label: 'Disasters', icon: 'meteor' },
    { key: 'creatures', label: 'Creatures', icon: 'paw' },
    { key: 'civ', label: 'Kingdoms', icon: 'flag' },
    { key: 'tools', label: 'Tools', icon: 'hand' },
  ];

  function register(p) {
    if (p.usesBrush === undefined) p.usesBrush = true;
    if (p.cooldown === undefined) p.cooldown = 0;
    list.push(p);
    byId[p.id] = p;
    return p;
  }

  /* --- Terrain brushes ---------------------------------------------------- */
  function terrainBrush(id, label, icon, color, terrain, opts) {
    opts = opts || {};
    return register({
      id: id,
      label: label,
      group: 'terrain',
      icon: icon,
      color: color,
      desc: opts.desc || 'Paint ' + label.toLowerCase() + '.',
      apply: function (game, x, y, r) {
        var world = game.world;
        world.forEachInDisc(x, y, r, function (i) {
          if (opts.dry) world.water[i] = 0;
          world.fire[i] = 0;
          world.lava[i] = 0;
          world.setTerrain(i, terrain);
          var max = WB.TERRAIN[terrain].fuel;
          world.fuel[i] = Math.round(max * (opts.fuel === undefined ? 0.85 : opts.fuel));
          if (opts.heightTo !== undefined) {
            world.height[i] += (opts.heightTo - world.height[i]) * 0.35;
          }
          WB.Water.wake(world, i);
        });
      },
    });
  }

  register({
    id: 'raise',
    label: 'Raise Land',
    group: 'terrain',
    icon: 'hill',
    color: '#b08a5a',
    desc: 'Push the ground upward. Water runs off it.',
    apply: function (game, x, y, r) {
      WB.Blast.raise(game.world, x, y, r, 0.035);
    },
  });

  register({
    id: 'lower',
    label: 'Lower Land',
    group: 'terrain',
    icon: 'pit',
    color: '#7a6a58',
    desc: 'Dig the ground down. Dig below the sea and it floods.',
    apply: function (game, x, y, r) {
      WB.Blast.lower(game.world, x, y, r, 0.035);
    },
  });

  register({
    id: 'flatten',
    label: 'Flatten',
    group: 'terrain',
    icon: 'brush',
    color: '#9a9a92',
    desc: 'Level terrain toward its local average.',
    apply: function (game, x, y, r) {
      WB.Blast.flatten(game.world, x, y, r);
    },
  });

  register({
    id: 'mountain',
    label: 'Mountain',
    group: 'terrain',
    icon: 'mountain',
    color: '#8b8578',
    desc: 'Raise a peak with bare stone on top.',
    apply: function (game, x, y, r) {
      var world = game.world;
      WB.Blast.raise(world, x, y, r, 0.11);
      world.forEachInDisc(x, y, r * 0.7, function (i) {
        world.water[i] = 0;
        world.setTerrain(i, T.MOUNTAIN);
        world.fuel[i] = 0;
        WB.Water.wake(world, i);
      });
    },
  });

  register({
    id: 'water',
    label: 'Water',
    group: 'terrain',
    icon: 'drop',
    color: '#4a9ac4',
    desc: 'Pour water. It flows downhill and pools.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i, xx, yy, d) {
        WB.Water.add(world, i, Math.round(14 * (1 - d / (r + 0.001))) + 4);
      });
    },
  });

  register({
    id: 'ocean',
    label: 'Deep Ocean',
    group: 'terrain',
    icon: 'wave',
    color: '#2a6a94',
    desc: 'Carve a deep basin and fill it.',
    apply: function (game, x, y, r) {
      var world = game.world;
      WB.Blast.lower(world, x, y, r, 0.05);
      world.forEachInDisc(x, y, r, function (i) {
        world.water[i] = Math.min(255, world.water[i] + 40);
        world.fuel[i] = 0;
        WB.Water.wake(world, i);
      });
    },
  });

  register({
    id: 'drain',
    label: 'Drain',
    group: 'terrain',
    icon: 'eraser',
    color: '#c8bfa8',
    desc: 'Remove water without touching the ground.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i) {
        if (world.water[i]) {
          world.water[i] = 0;
          world.setTerrain(i, WB.Worldgen.biomeFor(world, i, 0));
          WB.Water.wake(world, i);
        }
      });
    },
  });

  terrainBrush('grass', 'Grass', 'grass', '#5c9a3f', T.GRASS, { dry: true });
  terrainBrush('forest', 'Forest', 'tree', '#2f6b32', T.FOREST, { dry: true, fuel: 1 });
  terrainBrush('jungle', 'Jungle', 'palm', '#1d5c2b', T.JUNGLE, { dry: true, fuel: 1 });
  terrainBrush('taiga', 'Taiga', 'tree', '#3c6b57', T.TAIGA, { dry: true, fuel: 1 });
  terrainBrush('savanna', 'Savanna', 'grass', '#9c9a4e', T.SAVANNA, { dry: true });
  terrainBrush('sand', 'Sand', 'sand', '#d9c48b', T.SAND, { dry: true, fuel: 0.2 });
  terrainBrush('desert', 'Desert', 'cactus', '#e0c98f', T.DESERT, { dry: true, fuel: 0.1 });
  terrainBrush('swamp', 'Swamp', 'drop', '#4a5c3a', T.SWAMP, { fuel: 0.9 });
  terrainBrush('snow', 'Snow', 'snowflake', '#e8eef2', T.SNOW, { dry: true, fuel: 0.1 });
  terrainBrush('ice', 'Ice', 'crystal', '#b3d6e8', T.ICE, { dry: true, fuel: 0 });
  terrainBrush('rock', 'Rock', 'crystal', '#6e6a63', T.ROCK, { dry: true, fuel: 0 });
  terrainBrush('road', 'Road', 'road', '#8a7a63', T.ROAD, { dry: true, fuel: 0 });
  terrainBrush('ash', 'Ash Waste', 'sand', '#4a4642', T.ASH, { dry: true, fuel: 0.2 });
  terrainBrush('corrupt', 'Corruption', 'rift', '#6b2b5a', T.CORRUPT, { dry: true, fuel: 0.2 });

  register({
    id: 'lava',
    label: 'Lava',
    group: 'terrain',
    icon: 'flame',
    color: '#ff6a1f',
    desc: 'Pour molten rock. It flows, burns, and cools into stone.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i, xx, yy, d) {
        WB.Lava.add(world, i, Math.round(60 * (1 - d / (r + 0.001))) + 20);
      });
    },
  });

  /* --- Nature -------------------------------------------------------------- */
  register({
    id: 'fertilize',
    label: 'Fertilise',
    group: 'nature',
    icon: 'grass',
    color: '#7ec46a',
    desc: 'Grow vegetation instantly.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i) {
        if (world.water[i] > 3) return;
        var max = WB.TERRAIN[world.terrain[i]].fuel;
        world.fuel[i] = Math.min(max, world.fuel[i] + 40);
        world.moist[i] = Math.min(255, world.moist[i] + 20);
        world.markDirtyIdx(i);
      });
    },
  });

  register({
    id: 'defoliate',
    label: 'Wither',
    group: 'nature',
    icon: 'eraser',
    color: '#a08a5a',
    desc: 'Strip all plant life from the ground.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i) {
        world.fuel[i] = 0;
        world.moist[i] = Math.max(0, world.moist[i] - 30);
        world.markDirtyIdx(i);
      });
    },
  });

  register({
    id: 'rain',
    label: 'Rain',
    group: 'nature',
    icon: 'cloud',
    color: '#7aa8c8',
    desc: 'A drifting rain cloud. Douses fire, waters the land.',
    usesBrush: false,
    cooldown: 20,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Cloud(x, y, 'rain', { radius: 6 + r * 1.5, life: 700 }));
      if (game.audio) game.audio.play('splash', { intensity: 0.4 });
    },
  });

  register({
    id: 'sunbeam',
    label: 'Sun Ray',
    group: 'nature',
    icon: 'sun',
    color: '#f0c848',
    desc: 'Warm and dry the ground; melts snow and ice.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i) {
        world.baseTemp[i] = Math.min(120, world.baseTemp[i] + 1);
        if (world.moist[i] > 0) world.moist[i]--;
        if (world.terrain[i] === T.ICE || world.terrain[i] === T.SNOW) {
          if (world.rng.chance(0.15)) {
            world.setTerrain(i, T.DIRT);
            WB.Water.add(world, i, 4);
          }
        }
        world.markDirtyIdx(i);
      });
    },
  });

  register({
    id: 'frost',
    label: 'Frost',
    group: 'nature',
    icon: 'snowflake',
    color: '#a8d8f0',
    desc: 'Chill the ground. Water freezes over and becomes walkable.',
    apply: function (game, x, y, r) {
      var world = game.world;
      world.forEachInDisc(x, y, r, function (i) {
        world.baseTemp[i] = Math.max(-120, world.baseTemp[i] - 2);
        world.temp[i] = Math.max(-128, world.temp[i] - 2);
        if (world.fire[i]) {
          world.fire[i] = 0;
        }
        world.markDirtyIdx(i);
      });
    },
  });

  register({
    id: 'wind',
    label: 'Shift Wind',
    group: 'nature',
    icon: 'tornado',
    color: '#b8c8d8',
    desc: 'Point the prevailing wind at your cursor. Fire follows it.',
    usesBrush: false,
    apply: function (game, x, y) {
      var world = game.world;
      var dx = x - world.w / 2,
        dy = y - world.h / 2;
      var m = Math.sqrt(dx * dx + dy * dy) || 1;
      world.windX = (dx / m) * 1.2;
      world.windY = (dy / m) * 1.2;
      if (game.audio) game.audio.play('whoosh', { intensity: 0.5 });
    },
  });

  /* --- Disasters ------------------------------------------------------------ */
  register({
    id: 'ignite',
    label: 'Fire',
    group: 'disasters',
    icon: 'flame',
    color: '#ff8a2a',
    desc: 'Set the land alight. It spreads with the wind.',
    apply: function (game, x, y, r) {
      WB.Fire.igniteArea(game.world, x, y, r, 130);
      if (game.audio) game.audio.play('crackle', { intensity: 0.5 });
    },
  });

  register({
    id: 'extinguish',
    label: 'Extinguish',
    group: 'disasters',
    icon: 'drop',
    color: '#6ac8e0',
    desc: 'Put out fires and cool the ground.',
    apply: function (game, x, y, r) {
      WB.Fire.douse(game.world, x, y, r, 60);
    },
  });

  register({
    id: 'meteor',
    label: 'Meteor',
    group: 'disasters',
    icon: 'meteor',
    color: '#ff7a3a',
    desc: 'A rock from the sky. Crater, firestorm, shockwave.',
    usesBrush: false,
    cooldown: 8,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Meteor(x, y, { size: 4 + r * 0.9 }));
    },
  });

  register({
    id: 'meteorshower',
    label: 'Meteor Shower',
    group: 'disasters',
    icon: 'star',
    color: '#ffb03a',
    desc: 'A barrage of smaller impacts across a wide area.',
    usesBrush: false,
    cooldown: 40,
    apply: function (game, x, y, r) {
      var n = 10 + Math.round(r);
      for (var i = 0; i < n; i++) {
        var a = WB.fx.next() * 6.283,
          d = WB.fx.next() * (12 + r * 3);
        game.effects.add(
          new WB.FX.Meteor(x + Math.cos(a) * d, y + Math.sin(a) * d, {
            size: 2 + WB.fx.next() * 3,
            fall: 20 + WB.fx.next() * 40,
          })
        );
      }
    },
  });

  register({
    id: 'lightning',
    label: 'Lightning',
    group: 'disasters',
    icon: 'bolt',
    color: '#ffe14d',
    desc: 'A bolt from the blue. Ignites and kills.',
    usesBrush: false,
    cooldown: 4,
    apply: function (game, x, y) {
      Powers.strikeLightning(game, Math.round(x), Math.round(y));
    },
  });

  register({
    id: 'thunderstorm',
    label: 'Thunderstorm',
    group: 'disasters',
    icon: 'storm',
    color: '#8a9ab8',
    desc: 'A roaming storm that rains and hurls lightning.',
    usesBrush: false,
    cooldown: 30,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Cloud(x, y, 'storm', { radius: 8 + r, life: 1100 }));
    },
  });

  register({
    id: 'tornado',
    label: 'Tornado',
    group: 'disasters',
    icon: 'tornado',
    color: '#c8c0b0',
    desc: 'A funnel that tears up ground and throws everything it touches.',
    usesBrush: false,
    cooldown: 30,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Tornado(x, y, { radius: 3 + r * 0.6 }));
      if (game.audio) game.audio.play('whoosh', { intensity: 0.9 });
    },
  });

  register({
    id: 'volcano',
    label: 'Volcano',
    group: 'disasters',
    icon: 'volcano',
    color: '#e0562a',
    desc: 'Opens a vent that erupts lava and builds its own mountain.',
    usesBrush: false,
    cooldown: 60,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Volcano(x, y, { power: 0.6 + r * 0.12 }));
    },
  });

  register({
    id: 'earthquake',
    label: 'Earthquake',
    group: 'disasters',
    icon: 'quake',
    color: '#b09070',
    desc: 'Rips a fault across the land and levels what stands on it.',
    usesBrush: false,
    cooldown: 40,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Earthquake(x, y, { length: 30 + r * 8 }));
    },
  });

  register({
    id: 'fissure',
    label: 'Magma Fissure',
    group: 'disasters',
    icon: 'quake',
    color: '#e07a3a',
    desc: 'A quake that opens onto magma.',
    usesBrush: false,
    cooldown: 60,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Earthquake(x, y, { length: 24 + r * 6, magma: true }));
    },
  });

  register({
    id: 'tsunami',
    label: 'Tsunami',
    group: 'disasters',
    icon: 'tsunami',
    color: '#3a8ab8',
    desc: 'A wall of water sweeps in from the nearest map edge.',
    usesBrush: false,
    cooldown: 120,
    apply: function (game, x, y) {
      var world = game.world;
      /* Come from whichever edge the click is closest to. */
      var dl = x,
        dr = world.w - x,
        dt = y,
        db = world.h - y;
      var min = Math.min(dl, dr, dt, db);
      var edge = min === dl ? 0 : min === dr ? 1 : min === dt ? 2 : 3;
      game.effects.add(new WB.FX.Tsunami(edge, { amp: 140 }));
      if (game.audio) game.audio.play('rumble', { intensity: 0.9 });
    },
  });

  register({
    id: 'nuke',
    label: 'Nuke',
    group: 'disasters',
    icon: 'nuke',
    color: '#e8e04a',
    desc: 'Total annihilation, then fallout that mutates survivors.',
    usesBrush: false,
    cooldown: 90,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Nuke(x, y, { radius: 16 + r * 2.5 }));
    },
  });

  register({
    id: 'acidrain',
    label: 'Acid Rain',
    group: 'disasters',
    icon: 'acid',
    color: '#8ad23a',
    desc: 'Dissolves vegetation, soil and skin.',
    usesBrush: false,
    cooldown: 30,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Cloud(x, y, 'acid', { radius: 7 + r, life: 800 }));
    },
  });

  register({
    id: 'sandstorm',
    label: 'Sandstorm',
    group: 'disasters',
    icon: 'sand',
    color: '#d8b878',
    desc: 'Scours the land down to bare sand.',
    usesBrush: false,
    cooldown: 30,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Cloud(x, y, 'sand', { radius: 8 + r, life: 900 }));
    },
  });

  register({
    id: 'blizzard',
    label: 'Blizzard',
    group: 'disasters',
    icon: 'blizzard',
    color: '#c8e0f0',
    desc: 'Freezes everything under it, permanently cooling the ground.',
    usesBrush: false,
    cooldown: 30,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Cloud(x, y, 'snow', { radius: 8 + r, life: 900 }));
    },
  });

  register({
    id: 'plague',
    label: 'Plague',
    group: 'disasters',
    icon: 'skull',
    color: '#9ac05a',
    desc: 'Infects the living. Spreads by contact and kills slowly.',
    apply: function (game, x, y, r) {
      var u = game.units;
      if (!u) return;
      u.forEachNear(x, y, Math.max(2, r), function (i) {
        if (u.traits[i] & WB.TRAIT.UNDEAD) return;
        u.disease[i] = 1200;
        u.traits[i] |= WB.TRAIT.DISEASED;
      });
    },
  });

  register({
    id: 'blackhole',
    label: 'Black Hole',
    group: 'disasters',
    icon: 'blackhole',
    color: '#a06ad8',
    desc: 'Devours land and everything on it, then collapses.',
    usesBrush: false,
    cooldown: 90,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.BlackHole(x, y, { radius: 8 + r * 1.6 }));
    },
  });

  register({
    id: 'rift',
    label: 'Demon Rift',
    group: 'disasters',
    icon: 'rift',
    color: '#d84ad8',
    desc: 'A tear that corrupts the land and vomits demons.',
    usesBrush: false,
    cooldown: 60,
    apply: function (game, x, y) {
      game.effects.add(new WB.FX.Rift(x, y, {}));
    },
  });

  register({
    id: 'toxiccloud',
    label: 'Toxic Cloud',
    group: 'disasters',
    icon: 'acid',
    color: '#b06ad8',
    desc: 'Drifting poison that irradiates and corrodes.',
    usesBrush: false,
    cooldown: 30,
    apply: function (game, x, y, r) {
      game.effects.add(new WB.FX.Cloud(x, y, 'toxic', { radius: 7 + r, life: 800 }));
    },
  });

  register({
    id: 'iceage',
    label: 'Ice Age',
    group: 'disasters',
    icon: 'snowflake',
    color: '#9ac8e8',
    desc: 'Drops the whole world’s temperature.',
    usesBrush: false,
    cooldown: 60,
    global: true,
    apply: function (game) {
      WB.Climate.shiftTemperature(game.world, -8);
      game.chronicle.log('disaster', 'The world grows colder.');
    },
  });

  register({
    id: 'heatwave',
    label: 'Heat Wave',
    group: 'disasters',
    icon: 'sun',
    color: '#f09030',
    desc: 'Raises the whole world’s temperature.',
    usesBrush: false,
    cooldown: 60,
    global: true,
    apply: function (game) {
      WB.Climate.shiftTemperature(game.world, 8);
      game.chronicle.log('disaster', 'A scorching heat settles over the world.');
    },
  });

  register({
    id: 'drought',
    label: 'Drought',
    group: 'disasters',
    icon: 'cactus',
    color: '#d0a840',
    desc: 'Dries the world out. Fires spread far more easily.',
    usesBrush: false,
    cooldown: 60,
    global: true,
    apply: function (game) {
      WB.Climate.shiftMoisture(game.world, -40);
      game.chronicle.log('disaster', 'A great drought begins.');
    },
  });

  register({
    id: 'deluge',
    label: 'Deluge',
    group: 'disasters',
    icon: 'wave',
    color: '#4a9ac4',
    desc: 'Soaks the world and raises the sea.',
    usesBrush: false,
    cooldown: 60,
    global: true,
    apply: function (game) {
      WB.Climate.shiftMoisture(game.world, 40);
      WB.Water.setSeaLevel(game.world, game.world.seaLevel + 0.03);
      game.chronicle.log('disaster', 'The waters rise.');
    },
  });

  /* --- Creatures ------------------------------------------------------------ */
  function spawner(key, group, icon, color, count) {
    var sp = WB.Species.byKey(key);
    return register({
      id: 'spawn_' + key,
      label: sp.label,
      group: group,
      icon: icon,
      color: color,
      desc: 'Place ' + sp.label.toLowerCase() + 's into the world.',
      cooldown: 3,
      apply: function (game, x, y, r) {
        var n = count === undefined ? Math.max(1, Math.round(r * 0.6)) : count;
        for (var i = 0; i < n; i++) {
          game.units.spawnValid(key, x + WB.fx.range(-r, r), y + WB.fx.range(-r, r), {});
        }
        if (game.audio) game.audio.play('pop', { intensity: 0.4 });
      },
    });
  }

  spawner('sheep', 'creatures', 'paw', '#e8e4dc');
  spawner('deer', 'creatures', 'paw', '#a87a48');
  spawner('rabbit', 'creatures', 'paw', '#b8a494');
  spawner('boar', 'creatures', 'paw', '#5a4438');
  spawner('wolf', 'creatures', 'paw', '#7a7d84');
  spawner('bear', 'creatures', 'paw', '#4a3428');
  spawner('fish', 'creatures', 'drop', '#4a9ac4');
  spawner('bird', 'creatures', 'paw', '#3a4a6a');
  spawner('crab', 'creatures', 'paw', '#c4502a');
  spawner('dragon', 'creatures', 'dragon', '#8a2a2a', 1);
  spawner('demon', 'creatures', 'rift', '#8a1f4a', 1);
  spawner('undead', 'creatures', 'skull', '#9aa88a', 3);
  spawner('wraith', 'creatures', 'skull', '#5a4a8a', 1);
  spawner('kraken', 'creatures', 'blob', '#6a3a7a', 1);
  spawner('worm', 'creatures', 'blob', '#a0704a', 1);

  /* --- Kingdoms ------------------------------------------------------------- */
  WB.Species.CIV.forEach(function (key) {
    var sp = WB.Species.byKey(key);
    register({
      id: 'found_' + key,
      label: sp.label + ' Village',
      group: 'civ',
      icon: 'house',
      color: sp.color,
      desc: 'Found a new ' + sp.label.toLowerCase() + ' settlement with its own kingdom.',
      usesBrush: false,
      cooldown: 12,
      apply: function (game, x, y) {
        var world = game.world;
        var px = world.clampX(Math.round(x)),
          py = world.clampY(Math.round(y));
        if (game.villages.siteScore(px, py, key) < 0) {
          /* Nudge to the nearest workable spot instead of failing silently. */
          var site = game.villages.findSite(key, px, py, 12);
          if (!site) {
            game.chronicle.log('info', 'No room to settle there.');
            return;
          }
          px = site.x;
          py = site.y;
        }
        game.villages.found(px, py, key, null, 5);
        if (game.audio) game.audio.play('chime');
      },
    });

    register({
      id: 'people_' + key,
      label: sp.label,
      group: 'civ',
      icon: 'person',
      color: sp.color,
      desc: 'Drop loose ' + sp.label.toLowerCase() + 's with no home.',
      cooldown: 3,
      apply: function (game, x, y, r) {
        for (var i = 0; i < Math.max(1, Math.round(r * 0.5)); i++) {
          game.units.spawnValid(key, x + WB.fx.range(-r, r), y + WB.fx.range(-r, r), {});
        }
      },
    });
  });

  register({
    id: 'boat',
    label: 'Boat',
    group: 'civ',
    icon: 'boat',
    color: '#8a6a3a',
    desc: 'Place a boat on the water.',
    usesBrush: false,
    apply: function (game, x, y) {
      var world = game.world;
      game.buildings.place(WB.BTYPE.BOAT, world.clampX(Math.round(x)), world.clampY(Math.round(y)), -1, 0);
    },
  });

  register({
    id: 'raze',
    label: 'Raze',
    group: 'civ',
    icon: 'ruin',
    color: '#8a7a6a',
    desc: 'Flatten every building in the brush.',
    apply: function (game, x, y, r) {
      WB.Blast.razeBuildings(game, x, y, Math.max(1.5, r), true);
    },
  });

  register({
    id: 'advance',
    label: 'Advance Age',
    group: 'civ',
    icon: 'star',
    color: '#e8c23a',
    desc: 'Push every kingdom into the next era.',
    usesBrush: false,
    cooldown: 30,
    global: true,
    apply: function (game) {
      var ks = game.kingdoms.alive();
      for (var i = 0; i < ks.length; i++) {
        var next = WB.Kingdoms.AGES[ks[i].age + 1];
        if (next) ks[i].knowledge = Math.max(ks[i].knowledge, next.knowledge);
      }
      game.chronicle.log('age', 'Knowledge floods the world.');
    },
  });

  register({
    id: 'warmonger',
    label: 'Sow Discord',
    group: 'civ',
    icon: 'sword',
    color: '#d04a4a',
    desc: 'Turn every kingdom against its neighbours.',
    usesBrush: false,
    cooldown: 60,
    global: true,
    apply: function (game) {
      var ks = game.kingdoms.alive();
      for (var a = 0; a < ks.length; a++)
        for (var b = a + 1; b < ks.length; b++) {
          game.kingdoms.adjustRelation(ks[a], ks[b], -60);
          if (game.kingdoms.relation(ks[a], ks[b]) < -55)
            game.kingdoms.declareWar(ks[a], ks[b], 'a divine whisper');
        }
    },
  });

  register({
    id: 'peace',
    label: 'Impose Peace',
    group: 'civ',
    icon: 'shield',
    color: '#5ec46a',
    desc: 'End every war at once.',
    usesBrush: false,
    cooldown: 30,
    global: true,
    apply: function (game) {
      var ks = game.kingdoms.alive();
      for (var a = 0; a < ks.length; a++)
        for (var b = a + 1; b < ks.length; b++) {
          game.kingdoms.adjustRelation(ks[a], ks[b], 90);
          game.kingdoms.makePeace(ks[a], ks[b]);
        }
      game.chronicle.log('peace', 'A great peace is imposed upon the world.');
    },
  });

  /* --- Tools ---------------------------------------------------------------- */
  register({
    id: 'inspect',
    label: 'Inspect',
    group: 'tools',
    icon: 'magnify',
    color: '#e6e2d8',
    desc: 'Click anything to read its story.',
    usesBrush: false,
    apply: function (game, x, y) {
      var i = game.units.pickAt(x, y, 2.5);
      game.select(i);
    },
  });

  register({
    id: 'grab',
    label: 'Grab & Throw',
    group: 'tools',
    icon: 'hand',
    color: '#e8c8a0',
    desc: 'Drag a creature and fling it.',
    usesBrush: false,
    grab: true,
    apply: function () {
      /* handled by the input layer: see Game.pointer* */
    },
  });

  register({
    id: 'heal',
    label: 'Heal',
    group: 'tools',
    icon: 'heart',
    color: '#e8607a',
    desc: 'Restore health and cure disease.',
    apply: function (game, x, y, r) {
      var u = game.units;
      u.forEachNear(x, y, Math.max(2, r), function (i) {
        u.heal(i, 40);
        u.disease[i] = 0;
        u.traits[i] &= ~WB.TRAIT.DISEASED;
        u.food[i] = Math.min(100, u.food[i] + 30);
      });
      if (game.particles) game.particles.burst(K.MAGIC, x, y, 8, 2, 0.7, 0.5);
    },
  });

  register({
    id: 'food',
    label: 'Drop Food',
    group: 'tools',
    icon: 'food',
    color: '#e0a03a',
    desc: 'Feed everyone nearby and stock the local granary.',
    apply: function (game, x, y, r) {
      var u = game.units;
      u.forEachNear(x, y, Math.max(2, r), function (i) {
        u.food[i] = 100;
        if (u.home[i] >= 0) {
          var v = game.villages.list[u.home[i]];
          if (v && v.alive) v.food = Math.min(900, v.food + 6);
        }
      });
    },
  });

  register({
    id: 'smite',
    label: 'Smite',
    group: 'tools',
    icon: 'bolt',
    color: '#ff5a4a',
    desc: 'Kill whatever is under the brush.',
    apply: function (game, x, y, r) {
      var u = game.units;
      var doomed = [];
      u.forEachNear(x, y, Math.max(1.5, r), function (i) {
        doomed.push(i);
      });
      for (var k = 0; k < doomed.length; k++) u.kill(doomed[k], 'divine wrath');
      if (game.audio) game.audio.play('zap', { intensity: 0.6 });
    },
  });

  function traitTool(id, label, icon, color, desc, fn) {
    return register({
      id: id,
      label: label,
      group: 'tools',
      icon: icon,
      color: color,
      desc: desc,
      apply: function (game, x, y, r) {
        var u = game.units;
        u.forEachNear(x, y, Math.max(2, r), function (i) {
          fn(u, i, game);
        });
      },
    });
  }

  traitTool('bless', 'Bless', 'star', '#ffe14d', 'Grants resilience and long life.', function (u, i) {
    u.traits[i] |= WB.TRAIT.BLESSED;
    u.traits[i] &= ~WB.TRAIT.CURSED;
    u.maxAge[i] *= 1.5;
    u.story(i, 'Was blessed.');
  });

  traitTool('curse', 'Curse', 'skull', '#8a4ad8', 'Fragile, short-lived, unlucky.', function (u, i) {
    u.traits[i] |= WB.TRAIT.CURSED;
    u.traits[i] &= ~WB.TRAIT.BLESSED;
    u.maxAge[i] *= 0.6;
    u.story(i, 'Was cursed.');
  });

  traitTool('immortal', 'Immortality', 'clock', '#c8e8ff', 'Cannot be harmed or age.', function (u, i) {
    u.traits[i] |= WB.TRAIT.IMMORTAL;
    u.story(i, 'Became immortal.');
  });

  traitTool('mutate', 'Mutate', 'dna', '#7ad86a', 'Random beneficial mutation.', function (u, i) {
    u.mutate(i);
  });

  traitTool('enrage', 'Enrage', 'sword', '#e04a2a', 'Attacks everything on sight.', function (u, i) {
    u.traits[i] |= WB.TRAIT.ENRAGED;
    u.story(i, 'Flew into a rage.');
  });

  traitTool('tame', 'Tame', 'heart', '#7ac8e0', 'Calms a creature and stops its rage.', function (u, i) {
    u.traits[i] |= WB.TRAIT.TAMED;
    u.traits[i] &= ~WB.TRAIT.ENRAGED;
    u.target[i] = -1;
  });

  traitTool('empower', 'Empower', 'shield', '#e8b03a', 'Levels a creature up.', function (u, i) {
    u.level[i] = Math.min(255, u.level[i] + 3);
    u.maxHp[i] *= 1.6;
    u.hp[i] = u.maxHp[i];
    u.traits[i] |= WB.TRAIT.STRONG;
    u.story(i, 'Was empowered.');
  });

  /* --- Shared helpers -------------------------------------------------------- */
  var Powers = {
    list: list,
    groups: GROUPS,
    register: register,
    byId: function (id) {
      return byId[id];
    },
    inGroup: function (key) {
      return list.filter(function (p) {
        return p.group === key;
      });
    },
  };

  /* Used by the lightning power and by storm clouds. */
  Powers.strikeLightning = function (game, x, y) {
    var world = game.world;
    x = world.clampX(Math.round(x));
    y = world.clampY(Math.round(y));
    var i = y * world.w + x;

    game.effects.add(new WB.FX.Bolt(x, y));
    WB.Fire.ignite(world, i, 200);
    WB.Blast.damageUnits(game, x + 0.5, y + 0.5, 2.2, 220, 'lightning');
    WB.Blast.razeBuildings(game, x + 0.5, y + 0.5, 1.4, true);
    if (world.water[i] <= 3 && world.fuel[i] < 10 && world.rng.chance(0.4)) {
      world.setTerrain(i, WB.T.SCORCHED);
    }
    if (game.particles) game.particles.burst(K.SPARK, x + 0.5, y + 0.5, 14, 5, 0.5, 0.5);
    game.camera.addShake(3);
    if (game.audio) game.audio.play('zap', { intensity: 0.8 });
  };

  WB.Powers = Powers;
})(window.WB || (window.WB = {}));
