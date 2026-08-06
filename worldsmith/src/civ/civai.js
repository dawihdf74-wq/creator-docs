/* Worldsmith - behaviour for civilised units.
 *
 * Called from Units.think for anyone with a home village. Returning false hands
 * the unit back to the wild-animal brain, which is what happens to exiles and
 * to villagers whose settlement has just been wiped out. */
(function (WB) {
  'use strict';

  var ST = WB.UnitState;
  var TRAIT = WB.TRAIT;
  var B = WB.BTYPE;

  var CivAI = {};

  function enemyOf(game, kingdomA, kingdomB) {
    if (!kingdomA || !kingdomB || kingdomA === kingdomB) return false;
    var ka = game.kingdoms.byId(kingdomA);
    var kb = game.kingdoms.byId(kingdomB);
    if (!ka || !kb) return false;
    return game.kingdoms.atWar(ka, kb);
  }

  CivAI.think = function (units, i, sp) {
    var game = units.game;
    var world = units.world;
    var rng = world.rng;
    var village = game.villages.list[units.home[i]];

    if (!village || !village.alive) {
      units.home[i] = -1;
      return false;
    }

    var myKingdom = units.kingdom[i];

    /* --- 1. Immediate threats --------------------------------------------
     * Everyone fights back; soldiers go looking for trouble further out. */
    var isSoldier = (units.traits[i] & TRAIT.SOLDIER) !== 0;
    var current = units.target[i];
    if (current >= 0 && units.alive[current]) {
      var cdx = units.x[current] - units.x[i],
        cdy = units.y[current] - units.y[i];
      var cd2 = cdx * cdx + cdy * cdy;
      if (cd2 < 1.2) {
        units.attack(i, current);
        return true;
      }
      if (cd2 < 900) {
        units.tx[i] = units.x[current];
        units.ty[i] = units.y[current];
        units.state[i] = ST.FIGHT;
        return true;
      }
      units.target[i] = -1;
    }

    var found = -1,
      foundD = 1e9;
    var searchR = isSoldier ? 14 : 7;
    units.forEachNear(units.x[i], units.y[i], searchR, function (j, d2) {
      if (j === i || !units.alive[j]) return;
      var osp = WB.Species.byId(units.species[j]);
      var hostile = false;
      if (osp.klass === 'monster') hostile = true;
      else if (units.kingdom[j] && enemyOf(game, myKingdom, units.kingdom[j])) hostile = true;
      else if (units.traits[j] & TRAIT.ENRAGED) hostile = true;
      if (!hostile) return;
      /* Civilians only engage what they can plausibly survive. */
      if (!isSoldier && osp.hp > sp.hp * 2.5) return;
      if (d2 < foundD) {
        foundD = d2;
        found = j;
      }
    });
    if (found >= 0) {
      units.target[i] = found;
      units.tx[i] = units.x[found];
      units.ty[i] = units.y[found];
      units.state[i] = ST.FIGHT;
      return true;
    }

    /* --- 2. Recruitment ---------------------------------------------------- */
    if (!isSoldier && units.age[i] > sp.maxAge * 0.16 && rng.chance(0.02)) {
      var counts = game.villages.counts(village);
      if (counts.byType.barracks) {
        var soldiers = 0;
        for (var r = 0; r < village.residents.length; r++) {
          if (units.traits[village.residents[r]] & TRAIT.SOLDIER) soldiers++;
        }
        if (soldiers < counts.byType.barracks * 5) {
          units.traits[i] |= TRAIT.SOLDIER;
          units.maxHp[i] *= 1.25;
          units.hp[i] = units.maxHp[i];
          units.story(i, 'Took up arms for ' + village.name + '.');
          isSoldier = true;
        }
      }
    }

    /* --- 3. War: march on the enemy ---------------------------------------- */
    if (isSoldier) {
      var kingdom = game.kingdoms.byId(myKingdom);
      if (kingdom && Object.keys(kingdom.wars).length) {
        if (units.state[i] !== ST.MARCH || rng.chance(0.15)) {
          var goal = CivAI.pickWarTarget(game, kingdom, units.x[i], units.y[i]);
          if (goal) {
            units.tx[i] = goal.x + rng.range(-3, 3);
            units.ty[i] = goal.y + rng.range(-3, 3);
            units.state[i] = ST.MARCH;
          }
        }
        if (units.state[i] === ST.MARCH) {
          CivAI.siege(game, units, i);
          return true;
        }
      }
    }

    /* --- 4. Eat ------------------------------------------------------------ */
    if (units.food[i] < 55) {
      var dx = village.x - units.x[i],
        dy = village.y - units.y[i];
      if (dx * dx + dy * dy < 36) {
        if (village.food > 2) {
          village.food -= 2;
          units.food[i] = Math.min(100, units.food[i] + 30);
          units.state[i] = ST.IDLE;
          return true;
        }
        /* Stores are empty: go and forage in the wild. */
        return false;
      }
      CivAI.headHome(game, units, i, village);
      return true;
    }

    /* --- 5. Work ------------------------------------------------------------
     * Villagers drift between their home and a work site. Rather than a full
     * job assignment system, they gravitate to a random building of the
     * village, which reads as bustle and costs nothing. */
    var dxh = village.x - units.x[i],
      dyh = village.y - units.y[i];
    var distHome2 = dxh * dxh + dyh * dyh;

    if (distHome2 > 900) {
      CivAI.headHome(game, units, i, village);
      return true;
    }

    if (rng.chance(0.35) && village.buildings.length) {
      var bid = village.buildings[rng.int(0, village.buildings.length - 1)];
      if (game.buildings.alive[bid]) {
        units.tx[i] = game.buildings.x[bid] + 0.5 + rng.range(-1, 1);
        units.ty[i] = game.buildings.y[bid] + 0.5 + rng.range(-1, 1);
        units.state[i] = ST.WORK;
        return true;
      }
    }

    /* Gather wood from nearby forest, which visibly clears land around towns. */
    if (rng.chance(0.3)) {
      var here = world.clampY(units.y[i] | 0) * world.w + world.clampX(units.x[i] | 0);
      if (world.fuel[here] > 120) {
        world.fuel[here] -= 12;
        world.markDirtyIdx(here);
        village.wood += 1.5;
        units.state[i] = ST.WORK;
        return true;
      }
      var a = rng.next() * 6.283,
        d = rng.range(2, 12);
      var tx = village.x + Math.cos(a) * d,
        ty = village.y + Math.sin(a) * d;
      if (units.canStand(sp, tx, ty)) {
        units.tx[i] = tx;
        units.ty[i] = ty;
        units.state[i] = ST.WANDER;
      }
      return true;
    }

    return true;
  };

  /* Use the village's BFS field when in range, straight line otherwise. */
  CivAI.headHome = function (game, units, i, village) {
    var step = game.villages.stepHome(village, units.x[i], units.y[i]);
    if (step) {
      units.tx[i] = step.x;
      units.ty[i] = step.y;
    } else {
      units.tx[i] = village.x + 0.5;
      units.ty[i] = village.y + 0.5;
    }
    units.state[i] = ST.GOTO;
  };

  CivAI.pickWarTarget = function (game, kingdom, x, y) {
    var best = null,
      bestD = 1e9;
    for (var enemyId in kingdom.wars) {
      var enemy = game.kingdoms.byId(parseInt(enemyId, 10));
      if (!enemy) continue;
      for (var v = 0; v < enemy.villages.length; v++) {
        var vil = game.villages.list[enemy.villages[v]];
        if (!vil || !vil.alive) continue;
        var dx = vil.x - x,
          dy = vil.y - y;
        var d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = vil;
        }
      }
    }
    return best;
  };

  /* Soldiers standing next to enemy structures tear them down. */
  CivAI.siege = function (game, units, i) {
    var world = game.world;
    var x = world.clampX(units.x[i] | 0),
      y = world.clampY(units.y[i] | 0);
    var b = game.buildings;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
        var handle = world.structure[ny * world.w + nx];
        if (!handle) continue;
        var bid = handle - 1;
        if (!b.alive[bid]) continue;
        if (!enemyOf(game, units.kingdom[i], b.kingdom[bid])) continue;
        if (units.cool[i] > 0) return;
        units.cool[i] = 20;
        var sp = WB.Species.byId(units.species[i]);
        b.damage(bid, sp.dmg * (1 + units.level[i] * 0.2) * 1.5);
        if (game.particles) game.particles.burst(WB.PKIND.DEBRIS, nx + 0.5, ny + 0.5, 3, 2, 0.5, 0.5);
        return;
      }
    }
  };

  WB.CivAI = CivAI;
})(window.WB || (window.WB = {}));
