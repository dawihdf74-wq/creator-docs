/* Worldsmith - toolbar icons, drawn with canvas primitives.
 *
 * Deliberately vector rather than emoji: emoji glyphs differ wildly between
 * platforms and are missing entirely on some Linux browsers, which would leave
 * the whole toolbar as tofu boxes. These always render identically. */
(function (WB) {
  'use strict';

  var TAU = Math.PI * 2;

  function poly(ctx, pts, fill) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function circle(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function ring(ctx, x, y, r, lw, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  function shade(color, amount) {
    var rgb = WB.hexToRgb(color);
    var f = amount;
    var r = Math.round(Math.max(0, Math.min(255, rgb[0] * f)));
    var g = Math.round(Math.max(0, Math.min(255, rgb[1] * f)));
    var b = Math.round(Math.max(0, Math.min(255, rgb[2] * f)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* Each drawer receives a context already scaled to a 32x32 design box. */
  var D = {};

  D.blob = function (c, col) {
    circle(c, 16, 17, 10, col);
    circle(c, 16, 12, 7, shade(col, 1.15));
  };

  D.hill = function (c, col) {
    poly(
      c,
      [
        [3, 25],
        [13, 10],
        [23, 25],
      ],
      col
    );
    poly(
      c,
      [
        [13, 25],
        [22, 14],
        [29, 25],
      ],
      shade(col, 0.8)
    );
  };

  D.mountain = function (c, col) {
    poly(
      c,
      [
        [2, 27],
        [12, 6],
        [22, 27],
      ],
      col
    );
    poly(
      c,
      [
        [8, 14],
        [12, 6],
        [16, 14],
      ],
      '#f2f6fa'
    );
    poly(
      c,
      [
        [14, 27],
        [23, 12],
        [30, 27],
      ],
      shade(col, 0.75)
    );
  };

  D.pit = function (c, col) {
    poly(
      c,
      [
        [2, 8],
        [30, 8],
        [22, 26],
        [10, 26],
      ],
      shade(col, 0.55)
    );
    poly(
      c,
      [
        [2, 8],
        [30, 8],
        [26, 13],
        [6, 13],
      ],
      col
    );
  };

  D.wave = function (c, col) {
    c.strokeStyle = col;
    c.lineWidth = 3;
    c.lineCap = 'round';
    for (var k = 0; k < 3; k++) {
      var y = 11 + k * 6;
      c.beginPath();
      c.moveTo(4, y);
      c.quadraticCurveTo(10, y - 4, 16, y);
      c.quadraticCurveTo(22, y + 4, 28, y);
      c.stroke();
    }
  };

  D.drop = function (c, col) {
    c.beginPath();
    c.moveTo(16, 4);
    c.bezierCurveTo(26, 16, 25, 27, 16, 27);
    c.bezierCurveTo(7, 27, 6, 16, 16, 4);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    circle(c, 13, 20, 2.5, 'rgba(255,255,255,0.45)');
  };

  D.tree = function (c, col) {
    c.fillStyle = '#5a3d22';
    c.fillRect(14, 18, 4, 10);
    circle(c, 16, 14, 9, col);
    circle(c, 12, 12, 5, shade(col, 1.2));
  };

  D.palm = function (c, col) {
    c.strokeStyle = '#6a4a28';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(17, 28);
    c.quadraticCurveTo(14, 18, 16, 9);
    c.stroke();
    for (var a = 0; a < 5; a++) {
      var ang = -Math.PI / 2 + (a - 2) * 0.6;
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(16, 9);
      c.quadraticCurveTo(
        16 + Math.cos(ang) * 7,
        9 + Math.sin(ang) * 7,
        16 + Math.cos(ang) * 12,
        12 + Math.sin(ang) * 10
      );
      c.stroke();
    }
  };

  D.cactus = function (c, col) {
    c.fillStyle = col;
    c.fillRect(13, 8, 6, 20);
    c.fillRect(6, 14, 4, 8);
    c.fillRect(6, 18, 8, 4);
    c.fillRect(22, 11, 4, 10);
    c.fillRect(18, 17, 8, 4);
  };

  D.grass = function (c, col) {
    c.strokeStyle = col;
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (var i = 0; i < 5; i++) {
      var x = 5 + i * 5.5;
      c.beginPath();
      c.moveTo(x, 27);
      c.quadraticCurveTo(x - 3 + i, 18, x + 2, 9 + (i % 2) * 4);
      c.stroke();
    }
  };

  D.snowflake = function (c, col) {
    c.strokeStyle = col;
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var a = (i * Math.PI) / 3;
      c.beginPath();
      c.moveTo(16 - Math.cos(a) * 11, 16 - Math.sin(a) * 11);
      c.lineTo(16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11);
      c.stroke();
    }
    circle(c, 16, 16, 2.5, col);
  };

  D.flame = function (c, col) {
    c.beginPath();
    c.moveTo(16, 3);
    c.bezierCurveTo(24, 12, 26, 20, 16, 29);
    c.bezierCurveTo(6, 20, 8, 12, 16, 3);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    c.beginPath();
    c.moveTo(16, 13);
    c.bezierCurveTo(20, 18, 20, 23, 16, 27);
    c.bezierCurveTo(12, 23, 12, 18, 16, 13);
    c.closePath();
    c.fillStyle = '#ffe14d';
    c.fill();
  };

  D.meteor = function (c, col) {
    c.strokeStyle = 'rgba(255,190,90,0.85)';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(2 + i * 3, 4 + i * 5);
      c.lineTo(12 + i * 3, 14 + i * 5);
      c.stroke();
    }
    circle(c, 21, 21, 7, col);
    circle(c, 19, 19, 3, shade(col, 1.4));
  };

  D.bolt = function (c, col) {
    poly(
      c,
      [
        [19, 2],
        [8, 17],
        [15, 17],
        [12, 30],
        [24, 13],
        [17, 13],
      ],
      col
    );
  };

  D.tornado = function (c, col) {
    c.fillStyle = col;
    for (var i = 0; i < 6; i++) {
      var t = i / 5;
      var wdt = 13 * (1 - t) + 2;
      var y = 5 + i * 4.2;
      c.beginPath();
      c.ellipse(16 + Math.sin(i * 1.3) * 2, y, wdt, 2.4, 0, 0, TAU);
      c.fill();
    }
  };

  D.volcano = function (c, col) {
    poly(
      c,
      [
        [3, 28],
        [11, 11],
        [21, 11],
        [29, 28],
      ],
      col
    );
    poly(
      c,
      [
        [11, 11],
        [21, 11],
        [19, 15],
        [13, 15],
      ],
      '#ff5a1a'
    );
    circle(c, 16, 7, 3, '#ff8a2a');
    circle(c, 11, 4, 2, '#ffb03a');
    circle(c, 21, 3, 2, '#ffb03a');
  };

  D.quake = function (c, col) {
    c.strokeStyle = col;
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(2, 16);
    c.lineTo(9, 9);
    c.lineTo(14, 22);
    c.lineTo(20, 6);
    c.lineTo(25, 18);
    c.lineTo(30, 13);
    c.stroke();
    c.fillStyle = col;
    c.fillRect(2, 25, 28, 3);
  };

  D.tsunami = function (c, col) {
    c.beginPath();
    c.moveTo(2, 27);
    c.lineTo(2, 16);
    c.bezierCurveTo(6, 3, 24, 2, 27, 13);
    c.bezierCurveTo(24, 8, 16, 9, 15, 16);
    c.lineTo(30, 27);
    c.closePath();
    c.fillStyle = col;
    c.fill();
  };

  D.nuke = function (c, col) {
    circle(c, 16, 16, 12, shade(col, 0.35));
    c.fillStyle = col;
    for (var i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(16, 16);
      c.arc(16, 16, 11, (i * TAU) / 3 - 0.5, (i * TAU) / 3 + 0.5);
      c.closePath();
      c.fill();
    }
    circle(c, 16, 16, 3, col);
  };

  D.acid = function (c, col) {
    for (var i = 0; i < 4; i++) {
      var x = 6 + i * 7,
        y = 6 + (i % 2) * 6;
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x + 5, y + 7, x + 4, y + 13, x, y + 13);
      c.bezierCurveTo(x - 4, y + 13, x - 5, y + 7, x, y);
      c.closePath();
      c.fillStyle = col;
      c.fill();
    }
  };

  D.skull = function (c, col) {
    circle(c, 16, 14, 10, col);
    c.fillStyle = col;
    c.fillRect(11, 21, 10, 6);
    circle(c, 12, 14, 3.2, '#1b1520');
    circle(c, 20, 14, 3.2, '#1b1520');
    c.fillStyle = '#1b1520';
    c.fillRect(15, 19, 2, 4);
    c.fillRect(13, 24, 2, 3);
    c.fillRect(17, 24, 2, 3);
  };

  D.blizzard = function (c, col) {
    c.fillStyle = '#8fa8bd';
    c.beginPath();
    c.ellipse(15, 11, 11, 6, 0, 0, TAU);
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(5 + i * 7, 19);
      c.lineTo(2 + i * 7, 29);
      c.stroke();
    }
  };

  D.sun = function (c, col) {
    circle(c, 16, 16, 7, col);
    c.strokeStyle = col;
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (var i = 0; i < 8; i++) {
      var a = (i * TAU) / 8;
      c.beginPath();
      c.moveTo(16 + Math.cos(a) * 10, 16 + Math.sin(a) * 10);
      c.lineTo(16 + Math.cos(a) * 14, 16 + Math.sin(a) * 14);
      c.stroke();
    }
  };

  D.cloud = function (c, col) {
    circle(c, 11, 17, 6, col);
    circle(c, 19, 15, 8, col);
    circle(c, 24, 19, 5, col);
    c.fillStyle = col;
    c.fillRect(11, 17, 14, 6);
  };

  D.storm = function (c, col) {
    D.cloud(c, '#7b8a99');
    poly(
      c,
      [
        [18, 20],
        [11, 30],
        [16, 30],
        [13, 32],
      ],
      col
    );
    poly(
      c,
      [
        [22, 20],
        [16, 29],
        [20, 29],
        [18, 31],
      ],
      col
    );
  };

  D.blackhole = function (c, col) {
    ring(c, 16, 16, 12, 3, shade(col, 1.6));
    ring(c, 16, 16, 8, 2, shade(col, 1.2));
    circle(c, 16, 16, 6, '#0b0710');
  };

  D.rift = function (c, col) {
    poly(
      c,
      [
        [16, 2],
        [22, 12],
        [19, 16],
        [24, 30],
        [12, 18],
        [15, 14],
        [9, 6],
      ],
      col
    );
  };

  D.beam = function (c, col) {
    poly(
      c,
      [
        [13, 0],
        [19, 0],
        [26, 30],
        [6, 30],
      ],
      shade(col, 1.3)
    );
    poly(
      c,
      [
        [15, 0],
        [17, 0],
        [20, 30],
        [12, 30],
      ],
      '#ffffff'
    );
  };

  D.hand = function (c, col) {
    c.fillStyle = col;
    c.fillRect(10, 12, 4, 12);
    c.fillRect(15, 8, 4, 16);
    c.fillRect(20, 12, 4, 12);
    c.beginPath();
    c.arc(17, 24, 8, 0, Math.PI);
    c.fill();
  };

  D.heart = function (c, col) {
    c.beginPath();
    c.moveTo(16, 28);
    c.bezierCurveTo(2, 18, 5, 5, 16, 12);
    c.bezierCurveTo(27, 5, 30, 18, 16, 28);
    c.closePath();
    c.fillStyle = col;
    c.fill();
  };

  D.food = function (c, col) {
    circle(c, 16, 18, 9, col);
    c.fillStyle = '#4a8a3a';
    c.fillRect(15, 5, 2, 7);
    c.beginPath();
    c.ellipse(21, 8, 5, 3, -0.6, 0, TAU);
    c.fill();
  };

  D.sword = function (c, col) {
    poly(
      c,
      [
        [19, 2],
        [23, 6],
        [11, 22],
        [7, 18],
      ],
      col
    );
    c.fillStyle = '#8a6a3a';
    c.save();
    c.translate(9, 20);
    c.rotate(-Math.PI / 4);
    c.fillRect(-8, -2, 16, 4);
    c.fillRect(-3, 2, 6, 9);
    c.restore();
  };

  D.shield = function (c, col) {
    c.beginPath();
    c.moveTo(16, 3);
    c.lineTo(28, 8);
    c.lineTo(28, 17);
    c.bezierCurveTo(28, 24, 22, 28, 16, 30);
    c.bezierCurveTo(10, 28, 4, 24, 4, 17);
    c.lineTo(4, 8);
    c.closePath();
    c.fillStyle = col;
    c.fill();
  };

  D.person = function (c, col) {
    circle(c, 16, 8, 5, col);
    c.fillStyle = col;
    c.fillRect(11, 14, 10, 10);
    c.fillRect(11, 24, 4, 6);
    c.fillRect(17, 24, 4, 6);
  };

  D.paw = function (c, col) {
    circle(c, 16, 20, 7, col);
    circle(c, 8, 12, 3.4, col);
    circle(c, 14, 8, 3.4, col);
    circle(c, 20, 8, 3.4, col);
    circle(c, 25, 13, 3.4, col);
  };

  D.dragon = function (c, col) {
    poly(
      c,
      [
        [4, 20],
        [12, 8],
        [16, 14],
        [22, 6],
        [28, 20],
        [16, 26],
      ],
      col
    );
    circle(c, 22, 14, 1.8, '#ffe14d');
  };

  D.egg = function (c, col) {
    c.beginPath();
    c.ellipse(16, 18, 8, 11, 0, 0, TAU);
    c.fillStyle = col;
    c.fill();
  };

  D.house = function (c, col) {
    poly(
      c,
      [
        [16, 4],
        [29, 15],
        [3, 15],
      ],
      shade(col, 0.7)
    );
    c.fillStyle = col;
    c.fillRect(7, 15, 18, 13);
    c.fillStyle = '#3a2a1c';
    c.fillRect(14, 20, 5, 8);
  };

  D.flag = function (c, col) {
    c.fillStyle = '#6a5a48';
    c.fillRect(8, 3, 3, 26);
    poly(
      c,
      [
        [11, 4],
        [27, 9],
        [11, 15],
      ],
      col
    );
  };

  D.boat = function (c, col) {
    poly(
      c,
      [
        [3, 19],
        [29, 19],
        [24, 27],
        [8, 27],
      ],
      col
    );
    c.fillStyle = '#e8e4dc';
    poly(
      c,
      [
        [16, 3],
        [26, 17],
        [16, 17],
      ],
      '#e8e4dc'
    );
    c.fillStyle = '#4a3420';
    c.fillRect(15, 3, 2, 16);
  };

  D.road = function (c, col) {
    poly(
      c,
      [
        [10, 30],
        [22, 30],
        [19, 2],
        [13, 2],
      ],
      col
    );
    c.fillStyle = '#efe8d8';
    for (var i = 0; i < 4; i++) c.fillRect(15, 4 + i * 7, 2, 4);
  };

  D.eraser = function (c, col) {
    c.save();
    c.translate(16, 16);
    c.rotate(-0.6);
    c.fillStyle = col;
    c.fillRect(-11, -6, 14, 12);
    c.fillStyle = '#d8d4cc';
    c.fillRect(3, -6, 8, 12);
    c.restore();
  };

  D.clock = function (c, col) {
    circle(c, 16, 16, 12, col);
    circle(c, 16, 16, 9.5, '#1b1520');
    c.strokeStyle = col;
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(16, 16);
    c.lineTo(16, 9);
    c.moveTo(16, 16);
    c.lineTo(21, 18);
    c.stroke();
  };

  D.star = function (c, col) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var r = i % 2 === 0 ? 13 : 5.5;
      var a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([16 + Math.cos(a) * r, 16 + Math.sin(a) * r]);
    }
    poly(c, pts, col);
  };

  D.dna = function (c, col) {
    c.strokeStyle = col;
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (var s = -1; s <= 1; s += 2) {
      c.beginPath();
      for (var t = 0; t <= 1.001; t += 0.1) {
        var y = 4 + t * 24;
        var x = 16 + Math.sin(t * Math.PI * 2) * 8 * s;
        if (t === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
    for (var k = 0; k < 4; k++) {
      var tt = 0.15 + k * 0.23;
      var yy = 4 + tt * 24;
      var xx = Math.sin(tt * Math.PI * 2) * 8;
      c.beginPath();
      c.moveTo(16 - xx, yy);
      c.lineTo(16 + xx, yy);
      c.stroke();
    }
  };

  D.sand = function (c, col) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(2, 26);
    c.quadraticCurveTo(9, 15, 16, 21);
    c.quadraticCurveTo(23, 27, 30, 17);
    c.lineTo(30, 30);
    c.lineTo(2, 30);
    c.closePath();
    c.fill();
    circle(c, 10, 12, 2, shade(col, 1.2));
    circle(c, 22, 9, 2, shade(col, 1.2));
  };

  D.crystal = function (c, col) {
    poly(
      c,
      [
        [16, 2],
        [25, 13],
        [20, 30],
        [12, 30],
        [7, 13],
      ],
      col
    );
    poly(
      c,
      [
        [16, 2],
        [20, 30],
        [12, 30],
      ],
      shade(col, 1.35)
    );
  };

  D.wall = function (c, col) {
    c.fillStyle = col;
    for (var r = 0; r < 3; r++) {
      for (var i = 0; i < 4; i++) {
        var off = r % 2 ? 3 : 0;
        c.fillRect(2 + i * 7 + off, 9 + r * 7, 6, 6);
      }
    }
  };

  D.ruin = function (c, col) {
    c.fillStyle = col;
    c.fillRect(5, 14, 5, 15);
    c.fillRect(13, 19, 5, 10);
    c.fillRect(21, 11, 5, 18);
    c.fillRect(3, 27, 26, 3);
  };

  D.brush = function (c, col) {
    c.save();
    c.translate(16, 16);
    c.rotate(-0.7);
    c.fillStyle = '#8a6a3a';
    c.fillRect(-2, -14, 4, 16);
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(-5, 2);
    c.lineTo(5, 2);
    c.lineTo(3, 14);
    c.lineTo(-3, 14);
    c.closePath();
    c.fill();
    c.restore();
  };

  D.magnify = function (c, col) {
    ring(c, 14, 13, 8, 3, col);
    c.strokeStyle = col;
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(20, 19);
    c.lineTo(28, 28);
    c.stroke();
  };

  var cache = {};

  /* Render an icon to a data URL. Cached: the toolbar asks for the same few
   * dozen icons on every rebuild. */
  function dataUrl(name, size, color) {
    size = size || 32;
    color = color || '#e6e2d8';
    var key = name + '|' + size + '|' + color;
    if (cache[key]) return cache[key];

    var cv = document.createElement('canvas');
    var dpr = 2; /* icons are small; render at 2x so they stay crisp */
    cv.width = size * dpr;
    cv.height = size * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale((size * dpr) / 32, (size * dpr) / 32);
    var fn = D[name] || D.blob;
    fn(ctx, color);

    var url = cv.toDataURL();
    cache[key] = url;
    return url;
  }

  WB.Icons = { draw: D, dataUrl: dataUrl, names: Object.keys(D) };
})(window.WB || (window.WB = {}));
