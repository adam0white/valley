import { expect, it } from 'vitest';
import { dialogueChoices, dialogueWords, resolveDialogue } from '../src/sim/dialogue.ts';
import { act, compactRun, load, newGame, save, step } from '../src/sim/game.ts';
import { exportRun, personRun } from '../src/sim/hf.ts';
import { CastSession } from '../src/ui/cast-session.ts';
import { validLocalLog } from '../src/ui/local-log.ts';
import { required } from './required.ts';

function scene() {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  expect(act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] })).toBe(true);
  step(g, 570);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, 600);
  expect(dialogueChoices(g.valley)).toEqual([]);
  step(g, 840);
  expect(act(g, { verb: 'visit', house: 'coban' })).toBe(true);
  step(g, 870);
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
it('binds actual source words to a voluntary HF talk and replays pending and completed boundaries', () => {
  const g = scene();
  const choices = dialogueChoices(g.valley);
  expect(choices.map((c) => c.line)).toEqual(['follow-up', 'work-need']);
  const follow = required(choices[0]);
  const prior = required(g.valley.notes.find((n) => n.id === follow.prior));
  expect(follow.person).toBe('zehra');
  expect(prior.who).toBe('zehra');
  expect(dialogueWords(g.valley, follow)).toContain(required(prior.words));
  const before = exportRun(required(personRun(g.valley.kahya)));
  expect(act(g, follow)).toBe(true);
  // Host speech alone is not an actor mutation or a forced decision.
  expect(exportRun(required(personRun(g.valley.kahya)))).toEqual(before);
  expect(act(g, follow)).toBe(false);
  const forks = roundTrip(g);
  const cancelled = load(save(g));
  expect(act(cancelled, { verb: 'dialogue-cancel', turn: follow.turn })).toBe(true);
  step(cancelled, 990);
  expect(cancelled.valley.dialogue?.exchanges[0]?.status).toBe('cancelled');
  expect(cancelled.valley.dialogue?.exchanges[0]?.answer).toBeUndefined();
  step(g, 990);
  for (const fork of forks) {
    step(fork, 990);
    expect(native(fork)).toEqual(native(g));
  }
  const e = required(g.valley.dialogue?.exchanges[0]);
  expect(e.status).toBe('completed');
  expect(e.hearing?.attended).toHaveLength(1);
  expect(e.hearing?.deliveredAt).toBeGreaterThanOrEqual(e.saidAt);
  expect(e.activity?.action).toBe('valley-hearth-talk');
  expect(e.endedAt).toBe(e.activity?.endsAt);
  expect(e.decisions.some((d) => d.offer.id === e.activity?.affordanceId)).toBe(true);
  expect(e.answer?.words).toContain(required(prior.words));
  expect(e.answerNote).toBeDefined();
  roundTrip(g);
  expect(dialogueChoices(g.valley)).toEqual([]);
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
  const beforePeople = exportRun(required(personRun(g.valley.kahya)));
  expect(act(g, choice)).toBe(true);
  expect(exportRun(required(personRun(g.valley.kahya)))).toEqual(beforePeople);
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
    version: '0.4.0',
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
