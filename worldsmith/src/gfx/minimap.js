/* Worldsmith - minimap. Reuses the renderer's tile canvas, so it costs one
 * scaled drawImage per frame and is always consistent with the main view. */
(function (WB) {
  'use strict';

  function Minimap(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dragging = false;
    var self = this;

    function jump(ev) {
      var rect = self.canvas.getBoundingClientRect();
      var t = ev.touches ? ev.touches[0] : ev;
      var fx = (t.clientX - rect.left) / rect.width;
      var fy = (t.clientY - rect.top) / rect.height;
      var box = self.fitBox();
      /* Convert from canvas space into the letterboxed map area. */
      var mx = (fx * self.canvas.width - box.x) / box.w;
      var my = (fy * self.canvas.height - box.y) / box.h;
      if (mx < 0 || my < 0 || mx > 1 || my > 1) return;
      self.game.camera.centerOn(mx * self.game.world.w, my * self.game.world.h);
    }

    canvas.addEventListener('pointerdown', function (ev) {
      self.dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      jump(ev);
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (self.dragging) jump(ev);
    });
    canvas.addEventListener('pointerup', function (ev) {
      self.dragging = false;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    });
  }

  /* Letterbox the world into the minimap canvas, preserving aspect ratio. */
  Minimap.prototype.fitBox = function () {
    var world = this.game.world;
    var cw = this.canvas.width,
      ch = this.canvas.height;
    var scale = Math.min(cw / world.w, ch / world.h);
    var w = world.w * scale,
      h = world.h * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h };
  };

  Minimap.prototype.render = function () {
    var ctx = this.ctx,
      game = this.game;
    var cw = this.canvas.width,
      ch = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, cw, ch);

    var box = this.fitBox();
    ctx.drawImage(game.renderer.tileCanvas, box.x, box.y, box.w, box.h);

    /* viewport rectangle */
    var cam = game.camera;
    var vw = cam.vw / cam.zoom,
      vh = cam.vh / cam.zoom;
    var rx = box.x + ((cam.x - vw / 2) / game.world.w) * box.w;
    var ry = box.y + ((cam.y - vh / 2) / game.world.h) * box.h;
    var rw = (vw / game.world.w) * box.w;
    var rh = (vh / game.world.h) * box.h;
    ctx.strokeStyle = 'rgba(255,225,77,0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.max(box.x, rx), Math.max(box.y, ry), Math.min(rw, box.w), Math.min(rh, box.h));
  };

  Minimap.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width));
    this.canvas.height = Math.max(1, Math.round(rect.height));
  };

  WB.Minimap = Minimap;
})(window.WB || (window.WB = {}));
