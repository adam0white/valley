import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Full-term mechanics proof; deliberately opt-in because each run includes a full replay.
// Usage: node scripts/plain-english-proof.mjs [seed=7] [idle|plain|iron|open=plain] [outputDir=/tmp/valley-rules-proof]
// PROOF_SOURCE may point to an archived source tree to verify the original baseline.
const [seedText = '7', policy = 'plain', output = '/tmp/valley-rules-proof'] = process.argv.slice(2);
if (!['idle', 'plain', 'iron', 'open'].includes(policy)) throw Error(`Unknown policy: ${policy}`);
const source = process.env.PROOF_SOURCE ?? fileURLToPath(new URL('..', import.meta.url));
const { DAY, doyOf, seasonOf, yearOf } = await import(pathToFileURL(`${source}/src/sim/calendar.ts`));
const { act, END_DAY, fingerprint, newGame, step, stateJson, compactRun, load, save } = await import(
  pathToFileURL(`${source}/src/sim/game.ts`)
);
const { daysOfBread, underSeal } = await import(pathToFileURL(`${source}/src/sim/valley.ts`));
const seed = Number(seedText);
if (!Number.isSafeInteger(seed)) throw Error(`Invalid seed: ${seedText}`);
// Baseline contains only mechanical hashes, never prose or HF person state.
const fixture = JSON.parse(
  readFileSync(new URL('../test/fixtures/plain-english-mechanics.json', import.meta.url), 'utf8'),
);
const expected = fixture.runs.find((r) => r.seed === seed && r.policy === policy);
if (!expected) throw Error(`No baseline fixture for seed ${seed}, policy ${policy}`);

const g = newGame(seed);
const s = g.valley;
const houses = () => s.households.filter((h) => underSeal(s, h)).map((h) => h.id);
const iron = policy === 'iron';
const openHand = policy === 'open';
const canonical = (value) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
const sha = (value) => createHash('sha256').update(canonical(value)).digest('hex');
// No recursive string normalization. Preserve all HF Person/community/queued state,
// reply.reason/says/chosen, said keys, activity labels and every unlisted field.
const proseFields = [
  'households[].looks',
  'notes[].text',
  'notes[].words',
  'knocks[].words',
  'flags.gathering.elders[].words',
  'flags.gathering.letter',
];
const mechanical = (valley) => {
  const state = stateJson(valley);
  for (const h of state.households) h.looks = '';
  for (const n of state.notes) {
    n.text = '';
    if ('words' in n) n.words = '';
  }
  for (const k of state.knocks) k.words = '';
  if (state.flags.gathering) {
    state.flags.gathering.letter = '';
    for (const e of state.flags.gathering.elders) e.words = '';
  }
  return state;
};
const daily = [];
const lines = new Set();
const observe = () => {
  for (const n of s.notes) {
    lines.add(n.text);
    if (n.words) lines.add(n.words);
  }
  for (const k of s.knocks) lines.add(k.words);
};
for (let d = 0; d < END_DAY + 1 && !s.flags.ended; d++) {
  observe();
  const doy = doyOf(d),
    season = seasonOf(doy);
  step(g, d * DAY + 7 * 60 + 30);
  if (policy !== 'idle') {
    if (
      season === 'harvest' &&
      s.agha.standing > 5 &&
      !s.asks.some((a) => a.job === 'reap-agha' && !a.closed && a.until > s.minute)
    )
      act(g, { verb: 'call', job: 'reap-agha', houses: houses(), wage: yearOf(d) > 1 });
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
    )
      act(g, { verb: 'call', job: 'bring-share', houses: houses() });
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
    )
      act(g, { verb: 'call', job: 'build-mill', houses: houses().slice(0, 6), wage: true });
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
    if (openHand && d % 2 === 0 && s.flags.verbs.includes('give') && s.agha.granary > 2) {
      const hungry = s.households
        .filter((h) => underSeal(s, h) && h.members.length)
        .sort((a, b) => daysOfBread(s, a) - daysOfBread(s, b))[0];
      if (hungry && daysOfBread(s, hungry) < 60) act(g, { verb: 'give', house: hungry.id, kile: 6 });
    }
    if (d % 9 === 3) {
      const hs = houses();
      act(g, { verb: 'visit', house: hs[d % hs.length] ?? 'ak' });
    }
  }
  step(g, (d + 1) * DAY);
  observe();
  daily.push({ day: d, minute: s.minute, hash: sha(mechanical(s)), inputsHash: sha(g.inputs) });
  if (d % 100 === 0) console.log(`${seed}/${policy}: day ${d}`);
}
const final = mechanical(s);
const rawFingerprint = fingerprint(s);
const compact = compactRun(g);
const saved = save(g);
if (fingerprint(load(saved).valley) !== rawFingerprint) throw Error('Full save restore mismatch');
const loaded = load(compact);
if (fingerprint(loaded.valley) !== rawFingerprint) throw Error('Compact export replay mismatch');
const report = {
  seed,
  policy,
  proseFields,
  daily,
  finalHash: sha(final),
  rawFingerprint,
  inputs: g.inputs,
  inputsHash: sha(g.inputs),
  evidence: {
    minute: s.minute,
    ended: s.flags.ended,
    agha: s.agha,
    stats: s.stats,
    departed: s.departed,
    people: s.people.length,
    distinctLines: lines.size,
  },
  replay: 'MATCH',
  fullSaveRestore: 'MATCH',
};
mkdirSync(output, { recursive: true });
const base = `${output}/${seed}-${policy}`;
writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
writeFileSync(`${base}.state.json`, JSON.stringify(final));
writeFileSync(`${base}.compact.json`, JSON.stringify(compact));
writeFileSync(`${base}.lines.json`, JSON.stringify([...lines].sort(), null, 2));
console.log(
  `DONE ${base}: ${daily.length} days, ${g.inputs.length} inputs, ${lines.size} distinct lines, replay MATCH`,
);

if (
  canonical(expected.daily) !== canonical(daily) ||
  expected.finalHash !== report.finalHash ||
  expected.inputsHash !== report.inputsHash
) {
  const first = expected.daily.findIndex((d, i) => canonical(d) !== canonical(daily[i]));
  throw Error(
    `Mechanical baseline differs for ${seed}/${policy}; first daily mismatch ${first}; reports saved at ${base}`,
  );
}
console.log(`BASELINE MATCH ${seed}/${policy}: every daily state and input hash`);
