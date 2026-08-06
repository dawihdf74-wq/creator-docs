/* Worldsmith - climate, seasons and vegetation succession.
 *
 * These are slow, whole-map systems, so instead of scanning the grid every tick
 * they sweep it a few rows at a time. A full pass completes roughly every
 * SWEEP_TICKS ticks, which is fast enough that a forest visibly regrows after a
 * fire but cheap enough to be invisible in the frame budget. */
(function (WB) {
  'use strict';

  var T = WB.T;

  var DAY_TICKS = 600; /* one day/night cycle at speed 1 (~20 s) */
  var YEAR_DAYS = 8;
  var YEAR_TICKS = DAY_TICKS * YEAR_DAYS;
  var SWEEP_TICKS = 240;

  var Climate = {};

  Climate.DAY_TICKS = DAY_TICKS;
  Climate.YEAR_TICKS = YEAR_TICKS;

  /* Quantised cold, shared with the renderer.
   *
   * The frost wash on a tile is drawn from this bucket rather than from the raw
   * temperature, and the sweep below only repaints a row when a bucket changes.
   * Painting from the raw value instead leaves chunk-shaped bands across the
   * map, because neighbouring chunks are rebuilt at different moments and each
   * freezes a different gradient in place. */
  Climate.frostLevel = function (temp) {
    if (temp >= 1) return 0;
    if (temp >= -6) return 1;
    if (temp >= -14) return 2;
    return 3;
  };

  Climate.timeOfDay = function (world) {
    return (world.tick % DAY_TICKS) / DAY_TICKS;
  };

  Climate.yearPhase = function (world) {
    return (world.tick % YEAR_TICKS) / YEAR_TICKS;
  };

  Climate.seasonName = function (world) {
    var p = Climate.yearPhase(world);
    if (p < 0.25) return 'Spring';
    if (p < 0.5) return 'Summer';
    if (p < 0.75) return 'Autumn';
    return 'Winter';
  };

  /* Seasonal temperature swing. Amplitude grows toward the poles, exactly as
   * it does on a real planet - the tropics barely notice winter. */
  function seasonalOffset(world, y, phase) {
    var lat = Math.abs((y / world.h) * 2 - 1);
    var amp = 3 + lat * 17;
    return -Math.cos(phase * Math.PI * 2) * amp;
  }

  Climate.attach = function (world) {
    world.climateCursor = 0;
    world.tempOffset = 0; /* global dial: ice age, heatwave */
    world.moistOffset = 0; /* global dial: drought, deluge */
    world.seasons = true;
  };

  Climate.step = function (world, game) {
    /* Wind wanders, which keeps successive wildfires from looking identical. */
    if ((world.tick & 31) === 0) {
      world.windX += world.rng.range(-0.12, 0.12);
      world.windY += world.rng.range(-0.12, 0.12);
      var mag = Math.sqrt(world.windX * world.windX + world.windY * world.windY);
      if (mag > 1.4) {
        world.windX = (world.windX / mag) * 1.4;
        world.windY = (world.windY / mag) * 1.4;
      }
      if (mag < 0.15) world.windX += 0.2;
    }

    var rowsPerTick = Math.max(1, Math.ceil(world.h / SWEEP_TICKS));
    var y0 = world.climateCursor;
    var y1 = Math.min(world.h, y0 + rowsPerTick);
    Climate.sweep(world, game, y0, y1);
    world.climateCursor = y1 >= world.h ? 0 : y1;
  };

  Climate.sweep = function (world, game, y0, y1) {
    var w = world.w;
    var phase = Climate.yearPhase(world);
    var rng = world.rng;
    var TR = world.terrain,
      FU = world.fuel,
      WA = world.water,
      MO = world.moist,
      TP = world.temp,
      BT = world.baseTemp;

    for (var y = y0; y < y1; y++) {
      var season = world.seasons ? seasonalOffset(world, y, phase) : 0;
      var rowDirty = false;

      for (var x = 0; x < w; x++) {
        var i = y * w + x;

        /* --- temperature --- */
        var t = BT[i] + season + world.tempOffset;
        /* Lava and active fire heat their own tile. */
        if (world.lava[i] > 0) t += 60;
        else if (world.fire[i] > 0) t += 25;
        var nt = t < -128 ? -128 : t > 127 ? 127 : Math.round(t);
        if (nt !== TP[i]) {
          /* Only a change of frost bucket is visible, so only that repaints. */
          if (Climate.frostLevel(nt) !== Climate.frostLevel(TP[i])) rowDirty = true;
          TP[i] = nt;
        }

        /* --- hazards decay --- */
        if (world.acid[i] > 0) {
          if (FU[i] > 0) FU[i] = Math.max(0, FU[i] - 2);
          if (rng.next() < 0.3) {
            world.height[i] -= 0.0006;
            WB.Water.wake(world, i);
          }
          world.acid[i] = Math.max(0, world.acid[i] - 1);
          rowDirty = true;
        }
        if (world.rad[i] > 0 && rng.next() < 0.25) {
          world.rad[i]--;
          rowDirty = true;
        }

        /* --- evaporation of shallow puddles --- */
        if (WA[i] > 0 && WA[i] <= 6 && TP[i] > 4 && rng.next() < 0.05) {
          WA[i]--;
          rowDirty = true;
          if (WA[i] === 0) {
            TR[i] = WB.Worldgen.biomeFor(world, i, 0);
            FU[i] = 0;
          }
        }

        if (WA[i] > 3) {
          if (FU[i] > 0) {
            FU[i] = 0;
            rowDirty = true;
          }
          continue;
        }
        if (world.lava[i] > 0 || world.fire[i] > 0) continue;

        /* --- moisture drift toward the climate baseline --- */
        if ((world.tick & 3) === 0) {
          var target = 128 + world.moistOffset;
          if (WA[i] > 0) target = 220;
          if (MO[i] < target && rng.next() < 0.08) MO[i]++;
          else if (MO[i] > target && rng.next() < 0.08) MO[i]--;
        }

        /* --- vegetation regrowth --- */
        var def = WB.TERRAIN[TR[i]];
        var maxFuel = def.fuel;
        if (maxFuel > 0 && FU[i] < maxFuel) {
          var warmth = TP[i] > 2 && TP[i] < 42 ? 1 : TP[i] > -4 ? 0.3 : 0;
          var wet = MO[i] / 255;
          var p = 0.09 * warmth * (0.25 + wet);
          if (world.rad[i] > 0) p *= 0.2;
          if (rng.next() < p) {
            FU[i] = Math.min(maxFuel, FU[i] + 1 + (rng.next() < 0.3 ? 1 : 0));
            rowDirty = true;
          }
        }

        /* --- succession: burnt ground works its way back to its biome --- */
        var succ = WB.TERRAIN_REGROW[TR[i]];
        if (succ !== undefined && FU[i] >= maxFuel * 0.85 && rng.next() < 0.006) {
          if (TR[i] === T.DIRT || TR[i] === T.GRASS) {
            /* far enough along that climate decides what actually grows */
            var natural = WB.Worldgen.biomeFor(world, i, WB.Worldgen.slopeAt(world, x, y));
            if (natural !== TR[i] && WB.TERRAIN[natural].fuel >= maxFuel) {
              TR[i] = natural;
              rowDirty = true;
            }
          } else {
            TR[i] = succ;
            FU[i] = Math.min(WB.TERRAIN[succ].fuel, FU[i]);
            rowDirty = true;
          }
        }
      }

      if (rowDirty) world.markRectDirty(0, y, w - 1, y);
    }
  };

  /* Global climate dials used by the ice-age / heatwave / drought powers. */
  Climate.shiftTemperature = function (world, delta) {
    world.tempOffset += delta;
    world.markAllDirty();
  };

  Climate.shiftMoisture = function (world, delta) {
    world.moistOffset = Math.max(-120, Math.min(120, world.moistOffset + delta));
  };

  WB.Climate = Climate;
})(window.WB || (window.WB = {}));
