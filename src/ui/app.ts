import { automaticRate, type Pace, READING_MS } from './pacing.ts';
/**
 * The Valley UI: plain DOM and a Canvas 2D ink map over the pure sim. The UI reads state and gives orders through
 * `act`; it never changes the sim directly. Real time drives sim minutes in fixed quanta (continuous, with a slowdown
 * when something heavy happens; menus pause time). The save is the kahya's ledger: the seed and the input log in local
 * storage, and a bound volume (the whole state, gzipped) in IndexedDB every few weeks of the valley's time.
 */

import { type PhoneStage, phoneStage, telemetryNotice } from '@adam0white/lab-kit';
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
  type CompactRun,
  END_DAY,
  fingerprint,
  GAME_VERSION,
  type Game,
  gathering,
  type Input,
  load,
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
import type { CastStart } from '../sim/passport.ts';
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
import { CastSession, type LocalCastReceipt } from './cast-session.ts';
import { LAB_TOOLS, lab, labScreen, mountLab, openFeedback } from './lab.ts';
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
import { closingGrain } from './tally.ts';

const castSession = new CastSession(lab);
const LOG = 'valley-log-v1';
let speed: Pace = 'automatic';
const HUB = 'https://human.adamwhite.work';

interface Log {
  cast?: CastStart;
  continuity?: LocalCastReceipt;
  game: 'valley';
  version: string;
  seed: number;
  inputs: Input[];
  minute: number;
  volume: number;
  savedAt: string;
}

const notice = telemetryNotice();
// Use portable notice metrics without shrinking text or changing body typography.
if (notice) {
  notice.style.paddingInline = '2px';
  notice.style.fontFamily = 'Arial, "Liberation Sans", sans-serif';
  // Valley's root is 17px. Keep normal disclosure at 14px and scale enlarged roots.
  notice.style.fontSize = 'max(14px, 0.8rem)';
}
const noticeFooter = document.createElement('footer');
noticeFooter.className = 'notice-footer';
if (notice) noticeFooter.append(notice);
document.body.append(noticeFooter);
const app = document.getElementById('app') as HTMLElement;
let g: Game | null = null;
let hurrying = false;
let slowUntil = 0;
let raf = 0;
let last = 0;
let carry = 0;
let selected: string | null = null;
let stage: PhoneStage | null = null;
let actionCaption = '';
let importStatus = '';
let houseDetails = false;
let tab: 'notes' | 'ledger' | 'reader' | 'orders' = 'notes';
let lastDay = -1;
let lastSnapDay = -1;
let lastSheet = 0;
let sheetKey = '';
let seenNote = 0;
let volume = 0;
let wake: { release(): Promise<void> } | null = null;
let hunchCache: { key: string; lines: string[] } | null = null;
let actions: (() => void)[] = [];

const esc = (x: string) =>
  englishText(x).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
const mark = () => `<a class="mark" href="${HUB}">◇ human framework</a>`;
const footer = () => `<div class="footer"><a href="${HUB}/games/" target="_top">◇ All games</a></div>`;
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
    ...(g.cast ? { cast: structuredClone(g.cast) } : {}),
    continuity: castSession.metadata(),
    game: 'valley',
    version: GAME_VERSION,
    seed: g.valley.seed,
    inputs: g.inputs,
    minute: g.valley.minute,
    volume,
    savedAt: new Date().toISOString(),
  };
  try {
    const text = JSON.stringify(log);
    localStorage.setItem(LOG, text);
    lab.captureSave(JSON.parse(text));
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
  runId: string;
  seed: number;
  k: number;
  minute: number;
  gz: Blob;
}

let runTransition = 0;

async function bindVolume() {
  if (!g) return;
  const boundGame = g;
  const boundGeneration = castSession.generation;
  const current = () =>
    g === boundGame && castSession.game === boundGame && castSession.generation === boundGeneration;
  const s = g.valley;
  const json = JSON.stringify(stateJson(s));
  try {
    const bound: Bound = {
      runId: castSession.runId,
      seed: s.seed,
      k: g.inputs.length,
      minute: s.minute,
      gz: await gzip(json),
    };
    if (!current()) return;
    volume++;
    const d = await db();
    if (!current()) return;
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('volumes', 'readwrite');
      tx.objectStore('volumes').put(bound, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    if (!current()) return;
    lab.captureSave({ seed: bound.seed, k: bound.k, minute: bound.minute, state: JSON.parse(json) });
  } catch (error) {
    console.warn('Recovery snapshot could not be saved. The input log is kept.', error);
  }
  if (current()) writeLog();
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
  if (log.version !== GAME_VERSION)
    throw new Error('This ledger uses an older Valley edition. Start fresh from the title page.');
  if (log.cast) newGame(log.seed, log.cast); // Validate the pinned semantic header even when a bound volume exists.
  const bound = await readVolume();
  let game: Game;
  let rest: Input[];
  if (
    bound &&
    typeof bound.runId === 'string' &&
    bound.runId.length > 0 &&
    bound.runId === log.continuity?.runId &&
    bound.seed === log.seed &&
    bound.k <= log.inputs.length &&
    bound.minute <= log.minute
  ) {
    game = {
      valley: restoreState(JSON.parse(await gunzip(bound.gz)) as ValleyState),
      inputs: log.inputs.slice(0, bound.k),
      ...(log.cast ? { cast: structuredClone(log.cast) } : {}),
    };
    rest = log.inputs.slice(bound.k);
  } else {
    game = newGame(log.seed, log.cast);
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
  lab.trackRun(
    () => {
      if (!g || castSession.game !== g) return null;
      try {
        const saved = readLog();
        if (saved?.continuity?.runId === castSession.runId) lab.captureSave(saved);
      } catch {}
      return g && castSession.game === g ? castSession.exportRun(save(g, volume)) : null;
    },
    {
      runKey: () => g?.valley.seed ?? 'title',
      getLogs: () =>
        g && castSession.game === g
          ? g.valley.notes.slice(-40).map((line) => (line.words ? `${line.text} ${line.words}` : line.text))
          : [],
    },
  );
  castSession.connect(writeLog);
  mountLab({
    getRun: () => (g ? castSession.exportRun(save(g, volume)) : undefined),
    hasRun: () => !!g,
    chooseRecording: (allow) => castSession.queryRecording(allow),
    download,
    notebook: openNotebook,
    toTitle: pauseToCover,
    newGame: () => void begin(Math.floor(Math.random() * 1e9)),
    getSpeed: () => speed,
    setSpeed: (value) => {
      speed = value;
      hurrying = false;
      drawTop();
    },
    date: () => (g ? fullDateEnglish(dayOfMinute(g.valley.minute)) : 'The Valley'),
    bindVolume: async () => {
      if (!g) return;
      lastSnapDay = dayOfMinute(g.valley.minute);
      await bindVolume();
    },
  });
  const castHost = document.querySelector<HTMLElement>('.game-menu-panel .menu-body');
  if (castHost && LAB_TOOLS) castSession.mount(castHost, writeLog);
  if ('serviceWorker' in navigator && location.hostname !== 'localhost')
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  title();
}

function topbar(words: string): string {
  return `<header class="topbar"><span class="topbar-title">${words}</span><div class="topbar-actions"><button type="button" data-info aria-label="Information" popovertarget="game-info">i</button><button type="button" data-menu aria-label="Menu">≡<span class="desktop-label"> Menu</span></button></div></header><section id="game-info" popover="auto"><button data-info-close aria-label="Close information">×</button><div data-info-body></div></section>`;
}

function infoWords(): string {
  if (!g || app.querySelector('.title-page'))
    return `<h2>The valley</h2><p>Call households to the harvest. Read their replies. Visit to learn what they need.</p><p>Grain you give comes out of the landowner’s due. Rain can damage uncut barley.</p>`;
  if (g.valley.flags.ended)
    return `<h2>The tally</h2><p>The elders speak from what they remember. The grain tally is the game’s own convention: grain delivered, gifts and arrears are counted separately.</p>`;
  if (selected)
    return `<h2>Knowing a house</h2><p>Your guess comes from what you last saw. The reeve’s guess is his own read of a person; neither is certain.</p><p>A lower-hamlet visit takes a couple of hours. The upper hamlet takes most of a morning. You can go again when you return.</p>`;
  const s = g.valley;
  return `<h2>Your charge</h2><p>${esc(nextWords(s))}</p><p>Calls go through the crier; people weigh them against their own fields and can refuse. Hold a refusal to press it: they come, and they remember.</p><p>A visit takes walking time. Ease a share to leave more in a house’s jars; the neighbours will notice.</p><p>The grain bar: solid is in the granary, hatched is cut and waiting for threshing, outline is still standing, and the tick is the due.</p><p>The clock slows for replies and knocks. The menu and this i stop it. ${esc(limitsWords(s))}</p>${seasonOf(doyOf(dayOfMinute(s.minute))) === 'winter' ? '<p>Mill work asks for labour without a grain wage. The letter for grain opens when the forecast shows a shortfall.</p>' : ''}<p>Words: <b>kahya</b>, steward (you); <b>agha</b>, landowner; <b>kile</b>, grain measure.</p>`;
}

function title() {
  labScreen('title');
  cancelAnimationFrame(raf);
  const log = readLog();
  const where =
    log && log.version !== GAME_VERSION
      ? 'This ledger uses an older Valley edition. Start fresh to play the new cast. Your old ledger stays here until you begin a new term.'
      : log
        ? `Your ledger is open at ${dateWords(dayOfMinute(log.minute))} of year ${yearWord(yearOf(dayOfMinute(log.minute)))}.`
        : '';
  stage?.destroy();
  stage = null;
  app.innerHTML = `<div class="page title-page">
    ${topbar(`<a href="${HUB}/games/" target="_top">All games</a>`)}
    <section class="title-premise"><h1>The Valley</h1><p class="purpose">${esc(PURPOSE)}</p><p class="soft">People can refuse you, and they remember how you answer.</p></section>
    ${LAB_TOOLS ? '<button data-ways>Lab tools ▸</button>' : ''}
    <div class="vignette" aria-hidden="true"><svg viewBox="0 0 360 140"><path d="M0 95Q80 15 160 90T360 70M0 130Q90 50 180 120T360 95M250 0Q200 70 260 140" fill="none" stroke="currentColor"/><g fill="none" stroke="currentColor" stroke-width="2"><path d="M70 95v-18l12-12 12 12v18zM130 105V87l12-12 12 12v18zM190 90V72l12-12 12 12v18zM280 100V82l12-12 12 12v18z"/></g></svg></div>
    <footer class="title-actions">${where ? `<p class="hand">${esc(where)}</p>` : ''}
    ${log ? `${log.version === GAME_VERSION ? '<button class="primary" data-go="open">Resume</button>' : ''}<button data-go="new" class="hold">New game<span class="fill"></span></button><p class="soft">This replaces your saved game.</p>` : '<button class="primary" data-go="new">New game</button>'}${mark()}</footer>
    ${LAB_TOOLS ? `<dialog class="ways-panel" aria-label="Other ways in"><header><h2>Other ways in</h2><button data-ways-close aria-label="Close other ways in">×</button></header><label for="valley-name">A named valley</label><input id="valley-name" placeholder="Kuyulu" maxlength="80"><p>The same name gives the same valley.</p><button data-seed${log ? ' class="hold"' : ''}>Begin this valley${log ? '<span class="fill"></span>' : ''}</button>${log ? '<p class="soft">This replaces your saved game.</p>' : ''}<label for="load-run">Load a playtest run</label><input id="load-run" type="file" accept=".json,application/json"><p id="load-result" role="status"></p></dialog>` : ''}
  </div>`;
  app.querySelector('[data-go="open"]')?.addEventListener('click', () => {
    if (log && log.version === GAME_VERSION) openLedger(log);
  });
  const fresh = (seed: number) => {
    void begin(seed);
  };
  const nb = app.querySelector<HTMLButtonElement>('[data-go="new"]');
  if (nb) {
    nb.addEventListener('click', () => {
      if (!log) return fresh(Math.floor(Math.random() * 1e9));
      if (app.querySelector('[data-confirm-title]')) return;
      const confirm = document.createElement('div');
      confirm.innerHTML =
        '<p>Replace your saved game?</p><button data-confirm-title>Start new game</button><button data-cancel-title>Cancel</button>';
      nb.after(confirm);
      confirm
        .querySelector('[data-confirm-title]')
        ?.addEventListener('click', () => fresh(Math.floor(Math.random() * 1e9)));
      confirm.querySelector('[data-cancel-title]')?.addEventListener('click', () => confirm.remove());
    });
  }
  const ways = app.querySelector<HTMLDialogElement>('.ways-panel');
  app.querySelector('[data-ways]')?.addEventListener('click', () => ways?.showModal());
  app.querySelector('[data-ways-close]')?.addEventListener('click', () => ways?.close());
  const named = () => {
    const name = app.querySelector<HTMLInputElement>('#valley-name')?.value.trim();
    if (name) {
      ways?.close();
      fresh(seedFrom(name.toLowerCase()));
    }
  };
  const seed = app.querySelector<HTMLButtonElement>('[data-seed]');
  if (seed) {
    if (log) bindHold(seed, named);
    else seed.addEventListener('click', named);
  }
  app.querySelector<HTMLInputElement>('#load-run')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    const result = app.querySelector('#load-result');
    if (!file || !result) return;
    const transition = ++runTransition;
    const previous = g;
    const previousMeta = castSession.metadata();
    castSession.invalidate();
    try {
      const text = await file.text();
      if (transition !== runTransition) return;
      const saved = JSON.parse(text) as SavedGame | CompactRun;
      const restored = load(saved);
      if (fingerprint(restored.valley) !== saved.fingerprint) throw new Error('differs');
      result.textContent = 'matches';
      g = restored;
      await castSession.loaded(restored, undefined, true, saved);
      if (transition !== runTransition) return;
      volume = 0;
      importStatus = 'matches';
      ways?.close();
      writeLog();
      await bindVolume();
      enter();
    } catch {
      if (transition !== runTransition) return;
      // load() can reset module caches; restore the active instance before continuing.
      if (previous) {
        g = {
          valley: restoreState(previous.valley),
          inputs: previous.inputs,
          ...(previous.cast ? { cast: previous.cast } : {}),
        };
        await castSession.loaded(g, previousMeta);
      }
      result.textContent = 'differs — this run could not be loaded.';
    }
  });
}

function openLedger(log: Log) {
  const transition = ++runTransition;
  cancelAnimationFrame(raf);
  castSession.invalidate();
  app.innerHTML = `<div class="page">${topbar('The Valley')}<h2>Reading the ledger back…</h2><p class="hand" id="prog"></p></div>`;
  const prog = app.querySelector('#prog') as HTMLElement;
  reopen(log, (m) => {
    prog.textContent = `${dateWords(dayOfMinute(m))} of year ${yearWord(yearOf(dayOfMinute(m)))}`;
  })
    .then(async (game) => {
      if (transition !== runTransition) return;
      g = game;
      await castSession.loaded(game, log.continuity);
      if (transition !== runTransition) return;
      enter();
    })
    .catch(() => {
      prog.textContent = 'The ledger would not open. Begin a new term from the title page.';
    });
}

async function begin(seed: number, localOnly = false) {
  const transition = ++runTransition;
  cancelAnimationFrame(raf);
  app.innerHTML = `<div class="page">${topbar('The Valley')}<h2>Starting your game…</h2><p>Please wait.</p></div>`;
  try {
    const prepared = await castSession.fresh(seed, localOnly);
    if (transition !== runTransition) return;
    g = prepared;
    await clearSaves();
    if (transition !== runTransition || castSession.game !== prepared) return;
    importStatus = '';
    volume = 0;
    hurrying = false;
    seenNote = 0;
    writeLog();
    await castSession.activate(prepared);
    if (transition !== runTransition) return;
    enter();
  } catch (error) {
    if (transition !== runTransition) return;
    title();
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    console.error(error);
    status.textContent =
      LAB_TOOLS && error instanceof Error
        ? error.message
        : 'The game could not start. Your saved game is kept. Try again or open Feedback.';
    app.querySelector('.title-actions')?.prepend(status);
    if (LAB_TOOLS) {
      const local = document.createElement('button');
      local.textContent = 'Play fresh locally without carrying history';
      local.addEventListener('click', () => void begin(seed, true));
      status.after(local);
    }
  }
}

// ---------- play ----------

function enter() {
  labScreen('play');
  if (!g) return;
  if (g.valley.flags.ended) return ending();
  selected = null;
  tab = 'notes';
  carry = 0;
  hurrying = false;
  actionCaption = '';
  sheetKey = '';
  lastDay = dayOfMinute(g.valley.minute);
  lastSnapDay = lastDay;
  seenNote = Math.max(seenNote, (g.valley.notes.at(-1)?.id ?? 0) - 6);
  stage?.destroy();
  app.innerHTML = `<div class="play lk-stage" data-sheet="fit">
    ${topbar('<span id="cap"></span>')}
    <button class="grain-bar" aria-label="Open the landowner’s ledger"><span class="grain-track"><span class="grain-solid"></span><span class="grain-cut"></span><span class="grain-standing"></span><span class="grain-due"></span></span><span class="grain-label"></span></button>
    <div class="map lk-scene"><canvas id="map" aria-label="The valley map"></canvas><p id="now" class="moment"></p><span id="steward"></span></div>
    <nav id="houses" aria-label="Households"></nav>
    <section class="lk-sheet" aria-label="Valley notebook"><header class="lk-sheet-head" id="sheet-head" hidden></header><div id="house-answer" hidden></div><div class="sheet lk-sheet-body" id="sheet"></div><footer class="thumbs lk-commit" id="thumbs"></footer></section>
  </div>`;
  app.querySelector('.grain-bar')?.addEventListener('click', () => openReading('ledger'));
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
  app.querySelector('#sheet')?.addEventListener('click', onSheetClick);
  app.querySelector('#thumbs')?.addEventListener('click', onSheetClick);
  app.querySelector('#house-answer')?.addEventListener('click', onSheetClick);
  app.querySelector('#houses')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-h]');
    if (b?.dataset.h) pick(b.dataset.h);
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
  return automaticRate({
    night: partOfDay(s.minute) === 'night',
    travelling: !!s.kahyaState.visit,
    reading: t < slowUntil || selected !== null || tab !== 'notes',
    waiting: s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute),
    hurrying,
    working: !!currentJob(s),
    pace: speed,
  });
}

function frame(t: number) {
  if (!g) return;
  const s = g.valley;
  const elapsed = Math.max(0, t - last);
  const dt = Math.min(250, elapsed);
  last = t;
  if (document.querySelector('dialog[open], .hflab-veil, :popover-open')) {
    if (slowUntil > t - elapsed) slowUntil += elapsed;
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
    if (afterQuantum(t)) {
      // Stop at the first new event. Carry from the empty stretch cannot spend its reading time.
      carry = 0;
      drawSheet();
      break;
    }
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
  if (moved && (Object.keys(s.castReleased ?? {}).length || Object.keys(s.castDeaths ?? {}).length))
    void castSession.checkpoint();
  raf = requestAnimationFrame(frame);
}

function afterQuantum(t: number): boolean {
  if (!g) return false;
  const s = g.valley;
  // Something heavy happened: the clock slows by itself for a few seconds.
  const first = dayOfMinute(s.minute) < 1;
  let event = false;
  for (const n of s.notes) {
    if (n.id <= seenNote) continue;
    seenNote = n.id;
    if (n.kind === 'reply' || n.weight >= 2.5 || (first && n.weight >= 2)) {
      slowUntil = t + READING_MS;
      event = true;
    }
  }
  if (s.knocks.some((k) => !k.answered && k.at <= s.minute && k.at > s.minute - QUANTUM)) {
    slowUntil = t + READING_MS;
    event = true;
  }
  if (event) hurrying = false;
  const day = dayOfMinute(s.minute);
  if (day !== lastDay) {
    lastDay = day;
    void castSession.checkpoint();
    hunchCache = null;
    writeLog();
    drawTop();
    if (day - lastSnapDay >= 15) {
      lastSnapDay = day;
      bindVolume();
    }
  }
  if (event) drawTop();
  return event;
}

function drawTop() {
  if (!g) return;
  const s = g.valley;
  const now = app.querySelector('#now');
  if (now) now.textContent = englishText(nowWords(s));
  const button = app.querySelector<HTMLButtonElement>('[data-until]');
  if (button) {
    button.disabled = hurrying;
    button.textContent = 'Skip ⏩';
  }
  const label = app.querySelector('.grain-label');
  const knock = s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute);
  if (label)
    label.textContent = knock
      ? 'Someone is at your door.'
      : selected || tab !== 'notes' || performance.now() < slowUntil
        ? 'Time slows while you read.'
        : hurrying
          ? 'Waiting for the next event.'
          : seasonOf(doyOf(dayOfMinute(s.minute))) === 'harvest'
            ? 'Rain is due on 20 July.'
            : `The rider comes on ${dateWords(nextRiderDay(s)).replace('September', 'Sep')}.`;
  const total = Math.max(1, s.agha.due * 1.2, s.agha.granary + s.agha.reaped + s.agha.standing);
  for (const [selector, value] of [
    ['.grain-solid', s.agha.granary],
    ['.grain-cut', s.agha.reaped],
    ['.grain-standing', seasonOf(doyOf(dayOfMinute(s.minute))) === 'harvest' ? s.agha.standing : 0],
  ] as const) {
    app.querySelector<HTMLElement>(selector)?.style.setProperty('width', `${(value / total) * 100}%`);
  }
  app.querySelector<HTMLElement>('.grain-due')?.style.setProperty('left', `${(s.agha.due / total) * 100}%`);
}

function openNotebook() {
  if (!g) return;
  if (!g.valley.flags.ended) {
    if (!app.querySelector('.play')) enter();
    openReading('reader');
    return;
  }
  const panel = document.createElement('dialog');
  panel.className = 'notebook-panel';
  panel.setAttribute('aria-label', 'Earlier replies');
  panel.innerHTML = `<header class="lk-sheet-head"><button aria-label="Back to the gathering">←</button><h2>Earlier replies</h2></header><div class="lk-sheet-body">${reader(g.valley)}</div>`;
  panel.querySelector('button')?.addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => panel.remove(), { once: true });
  document.body.append(panel);
  panel.showModal();
}

function openReading(which: 'ledger' | 'reader' | 'orders') {
  selected = null;
  hurrying = false;
  tab = which;
  carry = 0;
  drawSheet(true);
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
  const focus = window.innerWidth < 900 && selected ? houseOf(s, selected) : undefined;
  const sc = focus ? Math.min(w / 360, h / 170) : Math.min(w / (WORLD.x1 - WORLD.x0), h / (y1 - y0));
  const ox = focus ? w / 2 - focus.x * sc : (w - (WORLD.x1 - WORLD.x0) * sc) / 2 - WORLD.x0 * sc;
  const oy = focus ? h * 0.6 - focus.y * sc : (h - (y1 - y0) * sc) / 2 - y0 * sc;
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
    house(ctx, X(hh.x), Y(hh.y), window.innerWidth < 900 ? 1.5 : 1);
    label(ctx, hh.short, X(hh.x), Y(hh.y) + 17, c.sky ?? '#3d5a73', 12);
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
  if (cap)
    cap.textContent = `${dateWords(dayOfMinute(s.minute))} · year ${yearOf(dayOfMinute(s.minute))} · ${wx}`;
  const steward = app.querySelector('#steward');
  if (steward) steward.textContent = caption(s, wx);
}

const growing = (season: string) => season === 'spring' || season === 'summer';

function caption(s: ValleyState, _wx: string): string {
  const v = s.kahyaState.visit;
  const where =
    v && v.back > s.minute
      ? s.minute < v.arrive
        ? `you are walking to ${houseOf(s, v.house)?.name ?? ''}`
        : s.minute < v.leave
          ? `you are at ${houseOf(s, v.house)?.name ?? ''}`
          : 'you are walking back'
      : '';
  return where ? `You: ${where.replace('you are ', '')}` : 'You: at the residence';
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
  let bd = 24;
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
  actionCaption = '';
  tab = 'notes';
  houseDetails = false;
  carry = 0;
  hunchCache = null;
  drawSheet(true);
  drawMap();
}

function closeHouse() {
  const origin = selected;
  selected = null;
  tab = 'notes';
  actionCaption = '';
  drawSheet(true);
  drawMap();
  app.querySelector<HTMLButtonElement>(`#houses button[data-h="${origin}"]`)?.focus({ preventScroll: true });
}
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('[data-info]')) {
    const body = app.querySelector('[data-info-body]');
    if (body) body.innerHTML = infoWords();
  }
  if (target.closest('[data-info-close]')) app.querySelector<HTMLElement>('#game-info')?.hidePopover();
});
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'Escape' &&
    (selected || tab !== 'notes') &&
    !document.querySelector('dialog[open], :popover-open')
  )
    closeHouse();
});

/** The houses as buttons for screen readers and keyboards, kept in step with the map. */
function drawHouses(s: ValleyState) {
  const nav = app.querySelector('#houses');
  if (!nav) return;
  const today = dayOfMinute(s.minute);
  const list = s.households.filter((h) => h.hamlet === 'lower' || s.flags.upper);
  const content = list
    .map((h, i) => {
      const waiting = s.asks.some(
        (a) =>
          !a.closed &&
          a.from <= s.minute &&
          a.until > s.minute &&
          Object.entries(a.replies).some(
            ([id, r]) =>
              h.members.includes(id) &&
              !a.insisted.includes(id) &&
              ['deferred', 'refused', 'modified'].includes(r.verdict),
          ),
      );
      const news = s.notes.some(
        (n) =>
          n.at <= s.minute &&
          dayOfMinute(n.at) === today &&
          (n.house === h.id || (n.who && h.members.includes(n.who))),
      );
      return `${h.hamlet === 'upper' && list[i - 1]?.hamlet !== 'upper' ? '<span class="hamlet-divider">upper</span>' : ''}<button data-h="${h.id}" class="${selected === h.id ? 'selected' : ''}" aria-pressed="${selected === h.id}" aria-label="${esc(h.name)}"><span class="house-icon" aria-hidden="true">⌂</span>${esc(h.short)}${waiting ? '<span class="reply-mark" aria-label="reply waiting">●</span>' : news ? '<span aria-label="new reply today">○</span>' : ''}</button>`;
    })
    .join('');
  if (nav.innerHTML !== content) {
    const left = nav.scrollLeft;
    nav.innerHTML = content;
    nav.scrollLeft = left;
  }
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
  drawTop();
  if (!g || (!force && app.querySelector('button.holding'))) return;
  const s = g.valley;
  // Count newly due scheduled notes, and retain IDs when the capped log replaces an old note.
  const key = `${s.notes.findLast((n) => n.at <= s.minute)?.id}:${s.notes.filter((n) => n.at <= s.minute).length}|${selected}|${tab}|${houseDetails}|${s.asks.length}|${busy(s)}|${dayOfMinute(s.minute)}|${s.flags.verbs.join(',')}|${s.agha.granary >= 2}|${s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute).length}`;
  if (!force && sheetKey === key) return;
  sheetKey = key;
  lastSheet = performance.now();
  actions = [];
  const sheet = app.querySelector<HTMLElement>('#sheet');
  const thumbs = app.querySelector<HTMLElement>('#thumbs');
  if (!sheet || !thumbs) return;
  const top = sheet.scrollTop;
  const knock = s.knocks.find((k) => !k.answered && k.at <= s.minute && k.until > s.minute);
  // An unanswered knock takes precedence over the house and reading sheets.
  if (knock) {
    selected = null;
    tab = 'notes';
    hurrying = false;
  }
  const hh = selected ? houseOf(s, selected) : undefined;
  const root = app.querySelector<HTMLElement>('.play');
  root?.setAttribute('data-house', String(!!hh));
  root?.setAttribute('data-knock', String(!!knock));
  root?.setAttribute('data-reader', String(tab === 'ledger' || tab === 'reader'));
  const header = app.querySelector<HTMLElement>('#sheet-head');
  if (header) {
    header.hidden = !hh && tab === 'notes';
    header.innerHTML = hh
      ? `<button class="house-close" aria-label="Back to the notebook">←</button><b>${esc(hh.name)}</b><button class="house-about" aria-expanded="${houseDetails}">About ▾</button>`
      : tab !== 'notes'
        ? `<button class="house-close" aria-label="Back to the notebook">←</button><b>${tab === 'ledger' ? 'The landowner’s ledger' : tab === 'reader' ? 'Earlier replies' : 'Other orders'}</b>`
        : '';
  }
  sheet.innerHTML =
    `${importStatus ? `<p id="load-result" role="status">${importStatus}</p>` : ''}` +
    (knock
      ? knockCard(s, knock)
      : hh
        ? houseCard(s, hh)
        : tab === 'ledger'
          ? ledger(s)
          : tab === 'reader'
            ? reader(s)
            : tab === 'orders'
              ? otherOrders(s)
              : notebook(s));
  thumbs.hidden = !!knock || tab !== 'notes';
  thumbs.innerHTML = thumbs.hidden ? '' : hh ? houseThumbs(s, hh) : valleyThumbs(s);
  for (const button of app.querySelectorAll<HTMLButtonElement>('button.hold[data-k]')) {
    const fn = actions[Number(button.dataset.k)];
    if (fn) bindHold(button, fn);
  }
  drawHouses(s);
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
        ? `A child has been born at ${hh?.name}.`
        : k.what === 'death'
          ? `Someone has died at ${hh?.name}.`
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

/** Keep still-actionable refusals visible even when their dated note is archived. */
function pendingReplies(s: ValleyState, house?: Household): string {
  const asks = s.asks.filter(
    (a) => !a.closed && a.from <= s.minute && a.until > s.minute && (!house || a.houses.includes(house.id)),
  );
  if (!asks.length) return '';
  const counts = { came: 0, deferred: 0, refused: 0, modified: 0 };
  const rows: string[] = [];
  for (const ask of [...asks].reverse()) {
    for (const [id, reply] of Object.entries(ask.replies).sort((a, b) => b[1].at - a[1].at)) {
      const hh = s.households.find((h) => h.members.includes(id));
      if (house && hh?.id !== house.id) continue;
      if (reply.verdict === 'deferred') counts.deferred++;
      else if (reply.verdict === 'refused') counts.refused++;
      else if (reply.verdict === 'modified') counts.modified++;
      else counts.came++;
      const complete =
        ask.job === 'reap-agha'
          ? s.agha.standing <= 5
          : ask.job === 'build-mill'
            ? s.agha.mill >= V.millHours
            : !hh || hh.paid >= shareOwed(hh) - 0.5 || dayOfMinute(s.minute) >= s.agha.dueDay;
      if (
        !s.flags.verbs.includes('insist') ||
        complete ||
        pressShown.has(id) ||
        ask.insisted.includes(id) ||
        !['deferred', 'refused', 'modified'].includes(reply.verdict)
      )
        continue;
      pressShown.add(id);
      rows.push(
        `<div class="reply-row"><span><b>${esc(hh?.short ?? '')} · ${esc(personOf(s, id)?.name ?? 'Someone')}</b><span class="reply-words">“${esc(reply.says)}”</span></span>${btn('Hold to press', () => order({ verb: 'insist', ask: ask.id, pid: id }), { hold: true })}</div>`,
      );
    }
  }
  return `<section class="pending-replies"><h2 class="section-label">Replies to the call</h2><p class="reply-count">${counts.came} came, ${counts.deferred} put off, ${counts.refused} refused${counts.modified ? `, ${counts.modified} part` : ''}</p>${rows.join('')}</section>`;
}

function notebook(s: ValleyState): string {
  pressShown.clear();
  const pending = pendingReplies(s);
  const today = dayOfMinute(s.minute);
  const recent = s.notes
    .filter((n) => dayOfMinute(n.at) === today && n.at <= s.minute)
    .sort((a, b) => b.weight - a.weight || b.at - a.at)
    .slice(0, 3)
    .sort((a, b) => b.at - a.at);
  return `${pending}<section class="current-notes"><h2 class="section-label">Today’s news</h2>${recent.length ? recent.map(noteLine).join('') : '<p class="soft">No new reply today.</p>'}</section>${btn('Earlier replies ▸', () => openReading('reader'), { cls: 'more' })}`;
}

function reader(s: ValleyState): string {
  const days = [...new Set(s.notes.filter((n) => n.at <= s.minute).map((n) => dayOfMinute(n.at)))].sort(
    (a, b) => b - a,
  );
  return days
    .map(
      (d) =>
        `<section class="day"><h3>${esc(fullDateEnglish(d))}</h3>${s.notes
          .filter((n) => dayOfMinute(n.at) === d && n.at <= s.minute)
          .slice()
          .reverse()
          .map(noteLine)
          .join('')}</section>`,
    )
    .join('');
}

function noteLine(n: Note): string {
  return `<div class="note${n.weight < 2 ? ' quiet' : ''}"><span class="t">${esc(partOfDay(n.at))}</span>${esc(n.text)}${n.words && !n.text.toLowerCase().includes(n.words.toLowerCase()) ? `<span class="w">“${esc(n.words)}”</span>` : ''}</div>`;
}

function datedReply(s: ValleyState, n: Note): string {
  const earlier = dayOfMinute(n.at) < dayOfMinute(s.minute) ? 'Earlier replies · ' : '';
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
  [0, 'They have almost no food left.'],
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
  [/^material/, 'they must cut their own barley first'],
  [/^commitment/, 'they have already promised to do something else'],
  [/^distrust/, 'they don’t trust your office'],
  [/^capacity/, 'they are not able to do this work'],
  [/^norm/, 'they believe this is wrong'],
  [/^habit/, 'they want to follow their usual routine'],
];

function hunchLine(hc: Hunch | undefined, who: string): string {
  if (!hc) return '';
  const sure =
    hc.confidence < 0.15 ? 'You can’t tell yet' : hc.confidence < 0.45 ? 'You think' : 'You are fairly sure';
  if (hc.confidence < 0.15) return `${sure} how ${who} would answer.`;
  const why = hc.verdict === 'assented' ? '' : (REASON.find(([re]) => re.test(hc.reason))?.[1] ?? '');
  return `${sure} ${who} ${VERDICT[hc.verdict] ?? 'would answer'}${why ? ` because ${why}` : ''}.`;
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
    .filter((n) => n.at <= s.minute && (n.house === hh.id || (n.who && hh.members.includes(n.who))))
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
    ? `<p class="soft" >Your book: ${esc(
        acts
          .slice(-2)
          .reverse()
          .map((a) => `you ${a.what} (${when(a.day)})`)
          .join('; '),
      )}.</p>`
    : '';
  const share =
    s.flags.verbs.includes('take') && underSeal(s, hh) && hh.members.length
      ? `<p class="soft" >The landowner’s book: their share is ${hh.eased ? 'eased' : 'unchanged'}; ${hh.paid >= shareOwed(hh) - 0.5 ? 'paid' : hh.paid > 0 ? 'part paid' : 'not yet paid'}.</p>`
      : '';
  const response = recent.find((n) => n.words && (n.kind === 'voice' || n.ask));
  const refusal = selectedRefusal(s, hh);
  if (!houseDetails)
    return `<div class="card">${response ? `<div class="house-response">${datedReply(s, response)}</div>` : ''}${refusal || (!response ? '<p class="soft">There is no new reply from this house.</p>' : '')}</div>`;
  return `<div class="card">
    ${response ? `<div class="house-response">${datedReply(s, response)}</div>` : ''}${refusal}
    <div class="house-context">
    ${lines
      .filter(Boolean)
      .map((l) => `<div class="hunch">${esc(l)}<span class="by">your guess</span></div>`)
      .join('')}
    ${reeve ? `<div class="hunch reeve">${esc(reeve)}<span class="by">The reeve’s guess</span></div>` : ''}
    <p class="limits">${esc(limitsWords(s, hh))}</p><div class="looks">${esc(hh.members.length ? hh.looks : 'The door is shut and the hearth is cold.')}</div><div class="people">${hh.members.length ? esc(names) : 'Nobody lives here now.'}</div>${share}${book}</div>
    ${pending}
    ${recent.length ? `<details class="house-history"><summary>Earlier replies from this house</summary>${recent.map((n) => noteLine(n)).join('')}</details>` : ''}
  </div>`;
}

const JOB_LABEL: Record<Job, string> = {
  'reap-agha': 'to the landowner’s barley',
  'bring-share': 'to bring the share',
  'build-mill': 'to the mill',
};

function giftHint(s: ValleyState): string {
  return s.agha.granary < 2
    ? 'The granary is too low. Giving returns when threshing, shares, or a loan bring grain in.'
    : 'This sends a small sack from the granary. It leaves less grain for the due.';
}

function visitHint(s: ValleyState): string {
  return busy(s) && s.kahyaState.visit
    ? `You can visit again when you return to the residence on ${fullDateEnglish(dayOfMinute(s.kahyaState.visit.back))}.`
    : 'Visits open when a household puts off your call; send word through the crier first.';
}

function houseThumbs(s: ValleyState, hh: Household): string {
  const out: string[] = [];
  const empty = !hh.members.length;
  const job = currentJob(s);
  const add = (label: string, fn: () => void, reason: string | null, hint: string, hold = false) => {
    const k = actions.length;
    actions.push(() => {
      actionCaption = `${label}: ${reason ?? hint}`;
      if (!reason) fn();
      else drawSheet(true);
    });
    out.push(
      `<button data-k="${k}"${hold && !reason ? ' class="hold"' : ''}${reason ? ' aria-disabled="true" class="blocked"' : ''}>${esc(label)}${hold && !reason ? '<span class="fill"></span>' : ''}</button>`,
    );
  };
  if (job)
    add(
      job === 'reap-agha' ? 'Call to barley' : job === 'bring-share' ? 'Call for share' : 'Call to mill',
      () => order({ verb: 'call', job, houses: [hh.id] }),
      callUnavailable(s, job, hh),
      'The crier carries your request; they can refuse.',
    );
  if (job === 'reap-agha' && yearOf(dayOfMinute(s.minute)) > 1)
    add(
      'Call for pay',
      () => order({ verb: 'call', job, houses: [hh.id], wage: true }),
      callUnavailable(s, job, hh),
      'A small share of the cut grain goes to their jars.',
    );
  if (s.flags.verbs.includes('visit'))
    add(
      'Visit',
      () => order({ verb: 'visit', house: hh.id }),
      empty ? 'Nobody lives here.' : busy(s) || !s.flags.verbs.includes('visit') ? visitHint(s) : null,
      hh.hamlet === 'upper'
        ? 'You will be away from the residence for most of a morning.'
        : 'You will be away from the residence for a couple of hours.',
    );
  if (s.flags.verbs.includes('give'))
    add(
      'Send grain',
      () => order({ verb: 'give', house: hh.id, kile: 6 }),
      empty
        ? 'Nobody lives here.'
        : !s.flags.verbs.includes('give')
          ? 'Giving opens when a household is short of food or asks at your door.'
          : s.agha.granary < 2
            ? giftHint(s)
            : null,
      `${knownFood(s, hh)} ${giftHint(s)}`,
    );
  const blocked = empty
    ? 'Nobody lives here.'
    : !underSeal(s, hh)
      ? 'This hamlet joins on 10 June, year two.'
      : hh.paid >= shareOwed(hh) - 0.5
        ? `Their share is paid. ${cropReturnWords(s)}`
        : null;
  if (s.flags.verbs.includes('ease'))
    add(
      'Ease share',
      () => order({ verb: 'ease', house: hh.id }),
      blocked ?? (hh.eased ? `Already eased. ${cropReturnWords(s)}` : null),
      'Leave half of this year’s share in their jars; the neighbours will notice.',
    );
  if (s.flags.verbs.includes('seize'))
    add(
      'Reeve’s men',
      () => order({ verb: 'seize', house: hh.id }),
      blocked,
      'They take the share from the jars; the household will remember that you used force.',
      true,
    );
  return `<p class="action-caption" role="status">${esc(actionCaption || limitsWords(s, hh))}</p><div class="verb-grid">${out.join('')}</div>`;
}

function pauseToCover() {
  cancelAnimationFrame(raf);
  writeLog();
  bindVolume().finally(title);
}

function hurry() {
  const s = g?.valley;
  if (
    !s ||
    selected ||
    tab !== 'notes' ||
    s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute)
  )
    return;
  seenNote = Math.max(seenNote, s.notes.at(-1)?.id ?? 0);
  hurrying = true;
  slowUntil = 0;
  drawTop();
}

function valleyThumbs(s: ValleyState): string {
  const job = currentJob(s);
  const reason = job ? callUnavailable(s, job) : null;
  const ask =
    job && s.asks.find((a) => a.job === job && !a.closed && a.from <= s.minute && a.until > s.minute);
  const who = s.flags.upper ? 'the valley' : 'the hamlet';
  const label =
    job === 'bring-share'
      ? `Call ${who} to bring the shares`
      : `Call ${who} ${JOB_LABEL[job ?? 'reap-agha']}`;
  const houses = s.households.filter((h) => underSeal(s, h) && h.members.length).map((h) => h.id);
  const primary =
    job && !reason
      ? btn(label, () => order({ verb: 'call', job, houses }), { cls: 'primary' })
      : btn('Skip ⏩', hurry, { cls: 'primary', disabled: hurrying }).replace(
          '<button ',
          '<button data-until aria-label="Skip to the next event" ',
        );
  return `<p class="action-caption">${esc(ask ? `The call is open until ${fullDateEnglish(dayOfMinute(ask.until))}.` : job && !reason ? 'The crier carries your request; they can refuse.' : limitsWords(s))}</p>${primary}<div class="row">${btn('Other orders ▸', () => openReading('orders'))}${btn('The ledger ▸', () => openReading('ledger'))}</div>`;
}

function otherOrders(s: ValleyState): string {
  const out: string[] = [];
  const job = currentJob(s);
  const houses = s.households.filter((h) => underSeal(s, h) && h.members.length).map((h) => h.id);
  const send = (o: Order) => {
    tab = 'notes';
    order(o);
    drawSheet(true);
  };
  if (job)
    out.push(
      btn(
        job === 'bring-share' ? 'Call for the shares' : `Call ${JOB_LABEL[job]}`,
        () => send({ verb: 'call', job, houses }),
        {
          disabled: !!callUnavailable(s, job),
          hint: callUnavailable(s, job) ?? 'The crier carries your request.',
        },
      ),
    );
  if (job === 'reap-agha' && yearOf(dayOfMinute(s.minute)) > 1)
    out.push(
      btn('Call to cut barley for pay', () => send({ verb: 'call', job, houses, wage: true }), {
        disabled: !!callUnavailable(s, job),
        hint: callUnavailable(s, job) ?? 'A small share of the cut grain goes to their jars.',
      }),
    );
  const blocked =
    !s.flags.verbs.includes('borrow') || !!(s.agha.loan && s.minute - s.agha.loan.asked < 300 * DAY);
  out.push(
    btn('Write to the landowner for grain', () => send({ verb: 'borrow', kile: 80 }), {
      disabled: blocked,
      hint:
        loanReturnWords(s) ??
        (!s.flags.verbs.includes('borrow')
          ? 'The letter opens when the forecast shows a shortfall or hungry houses find the granary low.'
          : 'A cart arrives in twelve days; repay a quarter more at a later rider.'),
    }),
  );
  return `<div class="other-orders">${out.join('')}</div>`;
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
    <p>${esc(nextWords(s))}</p>
    <p class="soft" >This grain is set aside for the due. Gifts leave less for the rider.</p>
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
    ${s.flags.verbs.includes('take') ? `<h3 style="margin:8px 0 0">${sharesFresh(s) ? 'Shares this year' : 'Shares brought to the last rider'}</h3><table>${rows}</table>` : ''}
    <p class="soft" >The term ends at the elders’ gathering, ${esc(dateWords(END_DAY))} of year three.</p>
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
  app.innerHTML = `<div class="page elders ending-page">
    ${topbar(dismissed ? 'The second letter' : 'The elders’ gathering')}<div class="ending-body"><h1>${dismissed ? 'The second letter' : 'The elders’ gathering'}</h1>
    <p class="soft">${esc(dateWords(dayOfMinute(s.minute)))} of year ${yearWord(yearOf(dayOfMinute(s.minute)))}.</p>
    ${dismissed ? '<p>The landowner’s rider came back with a sealed letter. The elders did not gather for you; they said these things at their own doors, and the local overseer wrote them down.</p>' : '<p>They sat along the wall of the residence, as they do at the end of a steward’s term, and each said one thing.</p>'}
    ${elders.map((e) => `<div class="elder"><b>${esc(e.name)}</b>, ${esc(e.house)}<span class="w">“${esc(e.words)}”</span></div>`).join('')}
    <p>${esc(letter)}</p>
    <details class="closing-grain"><summary>See the tally</summary><p data-closing-grain></p></details>
    </div><footer class="ending-actions"><div class="row"><button data-feedback>Feedback</button><button data-ending-notebook>Earlier replies</button>${LAB_TOOLS ? '<button data-download>Download this run</button>' : ''}</div><button class="primary" data-go="new">Begin a new term</button>${mark()}${footer()}</footer>
  </div>`;
  drawClosingGrain();
  app.querySelector('[data-feedback]')?.addEventListener('click', openFeedback);
  app.querySelector('[data-ending-notebook]')?.addEventListener('click', openNotebook);
  app.querySelector('[data-download]')?.addEventListener('click', download);
  app.querySelector('[data-go="new"]')?.addEventListener('click', () => {
    const button = app.querySelector<HTMLButtonElement>('[data-go="new"]');
    if (!button || app.querySelector('[data-ending-confirm]')) return;
    const confirm = document.createElement('span');
    confirm.innerHTML =
      '<p>Replace your saved game?</p><button data-ending-confirm>Start new game</button><button data-ending-cancel>Cancel</button>';
    button.after(confirm);
    confirm
      .querySelector('[data-ending-confirm]')
      ?.addEventListener('click', () => void begin(Math.floor(Math.random() * 1e9)));
    confirm.querySelector('[data-ending-cancel]')?.addEventListener('click', () => confirm.remove());
  });
}

function drawClosingGrain() {
  const target = app.querySelector('[data-closing-grain]');
  if (!target) return;
  target.textContent = g ? closingGrain(g.valley, true) : '';
}

function download() {
  if (!g) return;
  const sv: SavedGame = castSession.exportRun(save(g, volume));
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
  /** Jump ahead (headless, for testing): live the valley to `day` without drawing. */
  skipTo: (day: number) => {
    if (!g) return;
    step(g, day * DAY);
    writeLog();
    if (g.valley.flags.ended) ending();
    else {
      drawSheet(true);
      drawMap();
    }
  },
};
