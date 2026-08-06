/* Worldsmith - seeded pseudo random number generation.
 * No dependencies: mulberry32 + a few distributions the sim leans on. */
(function (WB) {
  'use strict';

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* mulberry32: tiny, fast, good enough spectral properties for a game sim. */
  function Rng(seed) {
    if (typeof seed === 'string') seed = hashString(seed);
    this.s = seed >>> 0 || 1;
  }

  Rng.prototype.next = function () {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* float in [a, b) - or [0, a) when b is omitted. */
  Rng.prototype.range = function (a, b) {
    if (b === undefined) {
      b = a;
      a = 0;
    }
    return a + this.next() * (b - a);
  };

  /* integer in [a, b] inclusive - or [0, a] when b is omitted. */
  Rng.prototype.int = function (a, b) {
    if (b === undefined) {
      b = a;
      a = 0;
    }
    return a + Math.floor(this.next() * (b - a + 1));
  };

  Rng.prototype.chance = function (p) {
    return this.next() < p;
  };

  Rng.prototype.pick = function (arr) {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  };

  /* Weighted pick. `weights` parallels `arr`; negative weights are treated as 0. */
  Rng.prototype.weighted = function (arr, weights) {
    var total = 0,
      i;
    for (i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
    if (total <= 0) return arr[0];
    var r = this.next() * total;
    for (i = 0; i < arr.length; i++) {
      var w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return arr[i];
      r -= w;
    }
    return arr[arr.length - 1];
  };

  /* Fisher-Yates, in place. */
  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  };

  /* Box-Muller, one sample per call (the spare is not worth the state). */
  Rng.prototype.gaussian = function (mean, sd) {
    var u = 1 - this.next(),
      v = this.next();
    var n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return (mean || 0) + n * (sd === undefined ? 1 : sd);
  };

  /* A point uniformly distributed inside a disc of radius r. */
  Rng.prototype.inDisc = function (r) {
    var a = this.next() * Math.PI * 2;
    var d = Math.sqrt(this.next()) * r;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d };
  };

  Rng.prototype.save = function () {
    return this.s;
  };

  Rng.prototype.restore = function (s) {
    this.s = s >>> 0 || 1;
  };

  WB.Rng = Rng;
  WB.hashString = hashString;

  /* Shared non-deterministic stream for cosmetics (particles, sprite jitter).
   * Kept separate from the world stream so drawing never perturbs the sim. */
  WB.fx = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
})(window.WB || (window.WB = {}));
