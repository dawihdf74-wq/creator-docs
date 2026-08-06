/* Worldsmith - structures.
 *
 * Buildings are a second structure-of-arrays store. `world.structure[tile]`
 * holds the building handle + 1 (0 meaning empty), so any system that already
 * has a tile index can find what is standing on it without a search. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var MAX_BUILDINGS = 4000;

  var B = {
    HUT: 0,
    HOUSE: 1,
    FARM: 2,
    MINE: 3,
    DOCK: 4,
    BARRACKS: 5,
    TOWER: 6,
    TEMPLE: 7,
    MARKET: 8,
    WALL: 9,
    RUIN: 10,
    BOAT: 11,
  };

  /* age: earliest era that may build it. jobs: how many residents it employs.
   * yields: what one worker-tick produces. */
  var DEFS = [];
  function def(id, key, label, sprite, o) {
    DEFS[id] = {
      id: id,
      key: key,
      label: label,
      sprite: sprite,
      hp: o.hp || 100,
      age: o.age || 0,
      jobs: o.jobs || 0,
      houses: o.houses || 0,
      wood: o.wood || 0,
      stone: o.stone || 0,
      gold: o.gold || 0,
      yields: o.yields || null,
      needsWater: !!o.needsWater,
      defense: o.defense || 0,
    };
  }

  def(B.HUT, 'hut', 'Hut', 'building_hut', { hp: 70, houses: 3, wood: 12 });
  def(B.HOUSE, 'house', 'House', 'building_house', { hp: 130, houses: 6, wood: 24, stone: 10, age: 1 });
  def(B.FARM, 'farm', 'Farm', 'building_farm', { hp: 60, jobs: 3, wood: 10, yields: { food: 0.5 } });
  def(B.MINE, 'mine', 'Mine', 'building_mine', {
    hp: 120,
    jobs: 3,
    wood: 18,
    yields: { stone: 0.3, gold: 0.08 },
    age: 1,
  });
  def(B.DOCK, 'dock', 'Dock', 'building_dock', {
    hp: 80,
    jobs: 2,
    wood: 20,
    needsWater: true,
    yields: { food: 0.35 },
  });
  def(B.BARRACKS, 'barracks', 'Barracks', 'building_barracks', {
    hp: 200,
    jobs: 4,
    wood: 30,
    stone: 24,
    age: 1,
    defense: 3,
  });
  def(B.TOWER, 'tower', 'Watchtower', 'building_tower', { hp: 260, stone: 40, age: 2, defense: 6 });
  def(B.TEMPLE, 'temple', 'Temple', 'building_temple', { hp: 220, wood: 30, stone: 50, gold: 20, age: 2 });
  def(B.MARKET, 'market', 'Market', 'building_market', {
    hp: 140,
    jobs: 3,
    wood: 34,
    gold: 10,
    age: 1,
    yields: { gold: 0.2 },
  });
  def(B.WALL, 'wall', 'Wall', 'building_wall', { hp: 400, stone: 20, age: 2, defense: 10 });
  def(B.RUIN, 'ruin', 'Ruins', 'building_ruin', { hp: 40 });
  def(B.BOAT, 'boat', 'Boat', 'building_boat', { hp: 60, wood: 20, needsWater: true, age: 1 });

  function Buildings(game) {
    this.game = game;
    this.world = game.world;
    var n = MAX_BUILDINGS;
    this.alive = new Uint8Array(n);
    this.x = new Int16Array(n);
    this.y = new Int16Array(n);
    this.type = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.maxHp = new Float32Array(n);
    this.village = new Int32Array(n);
    this.kingdom = new Uint16Array(n);
    this.progress = new Float32Array(n); /* 0..1 while under construction */
    this.count = 0;
    this.living = 0;
    this.free = [];
  }

  Buildings.prototype.reset = function () {
    this.alive.fill(0);
    this.count = 0;
    this.living = 0;
    this.free.length = 0;
  };

  Buildings.prototype.canPlace = function (type, x, y) {
    var world = this.world;
    if (x < 1 || y < 1 || x >= world.w - 1 || y >= world.h - 1) return false;
    var i = y * world.w + x;
    if (world.structure[i]) return false;
    var d = DEFS[type];
    if (d.needsWater) {
      /* Docks and boats want a wet neighbour, not a wet floor. */
      if (type === B.BOAT) return world.water[i] > 8;
      if (world.water[i] > 3) return false;
      var adjacentWater = false;
      world.forEach4(x, y, function (j) {
        if (world.water[j] > 8) adjacentWater = true;
      });
      return adjacentWater && world.walkable(i);
    }
    if (world.water[i] > 3 || world.lava[i] > 0) return false;
    if (!WB.TERRAIN[world.terrain[i]].buildable) return false;
    return true;
  };

  Buildings.prototype.place = function (type, x, y, villageId, kingdomId) {
    if (!this.canPlace(type, x, y)) return -1;
    var i = this.free.length ? this.free.pop() : this.count < MAX_BUILDINGS ? this.count++ : -1;
    if (i < 0) return -1;
    var d = DEFS[type];
    this.alive[i] = 1;
    this.x[i] = x;
    this.y[i] = y;
    this.type[i] = type;
    this.maxHp[i] = d.hp;
    this.hp[i] = d.hp;
    this.village[i] = villageId === undefined ? -1 : villageId;
    this.kingdom[i] = kingdomId || 0;
    this.progress[i] = 1;
    this.living++;

    var world = this.world;
    var ti = y * world.w + x;
    world.structure[ti] = i + 1;
    /* Farms reshape the ground they sit on; everything else gets a road pad. */
    if (type === B.FARM) world.setTerrain(ti, T.FARM);
    else if (type === B.RUIN) world.setTerrain(ti, T.RUINS);
    world.markDirtyIdx(ti);
    return i;
  };

  Buildings.prototype.at = function (tileIndex) {
    var h = this.world.structure[tileIndex];
    return h ? h - 1 : -1;
  };

  Buildings.prototype.damage = function (i, amount) {
    if (!this.alive[i]) return;
    this.hp[i] -= amount;
    if (this.hp[i] <= 0) this.destroy(i, true);
  };

  Buildings.prototype.destroy = function (i, leaveRuins) {
    if (!this.alive[i]) return;
    var world = this.world;
    var ti = this.y[i] * world.w + this.x[i];
    var wasType = this.type[i];
    var vx = this.x[i],
      vy = this.y[i],
      vid = this.village[i],
      kid = this.kingdom[i];

    this.alive[i] = 0;
    this.living--;
    this.free.push(i);
    if (world.structure[ti] === i + 1) world.structure[ti] = 0;
    world.markDirtyIdx(ti);

    var g = this.game;
    if (g.particles) g.particles.burst(WB.PKIND.DEBRIS, vx + 0.5, vy + 0.5, 8, 3, 1, 0.7);
    if (g.villages && vid >= 0) g.villages.onBuildingLost(vid, i, wasType);

    if (leaveRuins && wasType !== B.RUIN && wasType !== B.BOAT && world.rng.chance(0.6)) {
      this.place(B.RUIN, vx, vy, -1, kid);
    }
  };

  Buildings.prototype.kingdomColor = function (i) {
    var ks = this.game.kingdoms;
    if (ks && this.kingdom[i]) {
      var k = ks.byId(this.kingdom[i]);
      if (k) return k.color;
    }
    return '#d8c9a8';
  };

  /* Fire and lava eat buildings; run on a slow schedule from the sim. */
  Buildings.prototype.step = function () {
    var world = this.world;
    for (var i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      var ti = this.y[i] * world.w + this.x[i];
      if (world.fire[ti] > 0) this.damage(i, 2.5);
      else if (world.lava[ti] > 0) this.damage(i, 20);
      else if (world.water[ti] > 40 && this.type[i] !== B.BOAT && this.type[i] !== B.DOCK)
        this.damage(i, 1.5);
      else if (world.acid[ti] > 0) this.damage(i, 0.4);
    }
  };

  Buildings.prototype.census = function () {
    var out = { total: 0, byKey: {} };
    for (var i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      out.total++;
      var k = DEFS[this.type[i]].key;
      out.byKey[k] = (out.byKey[k] || 0) + 1;
    }
    return out;
  };

  Buildings.TYPE = B;
  Buildings.DEFS = DEFS;
  Buildings.SPRITE_NAMES = DEFS.map(function (d) {
    return d.sprite;
  });

  WB.Buildings = Buildings;
  WB.BTYPE = B;
})(window.WB || (window.WB = {}));
