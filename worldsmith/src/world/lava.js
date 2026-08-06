/* Worldsmith - molten rock.
 *
 * Same water-column scheme as the fluid sim but far more viscous, and it cools:
 * a flow that stops moving crusts over into obsidian and permanently raises the
 * terrain it settled on. That is what lets a volcano build its own cone instead
 * of just staining tiles orange. */
(function (WB) {
  'use strict';

  var T = WB.T;
  var U = WB.WATER_UNIT;

  var Lava = {};

  Lava.add = function (world, i, amount) {
    var v = world.lava[i] + amount;
    world.lava[i] = v > 255 ? 255 : v;
    if (world.terrain[i] !== T.LAVA) world.setTerrain(i, T.LAVA);
    world.fire[i] = 0;
    world.fuel[i] = 0;
    world.activeLava.add(i);
    world.markDirtyIdx(i);
  };

  Lava.wakeAll = function (world) {
    for (var i = 0; i < world.size; i++) if (world.lava[i] > 0) world.activeLava.add(i);
  };

  Lava.step = function (world, game) {
    var set = world.activeLava;
    var n = set.begin();
    if (n === 0) return 0;

    var L = world.lava,
      H = world.height,
      W = world.water,
      FU = world.fuel;
    var w = world.w,
      h = world.h;
    var rng = world.rng;
    var particles = game && game.particles;
    var active = 0;

    for (var k = 0; k < n; k++) {
      var i = set.cur[k];
      var lv = L[i];
      if (lv === 0) continue;
      var x = i % w,
        y = (i / w) | 0;

      /* Contact with water: quench into rock and throw up steam. */
      if (W[i] > 4) {
        var quench = Math.min(lv, 6);
        L[i] -= quench;
        W[i] = Math.max(0, W[i] - quench * 2);
        H[i] += quench * U * 0.8;
        if (particles && particles.count < 3000)
          particles.emit(WB.PKIND.SMOKE, x + 0.5, y + 0.5, WB.fx.range(-0.3, 0.3), -1.4, 1.8, 1.4);
        world.markDirtyIdx(i);
        WB.Water.wake(world, i);
        if (L[i] === 0) {
          world.setTerrain(i, T.OBSIDIAN);
          continue;
        }
        set.add(i);
        active++;
        continue;
      }

      /* Set light to anything flammable next door. */
      for (var d = 0; d < 4; d++) {
        var nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
        var ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var j = ny * w + nx;
        if (FU[j] > 8 && world.fire[j] === 0 && rng.next() < 0.25) WB.Fire.ignite(world, j, 140);
      }

      /* Viscous flow: only a quarter of the head moves per tick. */
      var surf = H[i] + lv * U;
      var remaining = lv;
      var movedAny = false;
      for (var dd = 0; dd < 4; dd++) {
        if (remaining <= 1) break;
        var mx = x + (dd === 0 ? -1 : dd === 1 ? 1 : 0);
        var my = y + (dd === 2 ? -1 : dd === 3 ? 1 : 0);
        if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
        var m = my * w + mx;
        var diff = H[i] + remaining * U - (H[m] + L[m] * U);
        if (diff <= U * 3) continue;
        var amt = Math.floor(diff / U / 4);
        if (amt < 1) continue;
        if (amt > remaining - 1) amt = remaining - 1;
        if (amt > 255 - L[m]) amt = 255 - L[m];
        if (amt < 1) continue;
        remaining -= amt;
        L[m] += amt;
        if (world.terrain[m] !== T.LAVA) world.setTerrain(m, T.LAVA);
        world.fuel[m] = 0;
        world.markDirtyIdx(m);
        set.add(m);
        movedAny = true;
      }
      L[i] = remaining;

      /* Cooling. A flow that is still moving stays molten longer. */
      var coolChance = movedAny ? 0.02 : 0.09;
      if (world.temp[i] < 0) coolChance *= 1.8;
      if (rng.next() < coolChance) {
        var solid = Math.min(remaining, 3);
        L[i] -= solid;
        H[i] += solid * U * 0.85; /* the flow leaves rock behind */
        if (L[i] <= 0) {
          L[i] = 0;
          world.setTerrain(i, rng.chance(0.5) ? T.OBSIDIAN : T.ROCK);
          world.markDirtyIdx(i);
          continue;
        }
      }

      if (particles && particles.count < 2600 && rng.next() < 0.06) {
        particles.emit(
          WB.PKIND.FIRE,
          x + 0.5,
          y + 0.5,
          WB.fx.range(-0.4, 0.4),
          -WB.fx.range(0.5, 1.5),
          0.7,
          0.5
        );
      }

      /* Lava tiles flicker, so their chunk needs an occasional repaint even
       * when nothing about them changed. */
      if ((world.tick & 7) === (i & 7)) world.markDirtyIdx(i);
      set.add(i);
      active++;
    }
    return active;
  };

  /* Open a vent that keeps erupting for a while. Registered as a world effect
   * by the volcano power. */
  Lava.erupt = function (world, i, amount) {
    Lava.add(world, i, amount);
    world.height[i] += amount * U * 0.25;
  };

  WB.Lava = Lava;
})(window.WB || (window.WB = {}));
