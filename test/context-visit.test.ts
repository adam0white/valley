import { expect, it } from 'vitest';
import { dialogueChoices, dialogueWords } from '../src/sim/dialogue.ts';
import { act, compactRun, load, newGame, save, step } from '../src/sim/game.ts';
import { exportRun, personRun } from '../src/sim/hf.ts';
import { required } from './required.ts';

function scene(house: string, at = 450) {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  step(g, at - 30);
  expect(act(g, { verb: 'visit', house })).toBe(true);
  step(g, at);
  return g;
}
const actors = (g: ReturnType<typeof newGame>) => exportRun(required(personRun(g.valley.kahya)));
function native(g: ReturnType<typeof newGame>) {
  const { savedAt: _at, ...rest } = save(g);
  return rest;
}
it('binds contextual questions to actual people and public sources during an attended visit', () => {
  for (const [house, at, line, person] of [
    ['water-guest', 450, 'friendship', 'danyal'],
    ['tepe', 450, 'son', 'serife'],
    ['coban', 6240, 'birth', 'yusuf'],
  ] as const) {
    const g = scene(house, at);
    const choice = required(dialogueChoices(g.valley).find((c) => String(c.line) === line));
    expect(choice.person).toBe(person);
    const before = actors(g);
    expect(act(g, choice)).toBe(true);
    expect(actors(g)).toEqual(before);
    const exchange = required(g.valley.dialogue?.exchanges.at(-1));
    expect(exchange).toHaveProperty('context.input', 1);
    expect(exchange).toHaveProperty('context.at', at);
    if (line === 'birth') {
      const birth = required(g.valley.notes.find((n) => n.kind === 'birth' && n.who === 'zehra'));
      expect(exchange).toHaveProperty('context.source.note', birth);
      expect(dialogueWords(g.valley, choice)).toContain(birth.text);
    } else {
      expect(exchange).toHaveProperty('context.source.kind', 'house-description');
      expect(exchange).not.toHaveProperty('context.source.at');
    }
    const forks = [load(save(g)), load(compactRun(g))];
    step(g, at + 90);
    expect(exchange.hearing?.percept.targetId).toBe(person);
    if (person === 'danyal') {
      expect(exchange.status).toBe('expired');
      expect(exchange.events.some((e) => e.kind === 'continue' && e.affordanceId === 'role:draw-water')).toBe(
        true,
      );
      expect(exchange.answer).toBeUndefined();
    } else {
      expect(exchange.decisions.length).toBeGreaterThan(0);
      expect(exchange.status).toBe('withheld');
      expect(exchange.decisions[0]?.offer.action).not.toBe('valley-hearth-talk');
      expect(exchange.answer).toBeUndefined();
    }
    for (const fork of forks) {
      step(fork, at + 90);
      expect(native(fork)).toEqual(native(g));
    }
    const full = save(g);
    const continued = [load(full), load(compactRun(g))];
    step(g, at + 1530);
    for (const fork of continued) {
      step(fork, at + 1530);
      expect(native(fork)).toEqual(native(g));
    }
    const forged = structuredClone(full);
    Object.assign(required(forged.state.dialogue?.exchanges[0]), { person: 'zehra' });
    expect(() => load(forged)).toThrow(/dialogue/);
    expect(save(g).inputs).toEqual(full.inputs);
  }
});

it('refuses unavailable or forged contextual inputs before mutation and preserves exact source authority', () => {
  const g = scene('coban', 6240);
  const choice = required(dialogueChoices(g.valley).find((c) => c.line === 'birth'));
  const before = native(g);
  for (const order of [
    { ...choice, person: 'danyal' },
    { ...choice, prior: choice.prior + 1 },
    { ...choice, visit: choice.visit - 30 },
    { ...choice, house: 'tepe' },
    { ...choice, source: { birth: true } },
  ])
    expect(act(g, order as typeof choice)).toBe(false);
  expect(native(g)).toEqual(before);
  expect(act(g, choice)).toBe(true);
  const held = save(g),
    wire = JSON.stringify(held);
  for (const forge of ['source', 'activation', 'extra', 'request'] as const) {
    const bad = structuredClone(held);
    const e = required(bad.state.dialogue?.exchanges[0]);
    const c = required(e.context);
    if (forge === 'activation') bad.inputs = bad.inputs.filter((i) => i.verb !== 'dialogue');
    if (forge === 'request') c.input--;
    if (forge === 'extra') Object.assign(c.source, { heardConversation: true });
    if (forge === 'source' && c.source.kind === 'note') {
      // Matching edited copies cannot supply an execution that never happened.
      c.source.note.at -= 30;
      e.prior.at -= 30;
      const sourceId = c.source.note.id;
      required(bad.state.notes.find((n) => n.id === sourceId)).at -= 30;
    }
    expect(() => load(bad)).toThrow(/dialogue/);
    expect(JSON.stringify(held)).toBe(wire);
  }
  expect(act(g, { verb: 'dialogue-cancel', turn: 0 })).toBe(true);
  step(g, 6330);
  expect(g.valley.dialogue?.exchanges[0]?.status).toBe('cancelled');
  expect(g.valley.dialogue?.exchanges[0]?.answer).toBeUndefined();
  expect(native(load(save(g)))).toEqual(native(g));
  const early = scene('coban');
  expect(dialogueChoices(early.valley).some((c) => c.line === 'birth')).toBe(false);
  const walking = newGame(7, undefined, false, true, 'valley-public-2026-10');
  act(walking, { verb: 'visit', house: 'water-guest' });
  expect(dialogueChoices(walking.valley)).toEqual([]);
  const sleeping = scene('water-guest', 1200);
  expect(sleeping.valley.people.find((p) => p.id === 'danyal')?.activity?.mode).toBe('sleep');
  expect(dialogueChoices(sleeping.valley).some((c) => c.line === 'friendship')).toBe(false);
});

it('asks about reciprocal help using the actual earlier food question without creating an agreement', () => {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] });
  step(g, 1080);
  act(g, { verb: 'visit', house: 'coban' });
  step(g, 1110);
  const choice = required(dialogueChoices(g.valley).find((c) => c.line === 'reciprocal-help'));
  const source = structuredClone(required(g.valley.notes.find((n) => n.id === choice.prior)));
  const people = actors(g),
    stores = structuredClone(g.valley.households);
  expect(act(g, choice)).toBe(true);
  expect(actors(g)).toEqual(people);
  expect(g.valley.households).toEqual(stores);
  const e = required(g.valley.dialogue?.exchanges[0]);
  expect(e).toHaveProperty('context.source.note', source);
  const full = load(save(g)),
    compact = load(compactRun(g));
  step(g, 1200);
  step(full, 1200);
  step(compact, 1200);
  expect(native(full)).toEqual(native(g));
  expect(native(compact)).toEqual(native(g));
  expect(e.status).toBe('withheld');
  expect(e.answer).toBeUndefined();
  expect(e.decisions[0]?.offer.action).not.toBe('valley-hearth-talk');
  const later = load(save(g));
  step(g, 2640);
  step(later, 2640);
  expect(native(later)).toEqual(native(g));
});

it('keeps the attended contextual talk offered when HF clears the preceding home activity', () => {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  act(g, {
    verb: 'call',
    job: 'reap-agha',
    houses: g.valley.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
  });
  step(g, 6210);
  act(g, { verb: 'visit', house: 'coban' });
  step(g, 6240);
  const choice = required(dialogueChoices(g.valley).find((c) => c.line === 'birth'));
  expect(act(g, choice)).toBe(true);
  step(g, 6330);
  const e = required(g.valley.dialogue?.exchanges[0]);
  expect(e.hearing?.attended).toHaveLength(1);
  const decision = required(e.decisions[0]);
  expect(decision.record.considered.map((c) => c.affordanceId)).toContain(`valley-dialogue:${e.turn}`);
});

it('completes the public Tepe contextual answer through ordinary HF choice and exact native continuation', () => {
  const g = newGame(7, undefined, false, true, 'valley-public-2026-10');
  expect(
    act(g, {
      verb: 'call',
      job: 'reap-agha',
      houses: g.valley.households.filter((h) => h.hamlet === 'lower').map((h) => h.id),
    }),
  ).toBe(true);
  step(g, 6300);
  expect(act(g, { verb: 'visit', house: 'tepe' })).toBe(true);
  step(g, 6330);
  const invitation = required(g.valley.knocks.find((k) => k.what === 'birth' && !k.answered));
  expect(act(g, { verb: 'turn-away', knock: invitation.id })).toBe(true);
  const source = required(g.valley.households.find((h) => h.id === 'tepe')).looks;
  const choice = required(dialogueChoices(g.valley).find((c) => c.line === 'son'));
  const beforePeople = actors(g),
    beforeHouses = structuredClone(g.valley.households);
  expect(act(g, choice)).toBe(true);
  expect(actors(g)).toEqual(beforePeople);
  expect(g.valley.households).toEqual(beforeHouses);
  const e = required(g.valley.dialogue?.exchanges[0]);
  expect(e).toHaveProperty('context.input', 3);
  expect(e).toHaveProperty('context.source', { kind: 'house-description', house: 'tepe', text: source });
  expect(e).not.toHaveProperty('context.source.at');
  const pending = [load(save(g)), load(compactRun(g))];
  step(g, 6360);
  expect(e.status).toBe('heard');
  expect(e.answer).toBeUndefined();
  step(g, 6390);
  expect(e.status).toBe('completed');
  expect(e.hearing?.deliveredAt).toBe(6330);
  expect(e.hearing?.attended).toHaveLength(1);
  expect(e.hearing?.memoryTimes).toEqual([6330]);
  expect(e.decisions[0]?.at).toBe(6364);
  expect(e.decisions[0]?.offer).toMatchObject({
    action: 'valley-hearth-talk',
    duration: 5,
    effort: 0.05,
    advertises: { belonging: 0.12, leisure: 0.06 },
  });
  expect(e.activity).toMatchObject({ startedAt: 6364, endsAt: 6369 });
  expect(e.answer).toEqual({
    at: 6369,
    words:
      'I have not told you why he is there. If you want field work, ask for it separately. This visit is not an agreement to send anyone.',
  });
  for (const fork of pending) {
    step(fork, 6390);
    expect(native(fork)).toEqual(native(g));
  }
  const held = save(g),
    wire = JSON.stringify(held);
  const forged = structuredClone(held);
  required(required(forged.state.dialogue?.exchanges[0]).answer).words = 'An invented promise to work';
  expect(() => load(forged)).toThrow(/dialogue/);
  expect(JSON.stringify(held)).toBe(wire);
  const continued = [load(held), load(compactRun(g))];
  step(g, 7830);
  for (const fork of continued) {
    step(fork, 7830);
    expect(native(fork)).toEqual(native(g));
  }
});
