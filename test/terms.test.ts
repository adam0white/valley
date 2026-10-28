import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { act, compactRun, load, newGame, restoreState, save, stateJson, step } from '../src/sim/game.ts';
import { copyReason, grainWords, helpOf, helpTargets } from '../src/sim/terms.ts';
import { makeWorld, personOf } from '../src/sim/valley.ts';
import { CastSession } from '../src/ui/cast-session.ts';
import { required } from './required.ts';

function opening(at = 450) {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  act(g, {
    verb: 'call',
    job: 'reap-agha',
    houses: ['tepe', 'coban', 'kavak', 'ak', 'dere', 'demirci', 'kuyucu', 'kara'],
  });
  act(g, { verb: 'visit', house: 'tepe' });
  step(g, at);
  return g;
}
const raw = (g: ReturnType<typeof newGame>) => stateJson(g.valley);
it('keeps actual words and conserves a voluntary partial-work, actual-carriage exchange through native continuation', async () => {
  const g = opening();
  const target = required(helpTargets(g.valley).find((t) => t.person === 'recep'));
  const before = raw(g);
  expect(act(g, { ...target, person: 'danyal' })).toBe(false);
  expect(raw(g)).toEqual(before);
  expect(act(g, target)).toBe(true);
  expect(g.valley.agha.granary).toBeCloseTo(before.agha.granary - 0.3);
  const pending = save(g);
  const pendingForks = [load(pending), load(compactRun(g))];
  step(g, 600);
  const h = required(helpOf(g.valley));
  expect(h.status).toBe('agreed');
  expect(h.speech?.activity.startedAt).toBe(454);
  expect(h.earned).toBe(0);
  expect(h.answer?.words).toContain('my own work only');
  for (const f of pendingForks) {
    step(f, 600);
    expect(raw(f)).toEqual(raw(g));
  }
  const assent = save(g);
  const stop = load(assent);
  expect(act(stop, { verb: 'help-end', contract: h.id })).toBe(true);
  step(stop, 2880);
  expect(helpOf(stop.valley)?.status).toBe('agreed');
  expect(helpOf(stop.valley)?.earned).toBe(0);
  expect(helpOf(stop.valley)?.returned).toBeCloseTo(0.3);
  step(g, 2880);
  expect(h.choices.some((c) => c.record.suggestion?.verdict === 'deferred')).toBe(true);
  expect(h.minutes).toBeCloseTo(90);
  expect(h.earned).toBeCloseTo(0.225);
  expect(h.returned).toBeCloseTo(0.075);
  const work = required(h.work[0]),
    actor = required(personOf(g.valley, h.person));
  const crop = g.valley.agha.reaped;
  required(makeWorld(g.valley).resolve)(actor, work.activity, work.reason);
  expect(g.valley.agha.reaped).toBe(crop);
  expect(h.earned).toBeCloseTo(0.225);
  expect(act(g, { verb: 'give', house: 'coban', kile: 6 })).toBe(true);
  step(g, 2940);
  const source = required(
    g.valley.notes.findLast((n) => n.kind === 'voice' && n.house === 'coban' && n.at <= g.valley.minute),
  );
  expect(source.words).toBeTruthy();
  const people = structuredClone(g.valley.people);
  expect(act(g, { verb: 'keep-words', note: source.id })).toBe(true);
  expect(g.valley.people).toEqual(people);
  expect(g.valley.receivedTerms?.keptWords[0]?.original).toEqual(source);
  expect(act(g, { verb: 'keep-words', note: source.id })).toBe(false);
  const kept = save(g);
  const forged = structuredClone(kept);
  required(forged.state.receivedTerms?.keptWords[0]).original.words = 'A fabricated promise';
  expect(() => load(forged)).toThrow(/replay/);
  const cap = load(kept);
  expect(act(cap, { verb: 'give', house: 'coban', kile: 6 })).toBe(true);
  step(cap, 3000);
  const nextSource = required(
    cap.valley.notes.findLast((n) => n.kind === 'voice' && n.house === 'coban' && n.at <= cap.valley.minute),
  );
  expect(nextSource.id).not.toBe(source.id);
  const book = required(cap.valley.receivedTerms).keptWords;
  // Structural negative only: synthetic full book, never a positive source/replay claim.
  while (book.length < 64) book.push({ ...structuredClone(required(book[0])), input: book.length });
  const unkept = nextSource;
  const capped = raw(cap);
  expect(copyReason(cap.valley, unkept.id)).toContain('full');
  expect(act(cap, { verb: 'keep-words', note: unkept.id })).toBe(false);
  expect(raw(cap)).toEqual(capped);
  step(g, 4320);
  expect(act(g, { verb: 'help-deliver', contract: h.id })).toBe(true);
  const dispatch = save(g);
  const beforeTrip = raw(g);
  const inputsBeforeTrip = structuredClone(g.inputs);
  expect(act(g, { verb: 'visit', house: 'kara' })).toBe(false);
  expect(act(g, { verb: 'pass', choice: 'depart' })).toBe(false);
  expect(raw(g)).toEqual(beforeTrip);
  expect(g.inputs).toEqual(inputsBeforeTrip);
  step(g, 4710);
  expect(h.cargo).toBeCloseTo(0.225);
  expect(h.delivered).toBe(0);
  const cargo = save(g);
  const returning = load(cargo);
  expect(act(returning, { verb: 'help-return', contract: h.id })).toBe(true);
  step(returning, 7200);
  expect(helpOf(returning.valley)?.delivered).toBe(0);
  expect(helpOf(returning.valley)?.held).toBeCloseTo(0.225);
  const returned = raw(returning);
  const returnedInputs = structuredClone(returning.inputs);
  expect(act(returning, { verb: 'help-deliver', contract: h.id })).toBe(false);
  expect(raw(returning)).toEqual(returned);
  expect(returning.inputs).toEqual(returnedInputs);
  step(g, 7200);
  expect(h.delivered).toBeCloseTo(0.225);
  expect(h.depositedAt).toBe(4770);
  expect(h.delivery?.phase).toBe('home');
  expect(h.held + h.cargo + h.returned + h.delivered).toBeCloseTo(0.3);
  for (const checkpoint of [dispatch, cargo, save(g)]) {
    const f = load(checkpoint);
    const compact = load(compactRun(f));
    step(f, 8640);
    step(compact, 8640);
    expect(raw(compact)).toEqual(raw(f));
  }
  step(g, 8640);
  expect(g.valley.receivedTerms?.keptWords[0]?.original).toEqual(source);
  if (process.env.VALLEY_TERMS_NATIVE_PROOF)
    writeFileSync(
      process.env.VALLEY_TERMS_NATIVE_PROOF,
      JSON.stringify({
        pending,
        assent,
        kept,
        dispatch,
        cargo,
        returned: save(returning),
        complete: save(g),
        source,
        notes:
          'Full/compact and later8640 continuation compared with every raw value. Cap-only synthetic negative is not a native positive.',
      }),
    );
  // The old finite passport is not an adapter for the new source. Refuse before
  // any shelf envelope/source journal/head write; full native exports still replay.
  const wordsOnly = opening();
  act(wordsOnly, { verb: 'give', house: 'coban', kile: 6 });
  step(wordsOnly, 510);
  const actualWords = required(wordsOnly.valley.notes.find((n) => !copyReason(wordsOnly.valley, n.id)));
  expect(act(wordsOnly, { verb: 'keep-words', note: actualWords.id })).toBe(true);
  for (const packet of [save(wordsOnly), pending, assent, kept, dispatch, cargo, save(returning), save(g)]) {
    let writes = 0;
    const session = new CastSession(
      {
        setPersonaRecording() {},
        allowPersonaRecording() {},
        personaRecordingAllowed: true,
        build: () => ({}),
      },
      {
        ready: Promise.resolve(true),
        enabled: true,
        setEnabled() {},
        async request<T>() {
          writes++;
          return undefined as T;
        },
      },
    );
    session.game = load(packet);
    const metadata = session.metadata();
    await session.checkpoint(true);
    expect(session.status).toContain('no reviewed continuing-person mapping');
    await session.alternative('hf.cast.yusuf.well');
    expect(session.status).toContain('no reviewed continuing-person mapping');
    expect(writes).toBe(0);
    expect(session.metadata()).toEqual(metadata);
    expect(raw(load(save(session.game)))).toEqual(raw(session.game));
  }
  const stripped = structuredClone(cargo);
  stripped.inputs = stripped.inputs.filter((i) => !i.verb.startsWith('help-') && i.verb !== 'keep-words');
  delete stripped.state.receivedTerms;
  // Complete current Persons (including the route goal) cannot be admitted by
  // removing both command/archive copies. The ordinary native loader regenerates.
  expect(() => load(stripped)).toThrow('replay state');
  let forgedWrites = 0;
  const forgedSession = new CastSession(
    {
      setPersonaRecording() {},
      allowPersonaRecording() {},
      personaRecordingAllowed: true,
      build: () => ({}),
    },
    {
      ready: Promise.resolve(true),
      enabled: true,
      setEnabled() {},
      async request<T>() {
        forgedWrites++;
        return undefined as T;
      },
    },
  );
  forgedSession.game = { valley: restoreState(stripped.state), inputs: stripped.inputs, plainEnglish: true };
  await forgedSession.checkpoint(true);
  expect(forgedSession.status).toContain('replay state');
  expect(forgedWrites).toBe(0);
  expect(grainWords(0.0000001)).toBe('less than 0.001');
  expect(grainWords(0.225)).toBe('0.225');
});
