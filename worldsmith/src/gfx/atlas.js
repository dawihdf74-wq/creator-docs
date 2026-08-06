/* Worldsmith - procedural sprite atlas.
 *
 * Every sprite in the game is authored here as a tiny pixel-string grid and
 * rasterised into one offscreen canvas at boot. No image files ship with the
 * game: the art is data, the atlas is built in about a millisecond, and race
 * variants are produced by swapping palette entries rather than by duplicating
 * artwork. */
(function (WB) {
  'use strict';

  var atlas = null; /* offscreen canvas */
  var index = {}; /* name -> {x, y, w, h} */

  /* --- Pixel-string helpers --------------------------------------------
   * '.' is transparent. Every other character indexes the sprite palette. */
  function Sprite(rows, palette) {
    return { rows: rows, palette: palette, w: rows[0].length, h: rows.length };
  }

  /* Produce a recoloured copy: `swap` maps palette key -> new colour. */
  function recolor(sprite, swap) {
    var p = {};
    for (var k in sprite.palette) p[k] = swap[k] || sprite.palette[k];
    return Sprite(sprite.rows, p);
  }

  /* --- Humanoid template -----------------------------------------------
   * s skin, c clothing, h hair, e eye, b boot. One 8x8 body, four cultures. */
  var HUMANOID = Sprite(
    ['..hhhh..', '.hssssh.', '.hseseh.', '..ssss..', '.cccccc.', '.cscscc.', '..cc.cc.', '..bb.bb.'],
    { h: '#3a2a1a', s: '#e8b98a', e: '#20161a', c: '#4a6fa5', b: '#3a3038' }
  );

  /* Dwarves get a beard instead of a jaw and are one row shorter. */
  var DWARF = Sprite(
    ['........', '..hhhh..', '.hssssh.', '.hseseh.', '..dddd..', '.cdddddc', '.cccccc.', '..bb.bb.'],
    { h: '#8a3a1e', s: '#dba97a', e: '#20161a', d: '#c4552a', c: '#a05a2a', b: '#4a3a2a' }
  );

  var RACE_SPRITES = {
    human: HUMANOID,
    elf: recolor(HUMANOID, { s: '#d8e6c6', h: '#e6d98f', c: '#4f9e5a' }),
    orc: recolor(HUMANOID, { s: '#6f9a4a', h: '#241a12', c: '#7a3a2a', e: '#c02020' }),
    dwarf: DWARF,
  };

  /* --- Animals ---------------------------------------------------------- */
  var ANIMALS = {
    sheep: Sprite(
      ['........', '..wwww..', '.wwwwww.', 'hwwwwww.', 'hwwwwww.', '.l.ll.l.', '........', '........'],
      { w: '#eceae2', h: '#3a3230', l: '#5a4c44' }
    ),
    deer: Sprite(
      ['a..a....', '.aa.....', 'hh.bbbb.', '.hbbbbbb', '..bbbbbb', '..l.ll.l', '........', '........'],
      { a: '#8a6a3a', h: '#a07a4a', b: '#a87a48', l: '#6a4a28' }
    ),
    rabbit: Sprite(
      ['........', '.e.e....', '.eee....', '..bbbb..', '..bbbbt.', '..l..l..', '........', '........'],
      { e: '#c9b8a8', b: '#b8a494', t: '#efe8e0', l: '#8a7868' }
    ),
    boar: Sprite(
      ['........', '........', 'tbbbbbb.', 'tbbbbbbb', '.bbbbbbb', '.l.ll.l.', '........', '........'],
      { b: '#5a4438', t: '#e8e0d0', l: '#3a2c24' }
    ),
    wolf: Sprite(
      ['........', 'ee......', 'gggggg..', '.gggggg.', '.gggggg.', '.l.ll.lt', '........', '........'],
      { g: '#7a7d84', e: '#d8d8dc', l: '#54565c', t: '#9aa0a8' }
    ),
    bear: Sprite(
      ['........', 'ee......', 'bbbbbb..', 'bbbbbbb.', 'bbbbbbb.', '.ll.ll..', '........', '........'],
      { b: '#4a3428', e: '#6a4a38', l: '#33241c' }
    ),
    fish: Sprite(
      ['........', '........', '..ffff.t', '.ffffftt', '..ffff.t', '........', '........', '........'],
      { f: '#4a9ac4', t: '#7ac0e0' }
    ),
    bird: Sprite(
      ['........', '...b....', '..bbbb..', '.bbbbbb.', '..b..b..', '........', '........', '........'],
      { b: '#3a4a6a' }
    ),
    crab: Sprite(
      ['........', '........', 'c.cccc.c', 'cccccccc', '.c.cc.c.', '........', '........', '........'],
      { c: '#c4502a' }
    ),
  };

  /* --- Monsters (12x12, they should read as bigger than people) ---------- */
  var MONSTERS = {
    dragon: Sprite(
      [
        '............',
        '..w......w..',
        '.www....www.',
        '.wwwwwwwwww.',
        '..ddddddd...',
        'e.ddddddd...',
        'dddddddd....',
        '..dd..dd....',
        '..dd..dd....',
        '............',
        '............',
        '............',
      ],
      { d: '#8a2a2a', w: '#5a1a1a', e: '#ffd23a' }
    ),
    demon: Sprite(
      [
        '............',
        '..h......h..',
        '..hh....hh..',
        '...dddddd...',
        '...dedded..',
        '...dddddd...',
        '..dddddddd..',
        '..d.dddd.d..',
        '....dd.dd...',
        '....d...d...',
        '............',
        '............',
      ],
      { d: '#8a1f4a', h: '#3a0f22', e: '#ffe14d' }
    ),
    undead: Sprite(
      [
        '............',
        '....gggg....',
        '...gggggg...',
        '...geggeg...',
        '....gggg....',
        '...cccccc...',
        '..gcccccc g.',
        '...cc..cc...',
        '...bb..bb...',
        '............',
        '............',
        '............',
      ],
      { g: '#9aa88a', c: '#4a5040', e: '#20160f', b: '#33382c' }
    ),
    wraith: Sprite(
      [
        '............',
        '....vvvv....',
        '...vvvvvv...',
        '...veevev...',
        '...vvvvvv...',
        '..vvvvvvvv..',
        '..vvvvvvvv..',
        '...vvvvvv...',
        '....v.v.v...',
        '............',
        '............',
        '............',
      ],
      { v: '#5a4a8a', e: '#c8f0ff' }
    ),
    kraken: Sprite(
      [
        '............',
        '...pppppp...',
        '..pppppppp..',
        '..pepppepp..',
        '..pppppppp..',
        '.p.p.pp.p.p.',
        'p..p.pp.p..p',
        'p..p....p..p',
        '............',
        '............',
        '............',
        '............',
      ],
      { p: '#6a3a7a', e: '#ffe14d' }
    ),
    worm: Sprite(
      [
        '............',
        '............',
        '...wwww.....',
        '..wwwwww....',
        '..wmwwmw....',
        '..wwwwwwww..',
        '...wwwwwwww.',
        '.....wwwwww.',
        '............',
        '............',
        '............',
        '............',
      ],
      { w: '#a0704a', m: '#40241a' }
    ),
  };

  /* --- Buildings (12x12) ------------------------------------------------ */
  var BUILDINGS = {
    house: Sprite(
      [
        '............',
        '............',
        '.....r......',
        '....rrr.....',
        '...rrrrr....',
        '..rrrrrrr...',
        '..wwwwwww...',
        '..wwdwwww...',
        '..wwdwwww...',
        '..wwdwwww...',
        '............',
        '............',
      ],
      { r: '#a04a32', w: '#c9ab86', d: '#5a3a24' }
    ),
    hut: Sprite(
      [
        '............',
        '............',
        '............',
        '.....s......',
        '....sss.....',
        '...sssss....',
        '...wwwww....',
        '...wwdww....',
        '...wwdww....',
        '............',
        '............',
        '............',
      ],
      { s: '#8a7a3a', w: '#9a8258', d: '#4a3520' }
    ),
    farm: Sprite(
      [
        '............',
        '............',
        '..gggggggg..',
        '..g.g.g.g.g.',
        '..gggggggg..',
        '..g.g.g.g.g.',
        '..gggggggg..',
        '..g.g.g.g.g.',
        '..gggggggg..',
        '............',
        '............',
        '............',
      ],
      { g: '#c8a83a' }
    ),
    mine: Sprite(
      [
        '............',
        '............',
        '....bbbb....',
        '...bwwwwb...',
        '...bwddwb...',
        '...bwddwb...',
        '...bbddbb...',
        '....ssss....',
        '............',
        '............',
        '............',
        '............',
      ],
      { b: '#6a5a4a', w: '#8a7a68', d: '#241c18', s: '#4a4038' }
    ),
    dock: Sprite(
      [
        '............',
        '............',
        '............',
        '....pppp....',
        '...pppppp...',
        '..pppppppp..',
        '..p.p..p.p..',
        '..p.p..p.p..',
        '............',
        '............',
        '............',
        '............',
      ],
      { p: '#7a5a38' }
    ),
    barracks: Sprite(
      [
        '............',
        '.....f......',
        '.....f......',
        '..rrrfrrr...',
        '..wwwwwww...',
        '..wwwwwww...',
        '..wwdwdww...',
        '..wwdwdww...',
        '..wwwwwww...',
        '............',
        '............',
        '............',
      ],
      { r: '#7a3428', w: '#8a8078', d: '#3a3028', f: '#c02a2a' }
    ),
    tower: Sprite(
      [
        '............',
        '....ssss....',
        '....s..s....',
        '....ssss....',
        '....wwww....',
        '....wddw....',
        '....wwww....',
        '....wddw....',
        '...wwwwww...',
        '............',
        '............',
        '............',
      ],
      { s: '#9a9288', w: '#b0a89c', d: '#2c2620' }
    ),
    temple: Sprite(
      [
        '............',
        '.....g......',
        '....ggg.....',
        '...mmmmm....',
        '..mmmmmmm...',
        '..m.m.m.m...',
        '..m.m.m.m...',
        '..mmmmmmm...',
        '..mmmmmmm...',
        '............',
        '............',
        '............',
      ],
      { m: '#dcd4c4', g: '#e8c23a' }
    ),
    market: Sprite(
      [
        '............',
        '............',
        '..cccccccc..',
        '..cccccccc..',
        '..p......p..',
        '..p.bbbb.p..',
        '..p.bbbb.p..',
        '..p......p..',
        '............',
        '............',
        '............',
      ],
      { c: '#c05a4a', p: '#7a5a38', b: '#8a6a3a' }
    ),
    wall: Sprite(
      [
        '............',
        '............',
        '............',
        '.ssssssssss.',
        '.s.ss.ss.ss.',
        '.ssssssssss.',
        '.ss.ss.ss.s.',
        '.ssssssssss.',
        '............',
        '............',
        '............',
        '............',
      ],
      { s: '#8a8478' }
    ),
    ruin: Sprite(
      [
        '............',
        '............',
        '............',
        '..s...s.....',
        '..s..ss.....',
        '..sssss..s..',
        '..sssss.ss..',
        '..sssssssss.',
        '............',
        '............',
        '............',
        '............',
      ],
      { s: '#6e6862' }
    ),
    boat: Sprite(
      [
        '............',
        '.....m......',
        '.....mss....',
        '.....msss...',
        '.....mssss..',
        '.....m......',
        '..hhhhhhhh..',
        '...hhhhhh...',
        '............',
        '............',
        '............',
        '............',
      ],
      { h: '#6a4a2a', m: '#4a3420', s: '#e8e4dc' }
    ),
  };

  /* --- Scenery ---------------------------------------------------------- */
  var SCENERY = {
    tree: Sprite(['..cc..', '.cccc.', 'cccccc', '.cccc.', '..tt..', '..tt..'], {
      c: '#2c6e34',
      t: '#4a3220',
    }),
    palm: Sprite(['.c..c.', 'cccccc', '..tt..', '..tt..', '..tt..', '.ttt..'], {
      c: '#3a8a44',
      t: '#6a4a28',
    }),
    pine: Sprite(['..cc..', '.cccc.', '..cc..', '.cccc.', 'cccccc', '..tt..'], {
      c: '#24583c',
      t: '#3a2a1c',
    }),
    cactus: Sprite(['..cc..', 'c.cc..', 'cccc.c', '..cccc', '..cc..', '..cc..'], { c: '#3f7a3a' }),
    rock: Sprite(['......', '..ss..', '.ssss.', 'ssssss', '.ssss.', '......'], { s: '#7a7268' }),
    bones: Sprite(['......', '.b..b.', '.bbbb.', '..bb..', '.b..b.', '......'], { b: '#ddd6c4' }),
  };

  /* --- Rasterisation ---------------------------------------------------- */
  function drawSprite(ctx, sprite, ox, oy) {
    for (var y = 0; y < sprite.rows.length; y++) {
      var row = sprite.rows[y];
      for (var x = 0; x < row.length; x++) {
        var key = row[x];
        if (key === '.') continue;
        var color = sprite.palette[key];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  function build() {
    var entries = [];
    var name;

    for (name in RACE_SPRITES) entries.push(['unit_' + name, RACE_SPRITES[name]]);
    for (name in ANIMALS) entries.push(['animal_' + name, ANIMALS[name]]);
    for (name in MONSTERS) entries.push(['monster_' + name, MONSTERS[name]]);
    for (name in BUILDINGS) entries.push(['building_' + name, BUILDINGS[name]]);
    for (name in SCENERY) entries.push(['scenery_' + name, SCENERY[name]]);

    /* Shelf packer with 1px gutters; at these sizes anything cleverer is
     * wasted effort. */
    var maxW = 256;
    var x = 1,
      y = 1,
      rowH = 0;
    var placements = [];
    for (var i = 0; i < entries.length; i++) {
      var sp = entries[i][1];
      if (x + sp.w + 1 > maxW) {
        x = 1;
        y += rowH + 1;
        rowH = 0;
      }
      placements.push({ name: entries[i][0], sprite: sp, x: x, y: y });
      x += sp.w + 1;
      if (sp.h > rowH) rowH = sp.h;
    }
    var totalH = y + rowH + 1;

    var cv = document.createElement('canvas');
    cv.width = maxW;
    cv.height = totalH;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (var p = 0; p < placements.length; p++) {
      var pl = placements[p];
      drawSprite(ctx, pl.sprite, pl.x, pl.y);
      index[pl.name] = { x: pl.x, y: pl.y, w: pl.sprite.w, h: pl.sprite.h };
    }

    atlas = cv;
    return cv;
  }

  /* Draw an atlas sprite into a context, scaled, centred on (cx, cy).
   * `flip` mirrors horizontally so units face their direction of travel. */
  function draw(ctx, name, cx, cy, scale, flip) {
    var r = index[name];
    if (!r) return;
    var dw = r.w * scale,
      dh = r.h * scale;
    var dx = cx - dw / 2,
      dy = cy - dh / 2;
    if (flip) {
      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(atlas, r.x, r.y, r.w, r.h, -dw / 2, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(atlas, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
    }
  }

  /* A standalone data URL for one sprite, used by DOM UI (roster avatars). */
  function dataUrl(name, scale) {
    var r = index[name];
    if (!r) return '';
    scale = scale || 4;
    var cv = document.createElement('canvas');
    cv.width = r.w * scale;
    cv.height = r.h * scale;
    var c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(atlas, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
    return cv.toDataURL();
  }

  WB.Atlas = {
    build: build,
    draw: draw,
    dataUrl: dataUrl,
    has: function (n) {
      return !!index[n];
    },
    rect: function (n) {
      return index[n];
    },
    canvas: function () {
      return atlas;
    },
  };
})(window.WB || (window.WB = {}));
