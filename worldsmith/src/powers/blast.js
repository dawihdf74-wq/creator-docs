/* Worldsmith - shared destruction helpers.
 *
 * Every disaster ends up wanting the same handful of primitives: dig a crater,
 * hurt whatever is standing there, flatten the buildings, throw debris. They
 * live here so a new power is a few lines of composition rather than a fresh
 * copy of the same loops. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var Blast = {};

  /* Bowl-shaped depression with a raised rim, the way a real impact looks. */
  Blast.crater = function (world, cx, cy, r, depth) {
    world.forEachInDisc(world.clampX(cx), world.clampY(cy), r + 2, function (i, x, y, d) {
      if (d <= r) {
        var t = 1 - d / r;
        world.height[i] -= depth * t * t;
      } else {
        /* ejecta piles up just outside the rim */
        var e = 1 - (d - r) / 2;
        world.height[i] += depth * 0.18 * Math.max(0, e);
      }
      if (world.height[i] < -1) world.height[i] = -1;
      world.lava[i] = 0;
      WB.Water.wake(world, i);
    });
  };

  Blast.scorch = function (world, cx, cy, r) {
    world.forEachInDisc(cx, cy, r, function (i, x, y, d) {
      if (world.water[i] > 3) return;
      world.fuel[i] = 0;
      world.fire[i] = 0;
      if (world.terrain[i] !== T.LAVA) world.setTerrain(i, d < r * 0.6 ? T.SCORCHED : T.ASH);
    });
  };

  Blast.damageUnits = function (game, cx, cy, r, amount, cause) {
    var u = game.units;
    if (!u) return 0;
    var hit = 0;
    var r2 = r * r;
    for (var i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      var dx = u.x[i] - cx,
        dy = u.y[i] - cy;
      var d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      /* falloff: full damage at the centre, a third at the rim */
      var falloff = 1 - Math.sqrt(d2) / r;
      u.damage(i, amount * (0.33 + falloff * 0.67), cause);
      hit++;
    }
    return hit;
  };

  /* Launch units outward. Used by shockwaves, tornadoes and the throw tool. */
  Blast.pushUnits = function (game, cx, cy, r, force) {
    var u = game.units;
    if (!u) return;
    var r2 = r * r;
    for (var i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      var dx = u.x[i] - cx,
        dy = u.y[i] - cy;
      var d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      var d = Math.sqrt(d2) || 0.001;
      var f = (force * (1 - d / r)) / d;
      u.launch(i, dx * f, dy * f - force * 0.25);
    }
  };

  Blast.razeBuildings = function (game, cx, cy, r, leaveRuins) {
    var b = game.buildings;
    if (!b) return 0;
    var razed = 0;
    var r2 = r * r;
    for (var i = 0; i < b.count; i++) {
      if (!b.alive[i]) continue;
      var dx = b.x[i] + 0.5 - cx,
        dy = b.y[i] + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      b.destroy(i, leaveRuins);
      razed++;
    }
    return razed;
  };

  /* The general-purpose bang. Options let each disaster pick its flavour. */
  Blast.explode = function (game, cx, cy, opts) {
    opts = opts || {};
    var world = game.world;
    var r = opts.radius || 6;
    cx = Math.max(0, Math.min(world.w - 1, cx));
    cy = Math.max(0, Math.min(world.h - 1, cy));

    if (opts.crater) Blast.crater(world, cx, cy, r * (opts.craterScale || 0.7), opts.crater);
    if (opts.scorch) Blast.scorch(world, cx, cy, r * 0.75);
    if (opts.fire) {
      WB.Fire.igniteArea(world, cx, cy, r * (opts.fireScale || 0.9), 160);
    }
    if (opts.damage) Blast.damageUnits(game, cx, cy, r, opts.damage, opts.cause || 'blast');
    if (opts.push) Blast.pushUnits(game, cx, cy, r * 1.4, opts.push);
    if (opts.raze !== false) Blast.razeBuildings(game, cx, cy, r * 0.8, opts.ruins !== false);

    var p = game.particles;
    if (p) {
      p.burst(WB.PKIND.SPARK, cx, cy, Math.min(90, 14 + r * 5), 6 + r * 0.7, 0.75, 0.7);
      p.burst(WB.PKIND.DEBRIS, cx, cy, Math.min(70, 10 + r * 4), 4 + r * 0.5, 1.3, 0.8);
      for (var s = 0; s < Math.min(40, 6 + r * 2); s++) {
        p.emit(
          WB.PKIND.SMOKE,
          cx + WB.fx.range(-r * 0.5, r * 0.5),
          cy + WB.fx.range(-r * 0.5, r * 0.5),
          WB.fx.range(-0.6, 0.6),
          -WB.fx.range(0.6, 2.2),
          2 + WB.fx.next() * 2,
          1.6
        );
      }
    }
    game.camera.addShake(opts.shake === undefined ? Math.min(16, 3 + r * 0.5) : opts.shake);
    if (game.audio) game.audio.play(opts.sound || 'boom', { intensity: Math.min(1, r / 20) });

    world.markRectDirty(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3);
    WB.Water.wakeRect(world, cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3);
  };

  /* Terrain sculpting shared by the brushes. */
  Blast.raise = function (world, cx, cy, r, amount) {
    world.forEachInDisc(cx, cy, r, function (i, x, y, d) {
      var t = 1 - d / r;
      world.height[i] = Math.min(1, world.height[i] + amount * t * t);
      if (world.water[i] > 0) {
        var drop = Math.min(world.water[i], Math.ceil((amount * t * t) / WB.WATER_UNIT));
        world.water[i] -= drop;
      }
      WB.Water.wake(world, i);
    });
  };

  Blast.lower = function (world, cx, cy, r, amount) {
    world.forEachInDisc(cx, cy, r, function (i, x, y, d) {
      var t = 1 - d / r;
      world.height[i] = Math.max(-1, world.height[i] - amount * t * t);
      WB.Water.wake(world, i);
    });
  };

  Blast.flatten = function (world, cx, cy, r) {
    var sum = 0,
      n = 0;
    world.forEachInDisc(cx, cy, r, function (i) {
      sum += world.height[i];
      n++;
    });
    if (!n) return;
    var avg = sum / n;
    world.forEachInDisc(cx, cy, r, function (i, x, y, d) {
      var t = 1 - d / r;
      world.height[i] += (avg - world.height[i]) * t * 0.6;
      WB.Water.wake(world, i);
    });
  };

  WB.Blast = Blast;
})(window.WB || (window.WB = {}));
