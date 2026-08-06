/* Worldsmith - user interface.
 *
 * The DOM is built from the power registry and the species table rather than
 * hand-written markup, so index.html stays a skeleton and a new power appears
 * in the toolbar automatically. */
(function (WB) {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function UI(game, root) {
    this.game = game;
    this.root = root;
    this.activeGroup = 'terrain';
    this.sidePanel = 'chronicle';
    this.buttons = {};
    this.build();
    this.bind();
  }

  /* --- Construction -------------------------------------------------------- */
  UI.prototype.build = function () {
    this.buildTopBar();
    this.buildSidePanel();
    this.buildToolbar();
    this.buildDialogs();
    this.buildToast();
  };

  UI.prototype.buildTopBar = function () {
    var self = this,
      game = this.game;
    var bar = document.getElementById('topbar');

    var left = el('div', 'bar-group');
    var title = el('div', 'brand', 'Worldsmith');
    left.appendChild(title);

    /* speed controls */
    var speeds = el('div', 'speed');
    var defs = [
      { label: '❚❚', value: 0, title: 'Pause (Space)' },
      { label: '▶', value: 1, title: 'Normal (1)' },
      { label: '▶▶', value: 2, title: 'Fast (2)' },
      { label: '▶▶▶', value: 4, title: 'Faster (3)' },
      { label: '▶▶▶▶', value: 8, title: 'Fastest (4)' },
    ];
    this.speedButtons = [];
    defs.forEach(function (d) {
      var b = el('button', 'speed-btn', d.label);
      b.title = d.title;
      b.addEventListener('click', function () {
        game.loop.setSpeed(d.value);
        self.refreshSpeed();
      });
      b._value = d.value;
      speeds.appendChild(b);
      self.speedButtons.push(b);
    });
    left.appendChild(speeds);

    var mid = el('div', 'bar-group');
    var modeSelect = el('select', 'select');
    [
      ['normal', 'Normal view'],
      ['kingdoms', 'Political'],
      ['height', 'Elevation'],
      ['temperature', 'Temperature'],
      ['moisture', 'Moisture'],
    ].forEach(function (m) {
      var o = el('option', null, m[1]);
      o.value = m[0];
      modeSelect.appendChild(o);
    });
    modeSelect.addEventListener('change', function () {
      game.renderer.setMapMode(modeSelect.value);
    });
    mid.appendChild(modeSelect);

    var newBtn = el('button', 'btn', 'New World');
    newBtn.addEventListener('click', function () {
      self.openDialog('world');
    });
    mid.appendChild(newBtn);

    var menuBtn = el('button', 'btn', 'Menu');
    menuBtn.addEventListener('click', function () {
      self.openDialog('menu');
    });
    mid.appendChild(menuBtn);

    /* Below the desktop breakpoint the side panel slides in over the map, so
     * it needs its own way in. CSS hides this button on wide screens. */
    var sideBtn = el('button', 'btn', 'Info');
    sideBtn.id = 'side-toggle';
    sideBtn.addEventListener('click', function () {
      document.getElementById('side').classList.toggle('open');
    });
    mid.appendChild(sideBtn);

    var right = el('div', 'bar-group stats-group');
    this.statsEl = el('div', 'stats');
    right.appendChild(this.statsEl);

    bar.appendChild(left);
    bar.appendChild(mid);
    bar.appendChild(right);
    this.refreshSpeed();
  };

  UI.prototype.refreshSpeed = function () {
    var s = this.game.loop.speed;
    this.speedButtons.forEach(function (b) {
      b.classList.toggle('active', b._value === s);
    });
  };

  UI.prototype.buildToolbar = function () {
    var self = this,
      game = this.game;
    var bar = document.getElementById('toolbar');

    var tabs = el('div', 'tabs');
    WB.Powers.groups.forEach(function (g) {
      var t = el('button', 'tab');
      var img = el('img', 'tab-icon');
      img.src = WB.Icons.dataUrl(g.icon, 22, '#e6e2d8');
      img.alt = '';
      t.appendChild(img);
      t.appendChild(el('span', null, g.label));
      t.addEventListener('click', function () {
        self.activeGroup = g.key;
        self.renderPowers();
        self.renderTabs();
      });
      t._key = g.key;
      tabs.appendChild(t);
    });
    this.tabsEl = tabs;
    bar.appendChild(tabs);

    this.powersEl = el('div', 'powers');
    bar.appendChild(this.powersEl);

    /* brush size */
    var brush = el('div', 'brush');
    brush.appendChild(el('label', null, 'Brush'));
    var slider = el('input', 'slider');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '16';
    slider.value = String(game.brushSize);
    slider.addEventListener('input', function () {
      game.setBrush(parseInt(slider.value, 10));
    });
    this.brushSlider = slider;
    this.brushLabel = el('span', 'brush-value', String(game.brushSize));
    brush.appendChild(slider);
    brush.appendChild(this.brushLabel);
    bar.appendChild(brush);

    this.descEl = el('div', 'power-desc');
    bar.appendChild(this.descEl);

    this.renderTabs();
    this.renderPowers();
  };

  UI.prototype.renderTabs = function () {
    var self = this;
    Array.prototype.forEach.call(this.tabsEl.children, function (t) {
      t.classList.toggle('active', t._key === self.activeGroup);
    });
  };

  UI.prototype.renderPowers = function () {
    var self = this,
      game = this.game;
    this.powersEl.innerHTML = '';
    this.buttons = {};
    WB.Powers.inGroup(this.activeGroup).forEach(function (p) {
      var b = el('button', 'power');
      b.title = p.label + ' - ' + p.desc;
      var img = el('img', 'power-icon');
      img.src = WB.Icons.dataUrl(p.icon, 30, p.color);
      img.alt = '';
      b.appendChild(img);
      b.appendChild(el('span', 'power-label', p.label));
      b.addEventListener('click', function () {
        game.setPower(p.id);
        /* Global powers fire immediately - there is nowhere to aim them. */
        if (p.global) {
          p.apply(game);
          self.toast(p.label + ' unleashed.');
        }
      });
      b._id = p.id;
      self.powersEl.appendChild(b);
      self.buttons[p.id] = b;
    });
    this.refreshPower();
  };

  UI.prototype.refreshPower = function () {
    var id = this.game.powerId;
    for (var k in this.buttons) this.buttons[k].classList.toggle('active', k === id);
    var p = this.game.currentPower();
    this.descEl.textContent = p ? p.label + ' — ' + p.desc : '';
  };

  UI.prototype.buildSidePanel = function () {
    var self = this;
    var side = document.getElementById('side');

    var tabs = el('div', 'side-tabs');
    [
      ['chronicle', 'Chronicle'],
      ['inspect', 'Inspect'],
      ['kingdoms', 'Kingdoms'],
    ].forEach(function (t) {
      var b = el('button', 'side-tab', t[1]);
      b.addEventListener('click', function () {
        self.sidePanel = t[0];
        self.renderSide();
      });
      b._key = t[0];
      tabs.appendChild(b);
    });
    this.sideTabs = tabs;
    side.appendChild(tabs);

    this.sideBody = el('div', 'side-body');
    side.appendChild(this.sideBody);

    var mini = el('div', 'minimap-wrap');
    var cv = el('canvas', 'minimap');
    cv.id = 'minimap';
    mini.appendChild(cv);
    side.appendChild(mini);

    this.renderSide();
  };

  UI.prototype.renderSide = function () {
    var self = this;
    Array.prototype.forEach.call(this.sideTabs.children, function (t) {
      t.classList.toggle('active', t._key === self.sidePanel);
    });
    if (this.sidePanel === 'chronicle') this.renderChronicle();
    else if (this.sidePanel === 'inspect') this.renderInspector();
    else this.renderKingdoms();
  };

  UI.prototype.renderChronicle = function () {
    this.sideBody.innerHTML = '';
    var list = el('div', 'chronicle');
    var entries = this.game.chronicle.entries;
    for (var i = entries.length - 1; i >= 0; i--) {
      list.appendChild(this.chronicleRow(entries[i]));
    }
    if (!entries.length) list.appendChild(el('div', 'empty', 'Nothing has happened yet.'));
    this.sideBody.appendChild(list);
  };

  UI.prototype.chronicleRow = function (e) {
    var self = this;
    var row = el('div', 'chron chron-' + e.kind);
    row.appendChild(el('span', 'chron-text', e.text));
    if (e.x >= 0) {
      row.classList.add('clickable');
      row.addEventListener('click', function () {
        self.game.camera.centerOn(e.x, e.y);
      });
    }
    return row;
  };

  UI.prototype.renderInspector = function () {
    var game = this.game;
    this.sideBody.innerHTML = '';
    var info = game.units.info(game.selectedUnit);
    if (!info) {
      this.sideBody.appendChild(el('div', 'empty', 'Click a creature to inspect it.'));
      return;
    }

    var head = el('div', 'inspect-head');
    var img = el('img', 'portrait');
    img.src = WB.Atlas.dataUrl(info.sprite, 6);
    head.appendChild(img);
    var titles = el('div');
    titles.appendChild(el('div', 'inspect-name', info.name));
    titles.appendChild(el('div', 'inspect-sub', info.species + (info.kingdom ? ' · ' + info.kingdom : '')));
    head.appendChild(titles);
    this.sideBody.appendChild(head);

    var bar = el('div', 'hpbar');
    var fill = el('div', 'hpfill');
    fill.style.width = Math.round((info.hp / info.maxHp) * 100) + '%';
    bar.appendChild(fill);
    this.sideBody.appendChild(bar);

    var rows = [
      ['Health', info.hp + ' / ' + info.maxHp],
      ['Age', info.age + ' / ' + info.maxAge + ' yr'],
      ['Level', info.level],
      ['Kills', info.kills],
      ['Food', info.food + '%'],
    ];
    if (info.village) rows.push(['Home', info.village]);
    if (info.diseased) rows.push(['Status', 'Diseased']);

    var table = el('div', 'kv');
    rows.forEach(function (r) {
      var line = el('div', 'kv-row');
      line.appendChild(el('span', 'kv-k', r[0]));
      line.appendChild(el('span', 'kv-v', String(r[1])));
      table.appendChild(line);
    });
    this.sideBody.appendChild(table);

    if (info.traits.length) {
      var tags = el('div', 'tags');
      info.traits.forEach(function (t) {
        tags.appendChild(el('span', 'tag', t));
      });
      this.sideBody.appendChild(tags);
    }

    if (info.story.length) {
      this.sideBody.appendChild(el('div', 'section-title', 'Life story'));
      var story = el('div', 'story');
      info.story.forEach(function (s) {
        story.appendChild(el('div', 'story-line', s.text));
      });
      this.sideBody.appendChild(story);
    }

    var follow = el('button', 'btn wide', 'Centre on');
    var self = this;
    follow.addEventListener('click', function () {
      self.game.camera.centerOn(info.x, info.y);
    });
    this.sideBody.appendChild(follow);
  };

  UI.prototype.renderKingdoms = function () {
    var self = this;
    this.sideBody.innerHTML = '';
    var rows = this.game.kingdoms.summary();
    if (!rows.length) {
      this.sideBody.appendChild(
        el('div', 'empty', 'No kingdoms yet. Found a village from the Kingdoms tab.')
      );
      return;
    }
    rows.forEach(function (k) {
      var row = el('div', 'kingdom clickable');
      var swatch = el('span', 'swatch');
      swatch.style.background = k.color;
      row.appendChild(swatch);
      var body = el('div', 'kingdom-body');
      body.appendChild(el('div', 'kingdom-name', k.full));
      body.appendChild(
        el(
          'div',
          'kingdom-sub',
          k.population + ' souls · ' + k.villages + ' towns · ' + k.age + (k.wars ? ' · at war' : '')
        )
      );
      row.appendChild(body);
      row.addEventListener('click', function () {
        var kingdom = self.game.kingdoms.byId(k.id);
        if (kingdom && kingdom.villages.length) {
          var v = self.game.villages.list[kingdom.villages[0]];
          if (v) self.game.camera.centerOn(v.x, v.y);
        }
      });
      self.sideBody.appendChild(row);
    });
  };

  /* --- Dialogs -------------------------------------------------------------- */
  UI.prototype.buildDialogs = function () {
    var self = this,
      game = this.game;
    var overlay = el('div', 'overlay hidden');
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) self.closeDialog();
    });
    this.overlay = overlay;

    /* --- world generation --- */
    var world = el('div', 'dialog');
    world.appendChild(el('h2', null, 'Forge a New World'));

    var presetRow = el('div', 'field');
    presetRow.appendChild(el('label', null, 'Shape'));
    var preset = el('select', 'select');
    Object.keys(WB.Worldgen.PRESETS).forEach(function (key) {
      var o = el('option', null, WB.Worldgen.PRESETS[key].label);
      o.value = key;
      preset.appendChild(o);
    });
    presetRow.appendChild(preset);
    world.appendChild(presetRow);

    var sizeRow = el('div', 'field');
    sizeRow.appendChild(el('label', null, 'Size'));
    var size = el('select', 'select');
    [
      ['192x128', 192, 128],
      ['256x192', 256, 192],
      ['384x256', 384, 256],
      ['512x384', 512, 384],
    ].forEach(function (s, i) {
      var o = el('option', null, s[0]);
      o.value = i;
      size.appendChild(o);
    });
    size.value = '2';
    sizeRow.appendChild(size);
    world.appendChild(sizeRow);

    var seedRow = el('div', 'field');
    seedRow.appendChild(el('label', null, 'Seed'));
    var seed = el('input', 'input');
    seed.type = 'text';
    seed.placeholder = 'leave blank for random';
    seedRow.appendChild(seed);
    world.appendChild(seedRow);

    var civRow = el('div', 'field');
    civRow.appendChild(el('label', null, 'Starting kingdoms'));
    var civs = el('input', 'input');
    civs.type = 'number';
    civs.min = '0';
    civs.max = '16';
    civs.value = '5';
    civRow.appendChild(civs);
    world.appendChild(civRow);

    var actions = el('div', 'dialog-actions');
    var create = el('button', 'btn primary', 'Create World');
    create.addEventListener('click', function () {
      var sizes = [
        [192, 128],
        [256, 192],
        [384, 256],
        [512, 384],
      ];
      var dims = sizes[parseInt(size.value, 10)];
      var sv = seed.value.trim();
      var seedNum =
        sv === ''
          ? (Math.random() * 0xffffffff) >>> 0
          : /^\d+$/.test(sv)
            ? parseInt(sv, 10) >>> 0
            : WB.hashString(sv);
      self.closeDialog();
      self.toast('Forging world…');
      /* Let the toast paint before the generator blocks the thread. */
      setTimeout(function () {
        game.resizeWorld(dims[0], dims[1], seedNum, {
          preset: preset.value,
          seed: seedNum,
          civs: parseInt(civs.value, 10) || 0,
        });
        self.renderSide();
        self.toast('World ready.');
      }, 30);
    });
    var cancel = el('button', 'btn', 'Cancel');
    cancel.addEventListener('click', function () {
      self.closeDialog();
    });
    actions.appendChild(create);
    actions.appendChild(cancel);
    world.appendChild(actions);
    world.classList.add('hidden');
    this.worldDialog = world;

    /* --- menu / settings --- */
    var menu = el('div', 'dialog hidden');
    menu.appendChild(el('h2', null, 'Menu'));

    var toggles = [
      ['showBorders', 'Show kingdom borders'],
      ['showGrid', 'Show tile grid'],
      ['showScenery', 'Show trees and rocks'],
      ['dayNight', 'Day / night cycle'],
      ['seasons', 'Seasons'],
      ['erosion', 'Water erosion'],
      ['sound', 'Sound'],
    ];
    toggles.forEach(function (t) {
      var row = el('label', 'check');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = game.settings[t[0]];
      box.addEventListener('change', function () {
        game.settings[t[0]] = box.checked;
        if (t[0] === 'showBorders' || t[0] === 'showGrid') game.world.markAllDirty();
        if (t[0] === 'seasons') game.world.seasons = box.checked;
        if (t[0] === 'sound') game.audio.enabled = box.checked;
      });
      row.appendChild(box);
      row.appendChild(el('span', null, t[1]));
      menu.appendChild(row);
    });

    var seaRow = el('div', 'field');
    seaRow.appendChild(el('label', null, 'Sea level'));
    var sea = el('input', 'slider');
    sea.type = 'range';
    sea.min = '-40';
    sea.max = '40';
    sea.value = '0';
    sea.addEventListener('change', function () {
      WB.Water.setSeaLevel(game.world, parseInt(sea.value, 10) / 200);
      self.toast('Sea level set.');
    });
    seaRow.appendChild(sea);
    menu.appendChild(seaRow);

    var volRow = el('div', 'field');
    volRow.appendChild(el('label', null, 'Volume'));
    var vol = el('input', 'slider');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = '35';
    vol.addEventListener('input', function () {
      game.audio.setVolume(parseInt(vol.value, 10) / 100);
    });
    volRow.appendChild(vol);
    menu.appendChild(volRow);

    var io = el('div', 'dialog-actions wrap');
    function ioBtn(label, fn) {
      var b = el('button', 'btn', label);
      b.addEventListener('click', fn);
      io.appendChild(b);
    }
    ioBtn('Save', function () {
      var r = WB.Save.toLocalStorage(game);
      self.toast(r.ok ? 'World saved.' : r.error);
    });
    ioBtn('Load', function () {
      var r = WB.Save.fromLocalStorage(game);
      self.toast(r.ok ? 'World loaded.' : r.error);
      if (r.ok) self.renderSide();
      self.closeDialog();
    });
    ioBtn('Export file', function () {
      WB.Save.download(game);
    });
    ioBtn('Import file', function () {
      var input = el('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.addEventListener('change', function () {
        if (!input.files.length) return;
        WB.Save.upload(game, input.files[0], function (err) {
          self.toast(err ? err.message : 'World loaded.');
          if (!err) {
            self.renderSide();
            self.closeDialog();
          }
        });
      });
      input.click();
    });
    ioBtn('Save map PNG', function () {
      WB.Save.exportPng(game, 3);
    });
    menu.appendChild(io);

    menu.appendChild(
      el(
        'p',
        'hint',
        'Drag to use the selected power. Two fingers or right-drag to pan, wheel or pinch to zoom. ' +
          'Space pauses, 1-4 set speed, [ and ] resize the brush.'
      )
    );

    var close = el('button', 'btn primary wide', 'Close');
    close.addEventListener('click', function () {
      self.closeDialog();
    });
    menu.appendChild(close);
    this.menuDialog = menu;

    overlay.appendChild(world);
    overlay.appendChild(menu);
    document.body.appendChild(overlay);
  };

  UI.prototype.openDialog = function (which) {
    this.overlay.classList.remove('hidden');
    this.worldDialog.classList.toggle('hidden', which !== 'world');
    this.menuDialog.classList.toggle('hidden', which !== 'menu');
  };

  UI.prototype.closeDialog = function () {
    this.overlay.classList.add('hidden');
  };

  /* --- Toast ---------------------------------------------------------------- */
  UI.prototype.buildToast = function () {
    this.toastEl = el('div', 'toast hidden');
    document.body.appendChild(this.toastEl);
  };

  UI.prototype.toast = function (msg) {
    var self = this;
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () {
      self.toastEl.classList.add('hidden');
    }, 2200);
  };

  /* --- Wiring --------------------------------------------------------------- */
  UI.prototype.bind = function () {
    var self = this,
      game = this.game;

    game.bus.on('power', function () {
      self.refreshPower();
    });
    game.bus.on('brush', function (n) {
      self.brushSlider.value = String(n);
      self.brushLabel.textContent = String(n);
    });
    game.bus.on('speed', function () {
      self.refreshSpeed();
    });
    game.bus.on('select', function () {
      if (self.sidePanel !== 'inspect') self.sidePanel = 'inspect';
      self.renderSide();
    });
    game.bus.on('chronicle', function (e) {
      self.pushFeed(e);
      if (self.sidePanel === 'chronicle') self.renderChronicle();
    });
    game.bus.on('chronicle:clear', function () {
      if (self.sidePanel === 'chronicle') self.renderChronicle();
      self.feedEl.innerHTML = '';
    });
    game.bus.on('worldchanged', function () {
      self.renderSide();
    });
    game.bus.on('loaded', function () {
      self.renderSide();
    });

    /* Stats and the kingdom roster refresh on a timer, not every frame:
     * rebuilding DOM at 60fps is pure waste. */
    this.feedEl = document.getElementById('feed');
    setInterval(function () {
      self.updateStats();
      if (self.sidePanel === 'kingdoms') self.renderKingdoms();
      else if (self.sidePanel === 'inspect' && game.selectedUnit >= 0) self.renderInspector();
    }, 700);
  };

  UI.prototype.updateStats = function () {
    var s = this.game.stats();
    this.statsEl.innerHTML = '';
    var items = [
      ['Year', s.year + ' · ' + s.season],
      ['Life', s.units],
      ['Kingdoms', s.kingdoms],
      ['Towns', s.villages],
      ['FPS', s.fps],
    ];
    var self = this;
    items.forEach(function (it) {
      var d = el('div', 'stat');
      d.appendChild(el('span', 'stat-k', it[0]));
      d.appendChild(el('span', 'stat-v', String(it[1])));
      self.statsEl.appendChild(d);
    });
  };

  UI.prototype.pushFeed = function (e) {
    var row = el('div', 'feed-row feed-' + e.kind, e.text);
    this.feedEl.appendChild(row);
    while (this.feedEl.children.length > 5) this.feedEl.removeChild(this.feedEl.firstChild);
    setTimeout(function () {
      row.classList.add('fade');
    }, 5200);
    setTimeout(function () {
      if (row.parentNode) row.parentNode.removeChild(row);
    }, 6600);
  };

  WB.UI = UI;
})(window.WB || (window.WB = {}));
