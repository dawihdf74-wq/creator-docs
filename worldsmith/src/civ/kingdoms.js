/* Worldsmith - kingdoms, borders, diplomacy and war.
 *
 * Villages federate into kingdoms; kingdoms hold territory, remember how they
 * feel about each other, and go to war when that feeling sours. Borders are
 * recomputed into a scratch buffer and diffed against `world.owner`, so a
 * reshuffle only dirties the tiles that actually changed hands. */
(function (WB) {
  'use strict';

  var AGES = [
    { key: 'stone', label: 'Stone Age', knowledge: 0 },
    { key: 'bronze', label: 'Bronze Age', knowledge: 900 },
    { key: 'iron', label: 'Iron Age', knowledge: 3200 },
    { key: 'gold', label: 'Golden Age', knowledge: 9000 },
  ];

  /* Distinct, readable on both land and water, and colour-blind tolerable. */
  var PALETTE = [
    '#e05a4a',
    '#4a8fd8',
    '#5ec46a',
    '#e0b23a',
    '#b06ad8',
    '#e07a2a',
    '#3ac0c0',
    '#d84a90',
    '#8ab63a',
    '#7a6ad8',
    '#c04a4a',
    '#3a9ad0',
    '#50b090',
    '#d09030',
    '#9a5ac0',
    '#e0684a',
    '#5aa0e0',
    '#68c080',
    '#c8a040',
    '#a878d0',
  ];

  var TERRITORY_PERIOD = 150; /* ticks between border recomputations */
  var DIPLO_PERIOD = 300;

  function Kingdoms(game) {
    this.game = game;
    this.world = game.world;
    this.list = [];
    this.nextId = 1;
    this.scratch = new Uint16Array(this.world.size);
    this.claimDist = new Uint16Array(this.world.size);
  }

  Kingdoms.prototype.reset = function () {
    this.list.length = 0;
    this.nextId = 1;
    this.world.owner.fill(0);
  };

  Kingdoms.prototype.byId = function (id) {
    for (var i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
    return null;
  };

  Kingdoms.prototype.alive = function () {
    return this.list.filter(function (k) {
      return k.villages.length > 0;
    });
  };

  Kingdoms.prototype.create = function (raceKey) {
    var rng = this.world.rng;
    var short = WB.Names.kingdomShort(rng);
    var k = {
      id: this.nextId++,
      race: raceKey,
      name: 'the ' + short,
      fullName: WB.Names.kingdom(rng),
      shortName: short,
      color: PALETTE[(this.list.length * 7) % PALETTE.length],
      rgb: null,
      villages: [],
      relations: {},
      wars: {},
      knowledge: 0,
      age: 0,
      founded: this.world.tick,
      peakPop: 0,
      battlesWon: 0,
      battlesLost: 0,
    };
    k.rgb = WB.hexToRgb(k.color);
    this.list.push(k);
    if (this.game.chronicle) {
      this.game.chronicle.log('found', k.fullName + ' has risen.', null, null);
    }
    return k;
  };

  Kingdoms.prototype.relation = function (a, b) {
    if (a.id === b.id) return 100;
    var v = a.relations[b.id];
    return v === undefined ? 0 : v;
  };

  Kingdoms.prototype.adjustRelation = function (a, b, delta) {
    if (a.id === b.id) return;
    var v = this.relation(a, b) + delta;
    v = Math.max(-100, Math.min(100, v));
    a.relations[b.id] = v;
    b.relations[a.id] = v; /* symmetric: simpler to reason about, reads the same */
  };

  Kingdoms.prototype.atWar = function (a, b) {
    return !!a.wars[b.id];
  };

  Kingdoms.prototype.declareWar = function (a, b, reason) {
    if (a.id === b.id || a.wars[b.id]) return;
    a.wars[b.id] = this.world.tick;
    b.wars[a.id] = this.world.tick;
    a.relations[b.id] = -80;
    b.relations[a.id] = -80;
    if (this.game.chronicle) {
      this.game.chronicle.log(
        'war',
        a.name + ' declared war on ' + b.name + (reason ? ' over ' + reason : '') + '.'
      );
    }
    if (this.game.audio) this.game.audio.play('horn');
  };

  Kingdoms.prototype.makePeace = function (a, b) {
    if (!a.wars[b.id]) return;
    delete a.wars[b.id];
    delete b.wars[a.id];
    a.relations[b.id] = 15;
    b.relations[a.id] = 15;
    if (this.game.chronicle)
      this.game.chronicle.log('peace', a.name + ' and ' + b.name + ' have made peace.');
  };

  /* --- Territory ---------------------------------------------------------
   * Multi-source expansion: every village claims outward, nearest wins. Kept
   * to a bounded radius per village so cost scales with settlement count, not
   * with map area. */
  Kingdoms.prototype.recomputeTerritory = function () {
    var world = this.world;
    var villages = this.game.villages;
    if (!villages) return;
    var scratch = this.scratch;
    var dist = this.claimDist;
    scratch.fill(0);
    dist.fill(65535);

    var list = villages.list;
    for (var v = 0; v < list.length; v++) {
      var vil = list[v];
      if (!vil.alive) continue;
      var radius = Math.min(26, 5 + Math.sqrt(vil.population * 3) + vil.buildings.length * 0.4);
      var kid = vil.kingdom;
      var cx = vil.x,
        cy = vil.y;
      var r2 = radius * radius;
      var x0 = Math.max(0, Math.floor(cx - radius)),
        x1 = Math.min(world.w - 1, Math.ceil(cx + radius));
      var y0 = Math.max(0, Math.floor(cy - radius)),
        y1 = Math.min(world.h - 1, Math.ceil(cy + radius));
      for (var y = y0; y <= y1; y++) {
        var dy = y - cy;
        for (var x = x0; x <= x1; x++) {
          var dx = x - cx;
          var d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          var i = y * world.w + x;
          /* Territory stops at the waterline. Letting claims run out over
           * shallow sea drew coloured borders across open water, which read as
           * a rendering fault rather than as a coastline. */
          if (world.water[i] > 8) continue;
          /* Terrain-weighted distance, not raw euclidean: claims reach far
           * along easy ground and stall against mountains and open water, so
           * borders hug the landscape instead of drawing perfect circles. */
          var d = Math.sqrt(d2) * 16;
          var t = world.terrain[i];
          if (world.water[i] > 3) d += 90;
          else if (t === WB.T.MOUNTAIN) d += 110;
          else if (t === WB.T.ROCK || t === WB.T.SNOW || t === WB.T.ICE) d += 55;
          else if (t === WB.T.SWAMP || t === WB.T.DESERT) d += 30;
          d = Math.round(d);
          /* Budget is the same as the euclidean reach, so the penalties above
           * actually pull the frontier in rather than just reordering claims. */
          if (d > radius * 16) continue;
          if (d < dist[i]) {
            dist[i] = d;
            scratch[i] = kid;
          }
        }
      }
    }

    /* Diff against the live owner map so only changed tiles repaint. */
    var owner = world.owner;
    for (var k = 0; k < world.size; k++) {
      if (owner[k] !== scratch[k]) {
        owner[k] = scratch[k];
        world.markDirtyIdx(k);
      }
    }
  };

  /* --- Diplomacy ---------------------------------------------------------- */
  Kingdoms.prototype.stepDiplomacy = function () {
    var alive = this.alive();
    if (alive.length < 2) return;
    var world = this.world,
      rng = world.rng;

    for (var a = 0; a < alive.length; a++) {
      var ka = alive[a];
      for (var b = a + 1; b < alive.length; b++) {
        var kb = alive[b];
        var rel = this.relation(ka, kb);

        if (this.atWar(ka, kb)) {
          /* War weariness pulls toward the negotiating table. */
          var since = world.tick - (ka.wars[kb.id] || world.tick);
          if (since > 4000 && rng.chance(0.25)) this.adjustRelation(ka, kb, 8);
          if (this.relation(ka, kb) > -10) this.makePeace(ka, kb);
          continue;
        }

        /* Same race gets on better; crowded borders breed friction. */
        var drift = 0;
        if (ka.race === kb.race) drift += 2;
        else drift -= 1;
        var touching = this.bordersTouch(ka, kb);
        if (touching) drift -= 4;
        if (ka.age !== kb.age) drift -= 1;
        drift += rng.range(-3, 3);
        this.adjustRelation(ka, kb, drift);

        rel = this.relation(ka, kb);
        if (rel < -55 && touching && rng.chance(0.4)) {
          this.declareWar(ka, kb, touching ? 'contested borders' : null);
        } else if (rel > 70 && !ka.allies) {
          /* allies is informational: it colours the roster and biases relations */
          ka.allies = kb.id;
          kb.allies = ka.id;
          if (this.game.chronicle)
            this.game.chronicle.log('peace', ka.name + ' and ' + kb.name + ' formed an alliance.');
        }
      }
    }
  };

  /* Cheap adjacency test: are any two of their settlements within reach? */
  Kingdoms.prototype.bordersTouch = function (ka, kb) {
    var villages = this.game.villages;
    if (!villages) return false;
    for (var i = 0; i < ka.villages.length; i++) {
      var va = villages.list[ka.villages[i]];
      if (!va || !va.alive) continue;
      for (var j = 0; j < kb.villages.length; j++) {
        var vb = villages.list[kb.villages[j]];
        if (!vb || !vb.alive) continue;
        var dx = va.x - vb.x,
          dy = va.y - vb.y;
        if (dx * dx + dy * dy < 60 * 60) return true;
      }
    }
    return false;
  };

  /* --- Ages --------------------------------------------------------------- */
  Kingdoms.prototype.stepAges = function () {
    for (var i = 0; i < this.list.length; i++) {
      var k = this.list[i];
      if (!k.villages.length) continue;
      var pop = this.populationOf(k);
      k.peakPop = Math.max(k.peakPop, pop);
      k.knowledge += pop * 0.05 + k.villages.length * 0.4;
      var next = AGES[k.age + 1];
      if (next && k.knowledge >= next.knowledge) {
        k.age++;
        if (this.game.chronicle) {
          this.game.chronicle.log('age', k.name + ' entered the ' + AGES[k.age].label + '.');
        }
      }
    }
  };

  Kingdoms.prototype.populationOf = function (k) {
    var villages = this.game.villages;
    if (!villages) return 0;
    var n = 0;
    for (var i = 0; i < k.villages.length; i++) {
      var v = villages.list[k.villages[i]];
      if (v && v.alive) n += v.population;
    }
    return n;
  };

  Kingdoms.prototype.step = function () {
    var t = this.world.tick;
    if (t % TERRITORY_PERIOD === 0) this.recomputeTerritory();
    if (t % DIPLO_PERIOD === 0) {
      this.stepDiplomacy();
      this.stepAges();
    }
  };

  /* Roster data for the UI panel. */
  Kingdoms.prototype.summary = function () {
    var self = this;
    return this.alive()
      .map(function (k) {
        return {
          id: k.id,
          name: k.name,
          full: k.fullName,
          color: k.color,
          race: k.race,
          age: AGES[k.age].label,
          villages: k.villages.length,
          population: self.populationOf(k),
          wars: Object.keys(k.wars).length,
        };
      })
      .sort(function (a, b) {
        return b.population - a.population;
      });
  };

  Kingdoms.AGES = AGES;
  WB.Kingdoms = Kingdoms;
})(window.WB || (window.WB = {}));
