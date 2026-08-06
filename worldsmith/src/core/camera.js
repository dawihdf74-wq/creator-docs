/* Worldsmith - viewport camera. Position is in tile space, zoom is
 * screen-pixels-per-tile so the pixel-art grid always lands on integers. */
(function (WB) {
  'use strict';

  function Camera(world) {
    this.world = world;
    this.x = world.w / 2;
    this.y = world.h / 2;
    this.zoom = 3;
    this.minZoom = 1;
    this.maxZoom = 24;
    this.vw = 800;
    this.vh = 600;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  Camera.prototype.resize = function (vw, vh) {
    this.vw = vw;
    this.vh = vh;
    this.clamp();
  };

  /* Keep at least part of the world on screen; when the world is smaller than
   * the viewport, lock it to the centre so it cannot be dragged into a corner. */
  Camera.prototype.clamp = function () {
    var halfW = this.vw / this.zoom / 2;
    var halfH = this.vh / this.zoom / 2;
    if (halfW * 2 >= this.world.w) this.x = this.world.w / 2;
    else this.x = Math.max(halfW, Math.min(this.world.w - halfW, this.x));
    if (halfH * 2 >= this.world.h) this.y = this.world.h / 2;
    else this.y = Math.max(halfH, Math.min(this.world.h - halfH, this.y));
  };

  Camera.prototype.setZoom = function (z, anchorScreenX, anchorScreenY) {
    z = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    if (z === this.zoom) return;
    if (anchorScreenX === undefined) {
      this.zoom = z;
      this.clamp();
      return;
    }
    /* Zoom about the cursor: keep the world point under it fixed. */
    var before = this.screenToWorld(anchorScreenX, anchorScreenY);
    this.zoom = z;
    var after = this.screenToWorld(anchorScreenX, anchorScreenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  };

  Camera.prototype.zoomBy = function (factor, sx, sy) {
    this.setZoom(this.zoom * factor, sx, sy);
  };

  Camera.prototype.pan = function (dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  };

  Camera.prototype.centerOn = function (wx, wy) {
    this.x = wx;
    this.y = wy;
    this.clamp();
  };

  Camera.prototype.screenToWorld = function (sx, sy) {
    return {
      x: this.x + (sx - this.vw / 2) / this.zoom,
      y: this.y + (sy - this.vh / 2) / this.zoom,
    };
  };

  Camera.prototype.worldToScreen = function (wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.vw / 2 + this.shakeX,
      y: (wy - this.y) * this.zoom + this.vh / 2 + this.shakeY,
    };
  };

  /* Tile rectangle currently visible, padded by one tile. */
  Camera.prototype.visibleTiles = function () {
    var halfW = this.vw / this.zoom / 2,
      halfH = this.vh / this.zoom / 2;
    return {
      x0: Math.max(0, Math.floor(this.x - halfW) - 1),
      y0: Math.max(0, Math.floor(this.y - halfH) - 1),
      x1: Math.min(this.world.w - 1, Math.ceil(this.x + halfW) + 1),
      y1: Math.min(this.world.h - 1, Math.ceil(this.y + halfH) + 1),
    };
  };

  Camera.prototype.addShake = function (amount) {
    this.shake = Math.min(24, this.shake + amount);
  };

  Camera.prototype.update = function (dt) {
    if (this.shake > 0.05) {
      this.shakeX = (WB.fx.next() * 2 - 1) * this.shake;
      this.shakeY = (WB.fx.next() * 2 - 1) * this.shake;
      this.shake *= Math.pow(0.0025, dt); /* ~decay to nothing in a second */
    } else {
      this.shake = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  };

  WB.Camera = Camera;
})(window.WB || (window.WB = {}));
