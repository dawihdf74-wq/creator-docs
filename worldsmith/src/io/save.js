/* Worldsmith - saving and loading.
 *
 * The tile arrays are packed into one binary blob and base64'd; everything else
 * (kingdoms, villages, the chronicle) is small enough to go as plain JSON.
 * Elevation is quantised to int16, which halves the largest array with no
 * visible loss - the renderer only resolves about 200 distinct heights anyway. */
(function (WB) {
  'use strict';

  var SLOT = 'worldsmith.save.v1';
  var VERSION = 1;

  function b64encode(bytes) {
    var out = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function b64decode(str) {
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function packWorld(world) {
    var n = world.size;
    /* int16 height + 10 byte arrays + 2 uint16 arrays */
    var size = n * 2 + n * 10 + n * 4;
    var buf = new ArrayBuffer(size);
    var off = 0;

    var h16 = new Int16Array(buf, off, n);
    for (var i = 0; i < n; i++)
      h16[i] = Math.max(-32767, Math.min(32767, Math.round(world.height[i] * 32767)));
    off += n * 2;

    var bytes = new Uint8Array(buf);
    function putU8(arr) {
      bytes.set(arr, off);
      off += n;
    }
    putU8(world.terrain);
    putU8(world.water);
    putU8(world.fire);
    putU8(world.fuel);
    putU8(world.lava);
    putU8(new Uint8Array(world.temp.buffer, world.temp.byteOffset, n));
    putU8(new Uint8Array(world.baseTemp.buffer, world.baseTemp.byteOffset, n));
    putU8(world.moist);
    putU8(world.acid);
    putU8(world.rad);

    var u16 = new Uint16Array(buf, off, n);
    u16.set(world.owner);
    off += n * 2;
    var u16b = new Uint16Array(buf, off, n);
    u16b.set(world.structure);
    off += n * 2;

    return b64encode(new Uint8Array(buf));
  }

  function unpackWorld(world, b64) {
    var bytes = b64decode(b64);
    var n = world.size;
    var buf = bytes.buffer;
    var off = 0;

    var h16 = new Int16Array(buf, off, n);
    for (var i = 0; i < n; i++) world.height[i] = h16[i] / 32767;
    off += n * 2;

    function takeU8(target) {
      target.set(bytes.subarray(off, off + n));
      off += n;
    }
    takeU8(world.terrain);
    takeU8(world.water);
    takeU8(world.fire);
    takeU8(world.fuel);
    takeU8(world.lava);
    takeU8(new Uint8Array(world.temp.buffer, world.temp.byteOffset, n));
    takeU8(new Uint8Array(world.baseTemp.buffer, world.baseTemp.byteOffset, n));
    takeU8(world.moist);
    takeU8(world.acid);
    takeU8(world.rad);

    world.owner.set(new Uint16Array(buf, off, n));
    off += n * 2;
    world.structure.set(new Uint16Array(buf, off, n));
    off += n * 2;
  }

  function packUnits(u) {
    var n = u.count;
    var out = {
      count: n,
      alive: b64encode(u.alive.subarray(0, n)),
      species: b64encode(u.species.subarray(0, n)),
      level: b64encode(u.level.subarray(0, n)),
      x: [],
      y: [],
      hp: [],
      maxHp: [],
      age: [],
      maxAge: [],
      food: [],
      traits: [],
      home: [],
      kingdom: [],
      kills: [],
      disease: [],
      names: [],
    };
    for (var i = 0; i < n; i++) {
      /* Rounded to two decimals: a unit's exact sub-tile position is not
       * worth a third of the file size. */
      out.x.push(Math.round(u.x[i] * 100) / 100);
      out.y.push(Math.round(u.y[i] * 100) / 100);
      out.hp.push(Math.round(u.hp[i]));
      out.maxHp.push(Math.round(u.maxHp[i]));
      out.age.push(Math.round(u.age[i]));
      out.maxAge.push(Math.round(u.maxAge[i]));
      out.food.push(Math.round(u.food[i]));
      out.traits.push(u.traits[i]);
      out.home.push(u.home[i]);
      out.kingdom.push(u.kingdom[i]);
      out.kills.push(u.kills[i]);
      out.disease.push(u.disease[i]);
      out.names.push(u.names[i] || 0);
    }
    return out;
  }

  function unpackUnits(u, d) {
    u.reset();
    var n = d.count;
    u.count = n;
    u.alive.set(b64decode(d.alive), 0);
    u.species.set(b64decode(d.species), 0);
    u.level.set(b64decode(d.level), 0);
    var living = 0;
    for (var i = 0; i < n; i++) {
      u.x[i] = d.x[i];
      u.y[i] = d.y[i];
      u.hp[i] = d.hp[i];
      u.maxHp[i] = d.maxHp[i];
      u.age[i] = d.age[i];
      u.maxAge[i] = d.maxAge[i];
      u.food[i] = d.food[i];
      u.traits[i] = d.traits[i];
      u.home[i] = d.home[i];
      u.kingdom[i] = d.kingdom[i];
      u.kills[i] = d.kills[i];
      u.disease[i] = d.disease[i];
      u.names[i] = d.names[i] || null;
      u.sprite[i] = u.species[i];
      u.tx[i] = u.x[i];
      u.ty[i] = u.y[i];
      u.target[i] = -1;
      u.facing[i] = 1;
      if (u.alive[i]) living++;
      else u.free.push(i);
    }
    u.living = living;
  }

  function packBuildings(b) {
    var n = b.count;
    var out = { count: n, alive: [], x: [], y: [], type: [], hp: [], village: [], kingdom: [] };
    for (var i = 0; i < n; i++) {
      out.alive.push(b.alive[i]);
      out.x.push(b.x[i]);
      out.y.push(b.y[i]);
      out.type.push(b.type[i]);
      out.hp.push(Math.round(b.hp[i]));
      out.village.push(b.village[i]);
      out.kingdom.push(b.kingdom[i]);
    }
    return out;
  }

  function unpackBuildings(b, d) {
    b.reset();
    b.count = d.count;
    var living = 0;
    for (var i = 0; i < d.count; i++) {
      b.alive[i] = d.alive[i];
      b.x[i] = d.x[i];
      b.y[i] = d.y[i];
      b.type[i] = d.type[i];
      b.hp[i] = d.hp[i];
      b.maxHp[i] = WB.Buildings.DEFS[d.type[i]].hp;
      b.village[i] = d.village[i];
      b.kingdom[i] = d.kingdom[i];
      b.progress[i] = 1;
      if (b.alive[i]) living++;
      else b.free.push(i);
    }
    b.living = living;
  }

  var Save = {};

  Save.serialize = function (game) {
    var world = game.world;
    return {
      version: VERSION,
      w: world.w,
      h: world.h,
      seed: world.seed,
      preset: world.preset,
      tick: world.tick,
      seaLevel: world.seaLevel,
      windX: world.windX,
      windY: world.windY,
      tempOffset: world.tempOffset,
      moistOffset: world.moistOffset,
      tiles: packWorld(world),
      units: packUnits(game.units),
      buildings: packBuildings(game.buildings),
      kingdoms: game.kingdoms.list.map(function (k) {
        return {
          id: k.id,
          race: k.race,
          name: k.name,
          fullName: k.fullName,
          shortName: k.shortName,
          color: k.color,
          villages: k.villages,
          relations: k.relations,
          wars: k.wars,
          knowledge: k.knowledge,
          age: k.age,
          founded: k.founded,
        };
      }),
      nextKingdomId: game.kingdoms.nextId,
      villages: game.villages.list.map(function (v) {
        return {
          id: v.id,
          alive: v.alive,
          x: v.x,
          y: v.y,
          race: v.race,
          kingdom: v.kingdom,
          name: v.name,
          population: v.population,
          residents: v.residents,
          buildings: v.buildings,
          food: Math.round(v.food),
          wood: Math.round(v.wood),
          stone: Math.round(v.stone),
          gold: Math.round(v.gold),
          founded: v.founded,
        };
      }),
      chronicle: game.chronicle.entries.slice(-60),
      camera: { x: game.camera.x, y: game.camera.y, zoom: game.camera.zoom },
    };
  };

  Save.restore = function (game, data) {
    if (!data || data.version !== VERSION) throw new Error('Unsupported save format.');
    game.resizeWorld(data.w, data.h, data.seed, { skipGenerate: true });
    var world = game.world;
    world.preset = data.preset;
    world.tick = data.tick || 0;
    world.seaLevel = data.seaLevel;
    world.windX = data.windX;
    world.windY = data.windY;
    world.tempOffset = data.tempOffset || 0;
    world.moistOffset = data.moistOffset || 0;
    unpackWorld(world, data.tiles);

    unpackUnits(game.units, data.units);
    unpackBuildings(game.buildings, data.buildings);

    game.kingdoms.reset();
    game.kingdoms.list = data.kingdoms.map(function (k) {
      k.rgb = WB.hexToRgb(k.color);
      k.peakPop = 0;
      k.battlesWon = 0;
      k.battlesLost = 0;
      return k;
    });
    game.kingdoms.nextId = data.nextKingdomId || game.kingdoms.list.length + 1;

    game.villages.reset();
    game.villages.list = data.villages.map(function (v) {
      v.field = null;
      v.fieldTick = -1e9;
      v.unrest = 0;
      v.lastUpdate = 0;
      return v;
    });
    for (var i = 0; i < game.villages.list.length; i++) {
      if (game.villages.list[i].alive) game.villages.buildField(game.villages.list[i]);
    }

    game.chronicle.entries = data.chronicle || [];
    if (data.camera) {
      game.camera.x = data.camera.x;
      game.camera.y = data.camera.y;
      game.camera.zoom = data.camera.zoom;
      game.camera.clamp();
    }

    game.effects.clear();
    game.particles.clear();
    WB.Water.wakeAll(world);
    WB.Lava.wakeAll(world);
    for (var f = 0; f < world.size; f++) if (world.fire[f]) world.activeFire.add(f);
    world.markAllDirty();
    game.renderer.worldChanged();
    game.bus.emit('loaded');
  };

  Save.toLocalStorage = function (game) {
    var json = JSON.stringify(Save.serialize(game));
    try {
      localStorage.setItem(SLOT, json);
      return { ok: true, bytes: json.length };
    } catch (e) {
      return { ok: false, error: 'Save too large for browser storage - use Export instead.' };
    }
  };

  Save.fromLocalStorage = function (game) {
    var json = localStorage.getItem(SLOT);
    if (!json) return { ok: false, error: 'No saved world found.' };
    try {
      Save.restore(game, JSON.parse(json));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  Save.hasLocal = function () {
    try {
      return !!localStorage.getItem(SLOT);
    } catch (e) {
      return false;
    }
  };

  Save.download = function (game) {
    var json = JSON.stringify(Save.serialize(game));
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'worldsmith-' + game.world.seed + '.json';
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  };

  Save.upload = function (game, file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        Save.restore(game, JSON.parse(reader.result));
        done(null);
      } catch (e) {
        done(e);
      }
    };
    reader.onerror = function () {
      done(new Error('Could not read that file.'));
    };
    reader.readAsText(file);
  };

  /* Export the map itself as a PNG, at an integer scale so it stays crisp. */
  Save.exportPng = function (game, scale) {
    scale = scale || 3;
    var src = game.renderer.tileCanvas;
    var cv = document.createElement('canvas');
    cv.width = src.width * scale;
    cv.height = src.height * scale;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'worldsmith-map-' + game.world.seed + '.png';
    a.click();
  };

  WB.Save = Save;
})(window.WB || (window.WB = {}));
