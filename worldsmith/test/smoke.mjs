/* Worldsmith - headless smoke test.
 *
 *   node worldsmith/test/smoke.mjs [--screenshots]
 *
 * Loads the game over file:// (which also proves the "no server needed" claim),
 * drives the simulation, fires every registered power, and checks the world
 * stays numerically sane and fast enough to play. */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const indexUrl = pathToFileURL(path.join(root, 'index.html')).href;
const shotDir = path.join(root, 'test', 'screenshots');

/* Playwright may be local or installed globally; resolve it either way. */
function loadPlaywright() {
  const candidates = ['playwright'];
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    candidates.push(path.join(globalRoot, 'playwright'));
  } catch {
    /* npm not on PATH: fall through to the plain specifier */
  }
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('Playwright not found. Install it with: npm i -D playwright');
}

const { chromium } = loadPlaywright();

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const wantShots = process.argv.includes('--screenshots');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

section('Boot');
await page.goto(indexUrl);
await page.waitForFunction('window.WORLDSMITH_READY === true', null, { timeout: 30000 });
check('loads from file:// with no server', true);
check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

/* Deterministic world for the rest of the run. */
await page.evaluate(() => {
  WB.debug.game.loop.setSpeed(0); // drive ticks manually
  WB.debug.game.resizeWorld(384, 256, 12345, { preset: 'continents', seed: 12345, civs: 6 });
});

section('World generation');
const gen = await page.evaluate(() => WB.debug.census());
const landRatio = gen.world.land / (gen.world.land + gen.world.water);
check(
  'land/ocean ratio is plausible',
  landRatio > 0.15 && landRatio < 0.85,
  `land ${(landRatio * 100).toFixed(1)}%`
);
check('wildlife was seeded', gen.units.animal > 20, `${gen.units.animal} animals`);
check('civilisations were founded', gen.units.civ > 10, `${gen.units.civ} people`);

const biomes = await page.evaluate(() => {
  const seen = new Set();
  for (const seed of [1, 2, 3, 7, 99]) {
    const w = new WB.World(192, 128, seed);
    WB.Climate.attach(w);
    WB.Worldgen.generate(w, { seed, preset: 'continents' });
    for (let i = 0; i < w.size; i++) seen.add(w.terrain[i]);
  }
  return [...seen].map((id) => WB.TERRAIN[id].name);
});
check(
  'biome variety across seeds',
  biomes.length >= 8,
  `${biomes.length} materials: ${biomes.slice(0, 10).join(', ')}`
);

if (wantShots) {
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, '1-world.png') });
}

section('Simulation stability');
const beforeWater = await page.evaluate(() => WB.debug.validate().waterTotal);
await page.evaluate(() => WB.debug.tick(2000));
const afterTicks = await page.evaluate(() => WB.debug.validate());
check(
  'no NaN in terrain or units after 2000 ticks',
  afterTicks.problems.length === 0,
  afterTicks.problems.join('; ')
);
check(
  'unit population stays bounded',
  afterTicks.stats.units > 0 && afterTicks.stats.units < 6000,
  `${afterTicks.stats.units} alive`
);

const drift = Math.abs(afterTicks.waterTotal - beforeWater) / Math.max(1, beforeWater);
check('fluid sim conserves water', drift < 0.15, `${(drift * 100).toFixed(2)}% drift`);

section('Powers');
const powerIds = await page.evaluate(() => WB.debug.powerIds());
check('registry is populated', powerIds.length >= 60, `${powerIds.length} powers`);

const powerResult = await page.evaluate(async (ids) => {
  const bad = [];
  const g = WB.debug.game;
  for (const id of ids) {
    try {
      const x = 60 + Math.random() * 260;
      const y = 60 + Math.random() * 130;
      WB.debug.fire(id, x, y, 5);
      WB.debug.tick(4);
    } catch (e) {
      bad.push(`${id}: ${e.message}`);
    }
  }
  WB.debug.tick(400); // let every spawned effect run to completion
  return { bad, validate: WB.debug.validate() };
}, powerIds);

check(
  'every power applies without throwing',
  powerResult.bad.length === 0,
  powerResult.bad.slice(0, 4).join(' | ')
);
check(
  'world still valid after every power fired',
  powerResult.validate.problems.length === 0,
  powerResult.validate.problems.join('; ')
);
check('no new page errors during powers', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

section('Disasters in isolation');
const disasterCheck = await page.evaluate(() => {
  const g = WB.debug.game;
  g.resizeWorld(256, 192, 777, { preset: 'continents', seed: 777, civs: 4 });
  const results = {};
  const ids = [
    'meteor',
    'tornado',
    'volcano',
    'earthquake',
    'tsunami',
    'nuke',
    'blackhole',
    'rift',
    'thunderstorm',
  ];
  for (const id of ids) {
    const before = WB.debug.census().world;
    WB.debug.fire(id, 128, 96, 6);
    WB.debug.tick(300);
    const after = WB.debug.census().world;
    results[id] = { changed: before.land !== after.land || before.burning !== after.burning };
  }
  return { results, validate: WB.debug.validate() };
});
const unchanged = Object.entries(disasterCheck.results)
  .filter(([, v]) => !v.changed)
  .map(([k]) => k);
check(
  'major disasters visibly alter the world',
  unchanged.length <= 2,
  unchanged.length ? `no measured change: ${unchanged.join(', ')}` : ''
);
check(
  'world valid after disaster sweep',
  disasterCheck.validate.problems.length === 0,
  disasterCheck.validate.problems.join('; ')
);

if (wantShots) {
  /* Aim at real forest, not at the middle of the map - the centre is usually
   * ocean and a fire lit on water demonstrates nothing. */
  const forest = await page.evaluate(() => {
    const g = WB.debug.game;
    g.resizeWorld(384, 256, 2024, { preset: 'continents', seed: 2024, civs: 6 });
    WB.debug.tick(600);
    const w = g.world;
    let best = null,
      bestScore = -1;
    for (let y = 6; y < w.h - 6; y += 2) {
      for (let x = 6; x < w.w - 6; x += 2) {
        let score = 0;
        for (let dy = -5; dy <= 5; dy++)
          for (let dx = -5; dx <= 5; dx++) {
            const i = (y + dy) * w.w + (x + dx);
            if (w.water[i] <= 3) score += w.fuel[i];
          }
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  });

  await page.evaluate(({ x, y }) => {
    const g = WB.debug.game;
    g.camera.centerOn(x, y);
    g.camera.setZoom(5);
    g.world.windX = 1.2;
    g.world.windY = 0.2;
    WB.debug.fire('ignite', x, y, 3);
    WB.debug.tick(110);
  }, forest);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, '2-wildfire.png') });

  await page.evaluate(({ x, y }) => {
    WB.debug.fire('meteor', x + 6, y + 4, 9);
    WB.debug.tick(24);
  }, forest);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, '3-meteor.png') });

  await page.evaluate(() => WB.debug.tick(20));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, '3b-impact.png') });

  await page.evaluate(() => {
    const g = WB.debug.game;
    g.resizeWorld(384, 256, 555, { preset: 'continents', seed: 555, civs: 8 });
    WB.debug.tick(4000);
    g.camera.setZoom(6);
    const v = g.villages.aliveList()[0];
    if (v) g.camera.centerOn(v.x, v.y);
    g.renderer.setMapMode('kingdoms');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, '4-kingdoms.png') });

  await page.evaluate(() => WB.debug.game.renderer.setMapMode('normal'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, '5-civilisation.png') });
}

section('Performance');
const perf = await page.evaluate(() => {
  const g = WB.debug.game;
  g.resizeWorld(384, 256, 4242, { preset: 'continents', seed: 4242, civs: 8 });
  WB.debug.tick(1500); // let the population grow into the thousands
  const units = g.stats().units;
  const t0 = performance.now();
  WB.debug.tick(300);
  const ms = performance.now() - t0;
  return { units, tps: 300 / (ms / 1000), msPerTick: ms / 300 };
});
check(
  'sustains >= 30 sim ticks/sec at 384x256',
  perf.tps >= 30,
  `${perf.tps.toFixed(0)} tps with ${perf.units} units (${perf.msPerTick.toFixed(2)} ms/tick)`
);

section('Persistence');
const roundTrip = await page.evaluate(() => {
  const g = WB.debug.game;
  const before = g.stats();
  const blob = WB.Save.serialize(g);
  const json = JSON.stringify(blob);
  WB.Save.restore(g, JSON.parse(json));
  const after = g.stats();
  return { bytes: json.length, before, after };
});
check(
  'save/load round-trip preserves the world',
  roundTrip.before.units === roundTrip.after.units && roundTrip.before.villages === roundTrip.after.villages,
  `${roundTrip.after.units} units, ${roundTrip.after.villages} towns, ${(roundTrip.bytes / 1048576).toFixed(1)} MB`
);

section('Interface');
const uiCheck = await page.evaluate(() => ({
  powerButtons: document.querySelectorAll('.power').length,
  tabs: document.querySelectorAll('.tab').length,
  minimap: !!document.getElementById('minimap'),
}));
check(
  'toolbar rendered power buttons',
  uiCheck.powerButtons > 0,
  `${uiCheck.powerButtons} in the active tab`
);
check('all power groups have tabs', uiCheck.tabs === 6, `${uiCheck.tabs} tabs`);
check('minimap present', uiCheck.minimap);

/* Narrow viewport: the toolbar must not push the canvas off screen. */
await page.setViewportSize({ width: 420, height: 780 });
await page.waitForTimeout(250);
const mobile = await page.evaluate(() => {
  const c = document.getElementById('view').getBoundingClientRect();
  return { w: c.width, h: c.height, bodyScroll: document.body.scrollWidth > window.innerWidth + 1 };
});
check(
  'canvas still visible at 420px wide',
  mobile.w > 100 && mobile.h > 100,
  `${Math.round(mobile.w)}x${Math.round(mobile.h)}`
);
check('no horizontal page scroll on mobile', !mobile.bodyScroll);

await browser.close();

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (wantShots) console.log(`Screenshots written to ${shotDir}`);
process.exit(failures === 0 ? 0 : 1);
