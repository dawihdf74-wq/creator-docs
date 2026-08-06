/* Worldsmith - a minimal pub/sub bus plus the world chronicle that feeds the
 * on-screen event ticker ("The Kingdom of Vaeloth declared war on Thornhold"). */
(function (WB) {
  'use strict';

  function Bus() {
    this.handlers = {};
  }

  Bus.prototype.on = function (name, fn) {
    (this.handlers[name] || (this.handlers[name] = [])).push(fn);
    return fn;
  };

  Bus.prototype.off = function (name, fn) {
    var list = this.handlers[name];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };

  Bus.prototype.emit = function (name, payload) {
    var list = this.handlers[name];
    if (!list) return;
    /* Copy: a handler is allowed to unsubscribe itself mid-dispatch. */
    var snapshot = list.slice();
    for (var i = 0; i < snapshot.length; i++) snapshot[i](payload);
  };

  /* Chronicle: bounded ring of notable world events. */
  var MAX_LOG = 200;

  function Chronicle(bus) {
    this.bus = bus;
    this.entries = [];
  }

  /* kind drives the ticker colour: 'war', 'peace', 'death', 'birth',
   * 'disaster', 'found', 'age', 'info'. */
  Chronicle.prototype.log = function (kind, text, x, y) {
    var e = {
      kind: kind,
      text: text,
      x: x === undefined ? -1 : x,
      y: y === undefined ? -1 : y,
      at: Date.now(),
    };
    this.entries.push(e);
    if (this.entries.length > MAX_LOG) this.entries.shift();
    this.bus.emit('chronicle', e);
    return e;
  };

  Chronicle.prototype.clear = function () {
    this.entries.length = 0;
    this.bus.emit('chronicle:clear');
  };

  WB.Bus = Bus;
  WB.Chronicle = Chronicle;
})(window.WB || (window.WB = {}));
