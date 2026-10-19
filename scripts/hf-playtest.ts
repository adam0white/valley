/**
 * HF people play The Valley: the HF-character playtester (human-framework `packages/playtester`) plays the kahya
 * through what the screen shows, and the run prints where each persona got bored, frustrated, rewarded or stopped.
 *
 *   HF_DIR=~/code/human-framework node scripts/hf-playtest.ts [seeds=2] [json=1]
 *
 * The adapter shows only what the phone shows: the notebook's lines (weighted as the notebook weights them),
 * knocks at the door, the crier's status, the due in words, the house hunches' existence (not their truth). Time
 * runs at 'steady' (120 game minutes a real second, three times faster at night), slowed to 20 for 3.5 real
 * seconds after a heavy note, as the UI does. The actions mirror the thumbs and knock cards in src/ui/app.ts; if
 * the UI changes, this list must follow it.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dayOfMinute, doyOf, seasonOf, yearOf } from '../src/sim/calendar.ts';
import { act, DAY, type Game, newGame, type Order, QUANTUM, step } from '../src/sim/game.ts';
import {
  houseOf,
  type Job,
  type Note,
  nextRiderDay,
  personOf,
  shareOwed,
  underSeal,
} from '../src/sim/valley.ts';

// The playtester's contract (packages/playtester/src/adapter.ts), restated so this repo typechecks alone.
interface PlayEvent {
  kind: string;
  summary: string;
  valence: number;
  salience: number;
  by?: string;
  answers?: boolean | string[];
}
interface PlayAction {
  id: string;
  label: string;
  kind: string;
  promise: number;
  focus?: number;
  tags?: string[];
}
interface Reading {
  ended: { reason: string; clock: string; why: string };
  minutes: number;
  meanEngagement: number;
  choices: Record<string, number>;
  longestLull: { seconds: number; from: string; phase: string };
  lookedAway: number;
  rewarded: string[];
}
interface Trace {
  moments: { t: number; clock: string; kind: string; text: string }[];
}
interface PT {
  PERSONAS: Record<string, { id: string }>;
  playSession(adapter: ValleyAdapter, persona: { id: string }, seed: number): Trace;
  readSession(trace: Trace): Reading;
}
const HF_DIR = process.env.HF_DIR ?? join(homedir(), 'code', 'human-framework');
const pt = (await import(join(HF_DIR, 'packages/playtester/src/index.ts'))) as PT;

const STEADY = 120;
const SLOWED = 20;

function jobInSeason(g: Game): Job | null {
  const s = g.valley;
  const season = seasonOf(doyOf(dayOfMinute(s.minute)));
  if ((season === 'harvest' || season === 'threshing') && s.agha.standing > 5) return 'reap-agha';
  if (s.flags.verbs.includes('take') && (season === 'threshing' || season === 'autumn')) return 'bring-share';
  if (s.agha.millOpen && s.agha.mill < 600) return 'build-mill';
  return null;
}
const openAsk = (g: Game, job: Job) =>
  g.valley.asks.find((a) => a.job === job && !a.closed && a.until > g.valley.minute);
const busy = (g: Game) => !!g.valley.kahyaState.visit && g.valley.kahyaState.visit.back > g.valley.minute;

function judge(n: Note): PlayEvent {
  const sal = Math.min(0.95, 0.35 + 0.15 * n.weight);
  const t = `${n.text}${n.words ? ` “${n.words}”` : ''}`;
  const v = (() => {
    if (n.kind === 'reply')
      return /would not/.test(n.text) ? -0.3 : /put .* off|instead|brought half/.test(n.text) ? -0.05 : 0.25;
    if (n.kind === 'birth' || n.kind === 'wedding') return 0.35;
    if (n.kind === 'death' || n.kind === 'left') return -0.5;
    if (n.kind === 'weather' && /storm|laid|flattened/.test(n.text)) return -0.5;
    if (n.kind === 'due') return /short/.test(n.text) ? -0.8 : 0.8;
    if (n.kind === 'knock') return -0.1;
    if (n.kind === 'work') return /last of it/.test(n.text) ? 0.6 : 0.3;
    if (n.kind === 'harvest' && /granary/.test(n.text)) return /due is in/.test(n.text) ? 0.8 : 0.5;
    if (n.kind === 'gift' || n.kind === 'visit') return 0.15;
    if (n.kind === 'voice')
      return /nothing in the jar|scraped|remember|haven’t forgotten|hard|Take it/.test(
        n.text + (n.words ?? ''),
      )
        ? -0.15
        : 0.3;
    if (n.kind === 'story') return 0.05;
    if (n.kind === 'seize') return -0.2;
    return 0;
  })();
  // What input this note answers (by id prefix), so an unanswered provocation is seen as unanswered.
  const answers: string[] | boolean =
    n.kind === 'voice'
      ? /hearth|wedding/.test(n.text)
        ? [`visit:${n.house}`]
        : /sack/.test(n.text)
          ? [`give:${n.house}`]
          : /doorway/.test(n.text)
            ? [`seize:${n.house}`]
            : [`ease:${n.house}`, 'ease:']
      : n.kind === 'reply'
        ? ['call:', 'wage:', ...(n.who ? [`press:${n.ask}:${n.who}`] : [])]
        : n.kind === 'knock' && /went back down the lane|sent .* away/.test(n.text)
          ? ['away:']
          : false;
  return { kind: n.kind, summary: t, valence: v, salience: sal, ...(n.who ? { by: n.who } : {}), answers };
}

class ValleyAdapter {
  name = 'the-valley';
  readonly g: Game;
  private seenNote = 0;
  private slowFor = 0;
  constructor(seed: number) {
    this.g = newGame(seed);
    this.seenNote = 0;
  }
  observe() {
    const s = this.g.valley;
    const events: PlayEvent[] = [];
    for (const n of s.notes) {
      if (n.id <= this.seenNote || n.at > s.minute + QUANTUM) continue;
      events.push(judge(n));
      if (n.weight >= 2.5) this.slowFor = 3.5;
    }
    this.seenNote = s.notes.filter((n) => n.at <= s.minute + QUANTUM).at(-1)?.id ?? this.seenNote;
    const knocks = s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute).length;
    const days = nextRiderDay(s) - dayOfMinute(s.minute);
    const short = 1 - Math.min(1, s.agha.granary / Math.max(1, s.agha.due));
    const d = dayOfMinute(s.minute);
    return {
      clock: `y${yearOf(d)} d${d} ${String(Math.floor((s.minute % DAY) / 60)).padStart(2, '0')}h`,
      phase: seasonOf(doyOf(d)),
      events,
      features: { pressure: Math.min(1, 0.3 * knocks + (days < 20 ? short * 0.6 : 0)) },
      over: !!s.flags.ended,
      chapter: `y${yearOf(d)} ${seasonOf(doyOf(d))}`,
      ...(s.flags.ended
        ? {
            outcome:
              s.flags.ended === 'dismissed'
                ? ('loss' as const)
                : s.agha.missed
                  ? ('mixed' as const)
                  : ('win' as const),
          }
        : {}),
    };
  }
  actions(): PlayAction[] {
    const g = this.g;
    const s = g.valley;
    const out: PlayAction[] = [];
    const job = jobInSeason(g);
    const houses = s.households.filter((h) => underSeal(s, h) && h.members.length).map((h) => h.id);
    const add = (id: string, label: string, kind: string, promise: number, tags?: string[]) =>
      out.push({ id, label, kind, promise, ...(tags ? { tags } : {}) });
    if (job && !openAsk(g, job)) {
      add(`call:${job}`, `call the valley (${job})`, 'call', 0.8);
      if (yearOf(dayOfMinute(s.minute)) > 1 || job === 'build-mill')
        add(`wage:${job}`, 'call for a sheaf in eight', 'call', 0.55);
    }
    for (const k of s.knocks.filter((k) => !k.answered && k.at <= s.minute && k.until > s.minute)) {
      if (k.what === 'grain') {
        if (s.agha.granary >= 2) add(`give:${k.house}`, `give grain to ${k.house}`, 'give', 0.65);
        add(`away:${k.id}`, `send ${k.house} away`, 'send-away', 0.25, ['confront']);
      } else if (!busy(g)) add(`visit:${k.house}:${k.what}`, `go to ${k.house} (${k.what})`, 'visit', 0.7);
    }
    if (s.flags.verbs.includes('visit') && !busy(g))
      for (const h of houses) add(`visit:${h}`, `sit with ${h}`, 'visit', 0.3);
    if (s.flags.verbs.includes('insist'))
      for (const a of s.asks.filter((a) => !a.closed && a.until > s.minute))
        for (const [pid, r] of Object.entries(a.replies))
          if (
            !a.insisted.includes(pid) &&
            (r.verdict === 'deferred' || r.verdict === 'refused' || r.verdict === 'modified')
          )
            add(`press:${a.id}:${pid}`, `press ${personOf(s, pid)?.name ?? pid}`, 'press', 0.45, [
              'confront',
            ]);
    for (const id of houses) {
      const h = houseOf(s, id);
      if (!h || h.paid >= shareOwed(h) - 0.5 || !s.flags.verbs.includes('take')) continue;
      if (s.flags.verbs.includes('ease') && !h.eased) add(`ease:${id}`, `ease ${id}`, 'ease', 0.25);
      if (s.flags.verbs.includes('seize')) add(`seize:${id}`, `seize from ${id}`, 'seize', 0.2, ['confront']);
    }
    if (
      s.flags.verbs.includes('borrow') &&
      (!s.agha.loan || s.minute - s.agha.loan.asked > 300 * DAY) &&
      s.agha.granary < s.agha.due * 0.6
    )
      add('borrow', 'write to the agha for grain', 'borrow', 0.4);
    return out;
  }
  apply(id: string) {
    const g = this.g;
    const [verb, a, b] = id.split(':');
    const houses = g.valley.households
      .filter((h) => underSeal(g.valley, h) && h.members.length)
      .map((h) => h.id);
    let o: Order | null = null;
    if (verb === 'call') o = { verb: 'call', job: a as Job, houses };
    else if (verb === 'wage') o = { verb: 'call', job: a as Job, houses, wage: true };
    else if (verb === 'give') o = { verb: 'give', house: a ?? '', kile: 6 };
    else if (verb === 'away') o = { verb: 'turn-away', knock: a ?? '' };
    else if (verb === 'visit')
      o = b ? { verb: 'visit', house: a ?? '', why: b as 'birth' } : { verb: 'visit', house: a ?? '' };
    else if (verb === 'press') o = { verb: 'insist', ask: a ?? '', pid: b ?? '' };
    else if (verb === 'ease') o = { verb: 'ease', house: a ?? '' };
    else if (verb === 'seize') o = { verb: 'seize', house: a ?? '' };
    else if (verb === 'borrow') o = { verb: 'borrow', kile: 80 };
    if (o) act(g, o);
  }
  advance(seconds: number) {
    const s = this.g.valley;
    let left = seconds;
    while (left > 0 && !s.flags.ended) {
      const dt = Math.min(left, 1);
      const h = (s.minute % DAY) / 60;
      const night = h < 5 || h >= 21;
      const rate = this.slowFor > 0 ? SLOWED : STEADY * (night ? 3 : 1);
      this.slowFor = Math.max(0, this.slowFor - dt);
      const to = s.minute + rate * dt;
      step(this.g, Math.floor(to / QUANTUM) * QUANTUM);
      left -= dt;
    }
  }
}

const seeds = Number(process.argv.find((a) => a.startsWith('seeds='))?.slice(6) ?? 2);
const json = process.argv.includes('json=1');
for (const persona of Object.values(pt.PERSONAS))
  for (let seed = 1; seed <= seeds; seed++) {
    const game = new ValleyAdapter(1000 + seed);
    const t0 = performance.now();
    const trace = pt.playSession(game, persona, seed);
    const r = pt.readSession(trace);
    if (json) {
      console.log(JSON.stringify(r));
      continue;
    }
    const s = game.g.valley;
    console.log(
      `\n${persona.id} seed ${seed}: ${r.ended.reason} after ${r.minutes} min at ${r.ended.clock} (${r.ended.why}) [${Math.round(performance.now() - t0)} ms]`,
    );
    console.log(
      `  granary ${Math.round(s.agha.granary)}/${s.agha.due}, delivered ${s.agha.delivered}, inputs ${game.g.inputs.length}; engagement ${r.meanEngagement}; time ${JSON.stringify(r.choices)}`,
    );
    console.log(
      `  longest lull ${r.longestLull.seconds}s from ${r.longestLull.from} (${r.longestLull.phase}); looked away ${r.lookedAway}x`,
    );
    for (const m of trace.moments.filter((x) => x.kind !== 'rewarded').slice(0, 8))
      console.log(
        `  ${Math.floor(m.t / 60)}:${String(m.t % 60).padStart(2, '0')} ${m.clock} ${m.kind}: ${m.text}`,
      );
    console.log(`  rewarded ${r.rewarded.length}x, first: ${r.rewarded.slice(0, 3).join(' | ')}`);
  }
