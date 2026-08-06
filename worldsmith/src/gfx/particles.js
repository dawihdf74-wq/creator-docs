/* Worldsmith - pooled particle system.
 *
 * Purely cosmetic, so it lives on the render clock rather than the sim clock
 * and never touches world state. Fixed-capacity parallel arrays: emitting from
 * a full pool recycles the oldest particle instead of allocating. */
(function (WB) {
  'use strict';

  var MAX = 4000;

  var KIND = {
    SPARK: 0,
    SMOKE: 1,
    FIRE: 2,
    SPLASH: 3,
    BLOOD: 4,
    DEBRIS: 5,
    MAGIC: 6,
    SNOW: 7,
  };

  function Particles() {
    this.x = new Float32Array(MAX);
    this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.tint = new Float32Array(MAX); /* 0..1 hue-ish shift within the kind */
    this.count = 0;
    this.cursor = 0;
  }

  Particles.prototype.emit = function (kind, x, y, vx, vy, life, size, tint) {
    var i;
    if (this.count < MAX) {
      i = this.count++;
    } else {
      i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
    }
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.tint[i] = tint === undefined ? WB.fx.next() : tint;
    return i;
  };

  /* Convenience emitters. Coordinates are tile space. */
  Particles.prototype.burst = function (kind, x, y, n, speed, life, size) {
    for (var k = 0; k < n; k++) {
      var a = WB.fx.next() * Math.PI * 2;
      var s = speed * (0.3 + WB.fx.next() * 0.7);
      this.emit(kind, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + WB.fx.next() * 0.8), size);
    }
  };

  Particles.prototype.fireAt = function (x, y) {
    this.emit(
      KIND.FIRE,
      x + WB.fx.range(-0.4, 0.4),
      y + WB.fx.range(-0.4, 0.4),
      WB.fx.range(-0.3, 0.3),
      -WB.fx.range(0.6, 1.6),
      0.5 + WB.fx.next() * 0.4,
      0.5
    );
    if (WB.fx.chance(0.35)) {
      this.emit(
        KIND.SMOKE,
        x + WB.fx.range(-0.5, 0.5),
        y - 0.3,
        WB.fx.range(-0.2, 0.2),
        -WB.fx.range(0.3, 0.8),
        1.4 + WB.fx.next() * 1.2,
        0.9
      );
    }
  };

  Particles.prototype.update = function (dt) {
    if (dt <= 0) return;
    var n = this.count;
    var i = 0;
    while (i < n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        /* swap-remove keeps the array dense with no gaps to skip */
        n--;
        this.x[i] = this.x[n];
        this.y[i] = this.y[n];
        this.vx[i] = this.vx[n];
        this.vy[i] = this.vy[n];
        this.life[i] = this.life[n];
        this.max[i] = this.max[n];
        this.size[i] = this.size[n];
        this.kind[i] = this.kind[n];
        this.tint[i] = this.tint[n];
        continue;
      }

      var k = this.kind[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;

      if (k === KIND.SMOKE) {
        this.vy[i] -= 0.35 * dt;
        this.vx[i] *= 1 - 0.9 * dt;
      } else if (k === KIND.FIRE) {
        this.vy[i] -= 1.1 * dt;
      } else if (k === KIND.SNOW) {
        this.vx[i] = Math.sin((this.life[i] + this.tint[i] * 6) * 3) * 0.5;
      } else if (k === KIND.MAGIC) {
        this.vx[i] *= 1 - 1.4 * dt;
        this.vy[i] *= 1 - 1.4 * dt;
      } else {
        /* ballistic: sparks, debris, blood, splash */
        this.vy[i] += 6 * dt;
      }
      i++;
    }
    this.count = n;
  };

  var COLORS = {};
  COLORS[KIND.SPARK] = [
    [255, 236, 150],
    [255, 170, 60],
  ];
  COLORS[KIND.SMOKE] = [
    [90, 88, 86],
    [40, 38, 40],
  ];
  COLORS[KIND.FIRE] = [
    [255, 226, 110],
    [220, 70, 20],
  ];
  COLORS[KIND.SPLASH] = [
    [190, 230, 250],
    [80, 150, 200],
  ];
  COLORS[KIND.BLOOD] = [
    [190, 40, 40],
    [110, 15, 20],
  ];
  COLORS[KIND.DEBRIS] = [
    [130, 118, 100],
    [70, 62, 54],
  ];
  COLORS[KIND.MAGIC] = [
    [220, 180, 255],
    [110, 70, 200],
  ];
  COLORS[KIND.SNOW] = [
    [255, 255, 255],
    [200, 220, 240],
  ];

  Particles.prototype.render = function (ctx, cam) {
    if (this.count === 0) return;
    var zoom = cam.zoom;
    var hw = cam.vw / 2,
      hh = cam.vh / 2;
    ctx.save();
    for (var i = 0; i < this.count; i++) {
      var t = this.life[i] / this.max[i];
      if (t <= 0) continue;
      var pair = COLORS[this.kind[i]];
      var mix = this.kind[i] === KIND.FIRE || this.kind[i] === KIND.SPARK ? t : 1 - t;
      mix = mix * 0.75 + this.tint[i] * 0.25;
      var r = Math.round(pair[0][0] * mix + pair[1][0] * (1 - mix));
      var g = Math.round(pair[0][1] * mix + pair[1][1] * (1 - mix));
      var b = Math.round(pair[0][2] * mix + pair[1][2] * (1 - mix));
      var alpha = this.kind[i] === KIND.SMOKE ? t * 0.55 : Math.min(1, t * 1.6);

      var sx = (this.x[i] - cam.x) * zoom + hw + cam.shakeX;
      var sy = (this.y[i] - cam.y) * zoom + hh + cam.shakeY;
      if (sx < -20 || sy < -20 || sx > cam.vw + 20 || sy > cam.vh + 20) continue;

      var s = Math.max(1, this.size[i] * zoom * (this.kind[i] === KIND.SMOKE ? 1.6 - t : 1));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  Particles.prototype.clear = function () {
    this.count = 0;
    this.cursor = 0;
  };

  Particles.KIND = KIND;
  WB.Particles = Particles;
  WB.PKIND = KIND;
})(window.WB || (window.WB = {}));
