/* Worldsmith - wildfire.
 *
 * Fuel-driven spread on an active set. Ignition probability is weighted by the
 * neighbour's biomass, its moisture, and how well the direction lines up with
 * the prevailing wind - which is what makes a fire run downwind in a front
 * instead of expanding as a tidy circle. */
(function (WB) {
  'use strict';

  var T = WB.T;

  var DIRS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  var Fire = {};

  Fire.canBurn = function (world, i) {
    return world.fuel[i] > 6 && world.water[i] <= 6 && world.fire[i] === 0;
  };

  Fire.ignite = function (world, i, strength) {
    if (world.water[i] > 6) return false;
    if (world.fuel[i] <= 2) return false;
    if (world.fire[i] > 0) return false;
    world.fire[i] = Math.max(40, Math.min(255, strength || 90));
    world.activeFire.add(i);
    world.markDirtyIdx(i);
    return true;
  };

  Fire.igniteArea = function (world, cx, cy, r, strength) {
    var lit = 0;
    world.forEachInDisc(cx, cy, r, function (i) {
      if (Fire.ignite(world, i, strength)) lit++;
    });
    return lit;
  };

  Fire.extinguish = function (world, i) {
    if (world.fire[i]) {
      world.fire[i] = 0;
      world.markDirtyIdx(i);
    }
  };

  Fire.step = function (world, game) {
    var set = world.activeFire;
    var n = set.begin();
    if (n === 0) return 0;

    var F = world.fire,
      FU = world.fuel,
      W = world.water,
      MO = world.moist;
    var w = world.w,
      h = world.h;
    var rng = world.rng;
    var wx = world.windX,
      wy = world.windY;
    var windMag = Math.sqrt(wx * wx + wy * wy) || 0.001;
    var particles = game && game.particles;
    var burning = 0;

    for (var k = 0; k < n; k++) {
      var i = set.cur[k];
      var f = F[i];
      if (f === 0) continue;

      /* Rain, flood or a splash puts it out. */
      if (W[i] > 6) {
        F[i] = 0;
        world.markDirtyIdx(i);
        if (particles) particles.emit(WB.PKIND.SMOKE, (i % w) + 0.5, ((i / w) | 0) + 0.5, 0, -0.7, 1.6, 1.1);
        continue;
      }

      var x = i % w,
        y = (i / w) | 0;

      /* Burn down the fuel. Wetter ground burns slower. */
      var wet = MO[i] / 255;
      var rate = 1 + (f / 255) * 3 * (1 - wet * 0.6);
      var consumed = Math.min(FU[i], Math.ceil(rate));
      FU[i] -= consumed;

      if (FU[i] <= 0) {
        /* Burnt out: the material itself is transformed. */
        F[i] = 0;
        var next = WB.TERRAIN_CONSUMED[world.terrain[i]];
        if (next !== undefined) world.setTerrain(i, next);
        world.flags[i] |= 1; /* burnt */
        world.markDirtyIdx(i);
        if (particles && particles.count < 2500)
          particles.emit(WB.PKIND.SMOKE, x + 0.5, y + 0.5, 0, -0.5, 2.2, 1.3);
        continue;
      }

      /* Intensity ramps with available fuel, then fades as it runs out. */
      var target = 60 + Math.min(195, FU[i]);
      F[i] = f + (target - f) * 0.25 > 255 ? 255 : Math.round(f + (target - f) * 0.25);
      burning++;
      world.markDirtyIdx(i);
      set.add(i);

      if (particles && particles.count < 3000 && rng.next() < 0.4) {
        particles.fireAt(x + 0.5, y + 0.5);
      }

      /* Spread. */
      var spreadBase = 0.16 * (f / 255) + 0.03;
      for (var d = 0; d < 8; d++) {
        var nx = x + DIRS[d][0],
          ny = y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var j = ny * w + nx;
        if (F[j] > 0 || W[j] > 6) continue;
        var fuelJ = FU[j];
        if (fuelJ <= 6) continue;

        /* dot product of the step direction with the wind, normalised */
        var dl = DIRS[d][0] * DIRS[d][0] + DIRS[d][1] * DIRS[d][1];
        var align = (DIRS[d][0] * wx + DIRS[d][1] * wy) / (Math.sqrt(dl) * windMag);
        var windFactor = 0.45 + Math.max(0, align) * 1.9 * Math.min(1, windMag);
        var diagonal = dl > 1 ? 0.65 : 1;
        var moistFactor = 1 - (MO[j] / 255) * 0.7;
        var fuelFactor = Math.min(1.4, fuelJ / 120 + 0.35);
        /* Fire climbs faster than it descends. */
        var slope = world.height[j] - world.height[i];
        var slopeFactor = 1 + Math.max(-0.4, Math.min(1.2, slope * 12));

        var p = spreadBase * windFactor * diagonal * moistFactor * fuelFactor * slopeFactor;
        if (rng.next() < p) {
          F[j] = 45;
          set.add(j);
          world.markDirtyIdx(j);
        }
      }
    }
    return burning;
  };

  /* Rain and snow damp fires and refill moisture across a region. */
  Fire.douse = function (world, cx, cy, r, amount) {
    world.forEachInDisc(cx, cy, r, function (i) {
      if (world.fire[i]) {
        world.fire[i] = Math.max(0, world.fire[i] - amount * 3);
        if (world.fire[i] === 0) world.markDirtyIdx(i);
      }
      world.moist[i] = Math.min(255, world.moist[i] + amount);
    });
  };

  WB.Fire = Fire;
})(window.WB || (window.WB = {}));
