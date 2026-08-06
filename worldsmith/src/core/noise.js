/* Worldsmith - value noise + fBm used by world generation.
 * Value noise (not simplex) keeps this dependency-free and patent-free, and with
 * enough octaves plus domain warping it is indistinguishable at map scale. */
(function (WB) {
  'use strict';

  var PERM_SIZE = 512;
  var MASK = 255;

  function Noise(seed) {
    var rng = new WB.Rng(seed);
    this.perm = new Uint8Array(PERM_SIZE);
    var p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) p[i] = i;
    rng.shuffle(p);
    for (i = 0; i < PERM_SIZE; i++) this.perm[i] = p[i & MASK];
    /* Gradient-free: hash straight to a value in [-1, 1]. */
    this.vals = new Float32Array(256);
    for (i = 0; i < 256; i++) this.vals[i] = rng.range(-1, 1);
  }

  /* Quintic smoothstep - C2 continuous, so no visible grid creases. */
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  Noise.prototype.hash2 = function (xi, yi) {
    return this.vals[this.perm[(this.perm[xi & MASK] + yi) & MASK]];
  };

  /* Single octave of 2D value noise, output in roughly [-1, 1]. */
  Noise.prototype.value2 = function (x, y) {
    var xi = Math.floor(x),
      yi = Math.floor(y);
    var xf = x - xi,
      yf = y - yi;
    var u = fade(xf),
      v = fade(yf);
    var a = this.hash2(xi, yi);
    var b = this.hash2(xi + 1, yi);
    var c = this.hash2(xi, yi + 1);
    var d = this.hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };

  /* Fractal Brownian motion. `opts`: octaves, lacunarity, gain, freq. */
  Noise.prototype.fbm = function (x, y, opts) {
    opts = opts || {};
    var octaves = opts.octaves || 5;
    var lac = opts.lacunarity || 2.0;
    var gain = opts.gain || 0.5;
    var freq = opts.freq || 1;
    var amp = 1,
      sum = 0,
      norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += this.value2(x * freq, y * freq) * amp;
      norm += amp;
      freq *= lac;
      amp *= gain;
    }
    return norm > 0 ? sum / norm : 0;
  };

  /* Ridged multifractal - gives mountain spines rather than rolling blobs. */
  Noise.prototype.ridged = function (x, y, opts) {
    opts = opts || {};
    var octaves = opts.octaves || 4;
    var lac = opts.lacunarity || 2.0;
    var gain = opts.gain || 0.5;
    var freq = opts.freq || 1;
    var amp = 1,
      sum = 0,
      norm = 0;
    for (var o = 0; o < octaves; o++) {
      var n = 1 - Math.abs(this.value2(x * freq, y * freq));
      sum += n * n * amp;
      norm += amp;
      freq *= lac;
      amp *= gain;
    }
    return norm > 0 ? (sum / norm) * 2 - 1 : 0;
  };

  /* Domain warp: sample fbm at a position that is itself displaced by fbm.
   * This is what turns obviously-noisy coastlines into believable ones. */
  Noise.prototype.warped = function (x, y, opts, strength) {
    var s = strength === undefined ? 0.6 : strength;
    var qx = this.fbm(x + 5.2, y + 1.3, { octaves: 3, freq: opts.freq });
    var qy = this.fbm(x + 9.7, y + 4.1, { octaves: 3, freq: opts.freq });
    return this.fbm(x + s * qx, y + s * qy, opts);
  };

  WB.Noise = Noise;
})(window.WB || (window.WB = {}));
