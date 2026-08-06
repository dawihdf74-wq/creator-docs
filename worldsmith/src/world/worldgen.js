/* Worldsmith - procedural world generation.
 *
 * Pipeline: elevation -> sea fill -> climate (latitude + altitude + wind-driven
 * rain shadow) -> biome lookup -> rivers -> vegetation. Everything is driven by
 * the world seed, so the same seed always rebuilds the same planet. */
(function (WB) {
  'use strict';

  var T = WB.T;

  /* --- Map presets ------------------------------------------------------
   * scale      feature size (higher = smaller, busier landmasses)
   * amp/bias   elevation gain and offset (bias is the land/ocean dial)
   * ridge      how much ridged noise piles mountains onto high ground
   * edge       where the border falloff starts (0..1 of half-extent)
   * edgeAmt    how hard the border is pushed underwater
   * shape      optional extra term, given (u, v, d) in -1..1 / 0..1 */
  var PRESETS = {
    continents: {
      label: 'Continents',
      scale: 2.6,
      amp: 1.0,
      bias: 0.04,
      ridge: 0.5,
      edge: 0.58,
      edgeAmt: 0.9,
    },
    pangaea: {
      label: 'Pangaea',
      scale: 1.7,
      amp: 1.05,
      bias: 0.16,
      ridge: 0.55,
      edge: 0.45,
      edgeAmt: 1.2,
      shape: function (u, v, d) {
        return 0.3 * (1 - d);
      },
    },
    islands: {
      label: 'Islands',
      scale: 5.5,
      amp: 1.0,
      bias: -0.04,
      ridge: 0.42,
      edge: 0.7,
      edgeAmt: 0.7,
    },
    archipelago: {
      label: 'Archipelago',
      scale: 9.0,
      amp: 0.95,
      bias: -0.13,
      ridge: 0.3,
      edge: 0.85,
      edgeAmt: 0.4,
    },
    inlandSea: {
      label: 'Inland Sea',
      scale: 2.4,
      amp: 0.9,
      bias: 0.3,
      ridge: 0.5,
      edge: 0.75,
      edgeAmt: 0.6,
      shape: function (u, v, d) {
        return -0.85 * Math.pow(1 - d, 1.6);
      },
    },
    highlands: {
      label: 'Highlands',
      scale: 3.2,
      amp: 1.0,
      bias: 0.34,
      ridge: 0.95,
      edge: 0.62,
      edgeAmt: 1.0,
    },
    lakes: {
      label: 'Lakelands',
      scale: 4.0,
      amp: 0.7,
      bias: 0.24,
      ridge: 0.35,
      edge: 0.6,
      edgeAmt: 0.9,
    },
    flat: {
      label: 'Flat World',
      scale: 2.0,
      amp: 0.16,
      bias: 0.08,
      ridge: 0.0,
      edge: 0.7,
      edgeAmt: 0.5,
    },
  };

  function smoothstep(a, b, t) {
    if (b === a) return 0;
    t = (t - a) / (b - a);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* --- Elevation -------------------------------------------------------- */
  function generateHeight(world, preset, noise) {
    var w = world.w,
      h = world.h;
    var aspect = h / w;
    var H = world.height;

    for (var y = 0; y < h; y++) {
      var ny = y / h;
      var v = ny * 2 - 1;
      var sy = ny * preset.scale * aspect;
      for (var x = 0; x < w; x++) {
        var nx = x / w;
        var u = nx * 2 - 1;
        var sx = nx * preset.scale;

        var e = noise.warped(sx, sy, { octaves: 6, freq: 1.0, gain: 0.52 }, 0.75);
        e = e * preset.amp + preset.bias;

        if (preset.ridge > 0) {
          var r = noise.ridged(sx * 1.9 + 11.5, sy * 1.9 + 7.25, { octaves: 4, freq: 1.0 });
          /* Ridges only bite where land already exists, so oceans stay smooth. */
          e += Math.max(0, e) * (r * 0.5 + 0.5) * preset.ridge;
        }

        var d = Math.max(Math.abs(u), Math.abs(v));
        if (preset.shape) e += preset.shape(u, v, d);
        e -= smoothstep(preset.edge, 1.0, d) * preset.edgeAmt;

        H[y * w + x] = clamp(e, -1, 1);
      }
    }
  }

  /* --- Sea fill --------------------------------------------------------- */
  function fillSea(world) {
    var H = world.height,
      W = world.water,
      sea = world.seaLevel;
    for (var i = 0; i < world.size; i++) {
      var d = sea - H[i];
      W[i] = d > 0 ? Math.min(255, Math.round(d / WB.WATER_UNIT)) : 0;
    }
  }

  /* --- Climate ----------------------------------------------------------
   * Temperature: latitude band, cooled by altitude, roughened by noise.
   * Moisture: a west-to-east humidity sweep that picks up water over sea and
   * dumps it climbing terrain. That single pass is what creates deserts in the
   * lee of mountain ranges instead of scattering them at random. */
  function generateClimate(world, noise) {
    var w = world.w,
      h = world.h;
    var H = world.height,
      Wt = world.water;
    var TP = world.temp,
      MO = world.moist;
    var sea = world.seaLevel;

    var humid = new Float32Array(world.size);

    for (var y = 0; y < h; y++) {
      var lat = Math.abs((y / h) * 2 - 1); /* 0 equator, 1 pole */
      var hum = 0.55;
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var alt = Math.max(0, H[i] - sea);

        /* Latitude falloff is curved, not linear: Earth's tropics are broad
         * and the cold is concentrated near the poles. A straight line here
         * freezes the mid-latitudes and turns the whole map white. */
        var t = 30 - Math.pow(lat, 1.55) * 56; /* +30C equator, -26C pole */
        t -= alt * 38; /* lapse rate with altitude */
        t += noise.fbm((x / w) * 4 + 31.7, (y / h) * 4 + 12.9, { octaves: 3 }) * 7;
        TP[i] = clamp(Math.round(t), -128, 127);
        world.baseTemp[i] = TP[i];

        if (Wt[i] > 3) {
          hum += (1 - hum) * 0.09; /* evaporation over water */
          humid[i] = 0.85;
        } else {
          var prevH = x > 0 ? H[i - 1] : H[i];
          var rise = Math.max(0, H[i] - prevH);
          var rainRate = 0.018 + rise * 4.5;
          /* Cold air holds less water, so poles are dry deserts too. */
          var capacity = clamp((t + 30) / 70, 0.15, 1);
          var rain = hum * rainRate * (0.4 + capacity * 0.6);
          hum = Math.max(0.02, hum - rain);
          humid[i] = clamp(rain * 22 + hum * 0.35, 0, 1);
        }
      }
    }

    /* Blend the sweep with broad noise so bands do not look like scanlines. */
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var k = yy * w + xx;
        var n = noise.fbm((xx / w) * 3.5 + 88.1, (yy / h) * 3.5 + 4.4, { octaves: 4 }) * 0.5 + 0.5;
        var m = humid[k] * 0.62 + n * 0.38;
        MO[k] = clamp(Math.round(m * 255), 0, 255);
      }
    }
  }

  /* --- Biomes -----------------------------------------------------------
   * Whittaker-style: temperature x moisture, with elevation overrides for
   * beaches, alpine rock and permanent ice. */
  function biomeFor(world, i, slope) {
    var H = world.height[i];
    var alt = H - world.seaLevel;
    var t = world.temp[i];
    var m = world.moist[i] / 255;

    if (world.water[i] > 3) {
      /* Sea floor: sand in the shallows, silt then bare rock going down. */
      if (world.water[i] < 24) return T.SAND;
      if (world.water[i] < 90) return T.DIRT;
      return T.ROCK;
    }

    if (t < -14) return T.ICE;
    if (alt > 0.62 || (slope > 0.055 && alt > 0.34)) return t < -2 ? T.SNOW : T.MOUNTAIN;
    if (alt > 0.46) return t < 2 ? T.SNOW : T.ROCK;
    if (alt < 0.012) return t < -6 ? T.ICE : T.SAND; /* beach band */

    if (t < -6) return m > 0.4 ? T.SNOW : T.TUNDRA;
    if (t < 2) return m > 0.45 ? T.TAIGA : T.TUNDRA;
    if (t < 11) {
      if (m > 0.62) return T.TAIGA;
      if (m > 0.34) return T.FOREST;
      return T.GRASS;
    }
    if (t < 23) {
      if (m > 0.72 && alt < 0.06 && slope < 0.012) return T.SWAMP;
      if (m > 0.55) return T.FOREST;
      if (m > 0.3) return T.GRASS;
      if (m > 0.16) return T.SAVANNA;
      return T.DESERT;
    }
    if (m > 0.66) return T.JUNGLE;
    if (m > 0.42) return T.FOREST;
    if (m > 0.2) return T.SAVANNA;
    return T.DESERT;
  }

  function slopeAt(world, x, y) {
    var w = world.w,
      H = world.height;
    var i = y * w + x;
    var l = x > 0 ? H[i - 1] : H[i];
    var r = x < w - 1 ? H[i + 1] : H[i];
    var u = y > 0 ? H[i - w] : H[i];
    var d = y < world.h - 1 ? H[i + w] : H[i];
    var dx = (r - l) * 0.5,
      dy = (d - u) * 0.5;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function paintBiomes(world) {
    for (var y = 0; y < world.h; y++) {
      for (var x = 0; x < world.w; x++) {
        var i = y * world.w + x;
        world.terrain[i] = biomeFor(world, i, slopeAt(world, x, y));
      }
    }
  }

  /* --- Rivers -----------------------------------------------------------
   * Steepest-descent walks from wet highlands. When a walk dead-ends in a pit
   * it floods that pit slightly and keeps going, which is what produces
   * mountain tarns feeding a river rather than rivers that stop mid-slope. */
  function carveRivers(world, rng, count) {
    var w = world.w,
      h = world.h,
      H = world.height,
      W = world.water;
    var attempts = 0;
    var made = 0;

    while (made < count && attempts < count * 40) {
      attempts++;
      var x = rng.int(2, w - 3),
        y = rng.int(2, h - 3);
      var i = y * w + x;
      if (W[i] > 3) continue;
      if (H[i] - world.seaLevel < 0.3) continue;
      if (world.moist[i] < 90) continue;

      var steps = 0;
      var flow = 1;
      var maxSteps = Math.max(w, h) * 2;

      while (steps++ < maxSteps) {
        i = y * w + x;
        if (W[i] > 6) break; /* reached sea or an existing lake */

        /* Cut a channel and lay down a little water. */
        H[i] -= 0.004 * Math.min(6, flow);
        W[i] = Math.min(255, W[i] + 5 + Math.min(20, flow * 2));
        world.markDirty(x, y);

        var bestX = -1,
          bestY = -1,
          bestS = world.surface(i);
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nxx = x + dx,
              nyy = y + dy;
            if (nxx < 0 || nyy < 0 || nxx >= w || nyy >= h) {
              bestX = -2;
              break;
            }
            var s = world.surface(nyy * w + nxx);
            if (s < bestS) {
              bestS = s;
              bestX = nxx;
              bestY = nyy;
            }
          }
          if (bestX === -2) break;
        }
        if (bestX === -2) break; /* ran off the map edge */

        if (bestX < 0) {
          /* Local minimum: raise the water here until it can spill onward. */
          W[i] = Math.min(255, W[i] + 14);
          if (W[i] >= 255) break;
          continue;
        }
        x = bestX;
        y = bestY;
        flow++;
      }
      made++;
    }
  }

  /* --- Vegetation ------------------------------------------------------- */
  function seedVegetation(world) {
    for (var i = 0; i < world.size; i++) {
      if (world.water[i] > 3) {
        world.fuel[i] = 0;
        continue;
      }
      var max = WB.TERRAIN[world.terrain[i]].fuel;
      var m = world.moist[i] / 255;
      world.fuel[i] = Math.round(max * (0.55 + m * 0.45));
    }
  }

  /* --- Entry point ------------------------------------------------------ */
  function generate(world, opts) {
    opts = opts || {};
    var presetKey = opts.preset || 'continents';
    var preset = PRESETS[presetKey] || PRESETS.continents;
    var seed = opts.seed === undefined ? world.seed : opts.seed >>> 0;

    world.seed = seed;
    world.rng = new WB.Rng(seed);
    world.seaLevel = opts.seaLevel === undefined ? 0 : opts.seaLevel;
    world.tick = 0;
    world.preset = presetKey;

    var noise = new WB.Noise(seed);
    var rng = new WB.Rng(seed ^ 0x5bf03635);

    world.water.fill(0);
    world.fire.fill(0);
    world.lava.fill(0);
    world.owner.fill(0);
    world.structure.fill(0);
    world.acid.fill(0);
    world.rad.fill(0);
    world.flags.fill(0);
    world.activeWater.clear();
    world.activeFire.clear();
    world.activeAcid.clear();
    world.activeLava.clear();

    generateHeight(world, preset, noise);
    fillSea(world);
    generateClimate(world, noise);
    paintBiomes(world);

    if (opts.rivers !== false && presetKey !== 'flat') {
      var riverCount = Math.round((world.w * world.h) / 4200);
      carveRivers(world, rng, riverCount);
      /* Rivers moved terrain and water, so biomes near them need a repaint. */
      paintBiomes(world);
    }

    seedVegetation(world);
    world.markAllDirty();
    return world;
  }

  WB.Worldgen = {
    PRESETS: PRESETS,
    generate: generate,
    biomeFor: biomeFor,
    slopeAt: slopeAt,
    paintBiomes: paintBiomes,
    fillSea: fillSea,
    seedVegetation: seedVegetation,
  };
})(window.WB || (window.WB = {}));
