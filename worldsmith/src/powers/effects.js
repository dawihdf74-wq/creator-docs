/* Worldsmith - persistent world effects.
 *
 * A disaster that unfolds over time (a tornado crossing a continent, a volcano
 * building a cone, a tsunami sweeping the map) is an object with a step() on
 * the sim clock and an optional render() on the frame clock. Instant effects
 * stay in powers.js; anything with a lifetime lives here. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var K = WB.PKIND;

  /* --- Manager ---------------------------------------------------------- */
  function Effects(game) {
    this.game = game;
    this.list = [];
  }

  Effects.prototype.add = function (fx) {
    fx.game = this.game;
    fx.world = this.game.world;
    if (fx.init) fx.init();
    this.list.push(fx);
    return fx;
  };

  Effects.prototype.step = function () {
    for (var i = this.list.length - 1; i >= 0; i--) {
      var fx = this.list[i];
      fx.step();
      if (fx.dead) {
        if (fx.finish) fx.finish();
        this.list.splice(i, 1);
      }
    }
  };

  Effects.prototype.render = function (ctx, cam) {
    for (var i = 0; i < this.list.length; i++) {
      var fx = this.list[i];
      if (fx.render) fx.render(ctx, cam);
    }
  };

  Effects.prototype.clear = function () {
    this.list.length = 0;
  };

  Effects.prototype.countOf = function (name) {
    var n = 0;
    for (var i = 0; i < this.list.length; i++) if (this.list[i].name === name) n++;
    return n;
  };

  /* --- Meteor ------------------------------------------------------------
   * Falls along a slanted trajectory so the streak reads as coming from the
   * sky rather than appearing on top of the target. */
  function Meteor(tx, ty, opts) {
    opts = opts || {};
    this.name = 'meteor';
    this.tx = tx;
    this.ty = ty;
    this.size = opts.size || 7;
    this.fall = opts.fall || 26;
    this.t = 0;
    this.dead = false;
    this.dirX = opts.dirX === undefined ? 0.55 : opts.dirX;
    this.dirY = opts.dirY === undefined ? -1 : opts.dirY;
    this.travel = opts.travel || 46;
    this.lava = opts.lava !== false;
  }

  Meteor.prototype.pos = function () {
    var k = 1 - this.t / this.fall;
    return { x: this.tx - this.dirX * this.travel * k, y: this.ty - this.dirY * this.travel * k };
  };

  Meteor.prototype.step = function () {
    this.t++;
    var p = this.pos();
    var ps = this.game.particles;
    if (ps) {
      for (var i = 0; i < 3; i++) {
        ps.emit(
          K.FIRE,
          p.x + WB.fx.range(-0.6, 0.6),
          p.y + WB.fx.range(-0.6, 0.6),
          WB.fx.range(-0.4, 0.4),
          WB.fx.range(-0.4, 0.4),
          0.55,
          this.size * 0.16
        );
      }
      ps.emit(K.SMOKE, p.x, p.y, WB.fx.range(-0.3, 0.3), WB.fx.range(-0.3, 0.3), 1.6, this.size * 0.22);
    }
    if (this.t >= this.fall) {
      this.dead = true;
      this.impact();
    }
  };

  Meteor.prototype.impact = function () {
    var g = this.game,
      world = g.world;
    var r = this.size;
    WB.Blast.explode(g, this.tx, this.ty, {
      radius: r,
      crater: 0.1 + r * 0.022,
      craterScale: 0.85,
      scorch: true,
      fire: true,
      damage: 260,
      push: 8,
      cause: 'meteor',
      shake: Math.min(20, 5 + r),
      sound: 'boom',
    });
    if (this.lava && r >= 6) {
      var cx = world.clampX(Math.round(this.tx)),
        cy = world.clampY(Math.round(this.ty));
      world.forEachInDisc(cx, cy, r * 0.28, function (i) {
        if (world.water[i] < 20) WB.Lava.add(world, i, 90);
      });
    }
    g.effects.add(new Shockwave(this.tx, this.ty, r * 3.2, 6));
  };

  Meteor.prototype.render = function (ctx, cam) {
    var p = this.pos();
    var s = cam.worldToScreen(p.x, p.y);
    var rad = Math.max(2, this.size * 0.35 * cam.zoom);
    var grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad * 2.2);
    grad.addColorStop(0, 'rgba(255,240,190,0.95)');
    grad.addColorStop(0.4, 'rgba(255,140,40,0.75)');
    grad.addColorStop(1, 'rgba(255,80,10,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rad * 2.2, 0, Math.PI * 2);
    ctx.fill();

    /* shadow marker on the ground so the player can read the impact point */
    var t = cam.worldToScreen(this.tx, this.ty);
    ctx.strokeStyle = 'rgba(255,90,40,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, this.size * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
  };

  /* --- Shockwave --------------------------------------------------------- */
  function Shockwave(x, y, maxR, ticks) {
    this.name = 'shockwave';
    this.x = x;
    this.y = y;
    this.maxR = maxR;
    this.ticks = ticks;
    this.t = 0;
    this.dead = false;
    this.prevR = 0;
  }

  Shockwave.prototype.step = function () {
    this.t++;
    var r = (this.t / this.ticks) * this.maxR;
    var g = this.game,
      world = g.world;
    /* Only the annulus between last tick's radius and this one is affected,
     * so a tile is never hit twice by the same wave. */
    var inner = this.prevR;
    var u = g.units;
    if (u) {
      for (var i = 0; i < u.count; i++) {
        if (!u.alive[i]) continue;
        var dx = u.x[i] - this.x,
          dy = u.y[i] - this.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < inner || d > r) continue;
        var f = (1 - d / this.maxR) * 6;
        u.launch(i, (dx / (d || 1)) * f, (dy / (d || 1)) * f - 1.5);
        u.damage(i, 25 * (1 - d / this.maxR), 'shockwave');
      }
    }
    /* knock down vegetation in the ring */
    var self = this;
    world.forEachInDisc(this.x, this.y, r, function (idx, x, y, d) {
      if (d < inner) return;
      if (world.fuel[idx] > 30) {
        world.fuel[idx] = Math.round(world.fuel[idx] * 0.55);
        world.markDirtyIdx(idx);
      }
    });
    this.prevR = r;
    if (this.t >= this.ticks) this.dead = true;
  };

  Shockwave.prototype.render = function (ctx, cam) {
    var r = (this.t / this.ticks) * this.maxR;
    var s = cam.worldToScreen(this.x, this.y);
    ctx.strokeStyle = 'rgba(255,220,180,' + (1 - this.t / this.ticks).toFixed(2) + ')';
    ctx.lineWidth = Math.max(1, cam.zoom * 0.6);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
  };

  /* --- Tornado ----------------------------------------------------------- */
  function Tornado(x, y, opts) {
    opts = opts || {};
    this.name = 'tornado';
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = opts.radius || 5;
    this.life = opts.life || 900;
    this.t = 0;
    this.dead = false;
    this.phase = WB.fx.next() * 6.28;
    this.carried = []; /* terrain the funnel has picked up and will drop */
  }

  Tornado.prototype.step = function () {
    var world = this.world,
      g = this.game;
    this.t++;
    if (this.t > this.life) {
      this.dead = true;
      return;
    }

    /* Drift with the wind plus a slow wander, so its track curves. */
    this.phase += 0.03;
    var wanderX = Math.cos(this.phase) * 0.35;
    var wanderY = Math.sin(this.phase * 0.7) * 0.35;
    this.vx = this.vx * 0.94 + (world.windX * 0.9 + wanderX) * 0.06;
    this.vy = this.vy * 0.94 + (world.windY * 0.9 + wanderY) * 0.06;
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < 2 || this.x > world.w - 3 || this.y < 2 || this.y > world.h - 3) {
      this.dead = true;
      return;
    }

    var cx = Math.round(this.x),
      cy = Math.round(this.y);
    var r = this.radius;
    var rng = world.rng;
    var self = this;

    /* Strip vegetation, lift soil, and occasionally tear the ground open. */
    world.forEachInDisc(cx, cy, r, function (i, x, y, d) {
      var strength = 1 - d / r;
      if (world.fuel[i] > 0 && rng.next() < 0.35 * strength) {
        world.fuel[i] = Math.max(0, world.fuel[i] - 12);
        world.markDirtyIdx(i);
      }
      if (rng.next() < 0.05 * strength) {
        var lift = 0.006 * strength;
        world.height[i] -= lift;
        self.carried.push(lift);
        if (self.carried.length > 400) self.carried.shift();
        WB.Water.wake(world, i);
      }
      if (world.water[i] > 3 && rng.next() < 0.2 * strength) {
        /* waterspout: throws water outward */
        var take = Math.min(world.water[i], 2);
        world.water[i] -= take;
        WB.Water.wake(world, i);
      }
    });

    /* Drop what it carried in a debris trail behind the funnel. */
    if (this.carried.length > 30 && rng.next() < 0.4) {
      var dropped = this.carried.shift();
      var dx = world.clampX(Math.round(this.x - this.vx * 6 + rng.range(-r, r)));
      var dy = world.clampY(Math.round(this.y - this.vy * 6 + rng.range(-r, r)));
      var di = dy * world.w + dx;
      world.height[di] += dropped * 0.8;
      world.markDirtyIdx(di);
    }

    /* Suck in and fling units. */
    var u = g.units;
    if (u) {
      var grab = r * 2.2,
        grab2 = grab * grab;
      for (var i2 = 0; i2 < u.count; i2++) {
        if (!u.alive[i2]) continue;
        var ux = u.x[i2] - this.x,
          uy = u.y[i2] - this.y;
        var d2 = ux * ux + uy * uy;
        if (d2 > grab2) continue;
        var dist = Math.sqrt(d2) || 0.001;
        /* Spiral: pull inward and swirl tangentially. */
        var pull = (1 - dist / grab) * 0.55;
        var tanx = -uy / dist,
          tany = ux / dist;
        u.launch(
          i2,
          (-ux / dist) * pull + tanx * pull * 1.6,
          (-uy / dist) * pull + tany * pull * 1.6 - pull * 0.7
        );
        if (dist < r * 0.7 && rng.next() < 0.08) u.damage(i2, 22, 'tornado');
      }
    }

    if (rng.next() < 0.25) WB.Blast.razeBuildings(g, this.x, this.y, r * 0.7, true);

    var ps = g.particles;
    if (ps && ps.count < 3200) {
      for (var p = 0; p < 4; p++) {
        var a = WB.fx.next() * 6.283;
        var rr = WB.fx.next() * r;
        ps.emit(
          K.DEBRIS,
          this.x + Math.cos(a) * rr,
          this.y + Math.sin(a) * rr - WB.fx.next() * 4,
          Math.cos(a + 1.57) * 2,
          -WB.fx.range(0.5, 2.5),
          1.1,
          0.6
        );
      }
    }
    g.camera.addShake(0.6);
  };

  Tornado.prototype.render = function (ctx, cam) {
    var s = cam.worldToScreen(this.x, this.y);
    var z = cam.zoom;
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (var i = 0; i < 9; i++) {
      var f = i / 8;
      var yy = s.y - f * this.radius * 3.2 * z;
      var rr = this.radius * z * (0.3 + f * 1.0);
      var wob = Math.sin(this.t * 0.25 + i * 0.8) * z * 0.6;
      ctx.fillStyle = i % 2 ? 'rgba(120,116,110,0.8)' : 'rgba(86,82,78,0.8)';
      ctx.beginPath();
      ctx.ellipse(s.x + wob, yy, rr, rr * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* --- Volcano ----------------------------------------------------------- */
  function Volcano(x, y, opts) {
    opts = opts || {};
    this.name = 'volcano';
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.life = opts.life || 1400;
    this.t = 0;
    this.dead = false;
    this.power = opts.power || 1;
  }

  Volcano.prototype.init = function () {
    var world = this.world;
    /* Push up a starter cone so the vent is never below sea level. */
    WB.Blast.raise(world, this.x, this.y, 6 * this.power, 0.16 * this.power);
    var i = this.y * world.w + this.x;
    world.water[i] = 0;
    WB.Lava.add(world, i, 200);
    this.game.camera.addShake(6);
    if (this.game.audio) this.game.audio.play('rumble', { intensity: 0.8 });
  };

  Volcano.prototype.step = function () {
    var world = this.world,
      g = this.game;
    this.t++;
    if (this.t > this.life) {
      this.dead = true;
      return;
    }
    var i = this.y * world.w + this.x;
    var rng = world.rng;

    /* Steady effusion, with periodic violent bursts. */
    if (this.t % 3 === 0) WB.Lava.erupt(world, i, 30 * this.power);

    if (rng.next() < 0.045) {
      /* Throw volcanic bombs onto the surrounding slopes. */
      var n = 1 + Math.floor(rng.next() * 3 * this.power);
      for (var b = 0; b < n; b++) {
        var a = rng.next() * 6.283;
        var dist = rng.range(4, 16 * this.power);
        var bx = world.clampX(Math.round(this.x + Math.cos(a) * dist));
        var by = world.clampY(Math.round(this.y + Math.sin(a) * dist));
        g.effects.add(
          new Meteor(bx, by, {
            size: 2 + rng.next() * 2,
            fall: 14,
            travel: 12,
            dirX: Math.cos(a) * -1,
            dirY: -1,
            lava: true,
          })
        );
      }
      g.camera.addShake(3);
    }

    var ps = g.particles;
    if (ps && ps.count < 3000) {
      ps.emit(
        K.SMOKE,
        this.x + WB.fx.range(-1.5, 1.5),
        this.y - 1,
        WB.fx.range(-0.4, 0.4),
        -WB.fx.range(1.2, 3),
        3.2,
        2.2
      );
      if (WB.fx.chance(0.5))
        ps.emit(
          K.FIRE,
          this.x + WB.fx.range(-1, 1),
          this.y,
          WB.fx.range(-0.8, 0.8),
          -WB.fx.range(1, 3),
          0.9,
          0.7
        );
    }
  };

  Volcano.prototype.render = function (ctx, cam) {
    var s = cam.worldToScreen(this.x + 0.5, this.y + 0.5);
    var r = 4 * cam.zoom;
    var grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    grad.addColorStop(0, 'rgba(255,190,80,0.55)');
    grad.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  /* --- Storm clouds (rain / acid / snow / sand) -------------------------- */
  function Cloud(x, y, kind, opts) {
    opts = opts || {};
    this.name = 'cloud';
    this.kind = kind; /* 'rain' | 'storm' | 'acid' | 'snow' | 'sand' | 'toxic' */
    this.x = x;
    this.y = y;
    this.radius = opts.radius || 9;
    this.life = opts.life || 700;
    this.t = 0;
    this.dead = false;
    this.drift = opts.drift === undefined ? 1 : opts.drift;
  }

  Cloud.prototype.step = function () {
    var world = this.world,
      g = this.game,
      rng = world.rng;
    this.t++;
    if (this.t > this.life) {
      this.dead = true;
      return;
    }
    this.x += world.windX * 0.055 * this.drift;
    this.y += world.windY * 0.055 * this.drift;
    if (
      this.x < -this.radius ||
      this.x > world.w + this.radius ||
      this.y < -this.radius ||
      this.y > world.h + this.radius
    ) {
      this.dead = true;
      return;
    }

    var cx = Math.round(this.x),
      cy = Math.round(this.y);
    var kind = this.kind;
    var self = this;

    world.forEachInDisc(world.clampX(cx), world.clampY(cy), this.radius, function (i, x, y, d) {
      var strength = 1 - d / self.radius;
      if (kind === 'rain' || kind === 'storm') {
        world.moist[i] = Math.min(255, world.moist[i] + (rng.next() < 0.3 ? 2 : 0));
        if (world.fire[i] > 0 && rng.next() < 0.5 * strength) {
          world.fire[i] = Math.max(0, world.fire[i] - 40);
          if (world.fire[i] === 0) world.markDirtyIdx(i);
        }
        if (rng.next() < 0.012 * strength && world.water[i] < 40) {
          world.water[i]++;
          WB.Water.wake(world, i);
          world.markDirtyIdx(i);
        }
      } else if (kind === 'acid') {
        if (rng.next() < 0.35 * strength) {
          world.acid[i] = Math.min(255, world.acid[i] + 18);
          world.markDirtyIdx(i);
        }
      } else if (kind === 'toxic') {
        if (rng.next() < 0.3 * strength) {
          world.acid[i] = Math.min(255, world.acid[i] + 8);
          world.rad[i] = Math.min(255, world.rad[i] + 6);
          world.markDirtyIdx(i);
        }
      } else if (kind === 'snow') {
        world.baseTemp[i] = Math.max(-90, world.baseTemp[i] - (rng.next() < 0.25 ? 1 : 0));
        world.moist[i] = Math.min(255, world.moist[i] + 1);
        if (world.fire[i] > 0) {
          world.fire[i] = 0;
          world.markDirtyIdx(i);
        }
      } else if (kind === 'sand') {
        if (rng.next() < 0.06 * strength && world.water[i] <= 3) {
          world.fuel[i] = Math.max(0, world.fuel[i] - 6);
          if (world.fuel[i] === 0 && rng.next() < 0.25) world.setTerrain(i, T.SAND);
          world.markDirtyIdx(i);
        }
      }
    });

    /* Lightning. */
    if (kind === 'storm' && rng.next() < 0.09) {
      var a = rng.next() * 6.283,
        rr = rng.next() * this.radius;
      var lx = world.clampX(Math.round(this.x + Math.cos(a) * rr));
      var ly = world.clampY(Math.round(this.y + Math.sin(a) * rr));
      WB.Powers.strikeLightning(g, lx, ly);
    }

    if (kind === 'acid' || kind === 'toxic') {
      WB.Blast.damageUnits(g, this.x, this.y, this.radius, 1.2, 'acid');
    }
    if (kind === 'sand') WB.Blast.damageUnits(g, this.x, this.y, this.radius, 0.4, 'sandstorm');
    if (kind === 'snow') WB.Blast.damageUnits(g, this.x, this.y, this.radius, 0.35, 'cold');

    /* Precipitation particles. */
    var ps = g.particles;
    if (ps && ps.count < 3000) {
      var pk = kind === 'snow' ? K.SNOW : kind === 'acid' || kind === 'toxic' ? K.MAGIC : K.SPLASH;
      for (var p = 0; p < 3; p++) {
        var pa = WB.fx.next() * 6.283,
          prr = WB.fx.next() * this.radius;
        ps.emit(
          pk,
          this.x + Math.cos(pa) * prr,
          this.y + Math.sin(pa) * prr - 3,
          0,
          kind === 'snow' ? 1.2 : 7,
          kind === 'snow' ? 2.4 : 0.5,
          0.5
        );
      }
    }
  };

  var CLOUD_COLORS = {
    rain: 'rgba(70,86,104,0.42)',
    storm: 'rgba(48,54,70,0.55)',
    acid: 'rgba(120,190,50,0.4)',
    toxic: 'rgba(150,90,190,0.4)',
    snow: 'rgba(200,215,230,0.45)',
    sand: 'rgba(198,168,110,0.45)',
  };

  Cloud.prototype.render = function (ctx, cam) {
    var s = cam.worldToScreen(this.x, this.y);
    var r = this.radius * cam.zoom;
    ctx.save();
    ctx.fillStyle = CLOUD_COLORS[this.kind] || CLOUD_COLORS.rain;
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * 6.283 + this.t * 0.004;
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * r * 0.42, s.y + Math.sin(a) * r * 0.3, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* --- Tsunami ----------------------------------------------------------- */
  function Tsunami(edge, opts) {
    opts = opts || {};
    this.name = 'tsunami';
    this.edge = edge; /* 0 left, 1 right, 2 top, 3 bottom */
    this.pos = 0;
    this.speed = opts.speed || 1.1;
    this.amp = opts.amp || 130;
    this.dead = false;
    this.trail = 14;
  }

  Tsunami.prototype.step = function () {
    var world = this.world,
      g = this.game;
    this.pos += this.speed;
    var horizontal = this.edge === 0 || this.edge === 1;
    var span = horizontal ? world.w : world.h;
    if (this.pos - this.trail > span) {
      this.dead = true;
      return;
    }

    var front = Math.round(this.edge === 1 || this.edge === 3 ? span - 1 - this.pos : this.pos);
    var cross = horizontal ? world.h : world.w;

    for (var c = 0; c < cross; c++) {
      for (var k = 0; k < Math.ceil(this.speed) + 1; k++) {
        var line = front + (this.edge === 1 || this.edge === 3 ? k : -k);
        if (line < 0 || line >= span) continue;
        var i = horizontal ? c * world.w + line : line * world.w + c;
        var target = this.amp;
        if (world.water[i] < target) {
          world.water[i] = Math.min(255, world.water[i] + Math.ceil((target - world.water[i]) * 0.5));
          world.markDirtyIdx(i);
          world.activeWater.add(i);
        }
        if (world.fire[i]) {
          world.fire[i] = 0;
          world.markDirtyIdx(i);
        }
      }
    }

    /* Sweep everything standing in the front. */
    var fx = horizontal ? front : world.w / 2;
    var fy = horizontal ? world.h / 2 : front;
    var u = g.units;
    if (u) {
      for (var ui = 0; ui < u.count; ui++) {
        if (!u.alive[ui]) continue;
        var along = horizontal ? u.x[ui] : u.y[ui];
        if (Math.abs(along - front) > 3) continue;
        var dir = this.edge === 1 || this.edge === 3 ? -1 : 1;
        if (horizontal) u.launch(ui, dir * 2.6, WB.fx.range(-0.8, 0.8));
        else u.launch(ui, WB.fx.range(-0.8, 0.8), dir * 2.6);
        u.damage(ui, 40, 'tsunami');
      }
    }
    if (horizontal) WB.Blast.razeBuildings(g, front, world.h / 2, world.h, true);
    else WB.Blast.razeBuildings(g, world.w / 2, front, world.w, true);

    g.camera.addShake(1.6);
    var ps = g.particles;
    if (ps && ps.count < 3200) {
      for (var p = 0; p < 6; p++) {
        var px = horizontal ? front : WB.fx.next() * world.w;
        var py = horizontal ? WB.fx.next() * world.h : front;
        ps.emit(K.SPLASH, px, py, WB.fx.range(-1, 1), -WB.fx.range(1, 3), 0.8, 0.8);
      }
    }
  };

  /* --- Earthquake -------------------------------------------------------- */
  function Earthquake(x, y, opts) {
    opts = opts || {};
    this.name = 'quake';
    this.x = x;
    this.y = y;
    this.angle = opts.angle === undefined ? WB.fx.next() * Math.PI * 2 : opts.angle;
    this.len = opts.length || 55;
    this.t = 0;
    this.step_ = 0;
    this.dead = false;
    this.fissure = opts.fissure !== false;
    this.magma = opts.magma || false;
  }

  Earthquake.prototype.step = function () {
    var world = this.world,
      g = this.game,
      rng = world.rng;
    this.t++;
    g.camera.addShake(5);

    /* Advance a rupture along the fault a few tiles per tick. */
    var advance = 2;
    for (var a = 0; a < advance; a++) {
      this.step_++;
      if (this.step_ > this.len) {
        this.dead = true;
        return;
      }
      var d = this.step_ - this.len / 2;
      /* the fault wanders so it doesn't look like a ruled line */
      var wob = Math.sin(this.step_ * 0.24) * 3;
      var px = this.x + Math.cos(this.angle) * d - Math.sin(this.angle) * wob;
      var py = this.y + Math.sin(this.angle) * d + Math.cos(this.angle) * wob;
      if (px < 1 || py < 1 || px > world.w - 2 || py > world.h - 2) continue;

      var self = this;
      var width = 1.4 + rng.next() * 1.6;
      world.forEachInDisc(Math.round(px), Math.round(py), width, function (i, xx, yy, dd) {
        if (self.fissure) {
          world.height[i] -= 0.09 * (1 - dd / width);
          world.fuel[i] = 0;
          if (world.terrain[i] !== T.LAVA) world.setTerrain(i, T.ROCK);
          if (self.magma && rng.next() < 0.12) WB.Lava.add(world, i, 120);
        }
        WB.Water.wake(world, i);
        world.markDirtyIdx(i);
      });
      /* upthrust on the flanks */
      world.forEachInDisc(
        Math.round(px + Math.sin(this.angle) * 3),
        Math.round(py - Math.cos(this.angle) * 3),
        2.5,
        function (i, xx, yy, dd) {
          world.height[i] += 0.02;
          WB.Water.wake(world, i);
        }
      );

      WB.Blast.razeBuildings(g, px, py, 3, true);
      WB.Blast.damageUnits(g, px, py, 2.5, 90, 'earthquake');

      var ps = g.particles;
      if (ps && ps.count < 3000) ps.burst(K.DEBRIS, px, py, 4, 3, 0.9, 0.6);
    }
    if (g.audio && this.t === 1) g.audio.play('rumble', { intensity: 1 });
  };

  /* --- Black hole -------------------------------------------------------- */
  function BlackHole(x, y, opts) {
    opts = opts || {};
    this.name = 'blackhole';
    this.x = x;
    this.y = y;
    this.life = opts.life || 260;
    this.t = 0;
    this.dead = false;
    this.maxR = opts.radius || 14;
  }

  BlackHole.prototype.step = function () {
    var world = this.world,
      g = this.game,
      rng = world.rng;
    this.t++;
    if (this.t > this.life) {
      this.dead = true;
      return;
    }
    /* grows, holds, then collapses */
    var f = this.t / this.life;
    var r = this.maxR * Math.sin(Math.min(1, f * 1.15) * Math.PI * 0.9);
    this.r = r;
    if (r < 0.5) return;

    /* Devour the ground: material is removed and never comes back. */
    var eat = r * 0.35;
    world.forEachInDisc(Math.round(this.x), Math.round(this.y), eat, function (i, x, y, d) {
      world.height[i] = Math.max(-1, world.height[i] - 0.05 * (1 - d / eat));
      world.water[i] = 0;
      world.lava[i] = 0;
      world.fuel[i] = 0;
      world.fire[i] = 0;
      world.setTerrain(i, T.OBSIDIAN);
      WB.Water.wake(world, i);
    });

    /* Drag everything inward; anything reaching the singularity is gone. */
    var u = g.units;
    if (u) {
      var r2 = r * r * 9;
      for (var i2 = 0; i2 < u.count; i2++) {
        if (!u.alive[i2]) continue;
        var dx = this.x - u.x[i2],
          dy = this.y - u.y[i2];
        var d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        var d = Math.sqrt(d2) || 0.001;
        if (d < eat) {
          u.kill(i2, 'the void');
          continue;
        }
        var pull = (1.6 / d) * (1 - d / (r * 3));
        u.launch(i2, (dx / d) * pull, (dy / d) * pull);
      }
    }
    WB.Blast.razeBuildings(g, this.x, this.y, eat, false);

    var ps = g.particles;
    if (ps && ps.count < 3200) {
      for (var p = 0; p < 4; p++) {
        var a = WB.fx.next() * 6.283;
        var rr = r * (1.2 + WB.fx.next());
        ps.emit(
          K.MAGIC,
          this.x + Math.cos(a) * rr,
          this.y + Math.sin(a) * rr,
          -Math.cos(a) * 3,
          -Math.sin(a) * 3,
          0.9,
          0.6
        );
      }
    }
    g.camera.addShake(2);
  };

  BlackHole.prototype.render = function (ctx, cam) {
    var r = (this.r || 0) * cam.zoom;
    if (r < 1) return;
    var s = cam.worldToScreen(this.x, this.y);
    var grad = ctx.createRadialGradient(s.x, s.y, r * 0.25, s.x, s.y, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.55, 'rgba(40,10,70,0.85)');
    grad.addColorStop(1, 'rgba(120,60,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,150,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 0.85, r * 0.3, this.t * 0.06, 0, Math.PI * 2);
    ctx.stroke();
  };

  /* --- Demonic rift ------------------------------------------------------ */
  function Rift(x, y, opts) {
    opts = opts || {};
    this.name = 'rift';
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.life = opts.life || 900;
    this.t = 0;
    this.dead = false;
    this.spawn = opts.spawn || 'demon';
    this.every = opts.every || 70;
  }

  Rift.prototype.init = function () {
    var world = this.world,
      self = this;
    world.forEachInDisc(this.x, this.y, 4, function (i, x, y, d) {
      if (world.water[i] > 3) return;
      if (world.rng.next() < 1 - d / 5) world.setTerrain(i, T.CORRUPT);
    });
  };

  Rift.prototype.step = function () {
    var g = this.game,
      world = this.world;
    this.t++;
    if (this.t > this.life) {
      this.dead = true;
      return;
    }
    /* Corruption creeps outward from the tear. */
    if (this.t % 20 === 0) {
      var rr = 4 + (this.t / this.life) * 9;
      world.forEachInDisc(this.x, this.y, rr, function (i, x, y, d) {
        if (world.water[i] > 3 || world.terrain[i] === T.CORRUPT) return;
        if (world.rng.next() < 0.06 * (1 - d / rr)) {
          world.setTerrain(i, T.CORRUPT);
          world.fuel[i] = 0;
        }
      });
    }
    if (this.t % this.every === 0 && g.units && g.units.spawnMonster) {
      g.units.spawnMonster(this.x + WB.fx.range(-2, 2), this.y + WB.fx.range(-2, 2), this.spawn);
    }
    var ps = g.particles;
    if (ps && ps.count < 3000 && WB.fx.chance(0.6)) {
      ps.emit(
        K.MAGIC,
        this.x + WB.fx.range(-1, 1),
        this.y + WB.fx.range(-1, 1),
        WB.fx.range(-0.3, 0.3),
        -WB.fx.range(0.4, 1.4),
        1.2,
        0.6
      );
    }
  };

  Rift.prototype.render = function (ctx, cam) {
    var s = cam.worldToScreen(this.x + 0.5, this.y + 0.5);
    var z = cam.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,80,255,0.9)';
    ctx.lineWidth = Math.max(1.5, z * 0.5);
    ctx.beginPath();
    for (var i = 0; i <= 8; i++) {
      var t = i / 8;
      var yy = s.y + (t - 0.5) * 6 * z;
      var xx = s.x + Math.sin(t * 9 + this.t * 0.1) * z * 0.9;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.restore();
  };

  /* --- Nuclear detonation ------------------------------------------------ */
  function Nuke(x, y, opts) {
    opts = opts || {};
    this.name = 'nuke';
    this.x = x;
    this.y = y;
    this.maxR = opts.radius || 26;
    this.t = 0;
    this.stages = 22;
    this.dead = false;
    this.prevR = 0;
  }

  Nuke.prototype.init = function () {
    var g = this.game;
    g.camera.addShake(22);
    if (g.audio) g.audio.play('boom', { intensity: 1 });
  };

  Nuke.prototype.step = function () {
    var world = this.world,
      g = this.game;
    this.t++;
    var f = this.t / this.stages;
    var r = this.maxR * Math.pow(Math.min(1, f), 0.55);
    var inner = this.prevR;
    var self = this;

    world.forEachInDisc(Math.round(this.x), Math.round(this.y), r, function (i, x, y, d) {
      if (d < inner) return;
      var near = 1 - d / self.maxR;
      world.fuel[i] = 0;
      world.fire[i] = 0;
      world.lava[i] = 0;
      if (world.water[i] > 0) {
        world.water[i] = Math.max(0, world.water[i] - Math.round(60 * near));
        WB.Water.wake(world, i);
      }
      world.setTerrain(i, near > 0.55 ? T.OBSIDIAN : near > 0.25 ? T.SCORCHED : T.ASH);
      world.rad[i] = Math.min(255, world.rad[i] + Math.round(230 * near));
      world.height[i] -= 0.05 * near;
      world.markDirtyIdx(i);
    });

    WB.Blast.damageUnits(g, this.x, this.y, r, 400, 'nuclear fire');
    WB.Blast.razeBuildings(g, this.x, this.y, r, false);
    WB.Blast.pushUnits(g, this.x, this.y, r * 1.3, 9 * (1 - f));

    this.prevR = r;
    g.camera.addShake(6 * (1 - f));

    var ps = g.particles;
    if (ps) {
      for (var p = 0; p < 8; p++) {
        var a = WB.fx.next() * 6.283;
        var rr = r * WB.fx.next();
        ps.emit(
          K.FIRE,
          this.x + Math.cos(a) * rr,
          this.y + Math.sin(a) * rr,
          Math.cos(a) * 2,
          Math.sin(a) * 2 - 1,
          1.1,
          1.4
        );
      }
      /* mushroom stem and cap */
      ps.emit(K.SMOKE, this.x + WB.fx.range(-2, 2), this.y - f * 12, WB.fx.range(-0.5, 0.5), -3.5, 4, 3.4);
    }

    if (this.t >= this.stages) {
      this.dead = true;
      /* Fallout drifts downwind after the blast. */
      g.effects.add(new Cloud(this.x, this.y, 'toxic', { radius: this.maxR * 0.8, life: 900 }));
    }
  };

  Nuke.prototype.render = function (ctx, cam) {
    var f = this.t / this.stages;
    var r = this.maxR * Math.pow(Math.min(1, f), 0.55) * cam.zoom;
    var s = cam.worldToScreen(this.x, this.y);
    var grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    grad.addColorStop(0, 'rgba(255,255,235,' + (1 - f) + ')');
    grad.addColorStop(0.5, 'rgba(255,190,80,' + (0.85 - f * 0.7) + ')');
    grad.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (f < 0.35) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 - f) * 1.6 + ')';
      ctx.fillRect(0, 0, cam.vw, cam.vh);
    }
  };

  /* --- Lightning flash (visual companion to the instant strike) ---------- */
  function Bolt(x, y) {
    this.name = 'bolt';
    this.x = x;
    this.y = y;
    this.t = 0;
    this.dead = false;
    this.seed = WB.fx.next() * 1000;
  }

  Bolt.prototype.step = function () {
    if (++this.t > 6) this.dead = true;
  };

  Bolt.prototype.render = function (ctx, cam) {
    var s = cam.worldToScreen(this.x + 0.5, this.y + 0.5);
    var alpha = 1 - this.t / 6;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,210,' + alpha.toFixed(2) + ')';
    ctx.lineWidth = Math.max(1.5, cam.zoom * 0.35);
    ctx.beginPath();
    var x = s.x,
      y = -20;
    ctx.moveTo(x, y);
    var rnd = this.seed;
    while (y < s.y) {
      rnd = (rnd * 9301 + 49297) % 233280;
      x += (rnd / 233280 - 0.5) * cam.zoom * 3;
      y += (s.y + 20) / 9;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.restore();
  };

  WB.Effects = Effects;
  WB.FX = {
    Meteor: Meteor,
    Shockwave: Shockwave,
    Tornado: Tornado,
    Volcano: Volcano,
    Cloud: Cloud,
    Tsunami: Tsunami,
    Earthquake: Earthquake,
    BlackHole: BlackHole,
    Rift: Rift,
    Nuke: Nuke,
    Bolt: Bolt,
  };
})(window.WB || (window.WB = {}));
