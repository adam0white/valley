import { dialogueChoices, dialogueStatus, dialogueWords } from '../sim/dialogue.ts';
import {
  allianceEdition,
  dialogueEdition,
  PUBLIC_EDITION,
  passEdition,
  type RulesEdition,
  rulesOf,
  type TermDecision,
} from '../sim/edition.ts';
import { clockWords, grainPreview, grainReceipt, paceWords, skipBlock, travelWords } from './clarity.ts';
import { validLocalLog } from './local-log.ts';
import { musicEvent } from './music.ts';
import { automaticRate, type Pace, READING_MS } from './pacing.ts';
/**
 * The Valley UI: plain DOM and a Canvas 2D ink map over the pure sim. The UI reads state and gives orders through
 * `act`; it never changes the sim directly. Real time drives sim minutes in fixed quanta (continuous, with a slowdown
 * when something heavy happens; menus pause time). The save is the kahya's ledger: the seed and the input log in local
 * storage, and a bound volume (the whole state, gzipped) in IndexedDB every few weeks of the valley's time.
 */

import { type PhoneStage, phoneStage, telemetryNotice } from '@adam0white/lab-kit';
import { brokerUnavailable } from '../sim/brokering.ts';
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
import { introductionEligible } from '../sim/introductions.ts';
import type { CastStart } from '../sim/passport.ts';
import { type Household, householdLabel, personLabel } from '../sim/people.ts';
import { stewardBusy } from '../sim/steward.ts';
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
  replyKey,
  SAYING_WORDS,
  sayingsAt,
  shareOwed,
  underSeal,
  V,
  type ValleyState,
} from '../sim/valley.ts';
import type { Saying } from '../sim/voices.ts';
import { CastSession, type LocalCastReceipt } from './cast-session.ts';
import { debugError, FOREIGN_FILE, lab, labScreen, mountLab, openFeedback, openMenu } from './lab.ts';
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
  noteWords,
  nowWords,
  PURPOSE,
  paidShareWords,
  shareOwnerWords,
} from './presentation.ts';
import { closingGrain } from './tally.ts';

const castSession = new CastSession(lab, FOREIGN_FILE ? null : undefined);
const LOG = 'valley-log-v1';
let fileLog: Log | null = null;
const fileVolumes = new Map<string, Bound>();
let speed: Pace = 'automatic';
const HUB = 'https://human.adamwhite.work';

interface Log {
  rules?: RulesEdition;
  plainEnglish?: boolean;
  cast?: CastStart;
  continuity?: LocalCastReceipt;
  game: 'valley';
  version: string;
  seed: number;
  inputs: Input[];
  minute: number;
  volume: number;
  savedAt: string;
  /** Presentation only: delays the player let be ("ask:person"). Never replayed. */
  accepted?: string[];
}

const notice = telemetryNotice(undefined, FOREIGN_FILE ? { preservation: 'preserve' } : {});
// Use portable notice metrics without shrinking text or changing body typography.
if (notice) {
  notice.style.paddingInline = '2px';
  notice.style.fontFamily = 'Arial, "Liberation Sans", sans-serif';
  // Valley's root is 17px. Keep normal disclosure at 14px and scale enlarged roots.
  notice.style.fontSize = 'max(14px, 0.8rem)';
}
const noticeFooter = document.createElement('footer');
noticeFooter.className = 'notice-footer';
const recordingStatus = document.createElement('p');
recordingStatus.dataset.recordingStatus = '';
recordingStatus.setAttribute('role', 'status');
function refreshRecordingNotice() {
  if (!FOREIGN_FILE) return;
  const status = lab.preservationStatus;
  if (status === 'existing-local' && lab.telemetryOn) {
    recordingStatus.remove();
    if (notice && notice.parentNode !== noticeFooter) noticeFooter.append(notice);
    return;
  }
  notice?.remove();
  const words =
    status === 'missing-identity'
      ? 'Recording is unavailable because this browser has no compatible recording identity. You can still play and download this file.'
      : status === 'incompatible-session'
        ? 'Recording is unavailable because this tab’s recording session cannot be reused. You can still play and download this file.'
        : status === 'identity-mismatch'
          ? 'Recording is unavailable because this browser has conflicting recording identities. You can still play and download this file.'
          : 'Recording is inactive in this file session. You can still play and download this file.';
  if (recordingStatus.textContent !== words) recordingStatus.textContent = words;
  if (recordingStatus.parentNode !== noticeFooter) noticeFooter.append(recordingStatus);
}
if (FOREIGN_FILE) refreshRecordingNotice();
else if (notice) noticeFooter.append(notice);
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
let textSizeObserver: ResizeObserver | null = null;
let actionCaption = '';
let insistReceipt: { ask: string; pid: string; previous: string; name: string; job: string } | null = null;
let pendingGrain: { game: Game; house: Household; stock: number; members: string } | null = null;
let importStatus = '';
let houseDetails = false;
/** A household call waiting for a second press because their jars looked low. */
let confirmCall: string | null = null;
/** The house whose list of things to say is open. */
let sayOpen: string | null = null;
/** What the last notebook answer did (insist with a group, let them finish). */
let notebookReceipt = '';
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
let sheetGeneration = 0;
let storedLogProblem = false;

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

/** Daylight minutes between two minutes (cutting happens in daylight). */
function daylightBetween(a: number, b: number): number {
  let total = 0;
  for (let d = dayOfMinute(a); d <= dayOfMinute(Math.max(a, b - 1)); d++) {
    const { rise, set } = daylight(doyOf(d));
    total += Math.max(0, Math.min(b, d * DAY + set) - Math.max(a, d * DAY + rise));
  }
  return total;
}

/** The one dated public forecast: the opening two-day rain warning. The pace guess never simulates ahead. */
function rainWarned(s: ValleyState): boolean {
  return (
    s.minute < 2 * DAY &&
    s.agha.standing > 5 &&
    s.asks.some((a) => a.job === 'reap-agha') &&
    s.notes.some(
      (n) =>
        n.kind === 'weather' && n.at <= s.minute && n.text.startsWith('Clouds are building over the ridge.'),
    )
  );
}

/** What the steward has seen of the uncut barley, sampled as time passes. Presentation only. */
let cutSamples: { seed: number; minute: number; standing: number }[] = [];
function sampleCut(s: ValleyState) {
  if (!rainWarned(s)) return;
  const last = cutSamples.at(-1);
  if (last && (last.seed !== s.seed || s.minute < last.minute || s.agha.standing > last.standing + 0.5))
    cutSamples = [];
  if (!last || cutSamples.length === 0 || s.minute - last.minute >= 20)
    cutSamples = [...cutSamples, { seed: s.seed, minute: s.minute, standing: s.agha.standing }].slice(-30);
}

/** Your guess whether the cutting finishes before the rain, from the pace of the last few daylight hours. */
function rainGuess(s: ValleyState): string | null {
  if (!rainWarned(s)) return null;
  const old = cutSamples.find(
    (x) => x.seed === s.seed && x.minute <= s.minute && daylightBetween(x.minute, s.minute) <= 240,
  );
  const watched = old ? daylightBetween(old.minute, s.minute) : 0;
  if (!old || watched < 60)
    return 'Watch the field for an hour of daylight to judge whether the cutting will finish before the rain.';
  const rate = (old.standing - s.agha.standing) / watched;
  const left = daylightBetween(s.minute, 2 * DAY);
  const uncut = Math.max(0, s.agha.standing - rate * left);
  if (rate <= 0.001)
    return 'Nobody has cut the landowner’s barley in the last few hours. At this pace it will all be standing when the rain comes.';
  if (uncut < 5)
    return 'At the pace of the last few hours, the cutting looks likely to finish before the rain.';
  const share = uncut / Math.max(1, s.agha.standing);
  return `At the pace of the last few hours, ${share > 0.66 ? 'most of' : share > 0.33 ? 'about half of' : 'some of'} the landowner’s barley would still be standing when the rain comes. More cutters would help.`;
}

// ---------- saves: the ledger ----------

function writeLog(): boolean {
  if (!g) return false;
  const log: Log = {
    ...(g.cast ? { cast: structuredClone(g.cast) } : {}),
    continuity: castSession.metadata(),
    ...(rulesOf(g.valley) ? { rules: rulesOf(g.valley) } : {}),
    game: 'valley',
    plainEnglish: g.plainEnglish ?? true,
    version: GAME_VERSION,
    seed: g.valley.seed,
    inputs: g.inputs,
    minute: g.valley.minute,
    volume,
    savedAt: new Date().toISOString(),
    ...(accepted().size ? { accepted: [...accepted()] } : {}),
  };
  try {
    const text = JSON.stringify(log);
    if (FOREIGN_FILE) {
      fileLog = log;
      lab.captureSave(JSON.parse(text));
      return true;
    }
    localStorage.setItem(LOG, text);
    lab.captureSave(JSON.parse(text));
    return localStorage.getItem(LOG) === text;
  } catch {
    return false;
  }
}

function readLog(): Log | null {
  if (FOREIGN_FILE) return fileLog;
  storedLogProblem = false;
  try {
    const raw = localStorage.getItem(LOG);
    if (!raw) {
      storedLogProblem = false;
      return null;
    }
    const log = JSON.parse(raw) as Log;
    storedLogProblem = !validLocalLog(log);
    return storedLogProblem ? null : log;
  } catch {
    storedLogProblem = true;
    return null;
  }
}

function db(): Promise<IDBDatabase> {
  if (FOREIGN_FILE) return Promise.reject(new Error('Native storage is unavailable in a file session.'));
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
  inputLog?: string;
  digest?: string;
  rules?: RulesEdition;
}

let runTransition = 0;

async function bindVolume(): Promise<boolean> {
  if (!g) return false;
  const logSaved = writeLog();
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
      inputLog: JSON.stringify(g.inputs),
      digest: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join(''),
      ...(rulesOf(s) ? { rules: rulesOf(s) } : {}),
      gz: await gzip(json),
    };
    if (!current()) return false;
    if (FOREIGN_FILE) {
      fileVolumes.set(`history:${castSession.runId}:${bound.digest}`, bound);
      fileVolumes.set('current', bound);
      volume++;
      lab.captureSave({ seed: bound.seed, k: bound.k, minute: bound.minute, state: JSON.parse(json) });
      return writeLog();
    }
    const d = await db();
    if (!current()) return false;
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('volumes', 'readwrite');
      tx.objectStore('volumes').put(bound, `history:${castSession.runId}:${bound.digest}`);
      tx.objectStore('volumes').put(bound, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    if (!current()) return false;
    volume++;
    lab.captureSave({ seed: bound.seed, k: bound.k, minute: bound.minute, state: JSON.parse(json) });
  } catch (error) {
    console.warn('Recovery snapshot could not be saved. The input log is kept.', error);
    return false;
  }
  return current() && writeLog() && logSaved;
}

async function readVolume(): Promise<Bound | null> {
  if (FOREIGN_FILE) return fileVolumes.get('current') ?? null;
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

async function openVolumes() {
  const dialog = document.createElement('dialog');
  dialog.className = 'volumes-panel';
  dialog.setAttribute('aria-label', 'Prior ledger volumes');
  dialog.innerHTML = `<button data-close>Close</button><h2>Prior volumes</h2><p>${FOREIGN_FILE ? 'These recovery volumes stay in this file session. Download the full game file to keep your progress.' : 'These are real recovery volumes saved in this browser. Reading them does not rewind the game or give an older person ownership of a new history.'}</p><div data-pages role="status">Reading volumes…</div>`;
  document.body.append(dialog);
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  try {
    const entries = FOREIGN_FILE
      ? [...fileVolumes.entries()].filter(([key]) => key.startsWith('history:')).map(([, bound]) => bound)
      : await (async () => {
          const d = await db();
          return await new Promise<Bound[]>((resolve, reject) => {
            const tx = d.transaction('volumes');
            const rows: Bound[] = [];
            const r = tx.objectStore('volumes').openCursor(IDBKeyRange.bound('history:', 'history;'));
            r.onsuccess = () => {
              const cursor = r.result;
              if (!cursor) return;
              rows.push(cursor.value as Bound);
              cursor.continue();
            };
            tx.oncomplete = () => resolve(rows);
            tx.onerror = () => reject(tx.error);
          });
        })();
    const pages = dialog.querySelector('[data-pages]');
    if (!pages || !dialog.isConnected) return;
    pages.innerHTML = entries.length
      ? entries
          .sort((a, b) => b.minute - a.minute)
          .map((b) => {
            const crossed =
              b.runId === castSession.runId && !!g && (b.minute > g.valley.minute || b.k > g.inputs.length);
            const label = `${fullDateEnglish(dayOfMinute(b.minute))}, ${b.k} recorded actions. ${b.runId === castSession.runId ? 'This term.' : 'Another saved term.'}`;
            return `<details><summary>${crossed ? `<s>${esc(label)}</s> Later pages outside the current continuation.` : esc(label)}</summary><button data-volume="${entries.indexOf(b)}">Read saved pages</button><div></div></details>`;
          })
          .join('')
      : '<p>No prior recovery volume has been saved yet.</p>';
    for (const button of pages.querySelectorAll<HTMLButtonElement>('[data-volume]'))
      button.addEventListener('click', async () => {
        const bound = entries[Number(button.dataset.volume)];
        const target = button.nextElementSibling;
        if (!bound || !target) return;
        try {
          const state = JSON.parse(await gunzip(bound.gz)) as ValleyState;
          target.innerHTML = state.notes
            .filter((n) => n.at <= bound.minute)
            .slice(-12)
            .map((n) => `<p>${esc(n.text)}${n.words ? ` “${esc(noteWords(n) ?? '')}”` : ''}</p>`)
            .join('');
          button.disabled = true;
        } catch {
          target.textContent = 'This volume could not be read. The current game is unchanged.';
        }
      });
  } catch {
    const pages = dialog.querySelector('[data-pages]');
    if (pages) pages.textContent = 'The browser could not read prior volumes.';
  }
}

async function clearSaves() {
  if (FOREIGN_FILE) return;
  try {
    localStorage.removeItem(LOG);
    const d = await db();
    d.transaction('volumes', 'readwrite').objectStore('volumes').delete('current');
  } catch {}
}

async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([text]);
  // A Blob input stream belongs to its document and can fail during WebKit unload.
  const input = new Response(text).body;
  if (!input) throw new Error('Save compression input is unavailable.');
  return new Response(input.pipeThrough(new CompressionStream('gzip'))).blob();
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
  if (!validLocalLog(log))
    throw new Error('This saved game uses an older Valley version. Start a new game from the title page.');
  if (log.cast) newGame(log.seed, log.cast); // Validate the pinned semantic header even when a bound volume exists.
  const bound = await readVolume();
  let game: Game;
  let rest: Input[];
  if (
    // Dialogue receipts require authoritative input replay; a volume digest proves only integrity.
    !dialogueEdition(log.rules) &&
    bound &&
    typeof bound.runId === 'string' &&
    bound.runId.length > 0 &&
    bound.runId === log.continuity?.runId &&
    bound.seed === log.seed &&
    bound.rules === log.rules &&
    Number.isSafeInteger(bound.k) &&
    bound.k >= 0 &&
    bound.inputLog === JSON.stringify(log.inputs.slice(0, bound.k)) &&
    bound.k <= log.inputs.length &&
    bound.minute <= log.minute
  ) {
    try {
      const json = await gunzip(bound.gz);
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))),
      ]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      const state = JSON.parse(json) as ValleyState;
      if (
        digest !== bound.digest ||
        state.seed !== log.seed ||
        state.minute !== bound.minute ||
        rulesOf(state) !== log.rules
      )
        throw new Error('Recovery volume differs from its receipt.');
      game = {
        valley: restoreState(state),
        plainEnglish: log.plainEnglish ?? true,
        inputs: log.inputs.slice(0, bound.k),
        ...(log.cast ? { cast: structuredClone(log.cast) } : {}),
      };
      rest = log.inputs.slice(bound.k);
    } catch {
      // An intact input log is authoritative when the recovery shortcut is damaged.
      game = newGame(log.seed, log.cast, false, log.plainEnglish ?? true, log.rules);
      rest = log.inputs;
    }
  } else {
    game = newGame(log.seed, log.cast, false, log.plainEnglish ?? true, log.rules);
    rest = log.inputs;
  }
  while (game.valley.minute + QUANTUM <= log.minute && !game.valley.flags.ended) {
    step(game, Math.min(log.minute, game.valley.minute + 3 * DAY), rest);
    onProgress(game.valley.minute);
    await new Promise((r) => setTimeout(r, 0));
  }
  const pending = log.inputs.slice(game.inputs.length);
  if (pending.length) step(game, game.valley.minute, pending);
  if (JSON.stringify(game.inputs) !== JSON.stringify(log.inputs))
    throw new Error('The saved input log contains actions that cannot be replayed. It has been kept.');
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
    newGame: FOREIGN_FILE ? undefined : title,
    diagnostics: () => {
      cancelAnimationFrame(raf);
      writeLog();
      title();
      app.querySelector<HTMLDialogElement>('.ways-panel')?.showModal();
    },
    closeFile: closeFileSession,
    recordingChanged: refreshRecordingNotice,
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
      const ok = await bindVolume();
      const status = document.querySelector('[data-save-status]');
      if (status)
        status.textContent = ok
          ? FOREIGN_FILE
            ? 'This file is kept in this tab. Download it to keep your progress.'
            : 'Your input log and recovery volume were saved in this browser.'
          : 'The browser could not confirm a complete save. Keep this page open and download the run from Lab tools.';
    },
  });
  if (!FOREIGN_FILE && 'serviceWorker' in navigator && location.hostname !== 'localhost')
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  title();
}

function topbar(words: string): string {
  return `<header class="topbar"><span class="topbar-title">${words}</span><div class="topbar-actions"><button type="button" data-info aria-label="Information" popovertarget="game-info">i</button><button type="button" data-menu aria-label="Menu">≡<span class="desktop-label"> Menu</span></button></div></header><section id="game-info" popover="auto"><button data-info-close aria-label="Close information">×</button><div data-info-body></div></section>`;
}

function infoWords(): string {
  if (!g || app.querySelector('.title-page'))
    return `<h2>The valley</h2><p>Call the households to help with the harvest. Read their replies. Visit them to learn what they need.</p><p>Grain you give leaves less to pay the landowner. Rain can damage uncut barley.</p>`;
  if (g.valley.flags.ended)
    return `<h2>The tally</h2><p>The elders speak from what they remember. The game counts grain delivered, gifts and unpaid grain separately.</p>`;
  if (selected)
    return `<h2>What you know about a household</h2><p>Your guess comes from what you last saw. The local overseer makes his own guess about a person. Neither guess is certain.</p><p>A visit to the lower hamlet takes a couple of hours. A visit to the upper hamlet takes most of a morning. You can visit again when you return.</p>`;
  const s = g.valley;
  return `<h2>Your work</h2><p>${esc(nextWords(s))}</p><p>The village announcer carries your requests. People consider their own field work and can refuse. Hold the button beside a refusal, or tap it twice, to insist. They will come, and they will remember. Choose Let them finish first to accept a delay; their reply stays the same.</p><p>A visit takes time to walk there and back. Reduce a household’s grain payment to leave more in its jars. The neighbours will notice.</p><p>The grain bar shows the harvest. The filled part is grain in the granary. The striped part is cut grain waiting to be separated from its stalks. The outline shows uncut grain. The mark shows what the landowner is owed.</p><p>Time slows for replies and knocks at your door. Opening the menu or this information panel stops time. ${esc(limitsWords(s))}</p>${seasonOf(doyOf(dayOfMinute(s.minute))) === 'winter' ? (s.edition ? '<p>Paid mill calls use grain from the granary for completed carrying. Ordinary calls offer no pay.</p>' : '<p>People receive no grain pay for mill work. You can write for grain when the estimate shows that you will have too little.</p>') : ''}<p>You are the steward. You manage the landowner’s grain, which is counted in grain measures.</p>`;
}

function closeFileSession() {
  if (!FOREIGN_FILE) return;
  ++runTransition;
  cancelAnimationFrame(raf);
  releaseWake();
  g = null;
  castSession.game = null;
  castSession.invalidate();
  fileLog = null;
  fileVolumes.clear();
  volume = 0;
  fileTitle();
}

function fileTitle() {
  refreshRecordingNotice();
  cancelAnimationFrame(raf);
  stage?.destroy();
  stage = null;
  textSizeObserver?.disconnect();
  textSizeObserver = null;
  app.innerHTML = `<div class="page title-page">${topbar('The Valley')}<h1>Open a Valley file</h1><p>This file stays in this tab. Download it before closing to keep your progress. Your browser ledger and people stay separate.</p><label for="foreign-run">Open a Valley file</label><input id="foreign-run" type="file" accept=".json,application/json"><p id="foreign-result" role="status"></p>${g ? '<button data-file-resume>Resume</button>' : ''}</div>`;
  app.querySelector('[data-file-resume]')?.addEventListener('click', enter);
  app.querySelector<HTMLInputElement>('#foreign-run')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    const result = app.querySelector('#foreign-result');
    if (!file || !result) return;
    const transition = ++runTransition;
    const previous = g;
    const previousMeta = castSession.metadata();
    let restoring = false;
    const previousFile = previous ? castSession.exportRun(save(previous, volume)) : null;
    try {
      const saved = JSON.parse(await file.text()) as SavedGame | CompactRun;
      const allowed = new Set([
        'rules',
        'plainEnglish',
        'castHeads',
        'castSources',
        'cast',
        'game',
        'version',
        'framework',
        'seed',
        'minute',
        'inputs',
        'state',
        'fingerprint',
        'savedAt',
        'label',
      ]);
      if (Object.keys(saved).some((key) => !allowed.has(key)))
        throw new Error('This file has unsupported fields.');
      if (saved.game !== 'valley') throw new Error('Open a full Valley file.');
      restoring = true;
      const restored = load(saved);
      if (fingerprint(restored.valley) !== saved.fingerprint) throw new Error('The saved game differs.');
      if (transition !== runTransition) return;
      await castSession.loaded(restored, undefined, true, saved);
      if (transition !== runTransition) return;
      g = restored;
      volume = 0;
      fileVolumes.clear();
      importStatus = 'This file has been loaded. Download it to keep your progress.';
      writeLog();
      await bindVolume();
      if (transition === runTransition) enter();
    } catch (error) {
      if (transition !== runTransition) return;
      if (restoring && previousFile) {
        g = load(previousFile);
        await castSession.loaded(g, previousMeta, true, previousFile);
      } else if (!previous) {
        g = null;
        castSession.game = null;
      }
      result.textContent = error instanceof Error ? error.message : 'This file could not be loaded.';
    }
  });
}

function title() {
  if (FOREIGN_FILE) {
    fileTitle();
    return;
  }
  pendingGrain = null;
  labScreen('title');
  cancelAnimationFrame(raf);
  const log = readLog();
  const hasSave = !!log || storedLogProblem;
  const where = storedLogProblem
    ? 'This browser’s saved ledger is malformed or incompatible. It is kept here. Starting a new game will replace it.'
    : log && log.version !== GAME_VERSION
      ? 'This saved game uses an older Valley version. Start a new game to play with the new people. Your old saved game stays here until you start.'
      : log
        ? `Your ledger is open at ${dateWords(dayOfMinute(log.minute))} of year ${yearWord(yearOf(dayOfMinute(log.minute)))}.`
        : '';
  textSizeObserver?.disconnect();
  textSizeObserver = null;
  stage?.destroy();
  stage = null;
  app.innerHTML = `<div class="page title-page">
    ${topbar(`<a href="${HUB}/games/" target="_top">All games</a>`)}
    <section class="title-premise"><h1>The Valley</h1><p class="purpose">${esc(PURPOSE)}</p><p class="soft">People can refuse you, and they remember how you answer.</p></section>
    <div class="vignette" aria-hidden="true"><svg viewBox="0 0 360 140"><path d="M0 95Q80 15 160 90T360 70M0 130Q90 50 180 120T360 95M250 0Q200 70 260 140" fill="none" stroke="currentColor"/><g fill="none" stroke="currentColor" stroke-width="2"><path d="M70 95v-18l12-12 12 12v18zM130 105V87l12-12 12 12v18zM190 90V72l12-12 12 12v18zM280 100V82l12-12 12 12v18z"/></g></svg></div>
    <footer class="title-actions"><p class="term-description">Visit a household and choose what to say. Grain wages, winter loans, inspections, pass journeys and family arrangements are part of this term. The steward needs food and rest between walks. People stay local to this valley.</p>${where ? `<p class="hand">${esc(where)}</p>` : ''}
    ${hasSave ? `${log && log.version === GAME_VERSION ? '<button class="primary" data-go="open">Resume</button>' : ''}<button data-go="new" class="hold">New game<span class="fill"></span></button><p class="soft">This replaces your saved game.</p>` : '<button class="primary" data-go="new">New game</button>'}${mark()}</footer>
    <dialog class="ways-panel" aria-label="Other ways to start"><header><h2>Other ways to start</h2><button data-ways-close aria-label="Close other ways to start">×</button></header><label for="valley-name">A named valley</label><input id="valley-name" placeholder="Kuyulu" maxlength="80"><p>The same name gives the same valley.</p><button data-seed${log ? ' class="hold"' : ''}>Begin this valley${log ? '<span class="fill"></span>' : ''}</button>${log ? '<p class="soft">This replaces your saved game.</p>' : ''}</dialog>
  </div>`;
  app.querySelector('[data-go="open"]')?.addEventListener('click', () => {
    if (log && log.version === GAME_VERSION) openLedger(log);
  });
  const fresh = (seed: number) => {
    void begin(seed, false, PUBLIC_EDITION);
  };
  const nb = app.querySelector<HTMLButtonElement>('[data-go="new"]');
  if (nb) {
    nb.addEventListener('click', () => {
      if (!hasSave) return fresh(Math.floor(Math.random() * 1e9));
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
    if (hasSave) bindHold(seed, named);
    else seed.addEventListener('click', named);
  }
}

function openLedger(log: Log) {
  const transition = ++runTransition;
  cancelAnimationFrame(raf);
  castSession.invalidate();
  app.innerHTML = `<div class="page">${topbar('The Valley')}<h2>Loading your saved game…</h2><p class="hand" id="prog"></p></div>`;
  const prog = app.querySelector('#prog') as HTMLElement;
  reopen(log, (m) => {
    prog.textContent = `${dateWords(dayOfMinute(m))} of year ${yearWord(yearOf(dayOfMinute(m)))}`;
  })
    .then(async (game) => {
      if (transition !== runTransition) return;
      g = game;
      if (Array.isArray(log.accepted))
        acceptedByGame.set(
          game,
          new Set(
            log.accepted.filter((k): k is string => typeof k === 'string' && k.length < 200).slice(0, 500),
          ),
        );
      await castSession.loaded(game, log.continuity);
      if (transition !== runTransition) return;
      enter();
    })
    .catch(() => {
      prog.textContent = 'Your saved game could not be opened. Start a new game from the title page.';
    });
}

async function begin(seed: number, localOnly = false, rules: RulesEdition = PUBLIC_EDITION) {
  const transition = ++runTransition;
  cancelAnimationFrame(raf);
  app.innerHTML = `<div class="page">${topbar('The Valley')}<h2>Starting your game…</h2><p>Please wait.</p></div>`;
  try {
    const prepared = await castSession.fresh(seed, localOnly, rules);
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
    status.textContent = 'The game could not start. Your saved game is kept. Try again or open Feedback.';
    app.querySelector('.title-actions')?.prepend(status);
    debugError(error);
  }
}

// ---------- play ----------

function enter() {
  pendingGrain = null;
  labScreen('play');
  if (!g) return;
  if (g.valley.flags.ended) return ending();
  selected = null;
  tab = 'notes';
  carry = 0;
  hurrying = false;
  actionCaption = '';
  insistReceipt = null;
  sheetKey = '';
  lastDay = dayOfMinute(g.valley.minute);
  lastSnapDay = lastDay;
  seenNote = Math.max(seenNote, (g.valley.notes.at(-1)?.id ?? 0) - 6);
  textSizeObserver?.disconnect();
  textSizeObserver = null;
  stage?.destroy();
  app.innerHTML = `<div class="play lk-stage" data-sheet="fit">
    ${topbar('<span id="cap"></span>')}
    <button class="grain-bar" aria-label="Open the landowner’s ledger"><span class="grain-track"><span class="grain-solid"></span><span class="grain-cut"></span><span class="grain-standing"></span><span class="grain-due"></span></span><span class="grain-label"></span></button>
    <div class="map lk-scene"><canvas id="map" aria-label="The valley map"></canvas><p id="now" class="moment"></p><span id="steward"></span></div>
    <nav id="houses" aria-label="Households"></nav>
    <section class="lk-sheet" aria-label="Valley notebook"><div id="pace" class="pace-status"><button type="button" data-pace-menu aria-label="Time control"></button><button type="button" data-pace-info aria-label="Current pace reason" aria-expanded="false" aria-controls="pace-explanation"><span aria-hidden="true">i</span></button><span id="pace-explanation" role="tooltip" hidden></span></div><header class="lk-sheet-head" id="sheet-head" hidden></header><div id="house-answer" hidden></div><div class="sheet lk-sheet-body" id="sheet"></div><footer class="thumbs lk-commit" id="thumbs"></footer></section>
  </div>`;
  app.querySelector('.grain-bar')?.addEventListener('click', () => openReading('ledger'));
  app.querySelector('[data-pace-menu]')?.addEventListener('click', openMenu);
  const paceInfo = app.querySelector<HTMLButtonElement>('[data-pace-info]');
  const paceExplanation = app.querySelector<HTMLElement>('#pace-explanation');
  paceInfo?.addEventListener('click', () => {
    if (!paceExplanation) return;
    paceExplanation.hidden = !paceExplanation.hidden;
    paceInfo.setAttribute('aria-expanded', String(!paceExplanation.hidden));
  });
  paceInfo?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && paceExplanation) {
      paceExplanation.hidden = true;
      paceInfo.setAttribute('aria-expanded', 'false');
    }
  });
  const root = app.querySelector<HTMLElement>('.lk-stage');
  if (root) {
    const checkTextSize = () => {
      const thumbs = root.querySelector<HTMLElement>('#thumbs');
      if (thumbs) {
        root.style.setProperty('--thumbs-height', `${thumbs.getBoundingClientRect().height}px`);
        const chromeHeight = ['#thumbs', '#sheet-head', '#pace'].reduce(
          (height, selector) => height + (root.querySelector(selector)?.getBoundingClientRect().height ?? 0),
          0,
        );
        root.style.setProperty('--reading-chrome-height', `${chromeHeight}px`);
      }
      root.dataset.reflow = String(
        parseFloat(getComputedStyle(root.querySelector('#now') ?? root).fontSize) > 24,
      );
    };
    stage = phoneStage(root, { observeOnly: true, onSceneRect: checkTextSize });
    const now = root.querySelector('#now');
    if (now) {
      textSizeObserver = new ResizeObserver(checkTextSize);
      textSizeObserver.observe(now);
      for (const chrome of root.querySelectorAll('#thumbs, #sheet-head, #pace'))
        textSizeObserver.observe(chrome);
    }
  }
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

function pacingState(t: number, s: ValleyState) {
  return {
    night: partOfDay(s.minute) === 'night',
    travelling: !!s.kahyaState.visit,
    reading: t < slowUntil || selected !== null || tab !== 'notes',
    waiting:
      s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute) ||
      !!pendingTerm(s) ||
      !!(
        s.pass?.journey?.seen &&
        !s.pass.journey.returned &&
        !s.pass.journey.cargo &&
        s.minute < s.pass.journey.leave
      ),
    replies: s.asks.some(
      (a) =>
        !a.closed &&
        a.until > s.minute &&
        Object.entries(a.replies).some(
          ([id, r]) =>
            ['refused', 'deferred', 'modified'].includes(r.verdict) &&
            !a.insisted.includes(id) &&
            !letBe(s, a, id),
        ),
    ),
    asked: questionOpen(s),
    hurrying,
    working: !!currentJob(s),
    pace: speed,
  };
}

/** A question from Zehra the player has not answered or set aside ("Not now"). */
let setAside = '';
function questionKey(s: ValleyState): string {
  const choice = dialogueChoices(s)[0];
  return choice ? `${s.seed}:${choice.visit}:${choice.prior}` : '';
}
function questionOpen(s: ValleyState): boolean {
  const key = questionKey(s);
  return !!key && key !== setAside;
}

function rateNow(t: number): number {
  return g ? automaticRate(pacingState(t, g.valley)) : 0;
}

function frame(t: number) {
  refreshRecordingNotice();
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
  if (moved) {
    sampleCut(s);
    drawTop();
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
      if (n.weight >= 2.5) musicEvent(['death', 'due', 'weather', 'theft', 'seize'].includes(n.kind));
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
    notebookReceipt = '';
    confirmCall = null;
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
  const pacing = pacingState(performance.now(), s);
  const pace = app.querySelector('[data-pace-menu]');
  const paceLabel = pacing.asked
    ? 'Almost stopped'
    : pacing.waiting || pacing.reading
      ? 'Slowed'
      : pacing.hurrying
        ? 'Skipping'
        : pacing.replies
          ? 'Replies open'
          : cap(speed);
  if (pace) pace.textContent = `${clockWords(s.minute)} · ${paceLabel}`;
  const explanation = app.querySelector('#pace-explanation');
  if (explanation)
    explanation.textContent = paceWords({
      ...pacing,
      readingView: selected ? 'house' : tab !== 'notes' ? tab : undefined,
      waitingReason: s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute)
        ? 'Someone is at your door.'
        : pendingTerm(s)
          ? 'A decision is open in the notebook.'
          : 'The quarry trade is open while you are there.',
    });
  const button = app.querySelector<HTMLButtonElement>('[data-until]');
  if (button) {
    const block = skipBlock(pacingState(performance.now(), s));
    button.disabled = !!block;
    const hint =
      block ?? (pacingState(performance.now(), s).replies ? 'Runs time quickly to the next reply.' : '');
    if (button.dataset.hint !== hint) {
      button.dataset.hint = hint;
      button.innerHTML = `Skip ⏩${hint ? `<span class="h">${esc(hint)}</span>` : ''}`;
    }
  }
  const label = app.querySelector('.grain-label');
  if (label)
    label.textContent =
      seasonOf(doyOf(dayOfMinute(s.minute))) === 'harvest'
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
  pendingGrain = null;
  selected = null;
  hurrying = false;
  tab = which;
  carry = 0;
  drawSheet(true);
}

function order(o: Order) {
  if (!g) return;
  pendingGrain = null;
  notebookReceipt = '';
  confirmCall = null;
  const grainBefore = g.valley.agha.granary;
  const noteBefore = new Set(g.valley.notes.map((n) => n.id));
  const ask = o.verb === 'insist' ? g.valley.asks.find((a) => a.id === o.ask) : undefined;
  const previous = o.verb === 'insist' ? JSON.stringify(ask?.replies[o.pid]) : '';
  insistReceipt = null;
  if (act(g, o)) {
    if (o.verb === 'give') {
      const h = houseOf(g.valley, o.house);
      actionCaption = grainReceipt(
        h ? householdLabel(h) : 'the household',
        Math.min(o.kile, grainBefore),
        grainBefore,
        g.valley.agha.granary,
        g.valley.notes.findLast((n) => !noteBefore.has(n.id) && n.kind === 'gift' && n.house === o.house)
          ?.text,
      );
    }
    if (o.verb === 'insist' && ask) {
      const person = personOf(g.valley, o.pid);
      insistReceipt = {
        ask: ask.id,
        pid: o.pid,
        previous: previous ?? '',
        name: cap(personLabel(person ?? { name: 'someone' })),
        job: JOB_LABEL[ask.job],
      };
      actionCaption = '';
    }
    if (o.verb === 'reply') {
      actionCaption = `You said: “${SAYING_WORDS[o.saying ?? 'listen']}”`;
      sayOpen = null;
    }
    if (o.verb === 'visit' || o.verb === 'give') {
      selected = o.house;
      houseDetails = false;
    }
    writeLog();
    hunchCache = null;
    drawSheet(true);
  } else {
    actionCaption = 'No action was recorded.';
    drawSheet(true);
  }
}

function actionWords(s: ValleyState): string {
  if (!insistReceipt) return actionCaption;
  const r = insistReceipt;
  const reply = s.asks.find((a) => a.id === r.ask)?.replies[r.pid];
  const answer =
    reply && JSON.stringify(reply) !== r.previous
      ? `Their current answer is ${reply.verdict}: “${reply.says}”`
      : 'Their next answer is pending.';
  return `You insisted that ${r.name} answer the request ${r.job}. ${answer}`;
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
  if (window.innerWidth >= 900) label(ctx, 'residence', X(600) - 34, Y(545) + 2, c['ink-soft'] ?? '#666', 11);
  ctx.strokeRect(X(630) - 5, Y(568) - 5, 10, 10);
  if (s.agha.millOpen) {
    const done = Math.min(1, s.agha.mill / 600);
    ctx.beginPath();
    ctx.arc(X(612), Y(420), 7, Math.PI, Math.PI + Math.PI * 2 * Math.max(0.08, done));
    ctx.stroke();
    label(
      ctx,
      done >= 1 ? 'mill' : 'mill under construction',
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
    label(ctx, shortHouse(hh), X(hh.x), Y(hh.y) + 17, c.sky ?? '#3d5a73', 12);
    ctx.strokeStyle = c.sky ?? '#3d5a73';
    ctx.lineWidth = 1;
    const halfLabel = ctx.measureText(shortHouse(hh)).width / 2;
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
  if (steward) steward.textContent = englishText(caption(s, wx).split('. ')[0] ?? '');
}

const growing = (season: string) => season === 'spring' || season === 'summer';

function caption(s: ValleyState, _wx: string): string {
  const v = s.kahyaState.visit;
  if (s.pass?.journey && !s.pass.journey.returned)
    return s.minute < s.pass.journey.arrive
      ? 'You are walking over the northern pass.'
      : s.minute < s.pass.journey.leave
        ? 'You are at Çam quarry in the neighbouring valley.'
        : 'You are carrying your goods home over the pass.';
  const destination = v ? houseOf(s, v.house) : undefined;
  const destinationName = destination ? householdLabel(destination) : 'the house';
  const where =
    v && v.back > s.minute
      ? s.minute < v.arrive
        ? `you are walking to ${destinationName}`
        : s.minute < v.leave
          ? `you are at ${destinationName}`
          : 'you are walking back'
      : '';
  return where && v
    ? `You: ${where.replace('you are ', '')}. ${travelWords(v, s.minute)}`
    : 'You: at the residence';
}

function kahyaAt(s: ValleyState): [number, number] {
  const v = s.kahyaState.visit;
  const home: [number, number] = [600, 545];
  if (s.pass?.journey && !s.pass.journey.returned) return [520, 350];
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
  pendingGrain = null;
  confirmCall = null;
  armed = null;
  selected = id && selected !== id ? id : null;
  actionCaption = '';
  insistReceipt = null;
  tab = 'notes';
  houseDetails = false;
  carry = 0;
  hunchCache = null;
  drawSheet(true);
  drawMap();
}

function closeHouse() {
  pendingGrain = null;
  confirmCall = null;
  armed = null;
  const origin = selected;
  selected = null;
  tab = 'notes';
  actionCaption = '';
  insistReceipt = null;
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
              !letBe(s, a, id) &&
              ['deferred', 'refused', 'modified'].includes(r.verdict),
          ),
      );
      const news = s.notes.some(
        (n) =>
          n.at <= s.minute &&
          dayOfMinute(n.at) === today &&
          (n.house === h.id || (n.who && h.members.includes(n.who))),
      );
      return `${h.hamlet === 'upper' && list[i - 1]?.hamlet !== 'upper' ? '<span class="hamlet-divider">upper</span>' : ''}<button data-h="${h.id}" class="${selected === h.id ? 'selected' : ''}" aria-pressed="${selected === h.id}" aria-label="${esc(householdLabel(h))}"><span class="house-icon" aria-hidden="true">⌂</span>${esc(shortHouse(h))}${waiting ? '<span class="reply-mark" aria-label="reply waiting">●</span>' : news ? '<span aria-label="new reply today">○</span>' : ''}</button>`;
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
  if (!g || (!force && app.querySelector('button.holding, button.armed'))) return;
  const s = g.valley;
  // Count newly due scheduled notes, and retain IDs when the capped log replaces an old note.
  const journey = s.pass?.journey;
  const routePhase = journey
    ? journey.returned
      ? 'home'
      : s.minute < journey.arrive
        ? 'out'
        : s.minute < journey.leave
          ? 'quarry'
          : 'return'
    : '';
  const visit = s.kahyaState.visit;
  const visitPhase = visit
    ? `${visit.house}:${visit.arrive}:${s.minute < visit.arrive ? 'out' : s.minute < visit.leave ? 'here' : s.minute < visit.back ? 'return' : 'home'}:${s.reply?.visits.includes(`${visit.house}:${visit.arrive}`) ?? false}`
    : '';
  const key = `${s.notes.findLast((n) => n.at <= s.minute)?.id}:${s.notes.filter((n) => n.at <= s.minute).length}|${selected}|${tab}|${houseDetails}|${JSON.stringify(s.asks.map((a) => a.replies))}|${busy(s)}|${dayOfMinute(s.minute)}|${s.flags.verbs.join(',')}|${s.agha.granary >= 2}|${routePhase}|${visitPhase}|${s.dialogue ? JSON.stringify([s.dialogue, dialogueChoices(s)]) : ''}|${s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute).length}|${accepted().size}|${setAside}|${s.reply?.visits.length ?? 0}|${selected === null || tab !== 'notes' ? (rainGuess(s) ?? '') : ''}|${confirmCall}|${sayOpen}|${notebookReceipt}`;
  const travel = app.querySelector<HTMLElement>('#reading-travel');
  if (travel) travel.textContent = englishText(caption(s, ''));
  const receipt = app.querySelector<HTMLElement>('#action-receipt');
  if (receipt && insistReceipt) receipt.textContent = actionWords(s);
  if (!force && sheetKey === key) return;
  sheetKey = key;
  lastSheet = performance.now();
  sheetGeneration++;
  actions = [];
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusRoot = active?.closest<HTMLElement>('#sheet-head, #sheet, #thumbs, #houses');
  const focusKey =
    active && focusRoot
      ? {
          root: focusRoot.id,
          tag: active.tagName,
          text: active.textContent,
          label: active.getAttribute('aria-label'),
          house: active.getAttribute('data-h'),
          selected,
        }
      : null;
  const sheet = app.querySelector<HTMLElement>('#sheet');
  const thumbs = app.querySelector<HTMLElement>('#thumbs');
  if (!sheet || !thumbs) return;
  const top = sheet.scrollTop;
  const upcomingTerm = pendingTerm(s);
  const knock = s.knocks.find(
    (k) =>
      !k.answered &&
      k.at <= s.minute &&
      k.until > s.minute &&
      !(upcomingTerm?.kind === 'winter' && upcomingTerm.house === k.house),
  );
  // An unanswered knock takes precedence over the house and reading sheets.
  if (knock) {
    selected = null;
    tab = 'notes';
    hurrying = false;
  }
  const term = !knock ? pendingTerm(s) : undefined;
  if (term) {
    selected = null;
    tab = 'notes';
    hurrying = false;
  }
  const hh = selected ? houseOf(s, selected) : undefined;
  if (!hh || tab !== 'notes') pendingGrain = null;
  const root = app.querySelector<HTMLElement>('.play');
  root?.setAttribute('data-house', String(!!hh));
  root?.setAttribute('data-notebook-active', String(!!visit || s.asks.length > 0 || !!notebookReceipt));
  root?.setAttribute('data-knock', String(!!knock || !!term));
  root?.setAttribute('data-reader', String(tab === 'ledger' || tab === 'reader'));
  const header = app.querySelector<HTMLElement>('#sheet-head');
  if (header) {
    header.hidden = !hh && tab === 'notes';
    header.innerHTML = hh
      ? `<button class="house-close" aria-label="Back to the notebook">←</button><b>${esc(householdLabel(hh))}</b><button class="house-about" aria-expanded="${houseDetails}">About ▾</button>`
      : tab !== 'notes'
        ? `<button class="house-close" aria-label="Back to the notebook">←</button><b>${tab === 'ledger' ? 'The landowner’s ledger' : tab === 'reader' ? 'Earlier replies' : 'Other orders'}</b>`
        : '';
  }
  sheet.innerHTML =
    `${importStatus ? `<p id="load-result" role="status">${importStatus}</p>` : ''}` +
    (knock
      ? knockCard(s, knock)
      : term
        ? termCard(s, term)
        : hh
          ? houseCard(s, hh)
          : tab === 'ledger'
            ? ledger(s)
            : tab === 'reader'
              ? reader(s)
              : tab === 'orders'
                ? otherOrders(s)
                : `<p id="reading-travel" class="reading-status">${esc(englishText(caption(s, '')))}</p>${notebook(s)}`);
  thumbs.hidden = !!knock || !!term || tab !== 'notes';
  thumbs.innerHTML = thumbs.hidden ? '' : hh ? houseThumbs(s, hh) : valleyThumbs(s);
  const generation = sheetGeneration;
  actions = actions.map((fn) => () => {
    if (generation !== sheetGeneration) return;
    const before = g?.inputs.length;
    const previousReceipt = notebookReceipt;
    fn();
    if (before === g?.inputs.length && previousReceipt === notebookReceipt) return;
    const result = app.querySelector<HTMLElement>(
      '.notebook-receipt, #action-receipt, .visit-reply, .visit-question',
    );
    if (result) {
      result.tabIndex = -1;
      result.focus({ preventScroll: true });
      result.scrollIntoView({ block: 'nearest' });
    }
  });
  for (const button of app.querySelectorAll<HTMLButtonElement>('button.hold[data-k]')) {
    const fn = actions[Number(button.dataset.k)];
    if (fn) bindHold(button, fn);
  }
  drawHouses(s);
  if (!force) sheet.scrollTop = top;
  stage?.refresh();
  if (focusKey && focusKey.selected === selected) {
    const candidates = app.querySelectorAll<HTMLElement>(
      `#${focusKey.root} button, #${focusKey.root} summary, #${focusKey.root} select`,
    );
    const replacement = [...candidates].find(
      (el) =>
        el.tagName === focusKey.tag &&
        el.textContent === focusKey.text &&
        el.getAttribute('aria-label') === focusKey.label &&
        el.getAttribute('data-h') === focusKey.house,
    );
    const target = replacement ?? sheet;
    if (!replacement) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}

function pendingTerm(s: ValleyState) {
  return s.edition?.decisions?.find((d) => !d.answered && d.from <= s.minute && d.until > s.minute);
}
function termCard(s: ValleyState, d: TermDecision): string {
  const choose = (choice: string) => order({ verb: 'term-choice', id: d.id, choice });
  let choices: string[];
  if (d.kind === 'winter')
    choices = [
      btn('Ask the neighbour for a loan', () => choose('neighbour')),
      btn('Send grain from the granary', () => choose('grain'), {
        disabled: s.agha.granary < 6,
        hint: 'A small sack leaves less grain for the rider.',
      }),
    ];
  else if (d.kind === 'inspection')
    choices = [
      btn('Open the separate store', () => choose('return')),
      btn('Keep it closed', () => choose('refuse'), { hint: 'The next due grows by six grain measures.' }),
    ];
  else
    choices = [
      btn('Send grain instead', () => choose('grain'), {
        disabled: s.agha.granary < 12,
        hint: 'The rider takes twelve grain measures. The due stays the same.',
      }),
      ...s.households
        .filter((h) => underSeal(s, h) && h.field.size > 0 && h.members.length)
        .map((h) =>
          btn(`Ask ${householdLabel(h)}`, () => choose(`ask:${h.id}`), {
            hint: 'They can refuse. Two days of carrying leave their own work waiting.',
          }),
        ),
    ];
  return `<div class="term-decision"><p>${esc(d.text)}</p><p class="soft">Reply before ${esc(fullDateEnglish(dayOfMinute(d.until)))}. Time slows while you read.</p><div class="row">${choices.join('')}</div></div>`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function shortHouse(h: Household): string {
  return h.id === 'water-guest' ? 'Danyal' : h.id === 'guests' ? 'Visitors' : h.short;
}

function knockCard(s: ValleyState, k: Knock): string {
  const p = personOf(s, k.personId);
  const hh = houseOf(s, k.house);
  const who = cap(personLabel(p ?? { name: 'someone' }, hh));
  const ask =
    k.what === 'grain'
      ? `${who} is at your door.`
      : k.what === 'birth'
        ? `A child has been born at ${hh ? householdLabel(hh) : 'a house'}.`
        : k.what === 'death'
          ? `Someone has died at ${hh ? householdLabel(hh) : 'a house'}.`
          : `${cap(hh ? householdLabel(hh) : 'A house')} asks you to the wedding.`;
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
              hint: busy(s)
                ? visitHint(s)
                : 'Walking there and spending time with them will keep you away from the residence.',
            },
          ),
          btn('Decline the invitation', () => order({ verb: 'turn-away', knock: k.id })),
        ];
  return `<div class="knock ink-in"><div>${esc(ask)}<span class="w hand" style="display:block">“${esc(k.words)}”</span></div><div class="row">${row.join('')}</div></div>`;
}

const busy = (s: ValleyState) => !!s.kahyaState.visit && s.kahyaState.visit.back > s.minute;

/** People who already have a Press button on screen: one per person, on their latest line. */
const pressShown = new Set<string>();

/** Delays the player accepted with "Let them finish first", per game: presentation only. The reply to the call
 * stays as it is and nothing is cut by accepting; the row leaves the notebook and stops slowing the clock. */
const acceptedByGame = new WeakMap<Game, Set<string>>();
function accepted(): Set<string> {
  if (!g) return new Set();
  const known = acceptedByGame.get(g);
  if (known) return known;
  const set = new Set<string>();
  acceptedByGame.set(g, set);
  return set;
}
const acceptKey = (ask: string, pid: string) => `${ask}:${pid}`;
/** A delayed reply the player let be: chosen in the notebook, or said in person with "finish your own barley first". */
function letBe(s: ValleyState, a: { id: string; from: number }, pid: string): boolean {
  if (accepted().has(acceptKey(a.id, pid))) return true;
  const home = s.households.find((h) => h.members.includes(pid));
  return !!(
    home &&
    s.reply?.visits.some((v) => {
      const [house, arrive, saying] = v.split(':');
      return house === home.id && saying === 'finish' && Number(arrive) >= a.from;
    })
  );
}

function namesWords(raw: string[]): string {
  // "Someone from the Demirci house" twice reads as "2 people from the Demirci house".
  const counts = new Map<string, number>();
  // Only unnamed people merge; two people who share a name both stay listed.
  raw.forEach((name, i) => {
    const key = name.startsWith('Someone from ') ? name : `${i}\u0000${name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const entries = [...counts]
    .map(([key, n]) => ({
      n,
      name: key.split('\u0000').at(-1) ?? key,
    }))
    .map(({ n, name }) => ({
      n,
      words:
        n > 1 && name.startsWith('Someone from ')
          ? `${n} people from ${name.slice('Someone from '.length)}`
          : name,
    }));
  const rest = entries.slice(3).reduce((sum, e) => sum + e.n, 0);
  const shown =
    entries.length > 4
      ? [...entries.slice(0, 3).map((e) => e.words), `${rest} others`]
      : entries.map((e) => e.words);
  return shown.length < 2 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

function letFinish(ask: string, pids: string[]) {
  for (const pid of pids) accepted().add(acceptKey(ask, pid));
  insistReceipt = null;
  actionCaption =
    pids.length === 1
      ? 'You let them finish their own work first. Their reply to the call stays the same. They may still come later.'
      : `You let ${pids.length} people finish their own work first. Their replies to the call stay the same. They may still come later.`;
  notebookReceipt = actionCaption;
  writeLog();
  drawSheet(true);
}

function insistAll(ask: string, pids: string[]) {
  if (!g) return;
  let done = 0;
  for (const pid of pids) if (act(g, { verb: 'insist', ask, pid })) done++;
  insistReceipt = null;
  actionCaption = done
    ? `You insisted with ${done} ${done === 1 ? 'person' : 'people'}. They will answer again, and they will remember.`
    : 'No action was recorded.';
  notebookReceipt = actionCaption;
  if (done) {
    writeLog();
    hunchCache = null;
  }
  drawSheet(true);
}

/** Keep still-actionable refusals visible even when their dated note is archived. Identical words to one call share
 * a row, so eight copies of the same put-off read as one line with eight names. */
function pendingReplies(s: ValleyState, house?: Household): string {
  const asks = s.asks.filter(
    (a) => !a.closed && a.from <= s.minute && a.until > s.minute && (!house || a.houses.includes(house.id)),
  );
  if (!asks.length) return '';
  const counts = { came: 0, deferred: 0, refused: 0, modified: 0 };
  const groups = new Map<string, { ask: string; says: string; ids: string[]; names: string[] }>();
  let letBeCount = 0;
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
      if (letBe(s, ask, id)) {
        letBeCount++;
        continue;
      }
      pressShown.add(id);
      const key = `${ask.id}|${reply.says}`;
      const group = groups.get(key) ?? { ask: ask.id, says: reply.says, ids: [], names: [] };
      group.ids.push(id);
      group.names.push(cap(personLabel(personOf(s, id) ?? { name: 'someone' }, hh)));
      groups.set(key, group);
    }
  }
  const rows = [...groups.values()].map((group) => {
    const many = group.ids.length > 1;
    const finish = btn('Let them finish first', () => letFinish(group.ask, group.ids));
    const insist = many
      ? btn(`Hold to insist with all ${group.ids.length}`, () => insistAll(group.ask, group.ids), {
          hold: true,
        })
      : btn('Hold to insist', () => order({ verb: 'insist', ask: group.ask, pid: group.ids[0] ?? '' }), {
          hold: true,
        });
    return `<div class="reply-row${many ? ' grouped' : ''}"><span><b>${esc(namesWords(group.names))}</b>${many ? ` <span class="soft">(${group.ids.length} people, the same words)</span>` : ''}<span class="reply-words">“${esc(group.says)}”</span></span><div class="reply-actions">${insist}${finish}</div></div>`;
  });
  const letLine = letBeCount
    ? `<p class="soft let-be">You let ${letBeCount} ${letBeCount === 1 ? 'person' : 'people'} finish their own work first. Their replies to the call stay the same.</p>`
    : '';
  return `<section class="pending-replies"><h2 class="section-label">Replies to the call</h2><p class="reply-count">${counts.came} came. ${counts.deferred} delayed. ${counts.refused} refused.${counts.modified ? ` ${counts.modified} agreed to do part of the work.` : ''}</p>${rows.join('')}${letLine}</section>`;
}

/** Only the steward's accepted input and already due outward notes enter this projection. */
function visitReply(s: ValleyState): string {
  const visit = s.kahyaState.visit;
  if (!g) return '';
  const input = g.inputs.findLast(
    (i) =>
      i.verb === 'reply' &&
      (!visit || (i.house === visit.house && i.at >= visit.arrive && i.at < visit.leave)),
  );
  const exchange = s.dialogue?.exchanges.findLast(
    (e) => !visit || (e.house === visit.house && e.visit === visit.arrive),
  );
  const status = exchange
    ? `<p class="visit-question" role="status">${esc(dialogueStatus(exchange))}</p>`
    : '';
  if (input?.verb !== 'reply') return status;
  const answer = s.notes.findLast(
    (n) =>
      n.house === input.house &&
      n.at === input.at + 1 &&
      n.at <= s.minute &&
      (n.kind === 'voice' || n.kind === 'story'),
  );
  return `${status}<section class="visit-reply" role="status">${answer ? noteLine(answer) : `<p>You said: “${esc(SAYING_WORDS[input.saying ?? 'listen'])}” ${s.minute <= input.at ? 'No answer yet.' : 'No answer is retained on these pages.'}</p>`}</section>`;
}

function notebookVisit(s: ValleyState): string {
  const visit = s.kahyaState.visit;
  if (!visit || visit.back <= s.minute) return visitReply(s);
  const house = houseOf(s, visit.house);
  if (!house) return '';
  const controls = sayingControls(s, house);
  return `<section class="notebook-visit">${visitReply(s)}${controls || `<p class="soft">${s.minute < visit.arrive ? 'Say is available after you arrive.' : s.minute >= visit.leave ? 'You have left the house. Say is available during a visit.' : !s.reply ? 'This saved term has no household Say action.' : 'There is nobody here to answer.'}</p>`}</section>`;
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
  const visit = s.kahyaState.visit;
  const asking =
    dialogueChoices(s).length && visit
      ? btn(
          'Zehra is waiting for your answer. Open her house ▸',
          () => {
            selected = visit.house;
            houseDetails = false;
            drawSheet(true);
          },
          { cls: 'primary' },
        )
      : '';
  const legend =
    pending || recent.length
      ? '<p class="soft mark-legend">On the house buttons, ● means a delayed reply you can still answer there. ○ means news from that house today.</p>'
      : '';
  const guess = rainGuess(s);
  const pace = guess
    ? `<div class="hunch rain-guess">${esc(guess)}<span class="by">your guess</span></div>`
    : '';
  const receipt = notebookReceipt
    ? `<p class="notebook-receipt" role="status">${esc(notebookReceipt)}</p>`
    : '';
  return `${receipt}${notebookVisit(s)}${asking}${pace}${pending}<section class="current-notes"><h2 class="section-label">Today’s news</h2>${recent.length ? recent.map(noteLine).join('') : '<p class="soft">No new reply today.</p>'}</section>${legend}${btn('Earlier replies ▸', () => openReading('reader'), { cls: 'more' })}`;
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
  return `<div class="note${n.weight < 2 ? ' quiet' : ''}"><span class="t">${esc(partOfDay(n.at))}</span>${esc(n.text)}${n.words && !n.text.toLowerCase().includes(n.words.toLowerCase()) ? `<span class="w">“${esc(noteWords(n) ?? '')}”</span>` : ''}</div>`;
}

function datedReply(s: ValleyState, n: Note): string {
  const earlier = dayOfMinute(n.at) < dayOfMinute(s.minute) ? 'Earlier replies · ' : '';
  const person = n.who ? personOf(s, n.who) : undefined;
  const speaker =
    n.kind === 'voice' && person ? cap(personLabel(person, houseOf(s, n.house ?? ''))) : undefined;
  const date = `${earlier}${speaker ? `${speaker} · ` : ''}${fullDateEnglish(dayOfMinute(n.at))}`;
  // The house header identifies the household; keep the person's complete words immediately below their name.
  const words =
    speaker && n.words
      ? `<div class="note"><span class="w">“${esc(noteWords(n) ?? '')}”</span></div>`
      : noteLine(n);
  return `<div class="reply-date soft">${esc(date)}</div>${words}`;
}

function knownFood(s: ValleyState, hh: Household): string {
  const guess = s.kahyaState.guess?.[hh.id];
  if (!guess) return 'Food: you haven’t seen their jars yet.';
  const ago = dayOfMinute(s.minute) - dayOfMinute(guess.at);
  return `${breadWords(guess.bread)}${ago > 2 ? ` You saw this ${ago} days ago.` : ''}`;
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
    <p>${esc(cap(personLabel(personOf(s, id) ?? { name: 'someone' }, hh)))}: “${esc(reply.says)}”</p>
    ${btn(`Hold to insist on the work`, () => order({ verb: 'insist', ask: ask.id, pid: id }), {
      hold: true,
      hint: 'You press this person to answer again. They may still refuse.',
    })}</div>`;
}

const BREAD: [number, string][] = [
  [200, 'Their jars are full.'],
  [80, 'You think they have enough food until spring.'],
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
  [/^material/, 'there is barley to cut at home first'],
  [/^commitment/, 'another task is already promised'],
  [/^distrust/, 'your office has not earned enough trust'],
  [/^capacity/, 'this work is too difficult'],
  [/^norm/, 'this request seems wrong'],
  [/^habit/, 'the usual routine is hard to change'],
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

function dialogueCard(s: ValleyState, hh: Household): string {
  if (!s.dialogue || s.kahyaState.visit?.house !== hh.id) return '';
  const out: string[] = [];
  const exchange = s.dialogue.exchanges.at(-1);
  if (exchange?.house === hh.id) {
    out.push(`<p role="status">${esc(dialogueStatus(exchange))}</p>`);
    if (['pending', 'heard', 'talking'].includes(exchange.status))
      out.push(btn('End this question', () => order({ verb: 'dialogue-cancel', turn: exchange.turn })));
  }
  const choices = dialogueChoices(s);
  if (choices.length)
    out.push(
      `<p class="soft">${esc(questionOpen(s) ? 'Zehra waits for your answer. Time almost stops until you answer or choose Not now. Her question closes when your visit ends.' : 'You set her question aside. You can still answer it until your visit ends.')}</p>`,
    );
  for (const choice of choices) out.push(btn(dialogueWords(s, choice), () => order(choice)));
  if (choices.length && questionOpen(s))
    out.push(
      btn('Not now', () => {
        setAside = questionKey(s);
        drawSheet(true);
      }),
    );
  return out.length ? `<section class="dialogue"><h2>Speak with Zehra</h2>${out.join('')}</section>` : '';
}

function houseCard(s: ValleyState, hh: Household): string {
  pressShown.clear();
  const pending = pendingReplies(s, hh);
  const people = hh.members.map((m) => personOf(s, m)).filter((p) => !!p);
  const named = people.filter((p) => !['a household member', 'a child'].includes(p.name));
  const unnamed = people.length - named.length;
  const names = [
    ...named.map((p) => cap(personLabel(p))),
    ...(unnamed
      ? [
          named.length
            ? `${unnamed} ${unnamed === 1 ? 'other person' : 'others'}`
            : `${unnamed} ${unnamed === 1 ? 'person' : 'people'}`,
        ]
      : []),
  ]
    .join(', ')
    .replace(/, ([^,]+)$/, ' and $1');
  const job = jobInSeason(s);
  const guess = s.kahyaState.guess?.[hh.id];
  const lines: string[] = [];
  if (!guess) lines.push(`You haven’t been inside ${householdLabel(hh)} yet.`);
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
      const mine = hunchLine(hunchOf(s, s.kahya, head, job), personLabel(head, hh));
      const osman = personOf(s, 'osman');
      const his =
        osman && s.flags.beats.includes('reeve') && hh.hamlet === 'lower' && head.id !== 'osman'
          ? hunchLine(hunchOf(s, osman, head, job), personLabel(head, hh))
              .replace(/^You can’t tell yet/, 'He can’t say')
              .replace(/^You think/, 'He thinks')
              .replace(/^You are fairly sure/, 'He is fairly sure')
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
    ? `<p class="soft" >Your record: ${esc(
        acts
          .slice(-2)
          .reverse()
          .map((a) => `you ${a.what} (${when(a.day)})`)
          .join('; '),
      )}.</p>`
    : '';
  const share =
    s.flags.verbs.includes('take') && underSeal(s, hh) && hh.members.length
      ? `<p class="soft" >The landowner’s record: ${esc(shareOwnerWords(s, hh))} is ${hh.eased ? 'reduced' : 'unchanged'}. ${hh.paid >= shareOwed(hh) - 0.5 ? 'The payment is complete' : hh.paid > 0 ? 'The payment is partly complete' : 'The payment has not arrived yet'}.</p>`
      : '';
  const response = recent.find((n) => n.words && (n.kind === 'voice' || n.ask));
  const refusal = selectedRefusal(s, hh);
  const conversation = dialogueCard(s, hh);
  const status = `${s.kahyaState.visit?.house === hh.id && !conversation ? visitReply(s) : ''}<p id="reading-travel" class="reading-status">${esc(englishText(caption(s, '')))}</p><p id="action-receipt" class="action-caption" role="status">${esc(actionWords(s) || limitsWords(s, hh))}</p>`;
  if (!houseDetails)
    return `<div class="card">${response ? `<div class="house-response">${datedReply(s, response)}</div>` : ''}${status}${conversation}${refusal || (!response ? '<p class="soft">There is no new reply from this house.</p>' : '')}</div>`;
  return `<div class="card">
    ${response ? `<div class="house-response">${datedReply(s, response)}</div>` : ''}${status}${conversation}${refusal}
    <div class="house-context">
    ${lines
      .filter(Boolean)
      .map((l) => `<div class="hunch">${esc(l)}<span class="by">your guess</span></div>`)
      .join('')}
    ${reeve ? `<div class="hunch reeve">${esc(reeve)}<span class="by">The local overseer’s guess</span></div>` : ''}
    <p class="limits">${esc(limitsWords(s, hh))}</p><div class="looks">${esc(hh.members.length ? hh.looks : 'The door is shut. Nobody has lit a fire inside.')}</div><div class="people">${hh.members.length ? esc(names) : 'Nobody lives here now.'}</div>${share}${book}</div>
    ${pending}
    ${recent.length ? `<details class="house-history"><summary>Earlier replies from this house</summary>${recent.map((n) => noteLine(n)).join('')}</details>` : ''}
  </div>`;
}

const JOB_LABEL: Record<Job, string> = {
  'reap-agha': 'to cut the landowner’s barley',
  'bring-share': 'to bring their grain payment',
  'build-mill': 'to work on the mill',
};

function giftHint(s: ValleyState): string {
  return s.agha.granary < 2
    ? 'The granary has too little grain. You can give again when harvest work, household payments or a loan bring in grain.'
    : 'This sends a small sack from the granary. It leaves less grain to pay the landowner.';
}

function visitHint(s: ValleyState): string {
  return busy(s) && s.kahyaState.visit
    ? 'You can visit again when you return.'
    : 'A visit takes time to walk and sit with the household.';
}

function zehraNote(s: ValleyState): string {
  const home = s.households.find((h) => h.members.includes('zehra'));
  return `In the Questions for Zehra version, you can answer only Zehra.${home ? ` She lives at ${householdLabel(home)}.` : ''} She must speak to you first.`;
}

const SAYING_HINT: Record<Saying, string> = {
  listen:
    'Answer the greeting. Someone in the house answers you. This does not ask for work or promise grain.',
  finish:
    'Accept their delay. They answer you, but their reply to the call stays the same. Holding to insist is still the way to press them.',
  rain: 'Remind them of the rain. They answer you, but their reply to the call stays the same.',
};

/** Existing sayings are the same public inputs in the house and notebook. No actor choice or clock change. */
function sayingControls(s: ValleyState, hh: Household): string {
  const out: string[] = [];
  const add = (label: string, fn: () => void, reason: string | null, hint: string) => {
    out.push(
      btn(
        label,
        () => {
          if (reason) {
            actionCaption = `${label}: ${reason}`;
            drawSheet(true);
          } else fn();
        },
        { cls: reason ? 'wide blocked' : 'wide', ...(selected === null ? { hint: reason ?? hint } : {}) },
      ).replace('<button ', reason ? '<button aria-disabled="true" ' : '<button '),
    );
  };
  const visit = s.kahyaState.visit;
  const sayings =
    s.reply && visit?.house === hh.id && visit.arrive <= s.minute && visit.leave > s.minute
      ? sayingsAt(s, hh)
      : [];
  // One saying shows directly; several sit behind one toggle so the house actions stay short on a phone.
  if (sayings.length > 1) {
    const k = actions.length;
    actions.push(() => {
      sayOpen = sayOpen === hh.id ? null : hh.id;
      drawSheet(true);
    });
    out.push(
      `<button data-k="${k}" class="wide say-toggle" aria-expanded="${sayOpen === hh.id}">${sayOpen === hh.id ? 'Say something ▾' : `Say something${selected === null ? ` at ${householdLabel(hh)}` : ''} (${sayings.length} choices) ▸`}</button>`,
    );
  }
  if (sayOpen === hh.id || sayings.length === 1)
    for (const saying of sayings)
      add(
        `Say: ${SAYING_WORDS[saying]}`,
        () => order({ verb: 'reply', house: hh.id, saying }),
        visit && s.reply?.visits.includes(replyKey(hh.id, visit.arrive, saying))
          ? 'You have already said this during this visit.'
          : null,
        SAYING_HINT[saying],
      );
  return out.join('');
}

function houseThumbs(s: ValleyState, hh: Household): string {
  const out: string[] = [];
  const empty = !hh.members.length;
  const job = currentJob(s);
  const add = (
    label: string,
    fn: () => void,
    reason: string | null,
    hint: string,
    hold = false,
    wide = false,
  ) => {
    const k = actions.length;
    actions.push(() => {
      insistReceipt = null;
      actionCaption = `${label}: ${reason ?? hint}`;
      if (!reason) fn();
      else drawSheet(true);
    });
    out.push(
      `<button data-k="${k}"${hold && !reason ? ` class="hold${wide ? ' wide' : ''}"` : reason ? ` aria-disabled="true" class="blocked${wide ? ' wide' : ''}"` : wide ? ' class="wide"' : ''}>${esc(label)}${hold && !reason ? '<span class="fill"></span>' : ''}</button>`,
    );
  };
  if (job)
    add(
      job === 'reap-agha'
        ? 'Call this house to cut barley'
        : job === 'bring-share'
          ? 'Call this house for grain payment'
          : 'Call this house to build mill',
      () => {
        // A call cannot be taken back. When you last saw their jars low, ask once more before sending it.
        const guess = s.kahyaState.guess?.[hh.id];
        if (guess && guess.bread < 25 && confirmCall !== hh.id) {
          confirmCall = hh.id;
          actionCaption = `${cap(householdLabel(hh))} looked short of food when you saw their jars. A call cannot be taken back, and work for the landowner leaves their own field waiting. Press the call again to send it.`;
          drawSheet(true);
          return;
        }
        confirmCall = null;
        order({ verb: 'call', job, houses: [hh.id] });
      },
      callUnavailable(s, job, hh),
      `The village announcer carries your request only to ${householdLabel(hh)}. People can refuse.`,
    );
  if (s.edition && job === 'build-mill')
    add(
      'Call this house for paid mill work',
      () => order({ verb: 'call', job, houses: [hh.id], wage: true }),
      s.agha.granary <= 0 ? 'The granary has no grain for wages.' : callUnavailable(s, job, hh),
      'Completed carrying earns a little grain from the granary. Unfinished work earns none. Pay stops when the grain runs out.',
    );
  if ((s.edition?.reserve ?? 0) > 0)
    add(
      'Send a sack from the separate store',
      () => order({ verb: 'term-choice', id: `reserve:${hh.id}`, choice: 'give' }),
      empty ? 'Nobody lives here.' : null,
      'The sack leaves the separate store. Your book records where it went.',
    );
  if (s.edition?.forecast === yearOf(dayOfMinute(s.minute)))
    add(
      'Ask for an extra sack',
      () => order({ verb: 'contribute', house: hh.id }),
      empty
        ? 'Nobody lives here.'
        : !underSeal(s, hh)
          ? 'This house is outside your authority.'
          : s.edition?.requests?.some(
                (r) =>
                  r.house === hh.id &&
                  r.action === 'early-sack' &&
                  yearOf(dayOfMinute(r.from)) === yearOf(dayOfMinute(s.minute)),
              )
            ? 'You already asked this household during this harvest.'
            : null,
      'Ask only if their jars are full. They can refuse. This is extra grain, not their normal share.',
    );
  const visit = s.kahyaState.visit;
  out.push(sayingControls(s, hh));
  if (
    s.dialogue &&
    !s.reply &&
    visit?.house === hh.id &&
    visit.arrive <= s.minute &&
    visit.leave > s.minute &&
    !hh.members.includes('zehra')
  )
    out.push(`<p class="soft say-note">${esc(zehraNote(s))} Here you can listen and see their jars.</p>`);
  if (s.edition && visit?.house === hh.id && visit.arrive <= s.minute && visit.leave > s.minute)
    for (const topic of ['person', 'debt', 'grievance'] as const)
      add(
        `Ask about ${topic === 'person' ? 'someone here' : topic === 'debt' ? 'a grain debt' : 'a grievance'}`,
        () => order({ verb: 'topic', house: hh.id, topic }),
        null,
        'Ask while you sit here. They may have nothing more to tell you.',
      );
  if (job === 'reap-agha' && yearOf(dayOfMinute(s.minute)) > 1)
    add(
      'Call this house to cut barley for pay',
      () => order({ verb: 'call', job, houses: [hh.id], wage: true }),
      callUnavailable(s, job, hh),
      'A small share of the cut grain goes to their jars.',
    );
  add(
    'Visit',
    () => order({ verb: 'visit', house: hh.id }),
    empty ? 'Nobody lives here.' : busy(s) ? visitHint(s) : null,
    hh.hamlet === 'upper'
      ? 'You will be away from the residence for most of a morning.'
      : 'You will be away from the residence for a couple of hours.',
  );
  const grainBlocked = () =>
    !hh.members.length
      ? 'Nobody lives here.'
      : !s.flags.verbs.includes('give')
        ? 'You can give grain when a household is short of food or asks at your door.'
        : s.agha.granary < 2
          ? giftHint(s)
          : null;
  const previewGrain = () => {
    if (!g) return;
    insistReceipt = null;
    const reason = grainBlocked();
    pendingGrain = reason
      ? null
      : { game: g, house: hh, stock: s.agha.granary, members: JSON.stringify(hh.members) };
    actionCaption = reason ?? grainPreview(householdLabel(hh), s.agha.granary);
    sayOpen = null;
    drawSheet(true);
    // On a phone the actions scroll; keep the question and its answer in view.
    app.querySelector('#thumbs .pending-grain')?.scrollIntoView({ block: 'nearest' });
  };
  if (pendingGrain?.house === hh) {
    const preview = pendingGrain;
    out.push(
      `<p class="pending-grain">${esc(grainPreview(householdLabel(preview.house), preview.stock))}</p>`,
      btn(
        'Confirm send grain',
        () => {
          // Consume before act: repeated or reentrant callbacks cannot spend twice.
          if (pendingGrain !== preview) return;
          pendingGrain = null;
          if (g !== preview.game || selected !== hh.id || tab !== 'notes') return;
          if (
            s.agha.granary !== preview.stock ||
            JSON.stringify(hh.members) !== preview.members ||
            grainBlocked()
          ) {
            previewGrain();
            return;
          }
          order({ verb: 'give', house: hh.id, kile: 6 });
        },
        { cls: 'wide' },
      ),
    );
    add(
      'Cancel',
      () => {
        pendingGrain = null;
        actionCaption = 'No grain was sent.';
        drawSheet(true);
      },
      null,
      'Keep the grain in your granary.',
    );
  } else if (s.flags.verbs.includes('give'))
    add('Send grain', previewGrain, grainBlocked(), `${knownFood(s, hh)} ${giftHint(s)}`);
  const blocked = empty
    ? 'Nobody lives here.'
    : !underSeal(s, hh)
      ? 'This hamlet joins on 10 June, year two.'
      : hh.paid >= shareOwed(hh) - 0.5
        ? `${paidShareWords(s, hh)} ${cropReturnWords(s)}`
        : null;
  if (s.flags.verbs.includes('ease'))
    add(
      'Reduce grain payment',
      () => order({ verb: 'ease', house: hh.id }),
      blocked ??
        (hh.eased ? `${shareOwnerWords(s, hh)} has already been reduced. ${cropReturnWords(s)}` : null),
      'Leave half of this year’s grain payment in their jars. The neighbours will notice.',
    );
  if (s.flags.verbs.includes('seize'))
    add(
      'Send the local overseer’s men',
      () => order({ verb: 'seize', house: hh.id }),
      blocked,
      'They take the grain payment from the jars. The household will remember that you used force.',
      true,
    );
  return `<div class="verb-grid">${out.join('')}</div>`;
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
    s.knocks.some((k) => !k.answered && k.at <= s.minute && k.until > s.minute) ||
    skipBlock(pacingState(performance.now(), s))
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
      ? `Call ${who} to bring grain payments`
      : `Call ${who} ${JOB_LABEL[job ?? 'reap-agha']}`;
  const houses = s.households.filter((h) => underSeal(s, h) && h.members.length).map((h) => h.id);
  const primary =
    job && !reason
      ? btn(label, () => order({ verb: 'call', job, houses }), { cls: 'primary' })
      : btn('Skip ⏩', hurry, {
          cls: 'primary',
          disabled: !!skipBlock(pacingState(performance.now(), s)),
        }).replace('<button ', '<button data-until aria-label="Skip to the next event" ');
  return `<p class="action-caption">${esc(ask ? `The call is open until ${fullDateEnglish(dayOfMinute(ask.until))}.` : job && !reason ? 'The village announcer carries your request. People can refuse.' : limitsWords(s))}</p>${primary}<div class="row">${btn('Other orders ▸', () => openReading('orders'))}${btn('The ledger ▸', () => openReading('ledger'))}</div>`;
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
        job === 'bring-share' ? 'Call for grain payments' : `Call ${JOB_LABEL[job]}`,
        () => send({ verb: 'call', job, houses }),
        {
          disabled: !!callUnavailable(s, job),
          hint: callUnavailable(s, job) ?? 'The village announcer carries your request.',
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
  if (s.edition) {
    if (job === 'build-mill')
      out.push(
        btn('Call for paid mill work', () => send({ verb: 'call', job, houses, wage: true }), {
          disabled: s.agha.granary <= 0 || !!callUnavailable(s, job),
          hint: 'Completed carrying earns a little grain from the granary. Unfinished work earns none. Pay stops when the grain runs out.',
        }),
      );
    out.push(
      btn(
        'Leave a sack out of the account',
        () => send({ verb: 'term-choice', id: 'reserve', choice: 'hide' }),
        {
          disabled: s.agha.granary < 6 || s.edition.hiddenYears?.includes(yearOf(dayOfMinute(s.minute))),
          hint: 'Keep a small sack in a separate store. The inspector may demand it or add to the due. Once each year.',
        },
      ),
    );
  }
  if (passEdition(s.edition?.id) && s.pass) {
    const roadTerms = allianceEdition(s.edition?.id);
    const j = s.pass.journey;
    const away = !!j && !j.returned;
    const there = !!j?.seen && s.minute < j.leave && !j.returned;
    const position = !away ? 50 : there ? 290 : s.minute < (j?.arrive ?? 0) ? 140 : 200;
    out.push(
      `<section aria-label="The pass route"><h3>Over the pass</h3><svg viewBox="0 0 340 90" role="img" aria-label="Residence, northern pass, Çam quarry in the adjacent valley" style="width:100%;max-width:480px"><path d="M50 50 L170 15 L290 50" fill="none" stroke="currentColor"/><circle cx="${position}" cy="45" r="6" fill="currentColor"/><text x="8" y="80" fill="currentColor">Residence</text><text x="145" y="12" fill="currentColor">Pass</text><text x="245" y="80" fill="currentColor">Çam quarry</text></svg><p>${away ? (there ? (roadTerms ? 'You are at the quarry. Stone is available only through the public road agreement below. A sack alone cannot buy a load. You can decline without paying.' : 'You are at the quarry. A sack can buy one stone load while you are here. Your return walk is still ahead.') : 'You are on the pass journey. The valley keeps working and eating. You cannot make another visit until you return.') : roadTerms ? 'Çam offers finite mill stone only through its public road agreement. Six carried grain reserves one load. Yusuf Usta must choose to complete twelve useful repair hours over six trips. Then you must travel back to collect within fourteen days. Each quarry journey takes two days and one provision. Failure releases the stone without refunding grain or time. You can do without the stone.' : 'Walk into the adjacent valley for dressed mill stone. Take provisions and a barter sack from the granary. A sack buys one load at the quarry if stock remains. You will be away for two days.'}</p>${btn('Walk to Çam quarry', () => send({ verb: 'pass', choice: 'depart' }), { disabled: away || !!(s.kahyaState.visit && s.kahyaState.visit.back > s.minute) || stewardBusy(s) || (s.stewardCare && !s.kahya.body.alive) || s.agha.granary < 7, hint: 'Pack provisions and a barter sack. That grain leaves the granary until you return or trade it.' })}${btn('Exchange a sack for stone', () => send({ verb: 'pass', choice: 'buy' }), { disabled: roadTerms || !there || !!j?.cargo || (j?.grain ?? 0) < 6 || s.pass.stock < 1, ...(roadTerms ? { hint: 'A sack alone cannot buy stone. Read the public road terms below before spending grain.' } : {}) })}${btn('Deliver the stone to the mill', () => send({ verb: 'pass', choice: 'deliver' }), { disabled: away || s.pass.stone < 1 || !s.agha.millOpen || s.agha.mill >= V.millHours, hint: 'Only stone carried home can supply a little of the mill work. The payment dates stay the same.' })}</section>`,
    );
    out.push(
      `<section><h3>A family introduction</h3><p>${s.introduction?.status === 'met' ? 'The adults met with her father present. Nobody has agreed to marry.' : s.introduction?.status === 'missed' ? 'No supervised meeting took place. Nobody was promised in marriage.' : s.introduction ? 'Each adult and her father has been invited. Their work and rest may come first.' : 'Ask an unmarried adult from Kavak and an unmarried adult from Kuyucu to meet at Kuyucu with her father present. They choose whether to attend. Meeting is not a marriage agreement.'}</p>${btn('Arrange an introduction at Kuyucu', () => send({ verb: 'introduce' }), { disabled: !!s.introduction || !introductionEligible(s), hint: 'Only these existing eligible adults are invited. No visitor is assigned a spouse or guardian.' })}</section>`,
    );
    if (allianceEdition(s.edition?.id)) {
      const b = s.brokering;
      const family =
        b?.phase === 'married'
          ? 'The marriage is recorded. The sponsored bridal gift belongs to the woman.'
          : b?.phase === 'engaged'
            ? 'Both adults accepted the proposal after her father’s approval. They have not married. A family ceremony still needs their separate confirmation.'
            : b?.phase === 'refused'
              ? 'The discussion ended with a refusal. No marriage was recorded.'
              : b?.phase === 'expired'
                ? 'The invitation ended without all the required answers. No marriage was recorded.'
                : b && ['guardian', 'proposal', 'answer', 'ceremony'].includes(b.phase)
                  ? 'The family discussion is open. Each person may choose their own work or rest. Attendance supplies no consent.'
                  : 'Further supervised meetings take provisions and two days of the steward’s presence. The adults may get to know each other over time. A proposal still requires separate answers.';
      out.push(
        `<section><h3>Family arrangements</h3><p>${family}</p>${(['meeting', 'proposal', 'ceremony'] as const)
          .map((choice) => {
            const reason = brokerUnavailable(s, choice);
            return btn(
              choice === 'meeting'
                ? 'Host another supervised meeting'
                : choice === 'proposal'
                  ? 'Host a proposal discussion'
                  : 'Host the family ceremony',
              () => send({ verb: 'broker', choice }),
              {
                disabled: !!reason,
                hint:
                  reason ??
                  (choice === 'ceremony'
                    ? 'Reserve provisions, a sponsored bridal gift and two days at Kuyucu. Either adult may still decline.'
                    : 'Bring provisions and stay at Kuyucu for two days. Work in the valley continues.'),
              },
            );
          })
          .join('')}</section>`,
      );
      const a = s.pass.alliance;
      out.push(
        `<section><h3>A road agreement with Çam</h3><p>${!a ? 'Çam’s public terms offer a stone reservation for a carried sack and repairs on this side of the pass within about a fortnight. These are the neighbouring valley’s standing terms. You commit the office to arranging the work. Yusuf Usta can still choose whether to help. Read and accept or decline them at the quarry.' : a.status === 'active' ? (a.hours >= 12 ? 'The local repairs are complete. Collect the reserved stone at Çam before the agreement ends. The return journey still takes time.' : 'The sack has paid Çam’s crew, and one stone is reserved. Local repairs remain. Yusuf Usta chooses his own work; your other calls may interrupt the repairs. Failure ends the reservation without refunding grain or time.') : a.status === 'completed' ? 'The agreement is complete. The stone was collected; it must still come home before the mill can use it.' : a.status === 'refused' ? 'The road agreement was declined or no stone was available to reserve. No obligations began.' : 'The road agreement ended without collection. The reservation was released. Grain and repair time already spent remain spent.'}</p>${btn('Accept Çam’s road terms', () => send({ verb: 'alliance', choice: 'accept' }), { disabled: !there || !!a || (j?.grain ?? 0) < 6, hint: 'Spend the carried sack. Arrange about two working days of voluntary repair, then travel back to collect the reserved stone within a fortnight.' })}${btn('Decline the road terms', () => send({ verb: 'alliance', choice: 'decline' }), { disabled: !there || !!a })}${btn('Collect the reserved stone', () => send({ verb: 'alliance', choice: 'collect' }), { disabled: !there || a?.status !== 'active' || a.hours < 12 || !!j?.cargo })}${btn('Withdraw from the road agreement', () => send({ verb: 'alliance', choice: 'withdraw' }), { disabled: a?.status !== 'active', hint: 'This breaks the agreement. The reservation ends; the spent sack and repair time do not return.' })}</section>`,
      );
    }
  }
  const blocked =
    !s.flags.verbs.includes('borrow') || !!(s.agha.loan && s.minute - s.agha.loan.asked < 300 * DAY);
  out.push(
    btn('Write to the landowner for grain', () => send({ verb: 'borrow', kile: 80 }), {
      disabled: blocked,
      hint:
        loanReturnWords(s) ??
        (!s.flags.verbs.includes('borrow')
          ? 'You can write when the estimate shows too little grain or hungry households find the granary low.'
          : 'A cart arrives in twelve days. Repay a quarter more when a later rider comes.'),
    }),
  );
  return `<div class="other-orders${allianceEdition(s.edition?.id) ? ' alliance-orders' : ''}">${out.join('')}</div>`;
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
        `<tr><td>${esc(householdLabel(h))}</td><td class="n">${Math.round(h.paid)} of ${shareOwed(h)}${h.eased ? ' (reduced)' : ''}</td></tr>`,
    )
    .join('');
  const loan =
    s.agha.loan && !s.agha.loan.paid
      ? `<tr><td>Owed for the loan${loanOwedAt(s, s.agha.dueDay) ? '' : ', at next year’s rider'}</td><td class="n">${s.agha.loan.owe}</td></tr>`
      : '';
  return `<div class="ledger ink-in"><p>${s.edition ? 'This term includes voluntary contributions, mill pay, winter loans and inspections.' : 'This term uses the original rules.'}</p>${btn('Read prior volumes', () => void openVolumes())}
    <p>${esc(nextWords(s))}</p>
    <p class="soft" >This grain is set aside to pay the landowner. Gifts leave less for the rider to collect.</p>
    <table>
      <tr><td>In the granary</td><td class="n">${Math.round(s.agha.granary)} grain measures</td></tr>
      ${s.agha.reaped >= 1 ? `<tr><td>Cut grain awaiting separation from stalks</td><td class="n">about ${Math.round(s.agha.reaped / 5) * 5 || 1}</td></tr>` : ''}
      ${s.agha.standing >= 1 ? `<tr><td>Uncut grain in the landowner’s field</td><td class="n">about ${Math.round(s.agha.standing / 10) * 10 || 5}</td></tr>` : ''}
      ${rainGuess(s) ? `<tr><td colspan="2" class="soft">${esc(rainGuess(s) ?? '')} (your guess)</td></tr>` : ''}
      <tr><td>Owed to the landowner</td><td class="n">${s.agha.due} grain measures</td></tr>
      <tr><td>The rider comes</td><td class="n">${esc(riderWords(s))}</td></tr>
      ${s.agha.arrears ? `<tr><td>Unpaid grain added to this year</td><td class="n">${s.agha.arrears}</td></tr>` : ''}
      ${loan}
      <tr><td>Years with too little grain paid</td><td class="n">${s.agha.missed}</td></tr>
    </table>
    ${s.flags.verbs.includes('take') ? `<h3 style="margin:8px 0 0">${sharesFresh(s) ? 'Grain payments this year' : 'Grain payments brought to the last rider'}</h3><table>${rows}</table>` : ''}
    <p class="soft" >The term ends at the elders’ gathering, ${esc(dateWords(END_DAY))} of year three.</p>
  </div>`;
}

// ---------- holding ----------

/** A hold button can also be confirmed with a second tap or key press within a few seconds, so it works without
 * press-and-hold (switch access, screen readers, drivers that cannot hold). The first tap only arms it. */
const ARM_MS = 5000;
let armed: { key: string; until: number } | null = null;
function holdKey(b: HTMLButtonElement): string {
  const row = b.closest('.reply-row, .decision-reply');
  return `${selected}|${tab}|${b.firstChild?.textContent ?? ''}|${row?.querySelector('b, p:not(.reply-date)')?.textContent ?? ''}`;
}

function bindHold(b: HTMLButtonElement, fn: () => void) {
  let timer = 0;
  let fired = false;
  let progressTimer = 0;
  let keyTapAt = -1e9;
  const duration = 650;
  const key = holdKey(b);
  const progress = document.createElement('span');
  progress.className = 'hold-progress';
  progress.setAttribute('aria-hidden', 'true');
  b.append(progress);
  const showProgress = (fraction: number) => {
    b.style.setProperty('--hold-progress', `${fraction * 100}%`);
    progress.textContent = fraction > 0 ? `${Math.floor(fraction * 100)}%` : '';
  };
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  const say = (text: string) => {
    const status = app.querySelector<HTMLElement>('#hold-feedback') ?? document.createElement('p');
    status.id = 'hold-feedback';
    status.className = 'hold-feedback';
    status.setAttribute('role', 'status');
    status.hidden = false;
    status.textContent = text;
    b.after(status);
  };
  const disarm = () => {
    if (armed?.key === key) armed = null;
    b.classList.remove('armed');
  };
  if (armed && armed.key === key && performance.now() < armed.until) {
    b.classList.add('armed');
    window.setTimeout(disarm, armed.until - performance.now());
  }
  const tap = () => {
    if (fired || b.disabled || !b.isConnected) return;
    if (armed && armed.key === key && performance.now() < armed.until) {
      cancel();
      fired = true;
      disarm();
      fn();
      return;
    }
    armed = { key, until: performance.now() + ARM_MS };
    b.classList.add('armed');
    window.setTimeout(disarm, ARM_MS);
    say('Tap again to confirm, or hold the button until it fills.');
  };
  b.addEventListener('click', () => {
    // A key press already counted on keyup; the browser may also send a click for it.
    if (performance.now() - keyTapAt < 80) return;
    tap();
  });
  const startHold = () => {
    if (b.disabled || fired || timer || !b.isConnected) return;
    const started = performance.now();
    showProgress(0);
    progressTimer = window.setInterval(() => {
      if (!b.isConnected) return cancel();
      showProgress(Math.min(1, (performance.now() - started) / duration));
    }, 16);
    b.classList.add('holding');
    timer = window.setTimeout(() => {
      clearInterval(progressTimer);
      timer = 0;
      if (fired || !b.isConnected || b.disabled) return cancel();
      fired = true;
      disarm();
      showProgress(1);
      b.classList.remove('holding');
      fn();
    }, duration);
  };
  b.addEventListener('pointerdown', startHold);
  let keyDown = false;
  b.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    // Repeats too: a held key must never turn into clicks that arm and fire.
    e.preventDefault();
    if (e.repeat) return;
    keyDown = true;
    startHold();
  });
  b.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    keyTapAt = performance.now();
    // Only a press that began on this button counts as a tap.
    if (!keyDown) return;
    keyDown = false;
    cancel();
    tap();
  });
  b.addEventListener('blur', () => cancel());
  const cancel = () => {
    clearTimeout(timer);
    clearInterval(progressTimer);
    timer = 0;
    showProgress(0);
    b.classList.remove('holding');
  };
  b.addEventListener('pointerleave', cancel);
  b.addEventListener('pointercancel', cancel);
  b.addEventListener('pointerup', cancel);
}

// ---------- the ending ----------

function ending() {
  textSizeObserver?.disconnect();
  textSizeObserver = null;
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
    ${elders
      .map(
        (e) =>
          `<div class="elder"><b>${esc(
            cap(
              personLabel(
                personOf(s, e.id) ?? { name: e.name },
                s.households.find((h) => h.name === e.house),
              ),
            ),
          )}</b>, ${esc(e.house)}<span class="w">“${esc(e.words)}”</span></div>`,
      )
      .join('')}
    <p>${esc(letter)}</p>
    <details class="closing-grain"><summary>See the tally</summary><p data-closing-grain></p></details>
    </div><footer class="ending-actions"><div class="row"><button data-feedback>Feedback</button><button data-ending-notebook>Earlier replies</button></div><button class="primary" data-go="new">Begin a new term</button>${mark()}${footer()}</footer>
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
  target.textContent = g ? englishText(closingGrain(g.valley, true)) : '';
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
