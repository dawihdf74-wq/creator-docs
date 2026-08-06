/* Worldsmith - flowing water.
 *
 * A water-column cellular automaton: each active cell hands half of its
 * surface-height difference to each lower neighbour. Only cells on the active
 * set are visited, so a still ocean costs nothing and a burst dam costs only
 * the width of its own flood front.
 *
 * This one system is load-bearing: floods, tsunamis, the sea-level dial,
 * draining a lake by digging a canal, and rivers cutting new beds all fall out
 * of it rather than being scripted separately. */
(function (WB) {
  'use strict';

  var U = WB.WATER_UNIT;

  /* Neighbour visit orders, rotated per cell per tick. Without this the
   * automaton develops a persistent drift toward whichever direction is
   * checked first, and rivers visibly lean. */
  var ORDERS = [
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 1, 2],
    [1, 0, 3, 2],
    [3, 2, 1, 0],
    [0, 2, 1, 3],
    [2, 0, 3, 1],
  ];

  var Water = {};

  /* Wake a cell and its neighbourhood. Anything that edits height, water or
   * terrain must call this or the fluid will not notice the change. */
  Water.wake = function (world, i) {
    var w = world.w;
    var x = i % w,
      y = (i / w) | 0;
    world.activeWater.add(i);
    if (x > 0) world.activeWater.add(i - 1);
    if (x < w - 1) world.activeWater.add(i + 1);
    if (y > 0) world.activeWater.add(i - w);
    if (y < world.h - 1) world.activeWater.add(i + w);
  };

  Water.wakeRect = function (world, x0, y0, x1, y1) {
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(world.w - 1, x1 + 1);
    y1 = Math.min(world.h - 1, y1 + 1);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) world.activeWater.add(y * world.w + x);
  };

  Water.add = function (world, i, amount) {
    var v = world.water[i] + amount;
    world.water[i] = v > 255 ? 255 : v < 0 ? 0 : v;
    world.markDirtyIdx(i);
    Water.wake(world, i);
  };

  /* Wake every wet cell. Used after sea-level changes and on load. */
  Water.wakeAll = function (world) {
    for (var i = 0; i < world.size; i++) if (world.water[i] > 0) world.activeWater.add(i);
  };

  Water.step = function (world, opts) {
    var set = world.activeWater;
    var n = set.begin();
    if (n === 0) return 0;

    var W = world.water,
      H = world.height,
      TR = world.terrain;
    var w = world.w,
      h = world.h;
    var erode = opts && opts.erosion;
    var erodeRate = (opts && opts.erosionRate) || 0.00016;
    var moves = 0;

    for (var k = 0; k < n; k++) {
      var i = set.cur[k];
      var wat = W[i];
      if (wat === 0) continue;

      var x = i % w,
        y = (i / w) | 0;
      var surf = H[i] + wat * U;
      var order = ORDERS[(world.tick + x + y * 3) & 7];
      var remaining = wat;
      var movedAny = false;

      for (var oi = 0; oi < 4; oi++) {
        if (remaining <= 0) break;
        var dir = order[oi];
        var nx = x,
          ny = y;
        if (dir === 0) nx = x - 1;
        else if (dir === 1) nx = x + 1;
        else if (dir === 2) ny = y - 1;
        else ny = y + 1;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        var j = ny * w + nx;
        var diff = H[i] + remaining * U - (H[j] + W[j] * U);
        if (diff <= U) continue; /* within a single unit: treat as level */

        /* Half the difference equalises the pair in one step without
         * oscillating, which is the stability condition for this scheme. */
        var amt = Math.floor(diff / U / 2);
        if (amt < 1) continue;
        if (amt > remaining) amt = remaining;
        var space = 255 - W[j];
        if (amt > space) amt = space;
        if (amt < 1) continue;

        remaining -= amt;
        W[j] += amt;
        movedAny = true;
        moves += amt;

        world.markDirtyIdx(j);
        set.add(j);
        /* The receiving cell's own neighbours may now be downhill of it. */
        if (nx > 0) set.add(j - 1);
        if (nx < w - 1) set.add(j + 1);
        if (ny > 0) set.add(j - w);
        if (ny < h - 1) set.add(j + w);

        if (erode && amt > 3) {
          /* Fast flow scours the bed and drops the load downstream. */
          var cut = Math.min(0.02, amt * erodeRate);
          if (TR[i] !== WB.T.ROCK && TR[i] !== WB.T.MOUNTAIN) {
            H[i] -= cut;
            H[j] += cut * 0.55;
          }
        }
      }

      if (remaining !== wat) {
        W[i] = remaining;
        world.markDirtyIdx(i);
      }
      /* Only cells that actually moved water stay awake; everything else
       * falls dormant until something disturbs it. */
      if (movedAny) set.add(i);
    }
    return moves;
  };

  /* Shallow puddles on warm dry land evaporate. Runs on a stripe schedule from
   * the climate system rather than every tick. */
  Water.evaporateStripe = function (world, y0, y1) {
    var W = world.water,
      w = world.w;
    for (var y = y0; y < y1; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var v = W[i];
        if (v === 0 || v > 8) continue;
        if (world.temp[i] < 2) continue;
        if (world.rng.next() < 0.06 + world.temp[i] / 900) {
          W[i] = v - 1;
          world.markDirtyIdx(i);
          if (W[i] === 0) world.setTerrain(i, WB.Worldgen.biomeFor(world, i, 0));
        }
      }
    }
  };

  /* Raise or lower the global sea level, filling or draining every basin. */
  Water.setSeaLevel = function (world, level) {
    var delta = level - world.seaLevel;
    if (Math.abs(delta) < 1e-6) return;
    world.seaLevel = level;
    for (var i = 0; i < world.size; i++) {
      var target = level - world.height[i];
      var want = target > 0 ? Math.min(255, Math.round(target / U)) : 0;
      if (delta > 0) {
        if (want > world.water[i]) world.water[i] = want;
      } else {
        if (world.water[i] > want) world.water[i] = want;
      }
    }
    world.markAllDirty();
    Water.wakeAll(world);
  };

  WB.Water = Water;
})(window.WB || (window.WB = {}));
