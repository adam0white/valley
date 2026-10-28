import { expect, it } from 'vitest';
import { dialogueChoices, dialogueWords, resolveDialogue } from '../src/sim/dialogue.ts';
import { DIALOGUE_EDITION } from '../src/sim/edition.ts';
import { act, compactRun, load, newGame, save, step } from '../src/sim/game.ts';
import { CastSession } from '../src/ui/cast-session.ts';
import { validLocalLog } from '../src/ui/local-log.ts';
import { required } from './required.ts';

function scene() {
  const g = newGame(7, undefined, false, true, DIALOGUE_EDITION);
  expect(act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
  step(g, 1080);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, 1110);
  return g;
}
function native(g: ReturnType<typeof newGame>) {
  const { savedAt: _at, ...rest } = save(g);
  return rest;
}
function roundTrip(g: ReturnType<typeof newGame>) {
  const full = load(save(g)),
    compact = load(compactRun(g));
  expect(native(full)).toEqual(native(g));
  expect(native(compact)).toEqual(native(g));
  return [full, compact];
}
it('binds two authored lines to actual Zehra and retains an ordinary withheld answer without rerolling', () => {
  const g = scene();
  const choices = dialogueChoices(g.valley);
  expect(choices.map((c) => c.line)).toEqual(['follow-up', 'work-need']);
  const follow = required(choices[0]);
  expect(g.valley.households.find((h) => h.id === follow.house)?.members).toContain('zehra');
  expect(follow.person).toBe('zehra');
  const prior = required(g.valley.notes.find((n) => n.id === follow.prior));
  expect(prior.who).toBe('zehra');
  expect(prior.at).toBeLessThanOrEqual(g.valley.minute);
  expect(dialogueWords(g.valley, follow)).toContain(prior.words);
  expect(dialogueWords(g.valley, required(choices[1]))).toContain('20 July');
  const workFork = load(save(g));
  const workChoice = required(dialogueChoices(workFork.valley)[1]);
  const people = structuredClone(g.valley.people);
  expect(act(g, follow)).toBe(true);
  expect(g.valley.people).toEqual(people); // speech is not perception, a forced decision or work
  expect(act(g, follow)).toBe(false);
  expect(g.valley.dialogue?.exchanges[0]?.status).toBe('pending');
  const forks = roundTrip(g);
  step(g, 1140);
  for (const fork of forks) {
    step(fork, 1140);
    expect(native(fork)).toEqual(native(g));
  }
  const e = required(required(g.valley.dialogue).exchanges[0]);
  expect(e.hearing?.deliveredAt).toBe(1110);
  expect(e.hearing?.percept.at).toBe(e.hearing?.deliveredAt);
  expect(e.hearing?.attended).toHaveLength(1);
  expect(e.hearing?.memoryTimes).toEqual([1110]);
  expect(e.status).toBe('withheld');
  expect(e.decisions[0]?.at).toBe(1114);
  expect(e.decisions[0]?.offer.action).not.toBe('valley-hearth-talk');
  expect(e.answerNote).toBeUndefined();
  expect(e.activity).toBeUndefined();
  roundTrip(g);
  expect(dialogueChoices(g.valley)).toEqual([]); // her actual next activity is sleep
  expect(act(g, follow)).toBe(false);
  expect(act(workFork, workChoice)).toBe(true);
  const pending = roundTrip(workFork);
  const cancelled = load(save(workFork));
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: 0 })).toBe(true);
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: 0 })).toBe(false);
  step(cancelled, 1230);
  expect(cancelled.valley.minute).toBe(1230);
  expect(required(cancelled.valley.dialogue).exchanges[0]?.status).toBe('cancelled');
  expect(required(cancelled.valley.dialogue).exchanges[0]?.answerNote).toBeUndefined();
  expect(cancelled.inputs.filter((i) => i.verb === 'dialogue')).toHaveLength(1);
  roundTrip(cancelled);
  step(workFork, 1230);
  for (const fork of pending) {
    step(fork, 1230);
    expect(native(fork)).toEqual(native(workFork));
  }
  expect(required(workFork.valley.dialogue).exchanges[0]?.answerNote).toBeUndefined();
  expect(required(workFork.valley.dialogue).exchanges[0]?.existingWork?.says).toBeDefined();
  roundTrip(workFork);
});

it('rejects stale, extra, unknown and absent-scene commands without side effects', () => {
  const g = scene();
  const choice = required(dialogueChoices(g.valley)[0]);
  const before = native(g);
  for (const invalid of [
    { ...choice, turn: -1 },
    { ...choice, prior: choice.prior + 100 },
    { ...choice, person: 'yusuf' },
    { ...choice, house: 'ak' },
    { ...choice, visit: choice.visit - 1 },
    { ...choice, line: 'secret' },
    { ...choice, ask: 'missing' },
    { ...choice, extra: true },
  ])
    expect(act(g, invalid as typeof choice)).toBe(false);
  expect(native(g)).toEqual(before);
  step(g, 1200);
  expect(act(g, choice)).toBe(false);
  expect(dialogueChoices(g.valley)).toEqual([]);
});

function cutScene() {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  expect(
    act(g, {
      verb: 'call',
      job: 'reap-agha',
      houses: g.valley.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
    }),
  ).toBe(true);
  step(g, 6210);
  expect(g.valley.agha.standing).toBe(0);
  expect(g.valley.flags.beats).toContain('cut-1');
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, 6240);
  return g;
}

it('records a prospective completed-cut question and completes only its real HF talk', () => {
  const g = cutScene();
  const choice = required(dialogueChoices(g.valley).find((c) => String(c.line) === 'after-cut'));
  const prior = required(g.valley.notes.find((n) => n.id === choice.prior));
  expect(prior.words).toBe('Who will feed my family while I cut his barley?');
  const beforePeople = structuredClone(g.valley.people);
  expect(act(g, choice)).toBe(true);
  expect(g.valley.people).toEqual(beforePeople);
  const e = required(g.valley.dialogue?.exchanges.at(-1));
  expect(e).toHaveProperty('cut.input', 2);
  expect(e).toHaveProperty('cut.at', 6240);
  expect(e).toHaveProperty('cut.source', prior);
  expect(e).toHaveProperty('cut.standing', 0);
  expect(e).not.toHaveProperty('cut.completedAt');
  roundTrip(g);
  step(g, 6330);
  expect(e.status).toBe('completed');
  expect(e.activity?.action).toBe('valley-hearth-talk');
  expect(e.activity?.endsAt).toBeLessThanOrEqual(required(e.endedAt));
  expect(e.answer?.words).toContain('Finishing his field does not answer that question.');
  expect(e.hearing?.attended).toHaveLength(1);
  expect(e.decisions.some((d) => d.offer.id === e.activity?.affordanceId)).toBe(true);
  const forks = roundTrip(g);
  step(g, 7770);
  for (const fork of forks) {
    step(fork, 7770);
    expect(native(fork)).toEqual(native(g));
  }
  roundTrip(g);
});

it('keeps unavailable, withheld, withdrawn and premature resolution separate from completion', () => {
  const early = scene();
  expect(dialogueChoices(early.valley).some((c) => c.line === 'after-cut')).toBe(false);
  const make = (at: number) => {
    const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
    act(g, {
      verb: 'call',
      job: 'reap-agha',
      houses: g.valley.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
    });
    step(g, at - 30);
    act(g, { verb: 'visit', house: 'coban' });
    step(g, at);
    return g;
  };
  const withheld = make(6000);
  expect(act(withheld, required(dialogueChoices(withheld.valley).find((c) => c.line === 'after-cut')))).toBe(
    true,
  );
  step(withheld, 6030);
  const refusal = required(withheld.valley.dialogue?.exchanges[0]);
  expect(refusal.status).toBe('withheld');
  expect(refusal.answer).toBeUndefined();
  roundTrip(withheld);

  const cancelled = cutScene();
  const order = required(dialogueChoices(cancelled.valley).find((c) => c.line === 'after-cut'));
  act(cancelled, order);
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: 0 })).toBe(true);
  step(cancelled, 6330);
  expect(cancelled.valley.dialogue?.exchanges[0]?.status).toBe('cancelled');
  expect(cancelled.valley.dialogue?.exchanges[0]?.answer).toBeUndefined();
  expect(dialogueChoices(cancelled.valley).some((c) => c.line === 'after-cut')).toBe(false);
  roundTrip(cancelled);

  const completed = cutScene();
  act(completed, required(dialogueChoices(completed.valley).find((c) => c.line === 'after-cut')));
  step(completed, 6330);
  const activity = required(completed.valley.dialogue?.exchanges[0]?.activity);
  const pending = cutScene();
  act(pending, required(dialogueChoices(pending.valley).find((c) => c.line === 'after-cut')));
  step(pending, 6270);
  // Resolution guard only: use the real sibling's timed activity before its actual start.
  // This is not claimed as a public interrupted execution or a fabricated native history.
  const zehra = required(pending.valley.people.find((p) => p.id === 'zehra'));
  expect(resolveDialogue(pending.valley, zehra, activity, 'interrupted')?.status).toBe('interrupted');
  expect(pending.valley.dialogue?.exchanges[0]?.answer).toBeUndefined();
  expect(pending.valley.dialogue?.exchanges[0]?.status).toBe('interrupted');
});

it('regenerates the source anchor from actual inputs and refuses edited history without changing the held packet', () => {
  const g = cutScene();
  act(g, required(dialogueChoices(g.valley).find((c) => c.line === 'after-cut')));
  step(g, 6330);
  const held = save(g);
  const wire = JSON.stringify(held);
  const rejected = (change: (packet: typeof held) => void) => {
    const packet = structuredClone(held);
    change(packet);
    expect(() => load(packet)).toThrow(/dialogue/);
    expect(JSON.stringify(held)).toBe(wire);
  };
  rejected((p) => {
    p.inputs = p.inputs.filter((i) => i.verb !== 'dialogue');
  });
  rejected((p) => {
    delete required(p.state.dialogue?.exchanges[0]).cut;
  });
  rejected((p) => {
    required(required(p.state.dialogue?.exchanges[0]).cut).input--;
  });
  rejected((p) => {
    required(required(p.state.dialogue?.exchanges[0]).cut).reaped++;
  });
  rejected((p) => {
    const e = required(p.state.dialogue?.exchanges[0]);
    const c = required(e.cut);
    // Two edited copies and their matching source note still are not recorded execution.
    c.source.at += 30;
    e.prior.at += 30;
    required(p.state.notes.find((n) => n.id === e.prior.id)).at += 30;
  });
  rejected((p) => {
    const c = required(required(p.state.dialogue?.exchanges[0]).cut);
    Object.assign(c.source, { permission: 'unrecorded food or work permission' });
  });
  rejected((p) => {
    p.state.agha.reaped++;
  });
  rejected((p) => {
    required(p.state.dialogue?.exchanges[0]).saidAt += 30;
  });
  roundTrip(g); // A rejection never destroys the original.
  const log = {
    game: 'valley',
    version: '0.3.1',
    seed: 7,
    minute: 6330,
    volume: 0,
    plainEnglish: true,
    rules: held.rules,
    inputs: held.inputs,
  };
  expect(validLocalLog(log)).toBe(true);
  const extra = structuredClone(log);
  Object.assign(required(extra.inputs.at(-1)), { cut: { completedAt: 5760 } });
  expect(validLocalLog(extra)).toBe(false);
  expect(act(g, { verb: 'give', house: 'coban', kile: 1 })).toBe(true);
  step(g, 7770);
  expect(g.valley.agha.granary).not.toBe(held.state.agha.granary);
  const later = roundTrip(g);
  expect(later[0]?.valley.dialogue?.exchanges[0]?.cut).toEqual(held.state.dialogue?.exchanges[0]?.cut);
});

it('refuses a public after-cut world at the actual production checkpoint without borrowing a passport', async () => {
  const g = cutScene();
  act(g, required(dialogueChoices(g.valley).find((c) => c.line === 'after-cut')));
  step(g, 6330);
  const held = native(g);
  const requests: unknown[] = [];
  const session = new CastSession(
    {
      setPersonaRecording: () => {},
      allowPersonaRecording: () => {},
      personaRecordingAllowed: false,
      build: () => ({ c: 'synthetic-control' }),
    },
    {
      ready: Promise.resolve(true),
      enabled: true,
      setEnabled: () => {},
      request: async <T>(q: unknown): Promise<T> => {
        requests.push(q);
        throw new Error('Unexpected passport publication');
      },
    },
  );
  await session.loaded(g, undefined, true, save(g));
  await session.checkpoint(true);
  expect(session.status).toContain('no reviewed continuing-person mapping');
  await session.alternative('hf.cast.danyal.well');
  expect(requests).toEqual([]);
  expect(native(g)).toEqual(held);
});
