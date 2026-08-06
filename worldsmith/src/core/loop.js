/* Worldsmith - fixed-timestep simulation loop, decoupled from rendering.
 *
 * The sim always advances in whole ticks of a constant size, so behaviour is
 * identical at 30fps and 144fps and reproducible from a seed. Rendering runs
 * once per animation frame regardless. */
(function (WB) {
  'use strict';

  var TICK_HZ = 30; /* sim ticks per second at speed 1 */
  var MAX_TICKS_PER_FRAME = 12; /* spiral-of-death guard */

  function Loop(opts) {
    this.onTick = opts.tick;
    this.onRender = opts.render;
    this.speed = 1; /* 0 = paused, then 1 / 2 / 4 / 8 */
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.rafId = 0;

    /* Rolling telemetry for the stats readout. */
    this.fps = 0;
    this.tps = 0;
    this._frames = 0;
    this._ticks = 0;
    this._statWindow = 0;

    var self = this;
    this._frame = function (now) {
      self._step(now);
    };
  }

  Loop.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this._frame);
  };

  Loop.prototype.stop = function () {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  };

  Loop.prototype.setSpeed = function (s) {
    this.speed = s;
    if (s === 0) this.accumulator = 0;
  };

  Loop.prototype.isPaused = function () {
    return this.speed === 0;
  };

  Loop.prototype._step = function (now) {
    if (!this.running) return;
    var dt = (now - this.last) / 1000;
    this.last = now;
    /* A backgrounded tab hands back a huge dt; clamp rather than fast-forward. */
    if (dt > 0.25) dt = 0.25;

    if (this.speed > 0) {
      this.accumulator += dt * TICK_HZ * this.speed;
      var budget = MAX_TICKS_PER_FRAME * (this.speed > 4 ? 2 : 1);
      var n = 0;
      while (this.accumulator >= 1 && n < budget) {
        this.onTick();
        this.accumulator -= 1;
        this._ticks++;
        n++;
      }
      /* Dropped ticks are forfeited, not queued, so the sim degrades in speed
       * instead of freezing the page trying to catch up. */
      if (n >= budget) this.accumulator = 0;
    }

    this.onRender(dt);
    this._frames++;

    this._statWindow += dt;
    if (this._statWindow >= 0.5) {
      this.fps = Math.round(this._frames / this._statWindow);
      this.tps = Math.round(this._ticks / this._statWindow);
      this._frames = 0;
      this._ticks = 0;
      this._statWindow = 0;
    }

    this.rafId = requestAnimationFrame(this._frame);
  };

  /* Advance the sim by exactly n ticks with no rendering. Used by the headless
   * smoke test and by "fast-forward" style debugging. */
  Loop.prototype.runTicks = function (n) {
    for (var i = 0; i < n; i++) this.onTick();
  };

  Loop.TICK_HZ = TICK_HZ;
  WB.Loop = Loop;
  WB.TICK_HZ = TICK_HZ;
})(window.WB || (window.WB = {}));
