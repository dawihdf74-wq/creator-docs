/* Worldsmith - villages.
 *
 * A village is the unit of civilisation: it holds a stockpile, decides what to
 * build next, feeds its residents and spawns children. Villages are updated
 * round-robin (a few per tick) rather than all at once, so a hundred
 * settlements cost the same per frame as one. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var B = WB.BTYPE;
  var FIELD_R = 22; /* radius of a village's pathing field, in tiles */
  var UPDATE_EVERY = 30; /* sim ticks between updates of a given village */

  function Villages(game) {
    this.game = game;
    this.world = game.world;
    this.list = [];
    this.cursor = 0;
  }

  Villages.prototype.reset = function () {
    this.list.length = 0;
    this.cursor = 0;
  };

  Villages.prototype.name = function (id) {
    var v = this.list[id];
    return v ? v.name : null;
  };

  /* --- Founding ----------------------------------------------------------- */
  Villages.prototype.siteScore = function (x, y, raceKey) {
    var world = this.world;
    if (x < 4 || y < 4 || x >= world.w - 4 || y >= world.h - 4) return -1;
    var i = y * world.w + x;
    if (world.water[i] > 3 || world.lava[i] > 0) return -1;
    if (!WB.TERRAIN[world.terrain[i]].buildable) return -1;

    var sp = WB.Species.byKey(raceKey);
    var score = 0;
    var fertile = 0,
      wood = 0,
      stone = 0,
      water = 0,
      buildable = 0;

    for (var dy = -6; dy <= 6; dy++) {
      for (var dx = -6; dx <= 6; dx++) {
        var nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
        var j = ny * world.w + nx;
        var t = world.terrain[j];
        if (world.water[j] > 3) {
          water++;
          continue;
        }
        var def = WB.TERRAIN[t];
        fertile += def.fertility;
        if (def.fuel > 150) wood++;
        if (t === T.MOUNTAIN || t === T.ROCK) stone++;
        if (def.buildable) buildable++;
        if (sp.biomes && sp.biomes.indexOf(t) >= 0) score += 1.5;
      }
    }
    if (buildable < 30) return -1;
    score += fertile * 1.2 + wood * 0.35 + stone * 0.25;
    if (water > 2 && water < 60) score += 8; /* coastal or riverside is prime */
    if (world.temp[i] < -20 || world.temp[i] > 45) score -= 25;

    /* Crowding penalty keeps settlements from stacking on one good spot. */
    for (var v = 0; v < this.list.length; v++) {
      var vv = this.list[v];
      if (!vv.alive) continue;
      var ddx = vv.x - x,
        ddy = vv.y - y;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 < 100) return -1;
      if (d2 < 1600) score -= (1600 - d2) / 60;
    }
    return score;
  };

  /* Sample candidate sites rather than scanning the map: a few dozen probes
   * find a good spot and cost nothing. */
  Villages.prototype.findSite = function (raceKey, nearX, nearY, spread) {
    var world = this.world,
      rng = world.rng;
    var best = null,
      bestScore = 4;
    for (var k = 0; k < 60; k++) {
      var x, y;
      if (nearX === undefined) {
        x = rng.int(5, world.w - 6);
        y = rng.int(5, world.h - 6);
      } else {
        var a = rng.next() * 6.283;
        var d = rng.range(14, spread || 55);
        x = Math.round(nearX + Math.cos(a) * d);
        y = Math.round(nearY + Math.sin(a) * d);
      }
      var s = this.siteScore(x, y, raceKey);
      if (s > bestScore) {
        bestScore = s;
        best = { x: x, y: y, score: s };
      }
    }
    return best;
  };

  Villages.prototype.found = function (x, y, raceKey, kingdom, settlers) {
    var game = this.game;
    var world = this.world;
    if (!kingdom) kingdom = game.kingdoms.create(raceKey);

    var v = {
      id: this.list.length,
      alive: true,
      x: x,
      y: y,
      race: raceKey,
      kingdom: kingdom.id,
      name: WB.Names.village(world.rng),
      population: 0,
      residents: [],
      buildings: [],
      food: 40,
      wood: 40,
      stone: 15,
      gold: 0,
      founded: world.tick,
      lastUpdate: 0,
      unrest: 0,
      field: null,
      fieldX: 0,
      fieldY: 0,
      fieldTick: -1e9,
    };
    this.list.push(v);
    kingdom.villages.push(v.id);

    /* A settlement starts with a hut and a farm so it is viable immediately. */
    this.build(v, B.HUT);
    this.build(v, B.FARM);

    var n = settlers === undefined ? 4 : settlers;
    for (var i = 0; i < n; i++) {
      var u = game.units.spawnValid(raceKey, x + world.rng.range(-2, 2), y + world.rng.range(-2, 2), {
        home: v.id,
        kingdom: kingdom.id,
      });
      if (u >= 0) {
        v.residents.push(u);
        v.population++;
      }
    }

    if (game.chronicle) {
      game.chronicle.log('found', v.name + ' was founded by ' + kingdom.name + '.', x, y);
    }
    this.buildField(v);
    return v;
  };

  /* --- Construction -------------------------------------------------------- */
  Villages.prototype.freeSpot = function (v, needsWater) {
    var world = this.world;
    var buildings = this.game.buildings;
    /* Spiral outward from the centre so villages grow as a cluster. */
    for (var r = 1; r < 14; r++) {
      var tries = 6 + r * 3;
      for (var k = 0; k < tries; k++) {
        var a = world.rng.next() * 6.283;
        var x = Math.round(v.x + Math.cos(a) * r);
        var y = Math.round(v.y + Math.sin(a) * r);
        if (needsWater) {
          if (buildings.canPlace(B.DOCK, x, y)) return { x: x, y: y };
        } else if (buildings.canPlace(B.HUT, x, y)) return { x: x, y: y };
      }
    }
    return null;
  };

  Villages.prototype.build = function (v, type) {
    var d = WB.Buildings.DEFS[type];
    if (v.wood < d.wood || v.stone < d.stone || v.gold < d.gold) return -1;
    var spot = this.freeSpot(v, d.needsWater);
    if (!spot) return -1;
    var id = this.game.buildings.place(type, spot.x, spot.y, v.id, v.kingdom);
    if (id < 0) return -1;
    v.wood -= d.wood;
    v.stone -= d.stone;
    v.gold -= d.gold;
    v.buildings.push(id);
    return id;
  };

  Villages.prototype.counts = function (v) {
    var b = this.game.buildings;
    var out = { houses: 0, jobs: 0, byType: {}, defense: 0 };
    for (var i = 0; i < v.buildings.length; i++) {
      var id = v.buildings[i];
      if (!b.alive[id]) continue;
      var d = WB.Buildings.DEFS[b.type[id]];
      out.houses += d.houses;
      out.jobs += d.jobs;
      out.defense += d.defense;
      out.byType[d.key] = (out.byType[d.key] || 0) + 1;
    }
    return out;
  };

  Villages.prototype.chooseBuild = function (v, kingdom) {
    var c = this.counts(v);
    var age = kingdom ? kingdom.age : 0;
    var atWar = kingdom && Object.keys(kingdom.wars).length > 0;

    if (c.houses < v.population + 2) return age >= 1 && v.stone >= 10 ? B.HOUSE : B.HUT;
    if (!c.byType.farm || c.byType.farm * 9 < v.population) return B.FARM;
    if (atWar && !c.byType.barracks && age >= 1) return B.BARRACKS;
    if (!c.byType.dock && this.nearWater(v)) return B.DOCK;
    if (age >= 1 && !c.byType.mine && this.nearStone(v)) return B.MINE;
    if (age >= 1 && v.population > 18 && (c.byType.market || 0) < 1) return B.MARKET;
    if (age >= 2 && !c.byType.temple) return B.TEMPLE;
    if (atWar && age >= 2 && (c.byType.wall || 0) < 8) return B.WALL;
    if (age >= 2 && (c.byType.tower || 0) < 2) return B.TOWER;
    if (v.population > c.houses - 2) return age >= 1 ? B.HOUSE : B.HUT;
    return -1;
  };

  Villages.prototype.nearWater = function (v) {
    var world = this.world;
    for (var dy = -7; dy <= 7; dy += 2)
      for (var dx = -7; dx <= 7; dx += 2) {
        var x = v.x + dx,
          y = v.y + dy;
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        if (world.water[y * world.w + x] > 12) return true;
      }
    return false;
  };

  Villages.prototype.nearStone = function (v) {
    var world = this.world;
    for (var dy = -8; dy <= 8; dy += 2)
      for (var dx = -8; dx <= 8; dx += 2) {
        var x = v.x + dx,
          y = v.y + dy;
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        var t = world.terrain[y * world.w + x];
        if (t === T.MOUNTAIN || t === T.ROCK) return true;
      }
    return false;
  };

  /* --- Pathing field -------------------------------------------------------
   * One BFS per village, reused by every resident that wants to go home. This
   * is the difference between villagers reliably returning and villagers
   * getting permanently stuck behind a lake. */
  Villages.prototype.buildField = function (v) {
    var world = this.world;
    var size = FIELD_R * 2 + 1;
    if (!v.field) v.field = new Uint16Array(size * size);
    v.field.fill(65535);
    v.fieldX = v.x - FIELD_R;
    v.fieldY = v.y - FIELD_R;
    v.fieldTick = world.tick;

    var queue = new Int32Array(size * size);
    var qh = 0,
      qt = 0;
    var startLocal = FIELD_R * size + FIELD_R;
    v.field[startLocal] = 0;
    queue[qt++] = startLocal;

    while (qh < qt) {
      var cur = queue[qh++];
      var cd = v.field[cur];
      var lx = cur % size,
        ly = (cur / size) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = lx + (d === 0 ? -1 : d === 1 ? 1 : 0);
        var ny = ly + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        var nl = ny * size + nx;
        if (v.field[nl] !== 65535) continue;
        var wx = v.fieldX + nx,
          wy = v.fieldY + ny;
        if (wx < 0 || wy < 0 || wx >= world.w || wy >= world.h) continue;
        if (!world.walkable(wy * world.w + wx)) continue;
        v.field[nl] = cd + 1;
        queue[qt++] = nl;
      }
    }
  };

  /* Next step toward the village centre, or null if outside the field. */
  Villages.prototype.stepHome = function (v, x, y) {
    if (!v.field) return null;
    var size = FIELD_R * 2 + 1;
    var lx = Math.round(x) - v.fieldX,
      ly = Math.round(y) - v.fieldY;
    if (lx < 1 || ly < 1 || lx >= size - 1 || ly >= size - 1) return null;
    var here = v.field[ly * size + lx];
    if (here === 65535) return null;
    var best = here,
      bx = lx,
      by = ly;
    for (var dy = -1; dy <= 1; dy++)
      for (var dx = -1; dx <= 1; dx++) {
        var nl = (ly + dy) * size + (lx + dx);
        var val = v.field[nl];
        if (val < best) {
          best = val;
          bx = lx + dx;
          by = ly + dy;
        }
      }
    if (best === here) return null;
    return { x: v.fieldX + bx + 0.5, y: v.fieldY + by + 0.5 };
  };

  /* --- Lifecycle callbacks -------------------------------------------------- */
  Villages.prototype.onBirth = function (vid, unit) {
    var v = this.list[vid];
    if (!v || !v.alive) return;
    v.residents.push(unit);
    v.population++;
  };

  Villages.prototype.onResidentDied = function (vid, unit) {
    var v = this.list[vid];
    if (!v || !v.alive) return;
    var i = v.residents.indexOf(unit);
    if (i >= 0) v.residents.splice(i, 1);
    v.population = v.residents.length;
    if (v.population === 0) this.abandon(v, 'its last inhabitant died');
  };

  Villages.prototype.onBuildingLost = function (vid, bid) {
    var v = this.list[vid];
    if (!v || !v.alive) return;
    var i = v.buildings.indexOf(bid);
    if (i >= 0) v.buildings.splice(i, 1);
  };

  Villages.prototype.abandon = function (v, reason) {
    if (!v.alive) return;
    v.alive = false;
    var kingdom = this.game.kingdoms.byId(v.kingdom);
    if (kingdom) {
      var ki = kingdom.villages.indexOf(v.id);
      if (ki >= 0) kingdom.villages.splice(ki, 1);
    }
    /* The buildings stay as ruins on the map. */
    var b = this.game.buildings;
    for (var i = 0; i < v.buildings.length; i++) {
      if (b.alive[v.buildings[i]] && this.world.rng.chance(0.5)) b.destroy(v.buildings[i], true);
    }
    v.buildings.length = 0;
    if (this.game.chronicle) {
      this.game.chronicle.log(
        'death',
        v.name + ' was abandoned' + (reason ? ' after ' + reason : '') + '.',
        v.x,
        v.y
      );
    }
    if (kingdom && kingdom.villages.length === 0 && this.game.chronicle) {
      this.game.chronicle.log('war', kingdom.fullName + ' has fallen.');
    }
  };

  /* --- Per-village update ---------------------------------------------------- */
  Villages.prototype.update = function (v) {
    var game = this.game,
      world = this.world;
    var kingdom = game.kingdoms.byId(v.kingdom);
    var c = this.counts(v);
    var dt = UPDATE_EVERY;

    /* Production. Workers are capped by available jobs. */
    var workers = Math.min(v.population, c.jobs);
    var b = game.buildings;
    var food = 0,
      stone = 0,
      gold = 0;
    for (var i = 0; i < v.buildings.length; i++) {
      var id = v.buildings[i];
      if (!b.alive[id]) continue;
      var d = WB.Buildings.DEFS[b.type[id]];
      if (!d.yields) continue;
      var staffed = Math.min(d.jobs, workers);
      workers -= staffed;
      var eff = staffed / Math.max(1, d.jobs);
      /* Farms only yield what the ground can actually give. */
      var ti = b.y[id] * world.w + b.x[id];
      var fertility = WB.TERRAIN[world.terrain[ti]].fertility;
      if (d.yields.food) food += d.yields.food * eff * dt * (0.4 + fertility);
      if (d.yields.stone) stone += d.yields.stone * eff * dt;
      if (d.yields.gold) gold += d.yields.gold * eff * dt;
    }

    /* Foraging and logging by everyone without a job. */
    var idle = Math.max(0, v.population - Math.min(v.population, c.jobs));
    v.wood += idle * 0.06 * dt;
    food += idle * 0.05 * dt;

    v.food += food - v.population * 0.09 * dt;
    v.stone += stone;
    v.gold += gold;
    v.wood = Math.min(600, v.wood);
    v.stone = Math.min(600, v.stone);

    /* Famine. */
    if (v.food < 0) {
      v.food = 0;
      v.unrest += 2;
      for (var r = 0; r < v.residents.length; r++) {
        var u = v.residents[r];
        if (game.units.alive[u]) game.units.food[u] -= 6;
      }
    } else {
      v.unrest = Math.max(0, v.unrest - 1);
      v.food = Math.min(900, v.food);
    }

    /* Growth: well-fed, well-housed villages have children. */
    if (v.food > 60 && v.population < c.houses && game.units.living < WB.Units.MAX * 0.85) {
      if (world.rng.chance(0.45)) {
        var child = game.units.spawnValid(
          v.race,
          v.x + world.rng.range(-3, 3),
          v.y + world.rng.range(-3, 3),
          {
            home: v.id,
            kingdom: v.kingdom,
            age: 0,
          }
        );
        if (child >= 0) {
          v.residents.push(child);
          v.population++;
          v.food -= 25;
        }
      }
    }

    /* Construction. */
    var want = this.chooseBuild(v, kingdom);
    if (want >= 0) this.build(v, want);

    /* Colonisation: a prosperous village sends out settlers. */
    if (
      v.population >= 14 &&
      v.food > 220 &&
      this.list.filter(function (x) {
        return x.alive;
      }).length < 90 &&
      world.rng.chance(0.12)
    ) {
      var site = this.findSite(v.race, v.x, v.y, 60);
      if (site) {
        v.food -= 150;
        var nv = this.found(site.x, site.y, v.race, kingdom, 0);
        /* Move real settlers rather than conjuring new ones. */
        for (var s = 0; s < 4 && v.residents.length > 6; s++) {
          var mover = v.residents.pop();
          v.population--;
          if (game.units.alive[mover]) {
            game.units.home[mover] = nv.id;
            game.units.tx[mover] = nv.x;
            game.units.ty[mover] = nv.y;
            nv.residents.push(mover);
            nv.population++;
          }
        }
      }
    }

    /* The pathing field goes stale as terrain changes around the village. */
    if (world.tick - v.fieldTick > 2400) this.buildField(v);

    /* A village whose land has been ruined dies off. */
    var centerIdx = world.clampY(v.y) * world.w + world.clampX(v.x);
    if (world.water[centerIdx] > 40 || world.lava[centerIdx] > 0) {
      this.abandon(v, 'the land beneath it was destroyed');
    }
  };

  Villages.prototype.step = function () {
    var n = this.list.length;
    if (!n) return;
    /* Spread updates so each village is visited every UPDATE_EVERY ticks. */
    var per = Math.max(1, Math.ceil(n / UPDATE_EVERY));
    for (var k = 0; k < per; k++) {
      var v = this.list[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      if (v && v.alive) this.update(v);
    }
  };

  Villages.prototype.aliveList = function () {
    return this.list.filter(function (v) {
      return v.alive;
    });
  };

  Villages.FIELD_R = FIELD_R;
  WB.Villages = Villages;
})(window.WB || (window.WB = {}));
