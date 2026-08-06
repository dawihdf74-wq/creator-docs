/* Worldsmith - synthesised sound.
 *
 * Every effect is generated from oscillators and a noise buffer at runtime, so
 * the game ships with no audio files. The context is created lazily on the
 * first user gesture because browsers refuse to start audio before one. */
(function (WB) {
  'use strict';

  function Audio() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.35;
    this.noiseBuffer = null;
    this.recent = 0;
    this.recentAt = 0;
  }

  Audio.prototype.ensure = function () {
    if (this.ctx) return true;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
    } catch (e) {
      return false;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    /* Two seconds of white noise, reused by every percussive sound. */
    var len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = this.noiseBuffer.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  };

  Audio.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype.setVolume = function (v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  };

  /* Rate limit: a hundred simultaneous fire crackles is just noise, and it
   * starves the audio thread. */
  Audio.prototype.throttled = function () {
    var now = performance.now();
    if (now - this.recentAt > 100) {
      this.recentAt = now;
      this.recent = 0;
    }
    return ++this.recent > 4;
  };

  Audio.prototype.noise = function (dur, filterType, freq, gain, sweepTo) {
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    var filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    if (sweepTo !== undefined) {
      filt.frequency.setValueAtTime(freq, ctx.currentTime);
      filt.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), ctx.currentTime + dur);
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  };

  Audio.prototype.tone = function (type, f0, f1, dur, gain) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ctx.currentTime + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  };

  Audio.prototype.play = function (name, opts) {
    if (!this.enabled) return;
    if (!this.ensure()) return;
    if (this.ctx.state === 'suspended') return;
    if (this.throttled()) return;
    opts = opts || {};
    var k = opts.intensity === undefined ? 0.6 : Math.max(0.05, Math.min(1, opts.intensity));

    switch (name) {
      case 'boom':
        this.noise(0.6 + k * 0.8, 'lowpass', 900 * (1 - k * 0.5) + 200, 0.9 * k, 60);
        this.tone('sine', 90 * (1.4 - k), 22, 0.5 + k * 0.5, 0.5 * k);
        break;
      case 'rumble':
        this.noise(1.6, 'lowpass', 180, 0.5 * k, 50);
        break;
      case 'zap':
        this.tone('square', 2400, 220, 0.16, 0.22 * k);
        this.noise(0.2, 'highpass', 2200, 0.28 * k);
        break;
      case 'splash':
        this.noise(0.35, 'bandpass', 1200, 0.3 * k, 400);
        break;
      case 'whoosh':
        this.noise(0.5, 'bandpass', 500, 0.25 * k, 1800);
        break;
      case 'horn':
        this.tone('sawtooth', 180, 150, 0.9, 0.2);
        this.tone('sawtooth', 240, 200, 0.9, 0.12);
        break;
      case 'pop':
        this.tone('triangle', 700, 180, 0.1, 0.18 * k);
        break;
      case 'chime':
        this.tone('sine', 880, 880, 0.4, 0.14);
        this.tone('sine', 1320, 1320, 0.5, 0.09);
        break;
      case 'crackle':
        this.noise(0.12, 'highpass', 1800, 0.1 * k);
        break;
      default:
        this.tone('sine', 440, 300, 0.15, 0.1);
    }
  };

  WB.Audio = Audio;
})(window.WB || (window.WB = {}));
