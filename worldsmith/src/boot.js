/* Worldsmith - startup.
 *
 * Builds the sprite atlas, creates the game, wires the UI, generates the first
 * world and starts the loop. Also exposes WB.debug, which the headless smoke
 * test drives. */
(function (WB) {
  'use strict';

  function boot() {
    var canvas = document.getElementById('view');

    WB.Atlas.build();

    var game = new WB.Game({ canvas: canvas });
    var ui = new WB.UI(game, document.body);

    /* The minimap canvas is created by the UI, so it is attached after. */
    var miniCanvas = document.getElementById('minimap');
    if (miniCanvas) {
      game.minimap = new WB.Minimap(game, miniCanvas);
    }

    function resize() {
      game.renderer.resize();
      if (game.minimap) game.minimap.resize();
    }
    window.addEventListener('resize', resize);
    resize();

    game.generate({ preset: 'continents', civs: 5 });
    game.camera.setZoom(3);
    game.setPower('raise');
    game.start();

    var loading = document.getElementById('loading');
    if (loading && loading.parentNode) loading.parentNode.removeChild(loading);

    /* --- debug / test surface --------------------------------------------- */
    WB.debug = {
      game: game,
      ui: ui,
      /* Fire any power at a world position, bypassing input. */
      fire: function (powerId, x, y, brush) {
        var p = WB.Powers.byId(powerId);
        if (!p) throw new Error('No such power: ' + powerId);
        var r = brush === undefined ? game.brushSize : brush;
        p.apply(game, x, y, p.usesBrush ? r : 1);
        return true;
      },
      tick: function (n) {
        for (var i = 0; i < n; i++) game.tick();
      },
      /* Sanity check used by the smoke test. */
      validate: function () {
        var w = game.world;
        var problems = [];
        var waterTotal = 0;
        for (var i = 0; i < w.size; i++) {
          if (!isFinite(w.height[i])) {
            problems.push('height NaN at ' + i);
            break;
          }
          waterTotal += w.water[i];
        }
        for (var u = 0; u < game.units.count; u++) {
          if (!game.units.alive[u]) continue;
          if (!isFinite(game.units.x[u]) || !isFinite(game.units.y[u])) {
            problems.push('unit position NaN at ' + u);
            break;
          }
        }
        return { problems: problems, waterTotal: waterTotal, stats: game.stats() };
      },
      census: function () {
        return {
          units: game.units.census(),
          world: game.world.census(),
          buildings: game.buildings.census(),
        };
      },
      powerIds: function () {
        return WB.Powers.list.map(function (p) {
          return p.id;
        });
      },
    };
    window.WORLDSMITH_READY = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.WB || (window.WB = {}));
