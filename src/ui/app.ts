/**
 * The Valley UI: plain DOM and a Canvas 2D ink map over the pure sim. The UI reads state and gives orders through
 * `act`; it never changes the sim directly. Real time drives sim minutes in fixed quanta (continuous, with a slowdown
 * when something heavy happens; menus pause time). The save is the kahya's ledger: the seed and the input log in local
 * storage, and a bound volume (the whole state, gzipped) in IndexedDB every few weeks of the valley's time.
 */

import { type PhoneStage, phoneStage } from '@adam0white/lab-kit';
import {
  DAY,
  daylight,
  dayOfMinute,
  doyOf,
  HOUR,
  minuteOfDay,
  seasonOf,
  weatherOf,
  yearOf,
} from '../sim/calendar.ts';
import {
  act,
  END_DAY,
  GAME_VERSION,
  type Game,
  gathering,
  type Input,
  newGame,
  type Order,
  QUANTUM,
  restoreState,
  type SavedGame,
  save,
  seedFrom,
  stateJson,
  step,
} from '../sim/game.ts';
import type { Household } from '../sim/people.ts';
import {
  type Hunch,
  houseOf,
  hunchOf,
  type Job,
  type Knock,
  loanOwedAt,
  type Note,
  nextRiderDay,
  personOf,
  shareOwed,
  underSeal,
  V,
  type ValleyState,
} from '../sim/valley.ts';
import { labScreen, mountLab } from './lab.ts';
import { closingGrain } from './tally.ts';

let showClosingGrain = false;

import {
  callUnavailable,
  cropReturnWords,
  currentJob,
  dateEnglish as dateWords,
  englishText,
  fullDateEnglish,
  limitsWords,
  loanReturnWords,
  nextWords,
  nowWords,
  PURPOSE,
} from './presentation.ts';

const LOG = 'valley-log-v1';
const SPEEDS = [30, 120, 480] as const; // sim minutes per real second
const SPEED_NAMES = ['slow', 'steady', 'fast'];
const SLOW_RATE = 20;
const HUB = 'https://human.adamwhite.work';

interface Log {
  game: 'valley';
  version: string;
  seed: number;
  inputs: Input[];
  minute: number;
  volume: number;
  savedAt: string;
}

const app = document.getElementById('app') as HTMLElement;
let g: Game | null = null;
let speed = 0;
let slowUntil = 0;
let raf = 0;
let last = 0;
let carry = 0;
let selected: string | null = null;
let stage: PhoneStage | null = null;
let houseAction = '';
let valleyAction = '';
let houseDetails = false;
let tab: 'notes' | 'ledger' | 'charge' = 'notes';
let historyOpen = false;
let repliesOpen = false;
let lastDay = -1;
let lastSnapDay = -1;
let lastSheet = 0;
let sheetKey = '';
let seenNote = 0;
let volume = 0;
const openDays = new Set<number>();
let wake: { release(): Promise<void> } | null = null;
let hunchCache: { key: string; lines: string[] } | null = null;
let actions: (() => void)[] = [];

const esc = (x: string) =>
  englishText(x).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
const mark = () => `<a class="mark" href="${HUB}">◇ human framework</a>`;
const footer = () => `<div class="footer"><a href="${HUB}/games/">◇ All games</a></div>`;
const yearWord = (y: number) => ['one', 'two', 'three', 'four'][y - 1] ?? String(y);

function partOfDay(m: number): string {
  const d = minuteOfDay(m);
  const { rise, set } = daylight(doyOf(dayOfMinute(m)));
  if (d < rise - 60 || d >= set + 120) return 'night';
  if (d < rise + 60) return 'first light';
  if (d < 11 * HOUR) return 'morning';
  if (d < 14 * HOUR) return 'midday';
  if (d < set - 60) return 'afternoon';
  return 'dusk';
}

// ---------- saves: the ledger ----------

function writeLog() {
  if (!g) return;
  const log: Log = {
    game: 'valley',
    version: GAME_VERSION,
    seed: g.valley.seed,
    inputs: g.inputs,
    minute: g.valley.minute,
    volume,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LOG, JSON.stringify(log));
  } catch {}
}

function readLog(): Log | null {
  try {
    const raw = localStorage.getItem(LOG);
    if (!raw) return null;
    const log = JSON.parse(raw) as Log;
    return log.game === 'valley' && Array.isArray(log.inputs) ? log : null;
  } catch {
    return null;
  }
}

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('valley', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('volumes');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

interface Bound {
  seed: number;
  k: number;
  minute: number;
  gz: Blob;
}

async function bindVolume() {
  if (!g) return;
  const s = g.valley;
  const json = JSON.stringify(stateJson(s));
  const bound: Bound = { seed: s.seed, k: g.inputs.length, minute: s.minute, gz: await gzip(json) };
  volume++;
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('volumes', 'readwrite');
      tx.objectStore('volumes').put(bound, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
  writeLog();
}

async function readVolume(): Promise<Bound | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const r = d.transaction('volumes').objectStore('volumes').get('current');
      r.onsuccess = () => res((r.result as Bound | undefined) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

async function clearSaves() {
  try {
    localStorage.removeItem(LOG);
    const d = await db();
    d.transaction('volumes', 'readwrite').objectStore('volumes').delete('current');
  } catch {}
}

async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([text]);
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function gunzip(b: Blob): Promise<string> {
  try {
    if (typeof DecompressionStream === 'undefined') return await b.text();
    return await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } catch {
    return await b.text();
  }
}

/** Read the ledger back: the bound volume, then the days written after it, quantum by quantum. */
async function reopen(log: Log, onProgress: (m: number) => void): Promise<Game> {
  const bound = await readVolume();
  let game: Game;
  let rest: Input[];
  if (bound && bound.seed === log.seed && bound.k <= log.inputs.length && bound.minute <= log.minute) {
    game = {
      valley: restoreState(JSON.parse(await gunzip(bound.gz)) as ValleyState),
      inputs: log.inputs.slice(0, bound.k),
    };
    rest = log.inputs.slice(bound.k);
  } else {
    game = newGame(log.seed);
    rest = log.inputs;
  }
  while (game.valley.minute + QUANTUM <= log.minute && !game.valley.flags.ended) {
    step(game, Math.min(log.minute, game.valley.minute + 3 * DAY), rest);
    onProgress(game.valley.minute);
    await new Promise((r) => setTimeout(r, 0));
  }
  volume = log.volume;
  return game;
}

// ---------- the title page ----------

export function start() {
  mountLab({
    onTallyChange: (enabled) => {
      showClosingGrain = enabled;
      if (g?.valley.flags.ended) drawClosingGrain();
    },
    getRun: () => (g ? save(g, volume) : undefined),
    hasRun: () => !!g,
    download,
    bindVolume: async () => {
      if (!g) return;
      lastSnapDay = dayOfMinute(g.valley.minute);
      await bindVolume();
    },
  });
  if ('serviceWorker' in navigator && location.hostname !== 'localhost')
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  title();
}

function title() {
  labScreen('title');
  cancelAnimationFrame(raf);
  const log = readLog();
  const where = log
    ? `Your ledger is open at ${dateWords(dayOfMinute(log.minute))} of year ${yearWord(yearOf(dayOfMinute(log.minute)))}.`
    : '';
  stage?.destroy();
  stage = null;
  app.innerHTML = `<div class="page">
    ${mark()}
    <h1>The Valley</h1>
    <p class="purpose">${esc(PURPOSE)}</p>
    <p class="soft">Call households to the harvest. Read their replies. Visit to learn what they need. The rain will not wait.</p>
    ${where ? `<p class="hand">${esc(where)}</p>` : ''}
    <div class="actions">
      ${log ? '<button class="primary" data-go="open">Open the ledger</button>' : '<button class="primary" data-go="new">Take up the seal</button>'}
      ${log ? '<button data-go="new" class="hold">Hold to begin a new term<span class="fill"></span></button><p class="soft" style="font-size:14px">Hold to begin again; the old ledger is closed for good.</p>' : ''}
      <button data-go="seed">A named valley (seed)</button>
    </div>
    <p class="soft" style="font-size:14px">Every household has its own needs and memory. People can refuse your requests, and they remember how you answer.</p>
    ${footer()}
  </div>`;
  app.querySelector('[data-go="open"]')?.addEventListener('click', () => {
    if (log) openLedger(log);
  });
  const fresh = (seed: number) => {
    clearSaves().then(() => begin(seed));
  };
  const nb = app.querySelector<HTMLButtonElement>('[data-go="new"]');
  if (nb) {
    if (log) bindHold(nb, () => fresh(Math.floor(Math.random() * 1e9)));
    else nb.addEventListener('click', () => fresh(Math.floor(Math.random() * 1e9)));
  }
  app.querySelector('[data-go="seed"]')?.addEventListener('click', () => {
    const name = prompt('Name the valley (the same name gives the same valley):', 'Kuyulu');
    if (name) fresh(seedFrom(name.trim().toLowerCase()));
  });
}

function openLedger(log: Log) {
  app.innerHTML = `<div class="page">${mark()}<h2>Reading the ledger back…</h2><p class="hand" id="prog"></p></div>`;
  const prog = app.querySelector('#prog') as HTMLElement;
  reopen(log, (m) => {
    prog.textContent = `${dateWords(dayOfMinute(m))} of year ${yearWord(yearOf(dayOfMinute(m)))}`;
  })
    .then((game) => {
      g = game;
      enter();
    })
    .catch(() => {
      prog.textContent = 'The ledger would not open. Begin a new term from the title page.';
    });
}

function begin(seed: number) {
  app.innerHTML = `<div class="page">${mark()}<h2>Up the valley road…</h2></div>`;
  setTimeout(() => {
    g = newGame(seed);
    volume = 0;
    speed = 0;
    seenNote = 0;
    writeLog();
    enter();
  }, 30);
}

// ---------- play ----------

function enter() {
  labScreen('play');
  if (!g) return;
  if (g.valley.flags.ended) return ending();
  selected = null;
  tab = 'notes';
  sheetKey = '';
  lastDay = dayOfMinute(g.valley.minute);
  lastSnapDay = lastDay;
  seenNote = Math.max(seenNote, (g.valley.notes.at(-1)?.id ?? 0) - 6);
  stage?.destroy();
  app.innerHTML = `<div class="play lk-stage" data-sheet="fit">
    <section class="lk-strip" aria-label="Valley state">
    <div class="top"><button class="charge-link" data-charge>Your charge</button><span class="grow"></span><span class="speed" id="speed" aria-label="Time passing"></span></div>
    <p id="hold-feedback" class="hold-feedback" role="status" hidden></p>
    <section class="orientation" aria-label="The work ahead"><p id="now" class="moment"></p><p id="next" class="next soft"></p></section>
    <p class="caption" id="cap"></p></section>
    <div class="map lk-scene"><canvas id="map" aria-label="The valley map"></canvas><nav id="houses" aria-label="Choose a house"></nav></div>
    <section class="lk-sheet" aria-label="Valley notebook">
      <header class="lk-sheet-head" id="sheet-head" hidden></header>
      <div id="house-answer" hidden></div>
      <div class="sheet lk-sheet-body" id="sheet"></div>
      <footer class="thumbs lk-commit" id="thumbs"></footer>
    </section>
  </div>`;
  app.querySelector('[data-charge]')?.addEventListener('click', () => {
    selected = null;
    tab = 'charge';
    drawSheet(true);
  });
  const root = app.querySelector<HTMLElement>('.lk-stage');
  if (root)
    stage = phoneStage(root, {
      observeOnly: true,
      onSceneRect: () => {
        root.dataset.reflow = String(
          parseFloat(getComputedStyle(root.querySelector('#now') ?? root).fontSize) > 24,
        );
      },
    });
  app.querySelector('#sheet-head')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.house-close')) closeHouse();
    if ((e.target as HTMLElement).closest('.house-about')) {
      houseDetails = !houseDetails;
      drawSheet(true);
      app.querySelector<HTMLButtonElement>('.house-about')?.focus({ preventScroll: true });
    }
  });
  const cv = app.querySelector('#map') as HTMLCanvasElement;
  cv.addEventListener('click', (e) => tapMap(cv, e));
  app.querySelector('#speed')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    speed = Number(b.dataset.s);
    slowUntil = 0;
    drawTop();
  });
  app.querySelector('#sheet')?.addEventListener('click', onSheetClick);
  app.querySelector('#thumbs')?.addEventListener('click', onSheetClick);
  app.querySelector('#house-answer')?.addEventListener('click', onSheetClick);
  app.querySelector('#houses')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-h]');
    if (b?.dataset.h) pick(b.dataset.h);
    if ((e.target as HTMLElement).closest('[data-house-list]')) closeHouse();
  });
  drawTop();
  drawSheet(true);
  drawMap();
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  requestWake();
}

function rateNow(t: number): number {
  if (!g) return 0;
  const s = g.valley;
  let r: number = SPEEDS[speed] ?? 120;
  // Nights go by faster when nobody is out.
  if (partOfDay(s.minute) === 'night' && !s.kahyaState.visit) r *= 3;
  if (t < slowUntil) r = Math.min(r, SLOW_RATE);
  // Someone at the door holds the valley at the slow pace until you answer (slowdown, not a pause).
  if (s.knocks.some((k) => !k.answered && k.what === 'grain' && k.at <= s.minute && k.until > s.minute))
    r = Math.min(r, SPEEDS[0]);
  return r;
}

function frame(t: number) {
  if (!g) return;
  const s = g.valley;
  const dt = Math.min(250, t - last);
  last = t;
  if (document.querySelector('dialog[open], .hflab-veil')) {
    raf = requestAnimationFrame(frame);
    return;
  }
  carry += (dt / 1000) * rateNow(t);
  const begun = performance.now();
  let moved = false;
  while (carry >= QUANTUM && performance.now() - begun < 14 && !s.flags.ended) {
    step(g, s.minute + QUANTUM);
    carry -= QUANTUM;
    moved = true;
    afterQuantum(t);
  }
  // Behind on a slow phone: let time go rather than pile it up.
  carry = Math.min(carry, QUANTUM * 2);
  if (s.flags.ended) {
    writeLog();
    bindVolume().finally(() => ending());
    return;
  }
  drawMap();
  if (moved && t - lastSheet > 450) drawSheet();
  raf = requestAnimationFrame(frame);
}

function afterQuantum(t: number) {
  if (!g) return;
  const s = g.valley;
  // Something heavy happened: the clock slows by itself for a few seconds.
  const first = dayOfMinute(s.minute) < 1;
  for (const n of s.notes) {
    if (n.id <= seenNote) continue;
    seenNote = n.id;
    if (n.weight >= 2.5 || (first && n.weight >= 2)) slowUntil = t + 3500;
  }
  if (s.knocks.some((k) => !k.answered && k.at <= s.minute && k.at > s.minute - QUANTUM))
    slowUntil = t + 3500;
  const day = dayOfMinute(s.minute);
  if (day !== lastDay) {
    lastDay = day;
    hunchCache = null;
    writeLog();
    drawTop();
    if (day - lastSnapDay >= 15) {
      lastSnapDay = day;
      bindVolume();
    }
  }
}

function drawTop() {
  if (!g) return;
  const sp = app.querySelector('#speed');
  if (sp)
    sp.innerHTML = SPEED_NAMES.map(
      (n, i) =>
        `<button data-s="${i}" class="${i === speed ? 'on' : ''}" aria-pressed="${i === speed}">${n}</button>`,
    ).join('');
}

function order(o: Order) {
  if (!g) return;
  if (act(g, o)) {
    if (o.verb === 'visit' || o.verb === 'give') {
      selected = o.house;
      houseDetails = false;
    }
    writeLog();
    hunchCache = null;
    drawSheet(true);
  }
}

// ---------- the map ----------

const WORLD = { x0: 230, x1: 830 };
const PLACES: Record<string, [number, number]> = {
  'field:agha': [735, 470],
  konak: [600, 545],
  granary: [630, 568],
  mill: [612, 420],
  coffeehouse: [452, 508],
  mosque: [452, 508],
  spring: [548, 520],
  road: [520, 775],
};

interface View {
  sc: number;
  ox: number;
  oy: number;
  y0: number;
}
let view: View = { sc: 1, ox: 0, oy: 0, y0: 0 };
const palette: Record<string, string> = {};
let paletteAt = 0;

function colours() {
  const now = performance.now();
  if (now - paletteAt < 2000 && palette.ink) return palette;
  paletteAt = now;
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['paper', 'paper-2', 'ink', 'ink-soft', 'rope', 'moss', 'sky'])
    palette[k] = cs.getPropertyValue(`--${k}`).trim() || '#000';
  return palette;
}

const hash = (k: string, i = 0) => {
  let h = 2166136261 ^ i;
  for (let c = 0; c < k.length; c++) h = Math.imul(h ^ k.charCodeAt(c), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};

function drawMap() {
  const cv = app.querySelector<HTMLCanvasElement>('#map');
  if (!cv || !g) return;
  const s = g.valley;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const c = colours();
  const y0 = s.flags.upper ? 120 : 330;
  const y1 = 790;
  const sc = Math.min(w / (WORLD.x1 - WORLD.x0), h / (y1 - y0));
  const ox = (w - (WORLD.x1 - WORLD.x0) * sc) / 2 - WORLD.x0 * sc;
  const oy = (h - (y1 - y0) * sc) / 2 - y0 * sc;
  view = { sc, ox, oy, y0 };
  const X = (x: number) => x * sc + ox;
  const Y = (y: number) => y * sc + oy;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = c.paper ?? '#f3ecdd';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The stream.
  ctx.strokeStyle = c.sky ?? '#3d5a73';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(690), Y(100));
  ctx.bezierCurveTo(X(640), Y(260), X(640), Y(360), X(612), Y(420));
  ctx.bezierCurveTo(X(585), Y(480), X(575), Y(600), X(545), Y(800));
  ctx.stroke();
  // Lanes to the konak.
  ctx.strokeStyle = c['ink-soft'] ?? '#6e665a';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (const hh of s.households) {
    if (hh.hamlet !== 'lower') continue;
    ctx.beginPath();
    ctx.moveTo(X(hh.x), Y(hh.y));
    ctx.quadraticCurveTo(X((hh.x + 600) / 2), Y((hh.y + 545) / 2 + 12), X(600), Y(545));
    ctx.stroke();
  }
  if (s.flags.upper) {
    ctx.beginPath();
    ctx.moveTo(X(600), Y(540));
    ctx.bezierCurveTo(X(560), Y(470), X(500), Y(420), X(520), Y(320));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(X(600), Y(550));
  ctx.lineTo(X(520), Y(780));
  ctx.stroke();
  ctx.setLineDash([]);
  // Fields: standing barley as upright strokes, sheaves as stooks, a sown field as green rows.
  const season = seasonOf(doyOf(dayOfMinute(s.minute)));
  const today = dayOfMinute(s.minute);
  const laid = [0, 1, 2, 3, 4, 5, 6].some(
    (k) => today - k >= 0 && weatherOf(s.seed, today - k).sky === 'storm',
  );
  const field = (
    key: string,
    fx: number,
    fy: number,
    size: number,
    standing: number,
    reaped: number,
    sown: number,
    under: boolean,
  ) => {
    const r = Math.sqrt(size) * 3.1;
    ctx.strokeStyle = under ? (c['ink-soft'] ?? '#666') : (c['paper-2'] ?? '#ddd');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      const rr = r * (0.85 + 0.25 * hash(key, k));
      const px = X(fx + Math.cos(a) * rr * 1.25);
      const py = Y(fy + Math.sin(a) * rr * 0.75);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    const n = Math.round((standing / Math.max(1, size)) * 22);
    ctx.strokeStyle = growing(season) ? (c.moss ?? '#4f6b3a') : (c.ink ?? '#222');
    ctx.lineWidth = 1.1;
    for (let k = 0; k < n; k++) {
      const px = fx + (hash(key, 100 + k) - 0.5) * r * 2;
      const py = fy + (hash(key, 200 + k) - 0.5) * r * 1.1;
      ctx.beginPath();
      ctx.moveTo(X(px), Y(py));
      // After a storm the standing barley lies over, all one way, until it is cut.
      if (laid) ctx.lineTo(X(px + 6), Y(py - 2));
      else ctx.lineTo(X(px + 1), Y(py - 7));
      ctx.stroke();
    }
    const st = Math.min(12, Math.round((reaped / Math.max(1, size)) * 12));
    ctx.strokeStyle = c.ink ?? '#222';
    for (let k = 0; k < st; k++) {
      const px = fx + (hash(key, 300 + k) - 0.5) * r * 1.8;
      const py = fy + (hash(key, 400 + k) - 0.5) * r;
      ctx.beginPath();
      ctx.moveTo(X(px - 3), Y(py + 3));
      ctx.lineTo(X(px), Y(py - 4));
      ctx.lineTo(X(px + 3), Y(py + 3));
      ctx.stroke();
    }
    if (n === 0 && sown > 0.05 && (season === 'sowing' || season === 'winter')) {
      ctx.strokeStyle = c.moss ?? '#4f6b3a';
      ctx.setLineDash([2, 4]);
      const rows = Math.max(1, Math.round(sown * 4));
      for (let k = 0; k < rows; k++) {
        const py = fy - r * 0.4 + k * r * 0.25;
        ctx.beginPath();
        ctx.moveTo(X(fx - r * 0.9), Y(py));
        ctx.lineTo(X(fx + r * 0.9), Y(py));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  };
  for (const hh of s.households) {
    field(
      hh.id,
      hh.fx,
      hh.fy,
      hh.field.size,
      hh.field.standing,
      hh.field.reaped,
      hh.field.sown,
      underSeal(s, hh),
    );
  }
  field('agha', 735, 470, 360, s.agha.standing, s.agha.reaped, 1, true);
  if (window.innerWidth >= 900)
    label(ctx, 'the landowner’s field', X(735), Y(470) + 52 * sc, c['ink-soft'] ?? '#666', 11);
  // Konak, granary, mill, coffeehouse, spring.
  ctx.strokeStyle = c.ink ?? '#222';
  ctx.lineWidth = 1.5;
  house(ctx, X(600), Y(545), 1.5);
  if (window.innerWidth >= 900) label(ctx, 'konak', X(600) - 34, Y(545) + 2, c['ink-soft'] ?? '#666', 11);
  ctx.strokeRect(X(630) - 5, Y(568) - 5, 10, 10);
  if (s.agha.millOpen) {
    const done = Math.min(1, s.agha.mill / 600);
    ctx.beginPath();
    ctx.arc(X(612), Y(420), 7, Math.PI, Math.PI + Math.PI * 2 * Math.max(0.08, done));
    ctx.stroke();
    label(
      ctx,
      done >= 1 ? 'mill' : 'the mill, rising',
      X(612) + 10,
      Y(420) - 8,
      c['ink-soft'] ?? '#666',
      11,
      'left',
    );
  }
  ctx.beginPath();
  ctx.arc(X(452), Y(508) - 2, 5, Math.PI, 0);
  ctx.lineTo(X(452) + 5, Y(508) + 4);
  ctx.lineTo(X(452) - 5, Y(508) + 4);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = c.sky ?? '#3d5a73';
  ctx.beginPath();
  ctx.arc(X(548), Y(520), 4, 0, Math.PI * 2);
  ctx.stroke();
  // Houses.
  const knocking = new Set(
    s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute).map((k) => k.house),
  );
  for (const hh of s.households) {
    const under = underSeal(s, hh);
    if (hh.hamlet === 'upper' && !s.flags.upper) continue;
    const empty = hh.members.length === 0;
    ctx.strokeStyle = empty
      ? (c['paper-2'] ?? '#ccc')
      : under
        ? (c.ink ?? '#222')
        : (c['ink-soft'] ?? '#666');
    ctx.lineWidth = 1.4;
    house(ctx, X(hh.x), Y(hh.y), 1);
    if (w >= 900 || window.innerWidth >= 900)
      label(ctx, hh.short, X(hh.x), Y(hh.y) + 15, c.sky ?? '#3d5a73', 12);
    ctx.strokeStyle = c.sky ?? '#3d5a73';
    ctx.lineWidth = 1;
    const halfLabel = ctx.measureText(hh.short).width / 2;
    ctx.beginPath();
    ctx.moveTo(X(hh.x) - halfLabel, Y(hh.y) + 23);
    ctx.lineTo(X(hh.x) + halfLabel, Y(hh.y) + 23);
    ctx.stroke();
    // The matching native buttons expose every house without guessing at map symbols.
    const control = app.querySelector<HTMLButtonElement>(`#houses button[data-h="${hh.id}"]`);
    if (control) {
      control.classList.toggle('selected', selected === hh.id);
      control.setAttribute('aria-pressed', String(selected === hh.id));
    }
    if (knocking.has(hh.id)) {
      ctx.fillStyle = c.rope ?? '#c2412d';
      ctx.beginPath();
      ctx.arc(X(hh.x) + 9, Y(hh.y) - 9, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selected === hh.id) {
      ctx.strokeStyle = c.rope ?? '#c2412d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(X(hh.x), Y(hh.y) + 3, 18, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // People who are out and about today: one ink dot each where they are.
  ctx.fillStyle = c.ink ?? '#222';
  for (const id of s.full) {
    const p = personOf(s, id);
    const place = p?.activity?.affordance?.placeId;
    if (!p || !place || !p.body.alive) continue;
    let pos: [number, number] | undefined = PLACES[place];
    if (place.startsWith('field:') && !pos) {
      const hh = houseOf(s, place.slice(6));
      if (hh) pos = [hh.fx, hh.fy];
    }
    if (!pos) continue;
    const spread = place === 'field:agha' ? 34 : 12;
    const px = pos[0] + (hash(id, 1) - 0.5) * spread * 2;
    const py = pos[1] + (hash(id, 2) - 0.5) * spread;
    ctx.beginPath();
    ctx.arc(X(px), Y(py), 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // The kahya, in rope, at the konak or on the lanes.
  const k = kahyaAt(s);
  ctx.fillStyle = c.rope ?? '#c2412d';
  ctx.beginPath();
  ctx.arc(X(k[0]), Y(k[1]) - 4, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(X(k[0]) - 1.2, Y(k[1]) - 1, 2.4, 7);
  // Weather and night.
  const wx = weatherOf(s.seed, dayOfMinute(s.minute)).sky;
  if (wx === 'rain' || wx === 'storm' || wx === 'snow') {
    ctx.strokeStyle = wx === 'snow' ? (c['ink-soft'] ?? '#666') : (c.sky ?? '#3d5a73');
    ctx.lineWidth = 1;
    const n = wx === 'storm' ? 70 : 35;
    const tt = (s.minute / QUANTUM) % 7;
    for (let i = 0; i < n; i++) {
      const px = hash('r', i + tt * 13) * w;
      const py = hash('q', i + tt * 7) * h;
      ctx.beginPath();
      ctx.moveTo(px, py);
      if (wx === 'snow') ctx.arc(px, py, 1, 0, Math.PI * 2);
      else ctx.lineTo(px - 4, py + 10);
      ctx.stroke();
    }
  }
  if (partOfDay(s.minute) === 'night') {
    ctx.fillStyle = 'rgba(20, 24, 40, 0.18)';
    ctx.fillRect(0, 0, w, h);
  }
  const cap = app.querySelector('#cap');
  if (cap) cap.textContent = caption(s, wx);
}

const growing = (season: string) => season === 'spring' || season === 'summer';

function caption(s: ValleyState, wx: string): string {
  const sky: Record<string, string> = {
    clear: 'Clear',
    cloud: 'Cloud over the ridge',
    rain: 'Rain',
    storm: 'A storm',
    snow: 'Snow',
    frost: 'Frost',
  };
  const v = s.kahyaState.visit;
  const where =
    v && v.back > s.minute
      ? s.minute < v.arrive
        ? `you are walking to ${houseOf(s, v.house)?.name ?? ''}`
        : s.minute < v.leave
          ? `you are at ${houseOf(s, v.house)?.name ?? ''}`
          : 'you are walking back'
      : '';
  const day = dayOfMinute(s.minute);
  return `${dateWords(day)}, year ${yearWord(yearOf(day))}. ${sky[wx] ?? wx}, ${partOfDay(s.minute)}${where ? `; ${where}` : ''}.`;
}

function kahyaAt(s: ValleyState): [number, number] {
  const v = s.kahyaState.visit;
  const home: [number, number] = [600, 545];
  if (!v || v.back <= s.minute) return home;
  const hh = houseOf(s, v.house);
  if (!hh) return home;
  const there: [number, number] = [hh.x + 8, hh.y + 6];
  const lerp = (a: [number, number], b: [number, number], f: number): [number, number] => [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
  ];
  // The walk back takes as long as the walk there.
  const out = v.back - v.leave;
  if (s.minute < v.arrive) return lerp(home, there, 1 - (v.arrive - s.minute) / Math.max(1, out));
  if (s.minute < v.leave) return there;
  return lerp(there, home, (s.minute - v.leave) / Math.max(1, out));
}

function house(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.beginPath();
  ctx.moveTo(x - 6 * k, y + 5 * k);
  ctx.lineTo(x - 6 * k, y - 2 * k);
  ctx.lineTo(x, y - 7 * k);
  ctx.lineTo(x + 6 * k, y - 2 * k);
  ctx.lineTo(x + 6 * k, y + 5 * k);
  ctx.closePath();
  ctx.stroke();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  col: string,
  px: number,
  align: CanvasTextAlign = 'center',
) {
  ctx.fillStyle = col;
  ctx.font = `${px}px Literata, Georgia, serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(englishText(text), x, y);
}

function tapMap(cv: HTMLCanvasElement, e: MouseEvent) {
  if (!g) return;
  const s = g.valley;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  let best: Household | null = null;
  let bd = 22;
  for (const hh of s.households) {
    if (hh.hamlet === 'upper' && !s.flags.upper) continue;
    const d = Math.hypot(hh.x * view.sc + view.ox - x, hh.y * view.sc + view.oy - y);
    if (d < bd) {
      bd = d;
      best = hh;
    }
  }
  pick(best?.id ?? null);
}

/** Select a house (or none): the map tap and the accessible house list both land here. */
function pick(id: string | null) {
  selected = id && selected !== id ? id : null;
  houseAction = '';
  houseDetails = false;
  hunchCache = null;
  drawSheet(true);
  drawMap();
}

function closeHouse() {
  const origin = selected;
  selected = null;
  drawSheet(true);
  drawMap();
  app.querySelector<HTMLButtonElement>(`#houses button[data-h="${origin}"]`)?.focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) closeHouse();
});

/** The houses as buttons for screen readers and keyboards, kept in step with the map. */
function drawHouses(s: ValleyState) {
  const nav = app.querySelector('#houses');
  if (!nav) return;
  const list = s.households.filter((h) => h.hamlet === 'lower' || s.flags.upper);
  app
    .querySelector<HTMLElement>('.play')
    ?.style.setProperty('--house-map-height', `${Math.ceil(list.length / 4) * 48 + 8}px`);
  const key = list.map((h) => h.id).join(',');
  for (const b of nav.querySelectorAll<HTMLButtonElement>('button[data-h]')) {
    b.classList.toggle('selected', b.dataset.h === selected);
    b.setAttribute('aria-pressed', String(b.dataset.h === selected));
  }
  if (nav.getAttribute('data-key') === key) return;
  nav.setAttribute('data-key', key);
  nav.innerHTML =
    '<span class="house-prompt">Choose a house</span>' +
    list
      .map(
        (h) =>
          `<button data-h="${h.id}" aria-label="${esc(h.name)}"><span class="house-icon" aria-hidden="true">⌂</span>${esc(h.short)}</button>`,
      )
      .join('') +
    '<button class="house-list-toggle" data-house-list>Choose a house</button>';
}

// ---------- the sheet: knocks, the house card, the notebook, the ledger ----------

function onSheetClick(e: Event) {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-k]');
  if (!b || b.disabled || b.classList.contains('hold')) return;
  actions[Number(b.dataset.k)]?.();
}

function btn(
  text: string,
  fn: () => void,
  opts: { cls?: string; hold?: boolean; hint?: string; disabled?: boolean } = {},
) {
  const k = actions.length;
  actions.push(fn);
  const cls = [opts.cls ?? '', opts.hold ? 'hold' : ''].join(' ').trim();
  return `<button data-k="${k}"${cls ? ` class="${cls}"` : ''}${opts.disabled ? ' disabled' : ''}>${esc(text)}${opts.hint ? `<span class="h">${esc(opts.hint)}</span>` : ''}${opts.hold ? '<span class="fill"></span>' : ''}</button>`;
}

function drawSheet(force = false) {
  if (!g) return;
  const s = g.valley;
  // Field progress can change without a new note; update the strip without replacing controls.
  const progress = app.querySelector('#next');
  const progressWords = englishText(nextWords(s));
  if (progress && progress.textContent !== progressWords) progress.textContent = progressWords;
  if (!force && app.querySelector('button.holding')) return;
  const key = `${s.notes.at(-1)?.id ?? 0}|${s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute).length}|${selected}|${tab}|${s.asks.length}|${busy(s)}|${dayOfMinute(s.minute)}|${[...openDays].join(',')}|${historyOpen}|${jobInSeason(s)}|${s.agha.granary >= s.agha.due}|${s.flags.verbs.join(',')}|${loanReturnWords(s)}|${s.agha.granary >= 2}|${s.asks
    .filter((a) => !a.closed && a.until > s.minute)
    .map((a) => a.id)
    .join(',')}`;
  if (!force && key === sheetKey) return;
  sheetKey = key;
  lastSheet = performance.now();
  actions = [];
  const sheet = app.querySelector('#sheet') as HTMLElement | null;
  const thumbs = app.querySelector('#thumbs') as HTMLElement | null;
  if (!sheet || !thumbs) return;
  const top = sheet.scrollTop;
  const knocks = s.knocks
    .filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute)
    .map((k) => knockCard(s, k));
  const hh = selected ? houseOf(s, selected) : undefined;
  app.querySelector('.play')?.setAttribute('data-house', String(!!hh));
  const body = hh
    ? houseCard(s, hh)
    : tab === 'ledger'
      ? ledger(s)
      : tab === 'charge'
        ? charge(s)
        : notebook(s);
  sheet.innerHTML =
    (tab === 'charge' || hh ? '' : knocks.join('')) +
    body +
    (!hh ? `<p class="limits">${esc(limitsWords(s))}</p>` : '');
  const header = app.querySelector<HTMLElement>('#sheet-head');
  if (header) {
    header.hidden = !hh;
    header.innerHTML = hh
      ? `<b>${esc(hh.name)}</b><button class="house-about">${houseDetails ? 'Reply' : 'About'}</button><button class="house-close" title="${esc(returnLabel())}">Close</button>`
      : '';
  }
  const answer = app.querySelector<HTMLElement>('#house-answer');
  if (answer) {
    answer.replaceChildren();
    const response = !houseDetails && hh ? sheet.querySelector('.house-response') : null;
    answer.hidden = !response;
    if (response) answer.append(response);
  }
  app.querySelector('.lk-sheet')?.setAttribute('aria-label', hh ? hh.name : 'Valley notebook');
  const now = app.querySelector('#now');
  const next = app.querySelector('#next');
  if (now) now.textContent = englishText(nowWords(s));
  if (next) next.textContent = englishText(nextWords(s));
  for (const detail of sheet.querySelectorAll<HTMLDetailsElement>('.pending-replies')) {
    detail.addEventListener('toggle', () => {
      repliesOpen = detail.open;
    });
  }
  drawHouses(s);
  thumbs.innerHTML = hh
    ? houseThumbs(s, hh)
    : tab === 'charge'
      ? btn(
          'Back to the notebook',
          () => {
            tab = 'notes';
            drawSheet(true);
          },
          { cls: 'wide' },
        )
      : valleyThumbs(s);
  for (const b of app.querySelectorAll<HTMLButtonElement>('button.hold[data-k]')) {
    const fn = actions[Number(b.dataset.k)];
    if (fn) bindHold(b, fn);
  }
  const chooser = app.querySelector<HTMLSelectElement>('#house-action');
  chooser?.addEventListener('change', () => {
    houseAction = chooser.value;
    drawSheet(true);
    app.querySelector<HTMLSelectElement>('#house-action')?.focus({ preventScroll: true });
  });
  app.querySelector<HTMLSelectElement>('#valley-action')?.addEventListener('change', (e) => {
    valleyAction = (e.target as HTMLSelectElement).value;
    drawSheet(true);
    app.querySelector<HTMLSelectElement>('#valley-action')?.focus({ preventScroll: true });
  });
  app.querySelector('.lk-sheet')?.setAttribute('data-details', String(houseDetails && !!hh));
  if (!force) sheet.scrollTop = top;
  stage?.refresh();
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function knockCard(s: ValleyState, k: Knock): string {
  const p = personOf(s, k.personId);
  const hh = houseOf(s, k.house);
  const who = `${p?.name ?? 'Someone'} of ${hh?.name ?? 'a house'}`;
  const ask =
    k.what === 'grain'
      ? `${who} is at your door.`
      : k.what === 'birth'
        ? `Word from ${hh?.name}: a child.`
        : k.what === 'death'
          ? `Word from ${hh?.name}: a death.`
          : `${cap(hh?.name ?? 'A house')} asks you to the wedding.`;
  const can = s.flags.verbs.includes('give') || k.what === 'grain';
  const row =
    k.what === 'grain'
      ? [
          btn('Give from the granary', () => order({ verb: 'give', house: k.house, kile: 6 }), {
            hint: giftHint(s),
            disabled: !can || s.agha.granary < 2,
          }),
          btn('Send them away', () => order({ verb: 'turn-away', knock: k.id })),
        ]
      : [
          btn(
            k.what === 'death' ? 'Go and sit with them' : 'Go',
            () => order({ verb: 'visit', house: k.house, why: k.what }),
            {
              disabled: busy(s),
              hint: busy(s) ? visitHint(s) : 'walking and sitting take time away from the residence',
            },
          ),
          btn('Send your regrets', () => order({ verb: 'turn-away', knock: k.id })),
        ];
  return `<div class="knock ink-in"><div>${esc(ask)}<span class="w hand" style="display:block">“${esc(k.words)}”</span></div><div class="row">${row.join('')}</div></div>`;
}

const busy = (s: ValleyState) => !!s.kahyaState.visit && s.kahyaState.visit.back > s.minute;

/** People who already have a Press button on screen: one per person, on their latest line. */
const pressShown = new Set<string>();

function charge(s: ValleyState): string {
  return `<article class="charge card"><h2>Your charge</h2><p class="purpose">${esc(PURPOSE)}</p>
    <details class="office-terms"><summary>Words used in the valley</summary><dl><dt>kahya</dt><dd>steward: your office in the valley.</dd><dt>agha</dt><dd>landowner: the absent owner whose due you collect.</dd><dt>kile</dt><dd>grain measure: the unit counted in the landowner’s ledger.</dd></dl></details>
    <h3>The work ahead</h3><p>${esc(nextWords(s))}</p>
    <h3>Ask, listen, decide</h3><p>Call a household to work or bring its share. People weigh your request against their own fields and promises. They can refuse.</p>
    <p>Choose a house to read its replies and visit. Walking takes time; you can visit again when you return. A visit makes your knowledge of their jars less uncertain.</p>
    <p>Give grain to help a house through hunger. It comes from the landowner’s due. Ease a share to leave more with a house, or press a refusal and be remembered for it.</p>
    <p class="soft">The clock keeps moving. Slow, steady, and fast change how quickly the days pass. New work opens with the crop and the valley’s needs.</p>
    <p class="soft">Your place is kept as you play. “Pause and return to the cover” stops time and keeps your place. Open the ledger to resume.</p></article>`;
}

/** Keep still-actionable refusals visible even when their dated note is archived. */
function pendingReplies(s: ValleyState, house?: Household): string {
  if (!s.flags.verbs.includes('insist')) return '';
  const controls: string[] = [];
  for (const ask of [...s.asks].reverse()) {
    if (
      ask.closed ||
      ask.until <= s.minute ||
      ask.from > s.minute ||
      (house && !ask.houses.includes(house.id))
    )
      continue;
    for (const [id, reply] of Object.entries(ask.replies)) {
      if (
        (house && !house.members.includes(id)) ||
        pressShown.has(id) ||
        ask.insisted.includes(id) ||
        !['deferred', 'refused', 'modified'].includes(reply.verdict)
      )
        continue;
      pressShown.add(id);
      const household = s.households.find((h) => h.members.includes(id));
      const complete =
        ask.job === 'reap-agha'
          ? s.agha.standing <= 5
          : ask.job === 'build-mill'
            ? s.agha.mill >= V.millHours
            : !household ||
              household.paid >= shareOwed(household) - 0.5 ||
              dayOfMinute(s.minute) >= s.agha.dueDay;
      controls.push(
        btn(
          `Hold to press ${personOf(s, id)?.name ?? 'them'}`,
          () => order({ verb: 'insist', ask: ask.id, pid: id }),
          {
            hold: true,
            disabled: complete,
            hint: complete
              ? (callUnavailable(s, ask.job, household) ??
                'This work is complete; no further insistence is needed.')
              : reply.says,
          },
        ),
      );
    }
  }
  return controls.length
    ? `<details class="pending-replies"${repliesOpen ? ' open' : ''}><summary>Read replies to the current call</summary><p class="soft">Hold to insist. They will come, and remember being pushed.</p><div class="presses">${controls.join('')}</div></details>`
    : '';
}

function notebook(s: ValleyState): string {
  pressShown.clear();
  const pending = pendingReplies(s);
  const today = dayOfMinute(s.minute);
  const notes = s.notes.filter((n) => n.at <= s.minute + QUANTUM && dayOfMinute(n.at) >= today - 20);
  // Current replies and important news lead. Historical dialogue stays in the book.
  const recent = notes
    .filter((n) => dayOfMinute(n.at) === today)
    .sort((a, b) => b.weight - a.weight || b.at - a.at);
  const lead = recent.slice(0, 2).sort((a, b) => b.at - a.at);
  const kept = new Set(lead.map((n) => n.id));
  const earlier = notes.filter((n) => !kept.has(n.id));
  const showHistory = earlier.length
    ? btn(
        historyOpen ? 'Close more notes' : 'Read more notes',
        () => {
          historyOpen = !historyOpen;
          drawSheet(true);
        },
        { cls: 'more' },
      )
    : '';
  let archive = '';
  if (historyOpen) {
    const days = [...new Set(earlier.map((n) => dayOfMinute(n.at)))].sort((a, b) => b - a);
    archive = `<div class="archive">${days
      .map((d) => {
        const list = earlier.filter((n) => dayOfMinute(n.at) === d).sort((a, b) => b.at - a.at);
        const shown = openDays.has(d) ? list : list.slice(0, 2);
        const more =
          shown.length < list.length
            ? btn(
                'Read the rest of this day',
                () => {
                  openDays.add(d);
                  drawSheet(true);
                },
                { cls: 'more' },
              )
            : '';
        return `<div class="day"><h3>${esc(dateWords(d))}</h3>${shown.map((n) => noteLine(n)).join('')}${more}</div>`;
      })
      .join('')}</div>`;
  }
  return `<section class="current-notes"><h2 class="section-label">${recent.length ? 'Today’s word' : 'The notebook'}</h2>${lead.length ? lead.map((n) => noteLine(n)).join('') : '<p class="soft">No new word today. Choose a house to visit, or let the days pass.</p>'}</section>${pending}${showHistory}${archive}`;
}

function noteLine(n: Note): string {
  return `<div class="note${n.weight < 2 ? ' quiet' : ''}"><span class="t">${esc(partOfDay(n.at))}</span>${esc(n.text)}${n.words && !n.text.toLowerCase().includes(n.words.toLowerCase()) ? `<span class="w">“${esc(n.words)}”</span>` : ''}</div>`;
}

function datedReply(s: ValleyState, n: Note): string {
  const earlier = dayOfMinute(n.at) < dayOfMinute(s.minute) ? 'Earlier word · ' : '';
  const speaker = n.kind === 'voice' && n.who ? personOf(s, n.who)?.name : undefined;
  const date = `${earlier}${speaker ? `${speaker} · ` : ''}${fullDateEnglish(dayOfMinute(n.at))}`;
  // The house header identifies the household; keep the person's complete words immediately below their name.
  const words =
    speaker && n.words ? `<div class="note"><span class="w">“${esc(n.words)}”</span></div>` : noteLine(n);
  return `<div class="reply-date soft">${esc(date)}</div>${words}`;
}

function knownFood(s: ValleyState, hh: Household): string {
  const guess = s.kahyaState.guess?.[hh.id];
  if (!guess) return 'Food: you haven’t seen their jars yet.';
  const ago = dayOfMinute(s.minute) - dayOfMinute(guess.at);
  return `${breadWords(guess.bread)}${ago > 2 ? ` Seen ${ago} days ago.` : ''}`;
}

/** One live refusal beside its consequence and hold control; other replies remain in the notebook. */
function selectedRefusal(s: ValleyState, hh: Household): string {
  if (!s.flags.verbs.includes('insist')) return '';
  const candidates = s.asks
    .flatMap((ask) => {
      const complete =
        ask.job === 'reap-agha'
          ? s.agha.standing <= 5
          : ask.job === 'build-mill'
            ? s.agha.mill >= V.millHours
            : hh.paid >= shareOwed(hh) - 0.5 || dayOfMinute(s.minute) >= s.agha.dueDay;
      if (
        ask.closed ||
        ask.from > s.minute ||
        ask.until <= s.minute ||
        complete ||
        !ask.houses.includes(hh.id)
      )
        return [];
      return Object.entries(ask.replies)
        .filter(
          ([id, reply]) =>
            hh.members.includes(id) &&
            !ask.insisted.includes(id) &&
            ['deferred', 'refused', 'modified'].includes(reply.verdict),
        )
        .map(([id, reply]) => ({ ask, id, reply }));
    })
    .sort((a, b) => b.reply.at - a.reply.at);
  const choice = candidates[0];
  if (!choice) return '';
  const { ask, id, reply } = choice;
  return `<div class="decision-reply"><p class="reply-date soft">${esc(fullDateEnglish(dayOfMinute(reply.at)))}</p>
    <p>${esc(personOf(s, id)?.name ?? 'They')}: “${esc(reply.says)}”</p>
    ${btn(
      `Hold to press ${personOf(s, id)?.name ?? 'them'}`,
      () => order({ verb: 'insist', ask: ask.id, pid: id }),
      { hold: true, hint: 'They will come, and remember being pushed.' },
    )}</div>`;
}

const BREAD: [number, string][] = [
  [200, 'Their jars are full.'],
  [80, 'They have enough to the spring, you think.'],
  [25, 'Their jars looked low.'],
  [0, 'They are scraping the jar.'],
];

function breadWords(days: number) {
  return (BREAD.find(([d]) => days >= d) ?? BREAD[3])?.[1] ?? '';
}

const VERDICT: Record<string, string> = {
  assented: 'would come',
  complied: 'would come if pressed',
  deferred: 'would put it off',
  modified: 'would do part of it',
  refused: 'would say no',
};
const REASON: [RegExp, string][] = [
  [/^material/, 'their own barley first'],
  [/^commitment/, 'something already promised'],
  [/^distrust/, 'they don’t trust your office'],
  [/^capacity/, 'not up to it'],
  [/^norm/, 'it sits wrong with them'],
  [/^habit/, 'their usual day'],
];

function hunchLine(hc: Hunch | undefined, who: string): string {
  if (!hc) return '';
  const sure =
    hc.confidence < 0.15 ? 'You can’t tell yet' : hc.confidence < 0.45 ? 'You think' : 'You are fairly sure';
  if (hc.confidence < 0.15) return `${sure} how ${who} would answer.`;
  const why = hc.verdict === 'assented' ? '' : (REASON.find(([re]) => re.test(hc.reason))?.[1] ?? '');
  return `${sure} ${who} ${VERDICT[hc.verdict] ?? 'would answer'}${why ? `: ${why}` : ''}.`;
}

function jobInSeason(s: ValleyState): Job | null {
  return currentJob(s) ?? null;
}

function houseCard(s: ValleyState, hh: Household): string {
  pressShown.clear();
  const pending = pendingReplies(s, hh);
  const people = hh.members.map((m) => personOf(s, m)).filter((p) => !!p);
  const names = people.map((p) => p?.name ?? '').join(', ');
  const job = jobInSeason(s);
  const guess = s.kahyaState.guess?.[hh.id];
  const lines: string[] = [];
  if (!guess) lines.push(`You haven’t been inside ${hh.name} yet.`);
  else {
    const ago = dayOfMinute(s.minute) - dayOfMinute(guess.at);
    lines.push(
      `${breadWords(guess.bread)}${ago > 2 ? ` That was ${ago > 40 ? 'a long while' : `${ago} days`} ago.` : ''}`,
    );
  }
  const head = people[0];
  let reeve = '';
  if (head && job) {
    const ck = `${hh.id}|${dayOfMinute(s.minute)}|${job}|${s.asks.length}`;
    if (hunchCache?.key !== ck) {
      const mine = hunchLine(hunchOf(s, s.kahya, head, job), head.name);
      const osman = personOf(s, 'osman');
      const his =
        osman && s.flags.beats.includes('reeve') && hh.hamlet === 'lower' && head.id !== 'osman'
          ? hunchLine(hunchOf(s, osman, head, job), head.name)
              .replace(/^You can’t tell yet/, 'He can’t say')
              .replace(/^You think/, 'He thinks')
              .replace(/^You are fairly sure/, 'He is sure')
          : '';
      hunchCache = { key: ck, lines: [mine, his] };
    }
    lines.push(hunchCache.lines[0] ?? '');
    reeve = hunchCache.lines[1] ?? '';
  }
  const recent = s.notes
    .filter((n) => n.house === hh.id || (n.who && hh.members.includes(n.who)))
    .slice(-4)
    .reverse();
  // The kahya's own book: what he last did to this house, in his words (he knows his acts, not their feelings).
  const acts = s.kahyaState.acts?.[hh.id] ?? [];
  const today = dayOfMinute(s.minute);
  const when = (d: number) =>
    today - d < 1
      ? 'today'
      : today - d < 2
        ? 'yesterday'
        : today - d < 30
          ? `${today - d} days ago`
          : dateWords(d);
  const book = acts.length
    ? `<p class="soft" style="font-size:15px">Your book: ${esc(
        acts
          .slice(-2)
          .reverse()
          .map((a) => `you ${a.what} (${when(a.day)})`)
          .join('; '),
      )}.</p>`
    : '';
  const share =
    s.flags.verbs.includes('take') && underSeal(s, hh) && hh.members.length
      ? `<p class="soft" style="font-size:15px">The landowner’s book: their share is ${shareOwed(hh)} grain measures${hh.eased ? ' (eased)' : ''}; ${hh.paid >= shareOwed(hh) - 0.5 ? 'paid' : hh.paid > 0 ? 'part paid' : 'not yet paid'}.</p>`
      : '';
  const response = recent.find((n) => n.words && (n.kind === 'voice' || n.ask));
  if (!houseDetails)
    return `<div class="card">${response ? `<div class="house-response">${datedReply(s, response)}</div>` : ''}</div>`;
  return `<div class="card">
    ${response ? `<div class="house-response">${datedReply(s, response)}</div>` : ''}
    <div class="house-context"><p class="limits">${esc(limitsWords(s, hh))}</p>
    <div class="looks">${esc(hh.members.length ? hh.looks : 'The door is shut and the hearth is cold.')}</div>
    <div class="people">${hh.members.length ? esc(names) : 'Nobody lives here now.'}</div>
    ${lines
      .filter(Boolean)
      .map((l) => `<div class="hunch">${esc(l)}<span class="by">your guess</span></div>`)
      .join('')}
    ${reeve ? `<div class="hunch reeve">${esc(reeve)}<span class="by">Osman’s guess</span></div>` : ''}
    ${share}${book}</div>
    ${pending}
    ${recent.length ? `<details class="house-history"><summary>Earlier word from this house</summary>${recent.map((n) => noteLine(n)).join('')}</details>` : ''}
  </div>`;
}

const JOB_LABEL: Record<Job, string> = {
  'reap-agha': 'to the landowner’s barley',
  'bring-share': 'to bring the share',
  'build-mill': 'to the mill',
};

function returnLabel(): string {
  return tab === 'ledger'
    ? 'Back to the landowner’s ledger'
    : tab === 'charge'
      ? 'Back to your charge'
      : 'Back to the notebook';
}

function knownJobs(s: ValleyState): Job[] {
  const jobs: Job[] = ['reap-agha', 'bring-share', 'build-mill'];
  const current = currentJob(s);
  return current ? [current, ...jobs.filter((j) => j !== current)] : jobs;
}

function giftHint(s: ValleyState): string {
  return s.agha.granary < 2
    ? 'The granary is too low. Giving returns when threshing, shares, or a loan bring grain in.'
    : 'a small sack from the granary; leaves less grain for the due';
}

function visitHint(s: ValleyState): string {
  return busy(s) && s.kahyaState.visit
    ? `You can visit again when you return to the residence on ${fullDateEnglish(dayOfMinute(s.kahyaState.visit.back))}.`
    : 'Visits open when a household puts off your call; send word through the crier first.';
}

function houseThumbs(s: ValleyState, hh: Household): string {
  const out: string[] = [];
  const food = knownFood(s, hh);
  const shareStatus = `Their share: ${Math.round(hh.paid)} of ${shareOwed(hh)} grain measures paid${hh.eased ? ' (eased)' : ''}. `;
  const under = underSeal(s, hh);
  const empty = !hh.members.length;
  const renewal = cropReturnWords(s);
  for (const job of knownJobs(s)) {
    const reason = callUnavailable(s, job, hh);
    out.push(
      btn(
        `Call them ${JOB_LABEL[job]}`,
        () =>
          order({
            verb: 'call',
            job,
            houses: [hh.id],
            wage: job === 'reap-agha' && yearOf(dayOfMinute(s.minute)) > 1,
          }),
        {
          disabled: !!reason,
          hint:
            reason ??
            (job === 'reap-agha' && yearOf(dayOfMinute(s.minute)) > 1
              ? 'paid work: a small share of the cut grain goes to their jars'
              : 'the crier carries your request; they can refuse'),
        },
      ),
    );
  }
  const visiting = !empty && s.flags.verbs.includes('visit') && !busy(s);
  out.push(
    btn(
      busy(s) ? 'You are out on the lanes' : 'Walk down and sit with them',
      () => order({ verb: 'visit', house: hh.id }),
      {
        disabled: !visiting,
        hint: empty
          ? 'Nobody lives here. Visits return if the house is lived in again.'
          : visiting
            ? hh.hamlet === 'upper'
              ? 'most of a morning away from the residence'
              : 'a couple of hours away from the residence'
            : visitHint(s),
      },
    ),
  );
  const unpaid = hh.paid < shareOwed(hh) - 0.5;
  const blocked = empty
    ? 'Nobody lives here; this needs a household.'
    : !under
      ? 'This hamlet comes under your seal on 10 June, year two.'
      : !unpaid
        ? `Their share is paid. ${renewal}`
        : null;
  if (s.flags.verbs.includes('ease'))
    out.push(
      btn('Ease their share', () => order({ verb: 'ease', house: hh.id }), {
        disabled: !!blocked || hh.eased,
        hint:
          shareStatus +
          (blocked ??
            (hh.eased
              ? `Already eased. ${renewal}`
              : 'leave half of this year’s share in their jars; the lanes will see')),
      }),
    );
  if (s.flags.verbs.includes('seize'))
    out.push(
      btn('Hold to send the reeve’s men', () => order({ verb: 'seize', house: hh.id }), {
        hold: true,
        disabled: !!blocked,
        hint:
          shareStatus + (blocked ?? 'they take the share from the jars; the lane will remember the force'),
      }),
    );
  out.push(
    btn('Send them grain', () => order({ verb: 'give', house: hh.id, kile: 6 }), {
      disabled: empty || !s.flags.verbs.includes('give') || s.agha.granary < 2,
      hint:
        food +
        ' ' +
        (empty
          ? 'Nobody lives here; giving returns if the house is lived in again.'
          : !s.flags.verbs.includes('give')
            ? 'Giving opens when a household is short of food or asks at your door.'
            : giftHint(s)),
    }),
  );
  const current = currentJob(s);
  const direct =
    !houseAction && visiting && (!current || callUnavailable(s, current, hh))
      ? 'Walk down and sit with them'
      : houseAction;
  const refusal = selectedRefusal(s, hh);
  const command = commandPicker(out, 'house-action', direct);
  return refusal && !houseAction
    ? refusal +
        btn('Other house actions', () => {
          houseAction = direct || `Call them ${JOB_LABEL[knownJobs(s)[0] ?? 'reap-agha']}`;
          drawSheet(true);
          app.querySelector<HTMLSelectElement>('#house-action')?.focus({ preventScroll: true });
        })
    : command;
}

function commandPicker(commands: string[], id: string, selectedTitle: string): string {
  const titles = commands.map((html) =>
    (html.match(/^<button[^>]*>([^<]*)/)?.[1] ?? 'Action').replace(
      'You are out on the lanes',
      'Walk down and sit with them',
    ),
  );
  const index = Math.max(0, titles.indexOf(selectedTitle));
  const label = id === 'house-action' ? 'House action' : 'Valley action';
  return `<label class="sr" for="${id}">${label}</label>
    <select id="${id}" aria-label="${label}">${titles.map((text, i) => `<option${i === index ? ' selected' : ''}>${text}</option>`).join('')}</select>
    ${commands[index]}`;
}

function pauseToCover() {
  cancelAnimationFrame(raf);
  writeLog();
  bindVolume().finally(title);
}

function valleyThumbs(s: ValleyState): string {
  const out: string[] = [];
  const houses = s.households.filter((h) => underSeal(s, h) && h.members.length).map((h) => h.id);
  const year = yearOf(dayOfMinute(s.minute));
  const who = s.flags.upper ? 'the valley' : 'the hamlet';
  for (const job of knownJobs(s)) {
    const reason = callUnavailable(s, job);
    out.push(
      btn(
        job === 'bring-share' ? `Call ${who} to bring the shares` : `Call ${who} ${JOB_LABEL[job]}`,
        () => order({ verb: 'call', job, houses }),
        {
          disabled: !!reason,
          cls: reason ? '' : 'primary',
          hint:
            reason ??
            (job === 'bring-share'
              ? `the rider comes ${riderWords(s)}`
              : 'the crier carries your request; they can refuse'),
        },
      ),
    );
    if (job === 'reap-agha' && year > 1)
      out.push(
        btn('Call to cut barley for pay', () => order({ verb: 'call', job, houses, wage: true }), {
          disabled: !!reason,
          hint: reason ?? 'paid work: a small share of the cut grain goes to their jars',
        }),
      );
  }
  if (s.agha.millOpen)
    out.push(
      btn('Call to carry mill stone for pay', () => {}, {
        disabled: true,
        hint: 'Mill work asks for labour without a grain wage. No paid mill calls return this term; use the mill call above.',
      }),
    );
  const loanBlocked = s.agha.loan && s.minute - s.agha.loan.asked < 300 * DAY;
  out.push(
    btn('Write to the landowner for grain', () => order({ verb: 'borrow', kile: 80 }), {
      disabled: !s.flags.verbs.includes('borrow') || !!loanBlocked,
      hint: loanBlocked
        ? (loanReturnWords(s) ?? '')
        : !s.flags.verbs.includes('borrow')
          ? 'The letter opens when the forecast shows a shortfall or hungry houses find the granary low.'
          : 'a cart of grain arrives in twelve days; repay a quarter more at a later rider',
    }),
  );
  const switchTab = btn(tab === 'ledger' ? 'The notebook' : 'The landowner’s ledger', () => {
    tab = tab === 'ledger' ? 'notes' : 'ledger';
    drawSheet(true);
  });
  if (tab !== 'ledger')
    out.push(
      btn('Pause and return to the cover', pauseToCover, {
        hint: 'your place is kept; time stops until you open the ledger',
      }),
    );
  return commandPicker(out, 'valley-action', valleyAction) + switchTab;
}

/** The rider's date, with the year when it is not this one. */
function riderWords(s: ValleyState): string {
  const d = nextRiderDay(s);
  const y = yearOf(d);
  return y === yearOf(dayOfMinute(s.minute)) ? dateWords(d) : `${dateWords(d)} of year ${yearWord(y)}`;
}

/** Shares are counted afresh when the new crop stands (doy 175) and stand for that year's rider. */
function sharesFresh(s: ValleyState): boolean {
  const doy = doyOf(dayOfMinute(s.minute));
  return doy >= 175 && doy <= doyOf(nextRiderDay(s));
}

function ledger(s: ValleyState): string {
  const rows = s.households
    .filter((h) => underSeal(s, h))
    .map(
      (h) =>
        `<tr><td>${esc(h.name)}</td><td class="n">${Math.round(h.paid)} of ${shareOwed(h)}${h.eased ? ' (eased)' : ''}</td></tr>`,
    )
    .join('');
  const loan =
    s.agha.loan && !s.agha.loan.paid
      ? `<tr><td>Owed for the loan${loanOwedAt(s, s.agha.dueDay) ? '' : ', at next year’s rider'}</td><td class="n">${s.agha.loan.owe}</td></tr>`
      : '';
  return `<div class="ledger ink-in">
    <h2 style="margin:0">The landowner’s ledger</h2>
    <p class="soft" style="font-size:14px">Grain set aside for the due; gifts leave less for the rider.</p>
    <table>
      <tr><td>In the granary</td><td class="n">${Math.round(s.agha.granary)} grain measures</td></tr>
      ${s.agha.reaped >= 1 ? `<tr><td>Cut, in his sheaves, not yet threshed</td><td class="n">about ${Math.round(s.agha.reaped / 5) * 5 || 1}</td></tr>` : ''}
      ${s.agha.standing >= 1 ? `<tr><td>Still standing in his field</td><td class="n">about ${Math.round(s.agha.standing / 10) * 10 || 5}</td></tr>` : ''}
      <tr><td>The due</td><td class="n">${s.agha.due} grain measures</td></tr>
      <tr><td>The rider comes</td><td class="n">${esc(riderWords(s))}</td></tr>
      ${s.agha.arrears ? `<tr><td>Written against this year</td><td class="n">${s.agha.arrears}</td></tr>` : ''}
      ${loan}
      <tr><td>Years short</td><td class="n">${s.agha.missed}</td></tr>
    </table>
    ${s.flags.verbs.includes('take') ? `<h3 style="margin:8px 0 0;font-size:16px">${sharesFresh(s) ? 'Shares this year' : 'Shares brought to the last rider'}</h3><table>${rows}</table>` : ''}
    <div class="actions">
      ${btn('Pause and return to the cover', pauseToCover, {
        hint: 'your place is kept; time stops until you open the ledger',
      })}
    </div>
    <p class="soft" style="font-size:14px">The term ends at the elders’ gathering, ${esc(dateWords(END_DAY))} of year three.</p>
  </div>`;
}

// ---------- holding ----------

function bindHold(b: HTMLButtonElement, fn: () => void) {
  let timer = 0;
  let fired = false;
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  const feedback = () => {
    if (fired || b.disabled) return;
    const status = app.querySelector<HTMLElement>('#hold-feedback') ?? document.createElement('p');
    status.id = 'hold-feedback';
    status.className = b.closest('.decision-reply') ? 'sr' : 'hold-feedback';
    status.setAttribute('role', 'status');
    status.hidden = false;
    status.textContent = 'Keep holding to press this action. Release after the ink fills the control.';
    b.after(status);
  };
  b.addEventListener('click', feedback);
  const startHold = () => {
    if (b.disabled) return;
    clearTimeout(timer);
    fired = false;
    b.classList.add('holding');
    timer = window.setTimeout(() => {
      fired = true;
      b.classList.remove('holding');
      fn();
    }, 650);
  };
  b.addEventListener('pointerdown', startHold);
  b.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      startHold();
    }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      feedback();
      cancel();
    }
  });
  b.addEventListener('blur', () => cancel());
  const cancel = () => {
    clearTimeout(timer);
    b.classList.remove('holding');
  };
  b.addEventListener('pointerleave', cancel);
  b.addEventListener('pointercancel', cancel);
  b.addEventListener('pointerup', () => {
    cancel();
    if (!fired)
      b.animate?.(
        [{ transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }],
        160,
      );
  });
}

// ---------- the ending ----------

function ending() {
  stage?.destroy();
  stage = null;
  labScreen('ending');
  cancelAnimationFrame(raf);
  releaseWake();
  if (!g) return title();
  const s = g.valley;
  const { elders, letter } = gathering(g);
  const dismissed = s.flags.ended === 'dismissed';
  app.innerHTML = `<div class="page elders">
    ${mark()}
    <h1>${dismissed ? 'The second letter' : 'The elders’ gathering'}</h1>
    <p class="soft">${esc(dateWords(dayOfMinute(s.minute)))} of year ${yearWord(yearOf(dayOfMinute(s.minute)))}.</p>
    ${dismissed ? '<p>The landowner’s rider came back with a sealed letter. The elders did not gather for you; they said these things at their own doors, and the local overseer wrote them down.</p>' : '<p>They sat along the wall of the residence, as they do at the end of a steward’s term, and each said one thing.</p>'}
    ${elders.map((e) => `<div class="elder"><b>${esc(e.name)}</b>, ${esc(e.house)}<span class="w">“${esc(e.words)}”</span></div>`).join('')}
    <p>${esc(letter)}</p>
    <div data-closing-grain></div>
    <div class="actions">
      <button class="primary" data-go="title">Close the ledger</button>
    </div>
    ${footer()}
  </div>`;
  drawClosingGrain();
  app.querySelector('[data-go="title"]')?.addEventListener('click', () => {
    clearSaves().then(() => {
      g = null;
      title();
    });
  });
}

function drawClosingGrain() {
  const target = app.querySelector('[data-closing-grain]');
  if (!target) return;
  target.textContent = g ? closingGrain(g.valley, showClosingGrain) : '';
}

function download() {
  if (!g) return;
  const sv: SavedGame = save(g, volume);
  const blob = new Blob([JSON.stringify(sv)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `the-valley-${sv.seed}-day${dayOfMinute(sv.minute)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- phone niceties ----------

async function requestWake() {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    if (nav.wakeLock && !wake) wake = await nav.wakeLock.request('screen');
  } catch {}
}
function releaseWake() {
  wake?.release().catch(() => {});
  wake = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (g && !g.valley.flags.ended && app.querySelector('.play')) {
      writeLog();
      bindVolume();
      lastSnapDay = dayOfMinute(g.valley.minute);
    }
    // Away from the page, the valley waits: nothing happens while you are gone.
    cancelAnimationFrame(raf);
  } else if (g && !g.valley.flags.ended && app.querySelector('.play')) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
    requestWake();
  }
});

export const _debug = {
  game: () => g,
  order,
  speed: (i: number) => {
    speed = i;
    drawTop();
  },
  /** Jump ahead (headless, for testing): live the valley to `day` without drawing. */
  skipTo: (day: number) => {
    if (!g) return;
    step(g, day * DAY);
    writeLog();
    drawSheet(true);
  },
};
