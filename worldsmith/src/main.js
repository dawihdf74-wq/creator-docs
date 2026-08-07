/* Worldsmith - the game object.
 *
 * Owns the world and every subsystem, drives the fixed-timestep tick, and
 * translates pointer, touch and keyboard input into god powers. */
(function (WB) {
  'use strict';

  var DEFAULT_W = 384;
  var DEFAULT_H = 256;

  function Game(opts) {
    opts = opts || {};
    this.canvas = opts.canvas;
    this.bus = new WB.Bus();
    this.chronicle = new WB.Chronicle(this.bus);
    this.audio = new WB.Audio();
    this.particles = new WB.Particles();

    this.settings = {
      showBorders: true,
      showGrid: false,
      showScenery: true,
      dayNight: true,
      seasons: true,
      sound: true,
      erosion: true,
    };

    this.brushSize = 4;
    this.powerId = 'raise';
    this.hover = { x: 0, y: 0, inside: false };
    this.selectedUnit = -1;
    this.grabbed = -1;
    this.painting = false;
    this.panning = false;
    this.lastApply = 0;
    this.lastPointer = { x: 0, y: 0 };
    this.pointers = {};
    this.pinchDist = 0;

    var seed = opts.seed === undefined ? (Math.random() * 0xffffffff) >>> 0 : opts.seed >>> 0;
    this.buildWorld(opts.width || DEFAULT_W, opts.height || DEFAULT_H, seed);

    this.renderer = new WB.Renderer(this, this.canvas);
    if (opts.minimap) this.minimap = new WB.Minimap(this, opts.minimap);

    var self = this;
    this.loop = new WB.Loop({
      tick: function () {
        self.tick();
      },
      render: function (dt) {
        self.render(dt);
      },
    });
  }

  /* --- World lifecycle ---------------------------------------------------- */
  Game.prototype.buildWorld = function (w, h, seed) {
    this.world = new WB.World(w, h, seed);
    WB.Climate.attach(this.world);
    this.camera = this.camera || new WB.Camera(this.world);
    this.camera.world = this.world;
    this.camera.x = w / 2;
    this.camera.y = h / 2;

    this.effects = new WB.Effects(this);
    this.units = new WB.Units(this);
    this.buildings = new WB.Buildings(this);
    this.kingdoms = new WB.Kingdoms(this);
    this.villages = new WB.Villages(this);
    this.selectedUnit = -1;
  };

  Game.prototype.resizeWorld = function (w, h, seed, opts) {
    opts = opts || {};
    this.buildWorld(w, h, seed);
    if (this.renderer) this.renderer.worldChanged();
    this.particles.clear();
    if (!opts.skipGenerate) this.generate(opts);
  };

  Game.prototype.generate = function (opts) {
    opts = opts || {};
    var world = this.world;
    WB.Worldgen.generate(world, {
      seed: opts.seed === undefined ? world.seed : opts.seed,
      preset: opts.preset || world.preset || 'continents',
      seaLevel: opts.seaLevel,
    });
    WB.Climate.attach(world);
    world.seasons = this.settings.seasons;
    /* Open at midday. Tick 0 is midnight, so a freshly forged world would
     * otherwise greet you in the dark. */
    world.tick = Math.floor(WB.Climate.DAY_TICKS / 2);

    this.units.reset();
    this.buildings.reset();
    this.kingdoms.reset();
    this.villages.reset();
    this.effects.clear();
    this.particles.clear();
    this.chronicle.clear();
    this.selectedUnit = -1;

    if (opts.populate !== false) this.populate(opts);

    this.camera.centerOn(world.w / 2, world.h / 2);
    if (this.renderer) this.renderer.worldChanged();
    this.chronicle.log('info', 'A new world takes shape. Seed ' + world.seed + '.');
    this.bus.emit('worldchanged');
  };

  /* Seed the fresh world with wildlife and, optionally, civilisations. */
  Game.prototype.populate = function (opts) {
    var world = this.world;
    var rng = world.rng;
    var area = world.w * world.h;

    var herds = Math.round(area / 5200);
    var packs = Math.round(area / 22000);
    var shoals = Math.round(area / 9000);

    var i, k;
    for (i = 0; i < herds; i++) {
      var key = rng.pick(['sheep', 'deer', 'rabbit', 'boar']);
      var hx = rng.int(2, world.w - 3),
        hy = rng.int(2, world.h - 3);
      if (world.water[hy * world.w + hx] > 3) continue;
      for (k = 0; k < rng.int(3, 7); k++) {
        this.units.spawnValid(key, hx + rng.range(-4, 4), hy + rng.range(-4, 4), {});
      }
    }
    for (i = 0; i < packs; i++) {
      var pkey = rng.chance(0.65) ? 'wolf' : 'bear';
      var px = rng.int(2, world.w - 3),
        py = rng.int(2, world.h - 3);
      if (world.water[py * world.w + px] > 3) continue;
      for (k = 0; k < rng.int(2, 4); k++) {
        this.units.spawnValid(pkey, px + rng.range(-3, 3), py + rng.range(-3, 3), {});
      }
    }
    for (i = 0; i < shoals; i++) {
      var fx = rng.int(2, world.w - 3),
        fy = rng.int(2, world.h - 3);
      if (world.water[fy * world.w + fx] <= 8) continue;
      for (k = 0; k < rng.int(3, 8); k++) {
        this.units.spawnValid('fish', fx + rng.range(-4, 4), fy + rng.range(-4, 4), {});
      }
    }

    var civs = opts.civs === undefined ? 5 : opts.civs;
    for (i = 0; i < civs; i++) {
      var race = WB.Species.CIV[i % WB.Species.CIV.length];
      var site = this.villages.findSite(race);
      if (site) this.villages.found(site.x, site.y, race, null, 5);
    }
  };

  /* --- Simulation --------------------------------------------------------- */
  Game.prototype.tick = function () {
    var world = this.world;
    world.tick++;

    WB.Water.step(world, { erosion: this.settings.erosion });
    WB.Lava.step(world, this);
    WB.Fire.step(world, this);
    WB.Climate.step(world, this);

    this.units.step();
    this.villages.step();
    this.kingdoms.step();
    if ((world.tick & 7) === 0) this.buildings.step();
    this.effects.step();

    if (this.selectedUnit >= 0 && !this.units.alive[this.selectedUnit]) {
      this.select(-1);
    }
  };

  Game.prototype.render = function (dt) {
    this.camera.update(dt);
    this.particles.update(this.loop.isPaused() ? 0 : dt);
    this.renderer.render(dt);
    if (this.minimap) this.minimap.render();
    this.bus.emit('frame', dt);
  };

  Game.prototype.timeOfDay = function () {
    return WB.Climate.timeOfDay(this.world);
  };

  Game.prototype.seasonName = function () {
    return WB.Climate.seasonName(this.world);
  };

  /* --- Powers -------------------------------------------------------------- */
  Game.prototype.currentPower = function () {
    return WB.Powers.byId(this.powerId);
  };

  Game.prototype.setPower = function (id) {
    if (!WB.Powers.byId(id)) return;
    this.powerId = id;
    this.bus.emit('power', id);
  };

  Game.prototype.applyPower = function (wx, wy, isDrag) {
    var power = this.currentPower();
    if (!power) return;
    var now = performance.now();
    var minGap = Math.max(isDrag ? 28 : 0, (power.cooldown * 1000) / WB.TICK_HZ);
    if (now - this.lastApply < minGap) return;
    this.lastApply = now;

    var world = this.world;
    var r = power.usesBrush ? this.brushSize : 1;
    var x = Math.max(0, Math.min(world.w - 0.001, wx));
    var y = Math.max(0, Math.min(world.h - 0.001, wy));
    power.apply(this, x, y, r);
    if (power.global) this.bus.emit('stats');
  };

  Game.prototype.select = function (i) {
    this.selectedUnit = i === undefined ? -1 : i;
    this.bus.emit('select', this.selectedUnit);
  };

  /* --- Input ---------------------------------------------------------------- */
  Game.prototype.attachInput = function () {
    var self = this;
    var canvas = this.canvas;

    function worldAt(ev) {
      var rect = canvas.getBoundingClientRect();
      return self.camera.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    }

    canvas.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
    });

    canvas.addEventListener('pointerdown', function (ev) {
      canvas.setPointerCapture(ev.pointerId);
      self.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      self.audio.resume();

      var count = Object.keys(self.pointers).length;
      if (count >= 2) {
        /* Second finger down: this is a pan/zoom gesture, not painting. */
        self.painting = false;
        self.panning = true;
        self.pinchDist = self.currentPinch();
        return;
      }

      var w = worldAt(ev);
      self.lastPointer = { x: ev.clientX, y: ev.clientY };

      if (ev.button === 1 || ev.button === 2 || ev.shiftKey) {
        self.panning = true;
        return;
      }

      var power = self.currentPower();
      if (power && power.grab) {
        self.grabbed = self.units.pickAt(w.x, w.y, 3);
        if (self.grabbed >= 0) {
          self.select(self.grabbed);
          return;
        }
      }
      self.painting = true;
      self.applyPower(w.x, w.y, false);
      /* A click with any tool also selects what is under it, so the
       * inspector is never more than one click away. */
      if (power && !power.grab) {
        var hit = self.units.pickAt(w.x, w.y, 1.6);
        if (hit >= 0) self.select(hit);
      }
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (self.pointers[ev.pointerId]) {
        self.pointers[ev.pointerId].x = ev.clientX;
        self.pointers[ev.pointerId].y = ev.clientY;
      }
      var rect = canvas.getBoundingClientRect();
      var w = self.camera.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      self.hover.x = Math.floor(w.x);
      self.hover.y = Math.floor(w.y);
      self.hover.inside = w.x >= 0 && w.y >= 0 && w.x < self.world.w && w.y < self.world.h;

      var count = Object.keys(self.pointers).length;
      if (count >= 2) {
        var d = self.currentPinch();
        if (self.pinchDist > 0 && d > 0) {
          var mid = self.pinchMid();
          self.camera.zoomBy(d / self.pinchDist, mid.x - rect.left, mid.y - rect.top);
        }
        self.pinchDist = d;
        return;
      }

      if (self.panning) {
        self.camera.pan(ev.clientX - self.lastPointer.x, ev.clientY - self.lastPointer.y);
        self.lastPointer = { x: ev.clientX, y: ev.clientY };
        return;
      }

      if (self.grabbed >= 0 && self.units.alive[self.grabbed]) {
        var u = self.units;
        u.vx[self.grabbed] = (w.x - u.x[self.grabbed]) * 3;
        u.vy[self.grabbed] = (w.y - u.y[self.grabbed]) * 3;
        u.x[self.grabbed] = w.x;
        u.y[self.grabbed] = w.y;
        u.air[self.grabbed] = 1.2;
        u.vz[self.grabbed] = 0;
        return;
      }

      if (self.painting) self.applyPower(w.x, w.y, true);
      self.lastPointer = { x: ev.clientX, y: ev.clientY };
    });

    function endPointer(ev) {
      delete self.pointers[ev.pointerId];
      if (Object.keys(self.pointers).length === 0) {
        self.panning = false;
        self.painting = false;
        self.pinchDist = 0;
        if (self.grabbed >= 0 && self.units.alive[self.grabbed]) {
          var u = self.units;
          /* Release: the drag velocity becomes the throw. */
          u.launch(self.grabbed, u.vx[self.grabbed] * 0.6, u.vy[self.grabbed] * 0.6);
          if (self.audio) self.audio.play('whoosh', { intensity: 0.35 });
        }
        self.grabbed = -1;
      }
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId);
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () {
      self.hover.inside = false;
    });

    canvas.addEventListener(
      'wheel',
      function (ev) {
        ev.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
        self.camera.zoomBy(factor, ev.clientX - rect.left, ev.clientY - rect.top);
      },
      { passive: false }
    );

    window.addEventListener('keydown', function (ev) {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      var cam = self.camera;
      var step = 40 / cam.zoom + 4;
      switch (ev.key) {
        case 'ArrowLeft':
        case 'a':
          cam.x -= step;
          cam.clamp();
          break;
        case 'ArrowRight':
        case 'd':
          cam.x += step;
          cam.clamp();
          break;
        case 'ArrowUp':
        case 'w':
          cam.y -= step;
          cam.clamp();
          break;
        case 'ArrowDown':
        case 's':
          cam.y += step;
          cam.clamp();
          break;
        case '+':
        case '=':
          cam.zoomBy(1.25);
          break;
        case '-':
        case '_':
          cam.zoomBy(1 / 1.25);
          break;
        case ' ':
          ev.preventDefault();
          self.loop.setSpeed(self.loop.speed === 0 ? 1 : 0);
          self.bus.emit('speed', self.loop.speed);
          break;
        case '1':
          self.loop.setSpeed(1);
          self.bus.emit('speed', 1);
          break;
        case '2':
          self.loop.setSpeed(2);
          self.bus.emit('speed', 2);
          break;
        case '3':
          self.loop.setSpeed(4);
          self.bus.emit('speed', 4);
          break;
        case '4':
          self.loop.setSpeed(8);
          self.bus.emit('speed', 8);
          break;
        case 'g':
          self.settings.showGrid = !self.settings.showGrid;
          break;
        case 'b':
          self.settings.showBorders = !self.settings.showBorders;
          self.world.markAllDirty();
          break;
        case 'Escape':
          self.select(-1);
          break;
        default:
          if (ev.key >= '[' && ev.key <= ']') break;
      }
      if (ev.key === '[') self.setBrush(self.brushSize - 1);
      if (ev.key === ']') self.setBrush(self.brushSize + 1);
    });
  };

  Game.prototype.currentPinch = function () {
    var ids = Object.keys(this.pointers);
    if (ids.length < 2) return 0;
    var a = this.pointers[ids[0]],
      b = this.pointers[ids[1]];
    var dx = a.x - b.x,
      dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  Game.prototype.pinchMid = function () {
    var ids = Object.keys(this.pointers);
    var a = this.pointers[ids[0]],
      b = this.pointers[ids[1]];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  Game.prototype.setBrush = function (n) {
    this.brushSize = Math.max(1, Math.min(16, n));
    this.bus.emit('brush', this.brushSize);
  };

  /* --- Stats --------------------------------------------------------------- */
  Game.prototype.stats = function () {
    var census = this.units.census();
    var world = this.world;
    return {
      tick: world.tick,
      year: Math.floor(world.tick / WB.Climate.YEAR_TICKS),
      season: this.seasonName(),
      fps: this.loop.fps,
      tps: this.loop.tps,
      units: census.total,
      civ: census.civ,
      animals: census.animal,
      monsters: census.monster,
      villages: this.villages.aliveList().length,
      kingdoms: this.kingdoms.alive().length,
      buildings: this.buildings.living,
      fires: world.activeFire.size(),
      effects: this.effects.list.length,
      particles: this.particles.count,
    };
  };

  Game.prototype.start = function () {
    this.attachInput();
    this.loop.start();
  };

  WB.Game = Game;
})(window.WB || (window.WB = {}));
