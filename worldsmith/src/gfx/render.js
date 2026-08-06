/* Worldsmith - the renderer.
 *
 * The tile layer is an ImageData at exactly one pixel per tile, kept up to date
 * per 32x32 chunk and then blitted to the screen scaled with smoothing off.
 * That means a full-map repaint costs one drawImage no matter the zoom, and an
 * ordinary frame only rewrites the handful of chunks that actually changed. */
(function (WB) {
  'use strict';

  var T = WB.T;

  var VOID_COLOR = '#080a10';
  var WATER_SHALLOW = [96, 172, 200];
  var WATER_DEEP = [14, 42, 74];

  /* How white a tile goes at each Climate.frostLevel bucket. */
  var FROST_WASH = [0, 0.14, 0.4, 0.66];

  /* Stable per-tile hash: gives every tile a fixed colour jitter so the map
   * has texture without shimmering when a chunk is rebuilt. */
  function tileHash(i) {
    var x = Math.imul(i ^ 0x9e3779b9, 2654435761) >>> 0;
    x ^= x >>> 15;
    return x >>> 0;
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }

  function Renderer(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    var world = game.world;
    this.tileCanvas = document.createElement('canvas');
    this.tileCanvas.width = world.w;
    this.tileCanvas.height = world.h;
    this.tileCtx = this.tileCanvas.getContext('2d');
    this.tileImage = this.tileCtx.createImageData(world.w, world.h);
    /* Opaque by default; the alpha channel is never touched again. */
    var d = this.tileImage.data;
    for (var i = 3; i < d.length; i += 4) d[i] = 255;

    this.mapMode = 'normal';
    this.chunkBudgetOffscreen = 24;
    this.frame = 0;
    this.stats = { chunksRebuilt: 0, entitiesDrawn: 0 };
  }

  Renderer.prototype.worldChanged = function () {
    var world = this.game.world;
    if (this.tileCanvas.width !== world.w || this.tileCanvas.height !== world.h) {
      this.tileCanvas.width = world.w;
      this.tileCanvas.height = world.h;
      this.tileImage = this.tileCtx.createImageData(world.w, world.h);
      var d = this.tileImage.data;
      for (var i = 3; i < d.length; i += 4) d[i] = 255;
    }
    world.markAllDirty();
  };

  Renderer.prototype.setMapMode = function (mode) {
    this.mapMode = mode;
    this.game.world.markAllDirty();
  };

  /* --- Tile colour ------------------------------------------------------ */
  Renderer.prototype.writeTile = function (data, i, x, y) {
    var world = this.game.world;
    var mode = this.mapMode;
    var o = i * 4;
    var r, g, b;

    if (mode !== 'normal') {
      var v;
      if (mode === 'height') {
        v = (world.height[i] + 1) * 0.5;
        r = g = b = clamp255(v * 255);
        if (world.water[i] > 3) {
          r = clamp255(r * 0.35);
          g = clamp255(g * 0.55);
          b = clamp255(b * 1.1 + 40);
        }
      } else if (mode === 'temperature') {
        v = (world.temp[i] + 40) / 80;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        r = clamp255(40 + v * 215);
        g = clamp255(60 + Math.sin(v * Math.PI) * 150);
        b = clamp255(255 - v * 215);
      } else if (mode === 'moisture') {
        v = world.moist[i] / 255;
        r = clamp255(150 - v * 120);
        g = clamp255(110 + v * 60);
        b = clamp255(60 + v * 190);
      } else {
        /* kingdoms: desaturated land, saturated territory */
        var td = WB.TERRAIN[world.terrain[i]].rgb;
        var lum = (td[0] * 0.3 + td[1] * 0.59 + td[2] * 0.11) * 0.55 + 40;
        r = g = b = clamp255(lum);
        if (world.water[i] > 3) {
          r = clamp255(lum * 0.4);
          g = clamp255(lum * 0.5);
          b = clamp255(lum * 0.8 + 30);
        }
        var kc = this.kingdomRgb(world.owner[i]);
        if (kc) {
          r = clamp255(r * 0.35 + kc[0] * 0.65);
          g = clamp255(g * 0.35 + kc[1] * 0.65);
          b = clamp255(b * 0.35 + kc[2] * 0.65);
        }
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      return;
    }

    var t = world.terrain[i];
    var def = WB.TERRAIN[t];
    var base = def.rgb;
    var hash = tileHash(i);

    /* per-tile jitter */
    var j = ((hash & 255) / 255 - 0.5) * def.jitter * 2;
    r = base[0] + j;
    g = base[1] + j;
    b = base[2] + j;

    /* vegetation density darkens and greens a tile as biomass grows */
    if (def.fuel > 8) {
      var fv = world.fuel[i] / def.fuel;
      var vf = 0.72 + fv * 0.34;
      r *= vf * 0.94;
      g *= vf;
      b *= vf * 0.9;
    }

    /* hillshade: directional light from the north-west */
    var w = world.w;
    var hL = x > 0 ? world.height[i - 1] : world.height[i];
    var hR = x < w - 1 ? world.height[i + 1] : world.height[i];
    var hU = y > 0 ? world.height[i - w] : world.height[i];
    var hD = y < world.h - 1 ? world.height[i + w] : world.height[i];
    var shade = 1 + (hL - hR + (hU - hD)) * 2.4;
    if (shade < 0.7) shade = 0.7;
    if (shade > 1.32) shade = 1.32;
    r *= shade;
    g *= shade;
    b *= shade;

    /* frost: below freezing, everything whitens. This is what makes seasons
     * and the ice-age power visible without touching the terrain array.
     * Quantised via Climate.frostLevel so the repaint schedule and the shading
     * agree - see the note there. */
    var temp = world.temp[i];
    var frost = WB.Climate.frostLevel(temp);
    if (frost > 0 && t !== T.SNOW && t !== T.ICE && t !== T.LAVA) {
      /* A light touch at level 1: an ordinary temperate winter should read as
       * a dusting, not as the whole map turning white. */
      var fr = FROST_WASH[frost];
      r += (236 - r) * fr;
      g += (243 - g) * fr;
      b += (250 - b) * fr;
    }

    /* water column */
    var wat = world.water[i];
    if (wat > 0) {
      var depth = Math.min(1, wat / 110);
      var wr = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * depth;
      var wg = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * depth;
      var wb = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * depth;
      /* frozen surface */
      if (frost >= 2) {
        wr = wr * 0.35 + 178 * 0.65;
        wg = wg * 0.35 + 214 * 0.65;
        wb = wb * 0.35 + 232 * 0.65;
      }
      var a = Math.min(0.96, 0.3 + wat / 46);
      r += (wr - r) * a;
      g += (wg - g) * a;
      b += (wb - b) * a;
      /* a brighter rim in the shallows reads as a shoreline */
      if (wat > 3 && wat < 16) {
        r += 18;
        g += 24;
        b += 26;
      }
    }

    /* hazards */
    var acid = world.acid[i];
    if (acid > 0) {
      var af = (acid / 255) * 0.65;
      r += (128 - r) * af;
      g += (222 - g) * af;
      b += (58 - b) * af;
    }
    var rad = world.rad[i];
    if (rad > 0) {
      var rf = (rad / 255) * 0.5;
      r += (176 - r) * rf;
      g += (74 - g) * rf;
      b += (217 - b) * rf;
    }

    if (t === T.LAVA) {
      /* slow per-tile pulse so lava fields look molten rather than painted */
      var ph = ((hash >>> 8) & 255) / 255;
      var pulse = 0.5 + 0.5 * Math.sin(world.tick * 0.09 + ph * 6.283);
      r = 210 + pulse * 45;
      g = 70 + pulse * 90;
      b = 20 + pulse * 25;
    }

    var fire = world.fire[i];
    if (fire > 0) {
      var ff = Math.min(1, fire / 140);
      r += (255 - r) * ff;
      g += (150 - g) * ff * 0.9;
      b += (40 - b) * ff;
    }

    /* territory tint */
    if (this.game.settings.showBorders && world.owner[i]) {
      var col = this.kingdomRgb(world.owner[i]);
      if (col) {
        var isEdge = this.isBorderTile(i, x, y);
        var bf = isEdge ? 0.62 : 0.2;
        r += (col[0] - r) * bf;
        g += (col[1] - g) * bf;
        b += (col[2] - b) * bf;
      }
    }

    data[o] = clamp255(r);
    data[o + 1] = clamp255(g);
    data[o + 2] = clamp255(b);
  };

  Renderer.prototype.isBorderTile = function (i, x, y) {
    var world = this.game.world,
      w = world.w,
      own = world.owner[i];
    if (x > 0 && world.owner[i - 1] !== own) return true;
    if (x < w - 1 && world.owner[i + 1] !== own) return true;
    if (y > 0 && world.owner[i - w] !== own) return true;
    if (y < world.h - 1 && world.owner[i + w] !== own) return true;
    return false;
  };

  Renderer.prototype.kingdomRgb = function (id) {
    if (!id) return null;
    var ks = this.game.kingdoms;
    if (!ks) return null;
    var k = ks.byId(id);
    return k ? k.rgb : null;
  };

  /* --- Dirty chunk maintenance ------------------------------------------ */
  Renderer.prototype.rebuildChunk = function (cx, cy) {
    var world = this.game.world;
    var C = WB.CHUNK;
    var x0 = cx * C,
      y0 = cy * C;
    var x1 = Math.min(world.w, x0 + C),
      y1 = Math.min(world.h, y0 + C);
    var data = this.tileImage.data;
    for (var y = y0; y < y1; y++) {
      var row = y * world.w;
      for (var x = x0; x < x1; x++) this.writeTile(data, row + x, x, y);
    }
    this.tileCtx.putImageData(this.tileImage, 0, 0, x0, y0, x1 - x0, y1 - y0);
    world.dirtyChunks[cy * world.chunksX + cx] = 0;
    this.stats.chunksRebuilt++;
  };

  Renderer.prototype.updateChunks = function () {
    var world = this.game.world;
    var C = WB.CHUNK;
    var v = this.game.camera.visibleTiles();
    var cx0 = (v.x0 / C) | 0,
      cx1 = (v.x1 / C) | 0;
    var cy0 = (v.y0 / C) | 0,
      cy1 = (v.y1 / C) | 0;
    this.stats.chunksRebuilt = 0;

    /* Visible chunks are never deferred: what the player is looking at must be
     * correct this frame. */
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        if (world.dirtyChunks[cy * world.chunksX + cx]) this.rebuildChunk(cx, cy);
      }
    }

    /* Off-screen chunks are rebuilt on a budget - they only matter to the
     * minimap, which tolerates being a few frames stale. */
    var budget = world.allDirty ? 1e9 : this.chunkBudgetOffscreen;
    var total = world.chunksX * world.chunksY;
    var done = 0;
    for (var c = 0; c < total && done < budget; c++) {
      if (!world.dirtyChunks[c]) continue;
      this.rebuildChunk(c % world.chunksX, (c / world.chunksX) | 0);
      done++;
    }
    if (world.allDirty) world.allDirty = false;
  };

  /* --- Entity passes ----------------------------------------------------- */
  Renderer.prototype.drawScenery = function (ctx, cam) {
    if (!this.game.settings.showScenery || cam.zoom < 7) return;
    var world = this.game.world;
    var v = cam.visibleTiles();
    var scale = cam.zoom / 6;
    var drawn = 0;
    for (var y = v.y0; y <= v.y1; y++) {
      for (var x = v.x0; x <= v.x1; x++) {
        var i = y * world.w + x;
        if (world.water[i] > 3 || world.fire[i]) continue;
        var t = world.terrain[i];
        var name = null;
        if (t === T.FOREST) name = 'scenery_tree';
        else if (t === T.JUNGLE) name = 'scenery_palm';
        else if (t === T.TAIGA) name = 'scenery_pine';
        else if (t === T.DESERT) name = 'scenery_cactus';
        else if (t === T.MOUNTAIN || t === T.ROCK) name = 'scenery_rock';
        else if (t === T.RUINS) name = 'scenery_bones';
        if (!name) continue;

        var hash = tileHash(i);
        /* Density scales with biomass, and the subset is stable per tile. */
        var need = t === T.DESERT || t === T.ROCK || t === T.MOUNTAIN ? 0.86 : 0.42;
        if ((hash & 255) / 255 < need) continue;
        if (world.fuel[i] < WB.TERRAIN[t].fuel * 0.25 && t !== T.ROCK && t !== T.MOUNTAIN) continue;

        var jx = (((hash >>> 8) & 255) / 255 - 0.5) * 0.5;
        var jy = (((hash >>> 16) & 255) / 255 - 0.5) * 0.5;
        var p = cam.worldToScreen(x + 0.5 + jx, y + 0.5 + jy);
        WB.Atlas.draw(ctx, name, p.x, p.y - scale * 1.5, scale);
        if (++drawn > 6000) return;
      }
    }
  };

  Renderer.prototype.drawBuildings = function (ctx, cam) {
    var b = this.game.buildings;
    if (!b || !b.count) return;
    var names = WB.Buildings ? WB.Buildings.SPRITE_NAMES : null;
    if (!names) return;
    var v = cam.visibleTiles();
    var scale = Math.max(0.35, cam.zoom / 9);
    for (var i = 0; i < b.count; i++) {
      if (!b.alive[i]) continue;
      var x = b.x[i],
        y = b.y[i];
      if (x < v.x0 - 2 || x > v.x1 + 2 || y < v.y0 - 2 || y > v.y1 + 2) continue;
      var p = cam.worldToScreen(x + 0.5, y + 0.5);
      if (cam.zoom < 3) {
        ctx.fillStyle = b.kingdomColor ? b.kingdomColor(i) : '#d8c9a8';
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      } else {
        WB.Atlas.draw(ctx, names[b.type[i]] || 'building_hut', p.x, p.y - scale * 2, scale);
      }
      this.stats.entitiesDrawn++;
    }
  };

  Renderer.prototype.drawUnits = function (ctx, cam) {
    var u = this.game.units;
    if (!u || !u.count) return;
    var names = WB.Units ? WB.Units.SPRITE_NAMES : null;
    if (!names) return;
    var v = cam.visibleTiles();
    var zoom = cam.zoom;
    var tiny = zoom < 3.5;
    var scale = Math.max(0.3, zoom / 8);
    var sel = this.game.selectedUnit;

    for (var i = 0; i < u.count; i++) {
      if (!u.alive[i]) continue;
      var x = u.x[i],
        y = u.y[i];
      if (x < v.x0 - 2 || x > v.x1 + 2 || y < v.y0 - 2 || y > v.y1 + 2) continue;
      var p = cam.worldToScreen(x, y);

      if (tiny) {
        ctx.fillStyle = u.dotColor(i);
        var s = zoom < 2 ? 2 : 3;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      } else {
        var name = names[u.sprite[i]];
        if (name) WB.Atlas.draw(ctx, name, p.x, p.y - scale, scale, u.facing[i] < 0);
        /* health pip only when hurt, and only when it would be legible */
        if (zoom >= 7 && u.hp[i] < u.maxHp[i]) {
          var frac = Math.max(0, u.hp[i] / u.maxHp[i]);
          var bw = 8 * scale;
          ctx.fillStyle = '#20161a';
          ctx.fillRect(p.x - bw / 2, p.y - scale * 5.5, bw, 2);
          ctx.fillStyle = frac > 0.5 ? '#5ec46a' : frac > 0.25 ? '#e0c040' : '#d04040';
          ctx.fillRect(p.x - bw / 2, p.y - scale * 5.5, bw * frac, 2);
        }
      }

      if (sel === i) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(6, zoom * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
      this.stats.entitiesDrawn++;
    }
  };

  /* --- Overlays ---------------------------------------------------------- */
  Renderer.prototype.drawGrid = function (ctx, cam) {
    if (!this.game.settings.showGrid || cam.zoom < 9) return;
    var v = cam.visibleTiles();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = v.x0; x <= v.x1 + 1; x++) {
      var p = cam.worldToScreen(x, v.y0);
      var q = cam.worldToScreen(x, v.y1 + 1);
      ctx.moveTo(Math.round(p.x) + 0.5, p.y);
      ctx.lineTo(Math.round(q.x) + 0.5, q.y);
    }
    for (var y = v.y0; y <= v.y1 + 1; y++) {
      var a = cam.worldToScreen(v.x0, y);
      var b = cam.worldToScreen(v.x1 + 1, y);
      ctx.moveTo(a.x, Math.round(a.y) + 0.5);
      ctx.lineTo(b.x, Math.round(b.y) + 0.5);
    }
    ctx.stroke();
  };

  /* Night is a translucent wash rather than a per-tile recolour, so the
   * day/night cycle costs one fillRect instead of a full map rebuild. */
  Renderer.prototype.drawDayNight = function (ctx, cam) {
    if (!this.game.settings.dayNight) return;
    var phase = this.game.timeOfDay(); /* 0 = midnight, 0.5 = noon */
    var dark = Math.max(0, Math.cos(phase * Math.PI * 2) * 0.5 + 0.5);
    dark = Math.pow(1 - dark, 1.4) * 0.62;
    if (dark < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(12, 20, 52, ' + dark.toFixed(3) + ')';
    ctx.fillRect(0, 0, cam.vw, cam.vh);
    ctx.restore();
  };

  Renderer.prototype.drawBrushCursor = function (ctx, cam) {
    var g = this.game;
    if (!g.hover || !g.hover.inside) return;
    var power = g.currentPower();
    if (!power) return;
    var r = power.usesBrush === false ? 0.5 : g.brushSize;
    var p = cam.worldToScreen(g.hover.x + 0.5, g.hover.y + 0.5);
    ctx.save();
    ctx.strokeStyle = power.cursorColor || 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, r * cam.zoom), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, r * cam.zoom) + 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  /* --- Frame ------------------------------------------------------------- */
  Renderer.prototype.render = function (dt) {
    var game = this.game,
      cam = game.camera,
      ctx = this.ctx,
      world = game.world;
    this.frame++;
    this.stats.entitiesDrawn = 0;

    this.updateChunks();

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, cam.vw, cam.vh);

    var v = cam.visibleTiles();
    var sw = v.x1 - v.x0 + 1,
      sh = v.y1 - v.y0 + 1;
    var p = cam.worldToScreen(v.x0, v.y0);
    ctx.drawImage(
      this.tileCanvas,
      v.x0,
      v.y0,
      sw,
      sh,
      Math.round(p.x),
      Math.round(p.y),
      Math.ceil(sw * cam.zoom),
      Math.ceil(sh * cam.zoom)
    );

    this.drawGrid(ctx, cam);
    this.drawScenery(ctx, cam);
    this.drawBuildings(ctx, cam);
    this.drawUnits(ctx, cam);
    if (game.effects) game.effects.render(ctx, cam);
    game.particles.render(ctx, cam);
    this.drawDayNight(ctx, cam);
    if (game.weather) game.weather.render(ctx, cam);
    this.drawBrushCursor(ctx, cam);
  };

  Renderer.prototype.resize = function () {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.game.camera.resize(w, h);
  };

  WB.Renderer = Renderer;
  WB.tileHash = tileHash;
})(window.WB || (window.WB = {}));
