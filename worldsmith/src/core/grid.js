/* Worldsmith - the tile world.
 *
 * Structure-of-arrays over typed arrays: one flat array per field, indexed by
 * `y * w + x`. There is no per-tile object anywhere in the engine, which is
 * what keeps a 512x512 world inside a few megabytes and cache-friendly. */
(function (WB) {
  'use strict';

  var CHUNK = 32; /* render dirty-tracking granularity, in tiles */

  /* 1 unit of `water` equals this much `height`. 250 units ~= 1.0 height,
   * so a full byte of water column spans the whole elevation range. */
  var WATER_UNIT = 1 / 250;

  /* --- Active set -------------------------------------------------------
   * Cellular systems (fire, flowing water, acid, fallout) only ever touch
   * cells that are actually doing something. Membership is a byte flag for
   * O(1) dedupe; iteration is a flat Int32 queue that double-buffers, so a
   * cell can re-enqueue itself for the next tick while we are iterating. */
  function ActiveSet(size) {
    this.mark = new Uint8Array(size);
    this.cur = new Int32Array(size);
    this.next = new Int32Array(size);
    this.curN = 0;
    this.nextN = 0;
  }

  ActiveSet.prototype.add = function (i) {
    if (this.mark[i]) return;
    if (this.nextN >= this.next.length) return; /* saturated: drop, sim self-heals */
    this.mark[i] = 1;
    this.next[this.nextN++] = i;
  };

  /* Promote the pending queue to the working queue. Returns its length. */
  ActiveSet.prototype.begin = function () {
    var t = this.cur;
    this.cur = this.next;
    this.next = t;
    this.curN = this.nextN;
    this.nextN = 0;
    /* Unmark the working set so cells may re-enter the pending set. */
    for (var k = 0; k < this.curN; k++) this.mark[this.cur[k]] = 0;
    return this.curN;
  };

  ActiveSet.prototype.clear = function () {
    this.mark.fill(0);
    this.curN = 0;
    this.nextN = 0;
  };

  ActiveSet.prototype.size = function () {
    return this.curN + this.nextN;
  };

  /* --- World ------------------------------------------------------------ */
  function World(w, h, seed) {
    this.w = w;
    this.h = h;
    this.size = w * h;
    this.seed = seed >>> 0;
    this.rng = new WB.Rng(seed);

    var n = this.size;
    this.height = new Float32Array(n); /* -1 .. 1 */
    this.terrain = new Uint8Array(n);
    this.water = new Uint8Array(n); /* water column depth */
    this.fire = new Uint8Array(n); /* burn intensity, 0 = not burning */
    this.fuel = new Uint8Array(n); /* vegetation biomass */
    this.lava = new Uint8Array(n); /* molten rock column, flows like thick water */
    this.temp = new Int8Array(n); /* degrees-ish, -128..127 */
    this.baseTemp = new Int8Array(n); /* climate baseline before seasonal swing */
    this.moist = new Uint8Array(n);
    this.owner = new Uint16Array(n); /* kingdom id, 0 = unclaimed */
    this.structure = new Uint16Array(n); /* building handle + 1, 0 = none */
    this.acid = new Uint8Array(n);
    this.rad = new Uint8Array(n);
    this.flags = new Uint8Array(n);

    this.seaLevel = 0;
    this.tick = 0;

    /* Global wind, drifts slowly; drives fire spread and rain shadow. */
    this.windX = 0.6;
    this.windY = -0.2;

    this.chunksX = Math.ceil(w / CHUNK);
    this.chunksY = Math.ceil(h / CHUNK);
    this.dirtyChunks = new Uint8Array(this.chunksX * this.chunksY);
    this.dirtyChunks.fill(1);
    this.allDirty = true;

    this.activeWater = new ActiveSet(n);
    this.activeFire = new ActiveSet(n);
    this.activeAcid = new ActiveSet(n);
    this.activeLava = new ActiveSet(n);
  }

  World.prototype.idx = function (x, y) {
    return y * this.w + x;
  };

  World.prototype.inBounds = function (x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  };

  World.prototype.clampX = function (x) {
    return x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
  };

  World.prototype.clampY = function (y) {
    return y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
  };

  /* Surface elevation including any water column standing on the tile. */
  World.prototype.surface = function (i) {
    return this.height[i] + this.water[i] * WATER_UNIT;
  };

  World.prototype.isWater = function (i) {
    return this.water[i] > 3;
  };

  World.prototype.isDeepWater = function (i) {
    return this.water[i] > 60;
  };

  World.prototype.isLand = function (i) {
    return this.water[i] <= 3;
  };

  /* Walkable for a land unit: dry (or barely damp) and not molten.
   * Deeply frozen water counts as walkable - armies really do cross the ice. */
  World.prototype.walkable = function (i) {
    if (this.lava[i] > 0) return false;
    if (this.water[i] <= 12) return true;
    return this.temp[i] < -8 && this.water[i] < 120;
  };

  World.prototype.markDirty = function (x, y) {
    var cx = (x / CHUNK) | 0,
      cy = (y / CHUNK) | 0;
    this.dirtyChunks[cy * this.chunksX + cx] = 1;
  };

  World.prototype.markDirtyIdx = function (i) {
    this.markDirty(i % this.w, (i / this.w) | 0);
  };

  World.prototype.markRectDirty = function (x0, y0, x1, y1) {
    var cx0 = Math.max(0, (x0 / CHUNK) | 0),
      cy0 = Math.max(0, (y0 / CHUNK) | 0);
    var cx1 = Math.min(this.chunksX - 1, (x1 / CHUNK) | 0),
      cy1 = Math.min(this.chunksY - 1, (y1 / CHUNK) | 0);
    for (var cy = cy0; cy <= cy1; cy++)
      for (var cx = cx0; cx <= cx1; cx++) this.dirtyChunks[cy * this.chunksX + cx] = 1;
  };

  World.prototype.markAllDirty = function () {
    this.dirtyChunks.fill(1);
    this.allDirty = true;
  };

  /* Set a tile's material, keeping fuel within the new material's ceiling. */
  World.prototype.setTerrain = function (i, t) {
    this.terrain[i] = t;
    var maxFuel = WB.TERRAIN[t].fuel;
    if (this.fuel[i] > maxFuel) this.fuel[i] = maxFuel;
    this.markDirtyIdx(i);
  };

  /* Visit the 4-neighbourhood. Callback receives (index, x, y). */
  World.prototype.forEach4 = function (x, y, fn) {
    if (x > 0) fn(y * this.w + x - 1, x - 1, y);
    if (x < this.w - 1) fn(y * this.w + x + 1, x + 1, y);
    if (y > 0) fn((y - 1) * this.w + x, x, y - 1);
    if (y < this.h - 1) fn((y + 1) * this.w + x, x, y + 1);
  };

  /* Run `fn(index, x, y)` over a filled disc. Used by every brush and blast. */
  World.prototype.forEachInDisc = function (cx, cy, r, fn) {
    var r2 = r * r;
    var x0 = Math.max(0, Math.floor(cx - r)),
      x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)),
      y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (var y = y0; y <= y1; y++) {
      var dy = y - cy;
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx;
        var d2 = dx * dx + dy * dy;
        if (d2 <= r2) fn(y * this.w + x, x, y, Math.sqrt(d2));
      }
    }
    this.markRectDirty(x0, y0, x1, y1);
  };

  /* Total land / water tile counts, for the stats panel. */
  World.prototype.census = function () {
    var land = 0,
      water = 0,
      burning = 0;
    for (var i = 0; i < this.size; i++) {
      if (this.water[i] > 3) water++;
      else land++;
      if (this.fire[i]) burning++;
    }
    return { land: land, water: water, burning: burning };
  };

  World.CHUNK = CHUNK;
  World.WATER_UNIT = WATER_UNIT;
  WB.World = World;
  WB.ActiveSet = ActiveSet;
  WB.CHUNK = CHUNK;
  WB.WATER_UNIT = WATER_UNIT;
})(window.WB || (window.WB = {}));
