// Headless measure: a plain steward plays the whole term; prints the refusal band, the valley's life, timings and
// a replay check. `npm run measure -- [seed] [days]`.

import { DAY, dayOfMinute, doyOf, seasonOf, yearOf } from '../src/sim/calendar.ts';
import { act, END_DAY, fingerprint, type Game, gathering, newGame, replay, step } from '../src/sim/game.ts';
import { daysOfBread, personOf, underSeal } from '../src/sim/valley.ts';

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? END_DAY + 1);
const g: Game = newGame(seed);
const s = g.valley;
const ms: Record<string, number> = {};
const dayCount: Record<string, number> = {};
const houses = () => s.households.filter((h) => underSeal(s, h)).map((h) => h.id);
const BOT = process.env.BOT ?? 'plain';
const idle = BOT === 'idle';
// Edge bots: 'iron' seizes from every unpaid house and turns every hungry knock away; 'open' gives to every
// knock while the granary lasts and eases every house.
const iron = BOT === 'iron';
const openHand = BOT === 'open';
// Lines worth counting over the whole term (the notebook keeps only the last 400).
const WATCH: [string, RegExp][] = [
  ['forecast', /^The reeve did the sums/],
  ['open-hand', /gone down the lanes since/],
  ['tally', /^The reeve’s tally/],
  ['mill-sight', /mill/i],
  ['grouped-press', /came when you pressed/],
];
const watched: Record<string, number> = {};
const seenNotes = new Set<number>();
const watch = () => {
  for (const n of s.notes) {
    if (seenNotes.has(n.id)) continue;
    seenNotes.add(n.id);
    for (const [k, re] of WATCH) if (re.test(n.text)) watched[k] = (watched[k] ?? 0) + 1;
  }
};
const t0 = performance.now();
for (let d = 0; d < days && !s.flags.ended; d++) {
  watch();
  const doy = doyOf(d);
  const season = seasonOf(doy);
  // Morning decisions at 07:30.
  step(g, d * DAY + 7 * 60 + 30);
  if (doy === 174)
    console.log(
      `  sown before the crop y${yearOf(d) + 1}: ` +
        s.households
          .map((h) => `${h.short} ${h.field.sown.toFixed(2)} store ${Math.round(h.store)}`)
          .join(', '),
    );
  if (!idle) {
    if (
      season === 'harvest' &&
      s.agha.standing > 5 &&
      !s.asks.some((a) => a.job === 'reap-agha' && !a.closed && a.until > s.minute)
    ) {
      act(g, { verb: 'call', job: 'reap-agha', houses: houses(), wage: yearOf(d) > 1 });
    }
    // Insist with one who put it off yesterday.
    const open = s.asks.filter((a) => !a.closed && a.until > s.minute && a.job !== 'bring-share');
    for (const a of open) {
      const off = Object.entries(a.replies).find(
        ([pid, r]) => r.verdict === 'deferred' && !a.insisted.includes(pid),
      );
      if (off && d % 2 === 0) act(g, { verb: 'insist', ask: a.id, pid: off[0] });
    }
    if (
      s.flags.verbs.includes('take') &&
      doy >= 216 &&
      doy < 262 &&
      !s.asks.some((a) => a.job === 'bring-share' && a.from > s.minute - 300 * DAY)
    ) {
      act(g, { verb: 'call', job: 'bring-share', houses: houses() });
    }
    // Ten days before the rider, ease the hungriest unpaid house and seize from the richest.
    if (d === s.agha.dueDay - 10 && (iron || openHand)) {
      for (const h of s.households.filter(
        (h) => underSeal(s, h) && h.members.length && h.paid < h.share - 0.5,
      ))
        act(g, iron ? { verb: 'seize', house: h.id } : { verb: 'ease', house: h.id });
    } else if (d === s.agha.dueDay - 10) {
      const unpaid = s.households.filter((h) => underSeal(s, h) && h.paid < h.share - 0.5);
      const hungry = unpaid.sort((a, b) => daysOfBread(s, a) - daysOfBread(s, b))[0];
      if (hungry) act(g, { verb: 'ease', house: hungry.id });
      const rich = unpaid.sort((a, b) => daysOfBread(s, b) - daysOfBread(s, a))[0];
      if (rich && rich !== hungry) act(g, { verb: 'seize', house: rich.id });
    }
    if (
      s.agha.millOpen &&
      s.agha.mill < 600 &&
      (doy >= 330 || doy < 170) &&
      !s.asks.some((a) => a.job === 'build-mill' && !a.closed && a.until > s.minute)
    ) {
      act(g, { verb: 'call', job: 'build-mill', houses: houses().slice(0, 6), wage: true });
    }
    if (
      s.flags.verbs.includes('borrow') &&
      s.agha.granary < 30 &&
      (!s.agha.loan || s.minute - s.agha.loan.asked > 300 * DAY)
    )
      act(g, { verb: 'borrow', kile: 80 });
    for (const k of s.knocks) {
      if (k.answered || k.at > s.minute || k.until < s.minute) continue;
      if (k.what === 'grain')
        act(
          g,
          !iron && s.agha.granary > (openHand ? 2 : 10)
            ? { verb: 'give', house: k.house, kile: openHand ? 15 : 6 }
            : { verb: 'turn-away', knock: k.id },
        );
      else act(g, { verb: 'visit', house: k.house, why: k.what });
    }
    // The open hand also walks the lanes with sacks, as the round-2 edge-pusher did: the hungriest house, every other day.
    if (openHand && d % 2 === 0 && s.flags.verbs.includes('give') && s.agha.granary > 2) {
      const hungriest = s.households
        .filter((h) => underSeal(s, h) && h.members.length)
        .sort((a, b) => daysOfBread(s, a) - daysOfBread(s, b))[0];
      if (hungriest && daysOfBread(s, hungriest) < 60) act(g, { verb: 'give', house: hungriest.id, kile: 6 });
    }
    if (d % 9 === 3) {
      const hs = houses();
      act(g, { verb: 'visit', house: hs[d % hs.length] ?? 'ak' });
    }
  }
  if (d === s.agha.dueDay - 1) {
    console.log(
      `  before the rider y${yearOf(d)}: granary ${Math.round(s.agha.granary)} due ${s.agha.due}; ` +
        s.households
          .filter((h) => underSeal(s, h))
          .map((h) => `${h.short} ${h.paid.toFixed(0)}/${h.share}${h.eased ? 'e' : ''}`)
          .join(', '),
    );
    const sa = s.asks.filter((x) => x.job === 'bring-share' && x.until > s.minute);
    console.log(
      '  share asks open:',
      sa
        .map(
          (x) =>
            `${x.id} replies ${Object.values(x.replies)
              .map((r) => `${r.verdict}:${r.chosen}:${r.reason.split(':')[0]}`)
              .join(' ')}`,
        )
        .join(' | '),
    );
  }
  const a = performance.now();
  step(g, (d + 1) * DAY);
  const key = `${season}${s.full.length > 15 ? '+' : ''}`;
  ms[key] = (ms[key] ?? 0) + performance.now() - a;
  dayCount[key] = (dayCount[key] ?? 0) + 1;
  if (d % (Number(process.env.EVERY) || 60) === 0)
    console.log(
      `day ${d} (${seasonOf(doyOf(d))} y${yearOf(d)}): people ${s.people.length}, full ${s.full.length}, agha standing ${Math.round(s.agha.standing)} reaped ${Math.round(s.agha.reaped)} granary ${Math.round(s.agha.granary)}, due ${s.agha.due}, delivered ${Math.round(s.agha.delivered)}, missed ${s.agha.missed}`,
    );
  if (process.env.HOUSES && d % (Number(process.env.EVERY) || 60) === 0)
    console.log(
      '   ',
      s.households
        .filter((h) => underSeal(s, h))
        .map((h) => `${h.short}:${Math.round(daysOfBread(s, h))}d/${h.members.length}`)
        .join(' '),
    );
}
const total = performance.now() - t0;
const kinds: Record<string, number> = {};
for (const n of s.notes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
watch();
console.log('WATCH', JSON.stringify(watched));
console.log('\nverdicts (all asks):', s.stats.verdicts);
const hv = s.stats.harvestVerdicts;
const hTot = Object.values(hv).reduce((a, b) => a + b, 0);
console.log(
  'harvest verdicts:',
  hv,
  `not a plain yes: ${(((hTot - (hv.assented ?? 0)) / Math.max(1, hTot)) * 100).toFixed(0)}%`,
);
console.log('notes by kind (last 400):', kinds);
console.log(
  'ended:',
  s.flags.ended,
  'day',
  dayOfMinute(s.minute),
  'delivered',
  Math.round(s.agha.delivered),
  'missed',
  s.agha.missed,
  'stolen',
  Math.round(s.stolen),
);
console.log(
  'people now',
  s.people.length,
  'departed',
  Object.values(s.departed).reduce((a: Record<string, number>, d) => {
    a[d.why] = (a[d.why] ?? 0) + 1;
    return a;
  }, {}),
);
console.log('ms per sim-day by season (+ = more than 15 lived in full):');
for (const k of Object.keys(ms).sort())
  console.log(`  ${k}: ${((ms[k] ?? 0) / (dayCount[k] ?? 1)).toFixed(1)} ms over ${dayCount[k]} days`);
console.log(`total ${(total / 1000).toFixed(1)} s, inputs ${g.inputs.length}`);
const trusts = s.people
  .filter((p) => p.will.voices.length)
  .map((p) => p.will.voices.find((v) => v.voiceId === 'kahya')?.trust ?? 0);
console.log(
  'trust in the kahya (internal): mean',
  (trusts.reduce((a, b) => a + b, 0) / trusts.length).toFixed(2),
  'min',
  Math.min(...trusts).toFixed(2),
);
if (s.flags.ended) {
  for (const e of gathering(g).elders) console.log(`  ${e.name} (${e.house}): ${e.words}`);
  console.log(`  LETTER ${gathering(g).letter}`);
}
for (const n of s.notes.filter((n) => n.weight >= 2.5).slice(-25))
  console.log(`  d${(n.at / DAY).toFixed(1)} ${n.text} ${n.words ? `“${n.words}”` : ''}`);
const deaths = s.notes.filter((n) => n.kind === 'death');
const riders = s.notes
  .filter((n) => n.kind === 'due')
  .map((n) => (/short/.test(n.text) ? `${n.text.match(/(\d+) short/)?.[1] ?? '?'} short` : 'whole'));
console.log(
  `SUMMARY bot=${BOT} seed=${seed}: riders [${riders.join(', ')}], ended ${s.flags.ended ?? '-'} d${dayOfMinute(s.minute)}, deaths ${deaths.length} (hungry ${deaths.filter((n) => /nothing in the jar/.test(n.text)).length}), left ${Object.values(s.departed).filter((d) => d.why === 'left').length}, people ${s.people.length}, seized ${s.stats.seized ?? 0}, given ${Math.round(s.stats.given ?? 0)}`,
);
if (process.env.REPLAY !== '0') {
  const fp = fingerprint(s);
  const r = replay(seed, g.inputs, s.minute);
  const fr = fingerprint(r.valley);
  console.log(`replay fingerprint ${fr} vs ${fp}: ${fr === fp ? 'MATCH' : 'DIFFERENT'}`);
}
void personOf;
if (process.env.JOBS) {
  const by: Record<string, Record<string, number>> = {};
  for (const a of s.asks)
    for (const r of Object.values(a.replies)) {
      const k = `${a.job}`;
      by[k] ??= {};
      const key = `${r.verdict}:${r.chosen}:${r.reason.split(':')[0]}`;
      by[k][key] = (by[k][key] ?? 0) + 1;
    }
  console.log(JSON.stringify(by, null, 1));
  console.log(s.households.map((h) => `${h.short} paid ${h.paid.toFixed(0)}/${h.share}`).join(', '));
}
