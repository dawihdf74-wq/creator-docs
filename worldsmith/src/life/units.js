/* Worldsmith - the unit store.
 *
 * Every living thing - villager, sheep, dragon - is a row in the same set of
 * typed arrays. Physics runs for everyone every tick (it is just a few adds);
 * decision-making is round-robin, so with 5000 units alive only a slice of them
 * think on any given tick and the cost per frame stays flat. */
(function (WB) {
  'use strict';

  var MAX_UNITS = 6000;
  var THINK_PERIOD = 10; /* a unit reconsiders roughly every 10 ticks */
  var CELL = 8; /* spatial hash cell size, in tiles */

  var ST = {
    IDLE: 0,
    WANDER: 1,
    FORAGE: 2,
    FLEE: 3,
    HUNT: 4,
    FIGHT: 5,
    BREED: 6,
    GOTO: 7,
    WORK: 8,
    MARCH: 9,
  };

  var TRAIT = {
    FAST: 1,
    STRONG: 2,
    TOUGH: 4,
    IMMORTAL: 8,
    BLESSED: 16,
    CURSED: 32,
    DISEASED: 64,
    MUTANT: 128,
    TAMED: 256,
    ENRAGED: 512,
    FIREPROOF: 1024,
    UNDEAD: 2048,
    ROYAL: 4096,
    SOLDIER: 8192,
    AQUATIC: 16384,
  };

  var TRAIT_LABELS = [
    [TRAIT.FAST, 'Fast'],
    [TRAIT.STRONG, 'Strong'],
    [TRAIT.TOUGH, 'Tough'],
    [TRAIT.IMMORTAL, 'Immortal'],
    [TRAIT.BLESSED, 'Blessed'],
    [TRAIT.CURSED, 'Cursed'],
    [TRAIT.DISEASED, 'Diseased'],
    [TRAIT.MUTANT, 'Mutant'],
    [TRAIT.TAMED, 'Tamed'],
    [TRAIT.ENRAGED, 'Enraged'],
    [TRAIT.FIREPROOF, 'Fireproof'],
    [TRAIT.UNDEAD, 'Undead'],
    [TRAIT.ROYAL, 'Royal'],
    [TRAIT.SOLDIER, 'Soldier'],
    [TRAIT.AQUATIC, 'Aquatic'],
  ];

  function Units(game) {
    this.game = game;
    this.world = game.world;
    var n = MAX_UNITS;

    this.alive = new Uint8Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.air = new Float32Array(n); /* height above ground when thrown */
    this.vz = new Float32Array(n);
    this.species = new Uint8Array(n);
    this.sprite = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.maxHp = new Float32Array(n);
    this.age = new Float32Array(n);
    this.maxAge = new Float32Array(n);
    this.food = new Float32Array(n);
    this.level = new Uint8Array(n);
    this.xp = new Uint16Array(n);
    this.kills = new Uint16Array(n);
    this.traits = new Uint32Array(n);
    this.state = new Uint8Array(n);
    this.target = new Int32Array(n);
    this.tx = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.cool = new Float32Array(n);
    this.facing = new Int8Array(n);
    this.home = new Int32Array(n); /* village id, -1 = none */
    this.kingdom = new Uint16Array(n);
    this.disease = new Uint16Array(n);
    this.job = new Uint8Array(n);
    this.carry = new Float32Array(n);

    this.names = new Array(n);
    this.stories = new Array(n);

    this.count = 0; /* high-water mark; iteration bound */
    this.living = 0;
    this.free = [];
    this.thinkCursor = 0;

    /* spatial hash */
    this.gw = Math.ceil(this.world.w / CELL);
    this.gh = Math.ceil(this.world.h / CELL);
    this.head = new Int32Array(this.gw * this.gh);
    this.next = new Int32Array(n);
    this.head.fill(-1);
  }

  Units.prototype.reset = function () {
    this.alive.fill(0);
    this.count = 0;
    this.living = 0;
    this.free.length = 0;
    this.names.length = 0;
    this.names.length = MAX_UNITS;
    this.stories.length = 0;
    this.stories.length = MAX_UNITS;
    this.head.fill(-1);
  };

  /* --- Spawning ---------------------------------------------------------- */
  Units.prototype.allocate = function () {
    if (this.free.length) return this.free.pop();
    if (this.count < MAX_UNITS) return this.count++;
    return -1;
  };

  Units.prototype.spawn = function (speciesKey, x, y, opts) {
    opts = opts || {};
    var sp = typeof speciesKey === 'number' ? WB.Species.byId(speciesKey) : WB.Species.byKey(speciesKey);
    if (!sp) return -1;
    var i = this.allocate();
    if (i < 0) return -1;
    var world = this.world;
    var rng = world.rng;

    this.alive[i] = 1;
    this.x[i] = Math.max(0.5, Math.min(world.w - 0.5, x));
    this.y[i] = Math.max(0.5, Math.min(world.h - 0.5, y));
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.air[i] = 0;
    this.vz[i] = 0;
    this.species[i] = sp.id;
    this.sprite[i] = sp.id;
    var hpScale = 1 + (opts.level || 0) * 0.25;
    this.maxHp[i] = sp.hp * hpScale;
    this.hp[i] = this.maxHp[i];
    this.age[i] = opts.age === undefined ? rng.range(0, sp.maxAge * 0.25) : opts.age;
    this.maxAge[i] = sp.maxAge * rng.range(0.75, 1.3);
    this.food[i] = 70;
    this.level[i] = opts.level || 1;
    this.xp[i] = 0;
    this.kills[i] = 0;
    this.traits[i] = opts.traits || 0;
    if (sp.fireproof) this.traits[i] |= TRAIT.FIREPROOF;
    if (sp.habitat === 'water') this.traits[i] |= TRAIT.AQUATIC;
    if (sp.key === 'undead') this.traits[i] |= TRAIT.UNDEAD;
    this.state[i] = ST.WANDER;
    this.target[i] = -1;
    this.tx[i] = this.x[i];
    this.ty[i] = this.y[i];
    this.cool[i] = 0;
    this.facing[i] = 1;
    this.home[i] = opts.home === undefined ? -1 : opts.home;
    this.kingdom[i] = opts.kingdom || 0;
    this.disease[i] = 0;
    this.job[i] = 0;
    this.carry[i] = 0;

    if (sp.klass === 'civ') this.names[i] = WB.Names.titled(rng, sp.key);
    else if (sp.klass === 'monster') this.names[i] = WB.Names.creature(rng, sp.key);
    else this.names[i] = null;
    this.stories[i] = null;

    this.living++;
    if (sp.klass !== 'animal') this.story(i, 'Born into the world.');
    return i;
  };

  Units.prototype.spawnRace = function (x, y, key, opts) {
    return this.spawn(key, x, y, opts);
  };

  Units.prototype.spawnMonster = function (x, y, key, opts) {
    return this.spawn(key || 'demon', x, y, opts);
  };

  /* Place a unit on a tile it can actually survive on, searching outward. */
  Units.prototype.spawnValid = function (key, x, y, opts) {
    var sp = WB.Species.byKey(key);
    if (!sp) return -1;
    var world = this.world;
    for (var attempt = 0; attempt < 40; attempt++) {
      var r = attempt * 0.6;
      var a = world.rng.next() * 6.283;
      var px = Math.round(x + Math.cos(a) * r);
      var py = Math.round(y + Math.sin(a) * r);
      if (px < 1 || py < 1 || px >= world.w - 1 || py >= world.h - 1) continue;
      var i = py * world.w + px;
      if (this.tileOk(sp, i)) return this.spawn(key, px + 0.5, py + 0.5, opts);
    }
    return this.spawn(key, x, y, opts);
  };

  Units.prototype.tileOk = function (sp, i) {
    var world = this.world;
    if (sp.habitat === 'air') return true;
    if (sp.habitat === 'water') return world.water[i] > 8;
    return world.walkable(i) && world.lava[i] === 0;
  };

  /* --- Story log ---------------------------------------------------------
   * Only kept for named beings; animals would multiply this by thousands for
   * no gain. Bounded so a long-lived hero cannot grow without limit. */
  Units.prototype.story = function (i, text) {
    if (!this.names[i]) return;
    var s = this.stories[i];
    if (!s) s = this.stories[i] = [];
    s.push({ tick: this.world.tick, text: text });
    if (s.length > 8) s.shift();
  };

  /* --- Death ------------------------------------------------------------- */
  Units.prototype.kill = function (i, cause) {
    if (!this.alive[i]) return;
    var sp = WB.Species.byId(this.species[i]);
    this.alive[i] = 0;
    this.living--;
    this.free.push(i);

    var g = this.game;
    if (g.particles) g.particles.burst(WB.PKIND.BLOOD, this.x[i], this.y[i], 6, 2.5, 0.7, 0.5);

    /* Corpses feed the ground they fall on. */
    var world = this.world;
    var ti = world.clampY(Math.floor(this.y[i])) * world.w + world.clampX(Math.floor(this.x[i]));
    if (world.water[ti] <= 3) world.moist[ti] = Math.min(255, world.moist[ti] + 6);

    if (this.names[i] && sp.klass === 'civ' && g.chronicle && world.rng.next() < 0.08) {
      g.chronicle.log(
        'death',
        this.names[i] + ' died of ' + (cause || 'unknown causes') + '.',
        this.x[i],
        this.y[i]
      );
    }
    if (g.selectedUnit === i) g.selectedUnit = -1;
    if (g.villages && this.home[i] >= 0) g.villages.onResidentDied(this.home[i], i);
  };

  Units.prototype.damage = function (i, amount, cause) {
    if (!this.alive[i] || amount <= 0) return;
    var tr = this.traits[i];
    if (tr & TRAIT.IMMORTAL) return;
    if (tr & TRAIT.TOUGH) amount *= 0.6;
    if (tr & TRAIT.BLESSED) amount *= 0.75;
    if (tr & TRAIT.CURSED) amount *= 1.4;
    this.hp[i] -= amount;
    if (this.hp[i] <= 0) this.kill(i, cause);
  };

  Units.prototype.heal = function (i, amount) {
    if (!this.alive[i]) return;
    this.hp[i] = Math.min(this.maxHp[i], this.hp[i] + amount);
  };

  /* Throw a unit. Vertical component comes from the magnitude, so a hard
   * shove also lofts them - which is what makes explosions look right. */
  Units.prototype.launch = function (i, vx, vy) {
    if (!this.alive[i]) return;
    this.vx[i] += vx;
    this.vy[i] += vy;
    var mag = Math.sqrt(vx * vx + vy * vy);
    if (mag > 0.4) {
      this.vz[i] += Math.min(4, mag * 0.55);
      this.air[i] = Math.max(this.air[i], 0.01);
    }
  };

  /* --- Spatial hash ------------------------------------------------------ */
  Units.prototype.rebuildHash = function () {
    this.head.fill(-1);
    var gw = this.gw;
    for (var i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      var cx = (this.x[i] / CELL) | 0;
      var cy = (this.y[i] / CELL) | 0;
      if (cx < 0) cx = 0;
      if (cy < 0) cy = 0;
      if (cx >= gw) cx = gw - 1;
      if (cy >= this.gh) cy = this.gh - 1;
      var c = cy * gw + cx;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  };

  Units.prototype.forEachNear = function (x, y, radius, fn) {
    var c0x = Math.max(0, ((x - radius) / CELL) | 0);
    var c1x = Math.min(this.gw - 1, ((x + radius) / CELL) | 0);
    var c0y = Math.max(0, ((y - radius) / CELL) | 0);
    var c1y = Math.min(this.gh - 1, ((y + radius) / CELL) | 0);
    var r2 = radius * radius;
    for (var cy = c0y; cy <= c1y; cy++) {
      for (var cx = c0x; cx <= c1x; cx++) {
        var i = this.head[cy * this.gw + cx];
        while (i !== -1) {
          if (this.alive[i]) {
            var dx = this.x[i] - x,
              dy = this.y[i] - y;
            var d2 = dx * dx + dy * dy;
            if (d2 <= r2) {
              if (fn(i, d2) === false) return;
            }
          }
          i = this.next[i];
        }
      }
    }
  };

  Units.prototype.pickAt = function (x, y, radius) {
    var best = -1,
      bestD = Infinity;
    this.forEachNear(x, y, radius, function (i, d2) {
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    });
    return best;
  };

  /* --- Per-tick physics --------------------------------------------------- */
  Units.prototype.stepPhysics = function () {
    var world = this.world;
    var w = world.w,
      h = world.h;
    var rng = world.rng;

    for (var i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      var sp = WB.Species.byId(this.species[i]);
      var tr = this.traits[i];

      /* --- airborne --- */
      if (this.air[i] > 0 || this.vz[i] !== 0) {
        this.vz[i] -= 0.35;
        this.air[i] += this.vz[i] * 0.1;
        this.x[i] += this.vx[i] * 0.1;
        this.y[i] += this.vy[i] * 0.1;
        this.vx[i] *= 0.985;
        this.vy[i] *= 0.985;
        if (this.air[i] <= 0) {
          /* landing */
          var impact = Math.abs(this.vz[i]);
          this.air[i] = 0;
          this.vz[i] = 0;
          this.vx[i] = 0;
          this.vy[i] = 0;
          if (impact > 2.4 && sp.habitat !== 'air') this.damage(i, (impact - 2.4) * 26, 'a hard landing');
        }
      } else {
        /* --- grounded movement --- */
        var speed = sp.speed * (tr & TRAIT.FAST ? 1.6 : 1) * (tr & TRAIT.ENRAGED ? 1.25 : 1);
        if (this.disease[i] > 0) speed *= 0.7;
        var ti = ((this.y[i] | 0) >>> 0) * w + ((this.x[i] | 0) >>> 0);
        if (ti >= 0 && ti < world.size && sp.habitat === 'land') {
          speed *= WB.TERRAIN[world.terrain[ti]].speed;
        }

        var dx = this.tx[i] - this.x[i];
        var dy = this.ty[i] - this.y[i];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.12) {
          var nx = this.x[i] + (dx / d) * speed;
          var ny = this.y[i] + (dy / d) * speed;
          if (this.canStand(sp, nx, ny)) {
            this.x[i] = nx;
            this.y[i] = ny;
            if (dx > 0.02) this.facing[i] = 1;
            else if (dx < -0.02) this.facing[i] = -1;
          } else {
            /* Blocked: pick a fresh destination next time it thinks. */
            this.tx[i] = this.x[i];
            this.ty[i] = this.y[i];
            this.state[i] = ST.WANDER;
          }
        }

        /* residual knockback */
        if (this.vx[i] !== 0 || this.vy[i] !== 0) {
          var kx = this.x[i] + this.vx[i] * 0.1;
          var ky = this.y[i] + this.vy[i] * 0.1;
          if (this.canStand(sp, kx, ky)) {
            this.x[i] = kx;
            this.y[i] = ky;
          }
          this.vx[i] *= 0.86;
          this.vy[i] *= 0.86;
          if (Math.abs(this.vx[i]) < 0.01) this.vx[i] = 0;
          if (Math.abs(this.vy[i]) < 0.01) this.vy[i] = 0;
        }
      }

      if (this.x[i] < 0.5) this.x[i] = 0.5;
      if (this.y[i] < 0.5) this.y[i] = 0.5;
      if (this.x[i] > w - 0.5) this.x[i] = w - 0.5;
      if (this.y[i] > h - 0.5) this.y[i] = h - 0.5;

      if (this.cool[i] > 0) this.cool[i]--;
      this.age[i]++;
      this.food[i] -= sp.klass === 'monster' ? 0.006 : 0.012;

      /* --- environmental hazards --- */
      var idx = world.clampY(this.y[i] | 0) * w + world.clampX(this.x[i] | 0);
      if (this.air[i] === 0) {
        if (world.fire[idx] > 0 && !(tr & TRAIT.FIREPROOF)) this.damage(i, 1.6, 'fire');
        if (world.lava[idx] > 0 && !(tr & TRAIT.FIREPROOF)) this.damage(i, 12, 'lava');
        if (world.acid[idx] > 0) this.damage(i, 0.35, 'acid');
        if (world.rad[idx] > 40) {
          this.damage(i, 0.22, 'radiation');
          if (rng.next() < 0.0008) this.mutate(i);
        }
        if (sp.habitat === 'land' && world.water[idx] > 40 && !(tr & TRAIT.AQUATIC))
          this.damage(i, 2.2, 'drowning');
        if (sp.habitat === 'water' && world.water[idx] <= 4) this.damage(i, 3, 'suffocation');
        var temp = world.temp[idx];
        if (temp < -22) this.damage(i, 0.28, 'the cold');
        else if (temp > 52) this.damage(i, 0.22, 'the heat');
      }

      if (sp.ignites && world.rng.next() < 0.02) WB.Fire.ignite(world, idx, 120);

      /* --- disease --- */
      if (this.disease[i] > 0) {
        this.disease[i]--;
        this.damage(i, 0.22, 'plague');
        if (rng.next() < 0.02) this.spreadDisease(i);
      }

      /* --- starvation and old age --- */
      if (this.food[i] <= 0) this.damage(i, 0.3, 'starvation');
      if (this.age[i] > this.maxAge[i] && !(tr & TRAIT.IMMORTAL)) {
        if (rng.next() < 0.02) this.kill(i, 'old age');
      }
    }
  };

  Units.prototype.canStand = function (sp, x, y) {
    var world = this.world;
    if (x < 0.5 || y < 0.5 || x > world.w - 0.5 || y > world.h - 0.5) return false;
    if (sp.habitat === 'air') return true;
    var i = (y | 0) * world.w + (x | 0);
    if (sp.habitat === 'water') return world.water[i] > 6;
    if (world.lava[i] > 0) return false;
    return world.water[i] <= 30 || world.temp[i] < -8;
  };

  Units.prototype.spreadDisease = function (i) {
    var self = this;
    this.forEachNear(this.x[i], this.y[i], 2.5, function (j) {
      if (j === i || self.disease[j] > 0) return;
      if (self.traits[j] & (TRAIT.UNDEAD | TRAIT.BLESSED)) return;
      if (self.world.rng.next() < 0.25) {
        self.disease[j] = 900;
        self.traits[j] |= TRAIT.DISEASED;
      }
    });
  };

  Units.prototype.mutate = function (i) {
    var rng = this.world.rng;
    this.traits[i] |= TRAIT.MUTANT;
    var roll = rng.int(0, 4);
    if (roll === 0) this.traits[i] |= TRAIT.FAST;
    else if (roll === 1) this.traits[i] |= TRAIT.STRONG;
    else if (roll === 2) this.traits[i] |= TRAIT.TOUGH;
    else if (roll === 3) {
      this.maxHp[i] *= 1.35;
      this.hp[i] = this.maxHp[i];
    } else this.traits[i] |= TRAIT.ENRAGED;
    this.story(i, 'Mutated by strange energies.');
  };

  /* --- Thinking ----------------------------------------------------------- */
  Units.prototype.stepThink = function () {
    if (this.count === 0) return;
    var slice = Math.max(1, Math.ceil(this.count / THINK_PERIOD));
    for (var n = 0; n < slice; n++) {
      var i = this.thinkCursor;
      this.thinkCursor = (this.thinkCursor + 1) % Math.max(1, this.count);
      if (!this.alive[i]) continue;
      this.think(i);
    }
  };

  Units.prototype.think = function (i) {
    var sp = WB.Species.byId(this.species[i]);
    if (sp.klass === 'civ' && WB.CivAI && this.home[i] >= 0) {
      if (WB.CivAI.think(this, i, sp)) return;
    }
    this.wildThink(i, sp);
  };

  Units.prototype.wildThink = function (i, sp) {
    var world = this.world;
    var rng = world.rng;
    var self = this;

    /* Fight first: an adjacent enemy overrides everything else. */
    var t = this.target[i];
    if (t >= 0 && this.alive[t]) {
      var dx = this.x[t] - this.x[i],
        dy = this.y[t] - this.y[i];
      var d2 = dx * dx + dy * dy;
      if (d2 < 1.2) {
        this.attack(i, t);
        return;
      }
      if (d2 < 400) {
        this.tx[i] = this.x[t];
        this.ty[i] = this.y[t];
        this.state[i] = ST.HUNT;
        return;
      }
      this.target[i] = -1;
    }

    var hungry = this.food[i] < 55;
    var isPredator = sp.diet === 'meat' || (sp.diet === 'both' && this.food[i] < 35);
    var isMonster = sp.klass === 'monster';

    /* Flee from anything obviously deadly. */
    if (!isMonster && sp.dmg < 12) {
      var threat = -1,
        threatD = 1e9;
      this.forEachNear(this.x[i], this.y[i], 9, function (j, d2n) {
        if (j === i) return;
        var osp = WB.Species.byId(self.species[j]);
        if (osp.dmg < WB.Species.byId(self.species[i]).dmg * 1.6) return;
        if (osp.diet === 'plant') return;
        if (d2n < threatD) {
          threatD = d2n;
          threat = j;
        }
      });
      if (threat >= 0) {
        var fx = this.x[i] - this.x[threat];
        var fy = this.y[i] - this.y[threat];
        var fl = Math.sqrt(fx * fx + fy * fy) || 1;
        this.tx[i] = this.x[i] + (fx / fl) * 9;
        this.ty[i] = this.y[i] + (fy / fl) * 9;
        this.state[i] = ST.FLEE;
        return;
      }
    }

    /* Hunt. */
    if ((isPredator && hungry) || isMonster || this.traits[i] & TRAIT.ENRAGED) {
      var prey = -1,
        preyD = 1e9;
      var myKingdom = this.kingdom[i];
      this.forEachNear(this.x[i], this.y[i], isMonster ? 22 : 12, function (j, d2n) {
        if (j === i) return;
        var osp = WB.Species.byId(self.species[j]);
        if (osp.klass === 'monster' && !isMonster) return;
        if (osp.key === WB.Species.byId(self.species[i]).key) return;
        if (myKingdom && self.kingdom[j] === myKingdom) return;
        if (!isMonster && osp.hp > WB.Species.byId(self.species[i]).hp * 1.8) return;
        if (d2n < preyD) {
          preyD = d2n;
          prey = j;
        }
      });
      if (prey >= 0) {
        this.target[i] = prey;
        this.tx[i] = this.x[prey];
        this.ty[i] = this.y[prey];
        this.state[i] = ST.HUNT;
        return;
      }
    }

    /* Graze. */
    if (hungry && (sp.diet === 'plant' || sp.diet === 'both')) {
      var found = this.findFoodTile(i, sp);
      if (found >= 0) {
        this.tx[i] = (found % world.w) + 0.5;
        this.ty[i] = ((found / world.w) | 0) + 0.5;
        this.state[i] = ST.FORAGE;
        var here = world.clampY(this.y[i] | 0) * world.w + world.clampX(this.x[i] | 0);
        if (here === found && world.fuel[here] > 4) {
          world.fuel[here] -= 4;
          world.markDirtyIdx(here);
          this.food[i] = Math.min(100, this.food[i] + 16);
        }
        return;
      }
    }

    /* Breed. */
    if (
      sp.breed > 0 &&
      this.food[i] > 68 &&
      this.age[i] > sp.maxAge * 0.14 &&
      this.living < MAX_UNITS * 0.82 &&
      rng.next() < sp.breed * THINK_PERIOD * 12
    ) {
      var mate = -1;
      var myId = this.species[i];
      this.forEachNear(this.x[i], this.y[i], 6, function (j) {
        if (j !== i && self.species[j] === myId && self.food[j] > 55) {
          mate = j;
          return false;
        }
      });
      if (mate >= 0) {
        var child = this.spawn(myId, this.x[i] + rng.range(-1, 1), this.y[i] + rng.range(-1, 1), {
          age: 0,
          home: this.home[i],
          kingdom: this.kingdom[i],
        });
        if (child >= 0) {
          this.food[i] -= 25;
          this.food[mate] -= 25;
          /* traits are partially heritable */
          var inherit =
            (this.traits[i] | this.traits[mate]) &
            (TRAIT.FAST | TRAIT.STRONG | TRAIT.TOUGH | TRAIT.MUTANT | TRAIT.TAMED);
          if (rng.chance(0.5)) this.traits[child] |= inherit;
          if (this.game.villages && this.home[i] >= 0) this.game.villages.onBirth(this.home[i], child);
        }
        return;
      }
    }

    /* Default: wander, biased toward habitable ground. */
    if (rng.next() < 0.5 || this.state[i] !== ST.WANDER) {
      var a = rng.next() * 6.283;
      var dist = 3 + rng.next() * 9;
      var nx = this.x[i] + Math.cos(a) * dist;
      var ny = this.y[i] + Math.sin(a) * dist;
      if (this.canStand(sp, nx, ny)) {
        this.tx[i] = nx;
        this.ty[i] = ny;
      }
      this.state[i] = ST.WANDER;
    }
  };

  /* Sample a few nearby tiles for biomass rather than scanning a radius:
   * cheap, and animals do not need optimal foraging. */
  Units.prototype.findFoodTile = function (i, sp) {
    var world = this.world;
    var rng = world.rng;
    var best = -1,
      bestV = 8;
    for (var k = 0; k < 7; k++) {
      var px = world.clampX(Math.round(this.x[i] + rng.range(-7, 7)));
      var py = world.clampY(Math.round(this.y[i] + rng.range(-7, 7)));
      var idx = py * world.w + px;
      if (sp.habitat === 'water') {
        if (world.water[idx] > 8 && rng.chance(0.4)) return idx;
        continue;
      }
      if (!world.walkable(idx)) continue;
      if (world.fuel[idx] > bestV) {
        bestV = world.fuel[idx];
        best = idx;
      }
    }
    return best;
  };

  Units.prototype.attack = function (i, t) {
    if (this.cool[i] > 0) return;
    var sp = WB.Species.byId(this.species[i]);
    var dmg = sp.dmg * (1 + this.level[i] * 0.18);
    if (this.traits[i] & TRAIT.STRONG) dmg *= 1.5;
    if (this.traits[i] & TRAIT.ENRAGED) dmg *= 1.3;
    if (this.disease[i] > 0) dmg *= 0.75;
    this.cool[i] = 18;
    this.state[i] = ST.FIGHT;

    var victimName = this.names[t];
    var wasAlive = this.alive[t];
    this.damage(t, dmg, this.names[i] ? 'a blow from ' + this.names[i] : 'a wild ' + sp.label.toLowerCase());
    if (this.game.particles)
      this.game.particles.burst(WB.PKIND.BLOOD, this.x[t], this.y[t], 3, 1.6, 0.4, 0.4);

    if (sp.breathesFire)
      WB.Fire.ignite(
        this.world,
        this.world.clampY(this.y[t] | 0) * this.world.w + this.world.clampX(this.x[t] | 0),
        150
      );
    if (sp.infectious && this.disease[t] === 0 && this.world.rng.chance(0.35)) {
      this.disease[t] = 900;
      this.traits[t] |= TRAIT.DISEASED;
    }

    if (wasAlive && !this.alive[t]) {
      this.kills[i]++;
      this.xp[i] += 12;
      this.food[i] = Math.min(100, this.food[i] + (sp.diet === 'plant' ? 5 : 45));
      if (this.xp[i] > this.level[i] * 40) {
        this.level[i] = Math.min(255, this.level[i] + 1);
        this.maxHp[i] *= 1.12;
        this.hp[i] = this.maxHp[i];
        this.story(i, 'Reached level ' + this.level[i] + '.');
      }
      if (victimName) this.story(i, 'Slew ' + victimName + '.');
      this.target[i] = -1;
    }
  };

  /* --- Frame entry point --------------------------------------------------- */
  Units.prototype.step = function () {
    this.rebuildHash();
    this.stepPhysics();
    this.stepThink();
  };

  /* --- Presentation helpers ------------------------------------------------ */
  Units.prototype.dotColor = function (i) {
    var k = this.kingdom[i];
    if (k && this.game.kingdoms) {
      var kd = this.game.kingdoms.byId(k);
      if (kd) return kd.color;
    }
    return WB.Species.byId(this.species[i]).color || '#ffffff';
  };

  Units.prototype.traitNames = function (i) {
    var out = [];
    var t = this.traits[i];
    for (var k = 0; k < TRAIT_LABELS.length; k++) {
      if (t & TRAIT_LABELS[k][0]) out.push(TRAIT_LABELS[k][1]);
    }
    return out;
  };

  Units.prototype.info = function (i) {
    if (i < 0 || !this.alive[i]) return null;
    var sp = WB.Species.byId(this.species[i]);
    var village = null,
      kingdom = null;
    if (this.game.villages && this.home[i] >= 0) village = this.game.villages.name(this.home[i]);
    if (this.game.kingdoms && this.kingdom[i]) {
      var kd = this.game.kingdoms.byId(this.kingdom[i]);
      if (kd) kingdom = kd.name;
    }
    return {
      index: i,
      name: this.names[i] || sp.label,
      species: sp.label,
      klass: sp.klass,
      sprite: sp.sprite,
      hp: Math.max(0, Math.round(this.hp[i])),
      maxHp: Math.round(this.maxHp[i]),
      age: Math.floor((this.age[i] / WB.Climate.YEAR_TICKS) * 10) / 10,
      maxAge: Math.floor((this.maxAge[i] / WB.Climate.YEAR_TICKS) * 10) / 10,
      level: this.level[i],
      kills: this.kills[i],
      food: Math.round(this.food[i]),
      traits: this.traitNames(i),
      diseased: this.disease[i] > 0,
      village: village,
      kingdom: kingdom,
      story: this.stories[i] || [],
      x: this.x[i],
      y: this.y[i],
    };
  };

  Units.prototype.census = function () {
    var out = { total: 0, civ: 0, animal: 0, monster: 0, byKey: {} };
    for (var i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      var sp = WB.Species.byId(this.species[i]);
      out.total++;
      out[sp.klass]++;
      out.byKey[sp.key] = (out.byKey[sp.key] || 0) + 1;
    }
    return out;
  };

  Units.SPRITE_NAMES = null; /* filled below once species exist */
  Units.ST = ST;
  Units.TRAIT = TRAIT;
  Units.MAX = MAX_UNITS;

  WB.Units = Units;
  WB.TRAIT = TRAIT;
  WB.UnitState = ST;

  /* Renderer looks up sprite names by species id. */
  WB.Units.SPRITE_NAMES = (function () {
    var names = [];
    for (var i = 0; i < WB.Species.list.length; i++) names.push(WB.Species.list[i].sprite);
    return names;
  })();
})(window.WB || (window.WB = {}));
