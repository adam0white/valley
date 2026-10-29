import { expect, it } from 'vitest';
import { newGame } from '../src/sim/game.ts';
import { createCommunity, createPerson, finish, stepCommunity, type World } from '../src/sim/hf.ts';
import { captureSteward, resolveSteward, stewardOffers } from '../src/sim/steward.ts';
import { required } from './required.ts';

it('finishes a late care activity before walking home and eating from the granary', () => {
  const s = newGame(7, undefined, false, true, 'valley-public-2026-10').valley;
  const p = createPerson({ id: 'kahya', name: 'Kahya', seed: 1, sex: 'male', bornAt: -10000000 });
  s.kahya = p;
  s.stewardCare = { grain: 0, eaten: 0 };
  s.kahyaState.place = 'house:coban';
  s.kahyaState.visit = { house: 'coban', arrive: 0, leave: 30, back: 50, walk: 60, outboundStarted: true };
  s.agha.granary = 1;
  const c = createCommunity([p]);
  let forceSleep = true;
  const world: World = {
    now: () => p.now,
    affordancesFor: () => {
      const offers = stewardOffers(s, p.now);
      return forceSleep ? offers.filter((o) => o.action === 'sleep') : offers;
    },
    perceptsFor: () => [],
    scarcityFor: () => 0,
    beginOptions: (_p, offer, record) => captureSteward(s, offer, record),
    resolve: (_p, activity, reason) => resolveSteward(s, activity, reason),
  };
  // Force an ordinary HF sleep offer whose completion exceeds the planned return.
  stepCommunity(c, world, 1);
  expect(p.activity?.action).toBe('sleep');
  forceSleep = false;
  stepCommunity(c, world, 480);
  expect(s.kahyaState.place).toBe('house:coban');
  expect(stewardOffers(s, p.now).map((o) => o.action)).toEqual(['walk']);
  expect(s.agha.granary).toBe(1);
  stepCommunity(c, world, 481);
  expect(p.activity?.action).toBe('walk');
  expect(s.kahyaState.place).toBe('house:coban');
  expect(s.agha.granary).toBe(1);
  stepCommunity(c, world, 541);
  expect(s.kahyaState.place).toBe('residence');
  expect(stewardOffers(s, p.now).some((o) => o.action === 'eat')).toBe(true);
});

it('requires accepted pass walks before quarry arrival and cargo settlement', async () => {
  const { passTick } = await import('../src/sim/pass.ts');
  const s = newGame(7, undefined, false, true, 'valley-public-2026-10').valley;
  const p = createPerson({ id: 'kahya', name: 'Kahya', seed: 1, sex: 'male', bornAt: -10000000 });
  s.kahya = p;
  s.stewardCare = { grain: 0, eaten: 0 };
  s.kahyaState.place = 'residence';
  s.kahyaState.visit = { house: 'cam', arrive: 10, leave: 30, back: 50 };
  s.pass = {
    stock: 1,
    grainReceived: 0,
    stone: 0,
    journey: { from: 0, arrive: 10, leave: 30, back: 50, cargo: 1, grain: 6 },
  };
  s.agha.granary = 1;
  s.minute = 60;
  passTick(s);
  expect(s.pass.journey?.seen).toBeFalsy();
  expect(s.pass.journey?.returned).toBeFalsy();
  expect(s.pass.stone).toBe(0);
  expect(s.agha.granary).toBe(1);
});

it('settles pass cargo only after actual accepted outward and late return walks', async () => {
  const { passTick } = await import('../src/sim/pass.ts');
  const s = newGame(7, undefined, false, true, 'valley-public-2026-10').valley;
  const p = createPerson({ id: 'kahya', name: 'Kahya', seed: 1, sex: 'male', bornAt: -10000000 });
  s.kahya = p;
  s.stewardCare = { grain: 0, eaten: 0 };
  s.kahyaState.place = 'residence';
  s.kahyaState.visit = { house: 'cam', arrive: 480, leave: 500, back: 520 };
  s.pass = {
    stock: 1,
    grainReceived: 0,
    stone: 0,
    journey: { from: 0, arrive: 480, leave: 500, back: 520, cargo: 1, grain: 6 },
  };
  s.agha.granary = 1;
  const c = createCommunity([p]);
  let phase: 'out' | 'sleep' | 'return' = 'out';
  const world: World = {
    now: () => p.now,
    affordancesFor: () =>
      phase === 'out' && !s.pass?.journey?.outwardArrived
        ? [
            {
              id: 'cam-journey',
              action: 'walk',
              label: 'walk over the pass',
              duration: 480,
              effort: 0.25,
              placeId: 'pass',
              advertises: {},
              tags: ['work'],
            },
          ]
        : phase !== 'return'
          ? stewardOffers(s, 0).filter((o) => o.action === 'sleep')
          : stewardOffers(s, p.now),
    perceptsFor: () => [],
    scarcityFor: () => 0,
    beginOptions: (_p, offer, record) => captureSteward(s, offer, record),
    resolve: (_p, activity, reason) => resolveSteward(s, activity, reason),
  };
  stepCommunity(c, world, 1);
  expect(p.activity?.affordanceId).toBe('cam-journey');
  stepCommunity(c, world, 481);
  phase = 'sleep';
  s.minute = 481;
  passTick(s);
  expect(s.pass.journey?.seen).toBe(true);
  expect(s.kahyaState.place).toBe('house:cam');
  stepCommunity(c, world, 482);
  expect(p.activity?.action).toBe('sleep');
  phase = 'return';
  stepCommunity(c, world, 961);
  s.minute = 961;
  passTick(s);
  expect(s.pass.journey?.returned).toBeFalsy();
  expect(s.agha.granary).toBe(1);
  expect(s.pass.stone).toBe(0);
  expect(stewardOffers(s, p.now).map((o) => o.action)).toEqual(['walk']);
  stepCommunity(c, world, 962);
  expect(p.activity?.action).toBe('walk');
  const firstReturn = required(p.activity);
  finish(p, {
    at: p.now,
    affordanceId: firstReturn.affordanceId,
    action: firstReturn.action,
    status: 'interrupted',
  });
  passTick(s);
  expect(s.pass.journey?.homeArrived).toBeFalsy();
  expect(s.pass.journey?.returned).toBeFalsy();
  expect(s.pass.stone).toBe(0);
  expect(s.agha.granary).toBe(1);
  stepCommunity(c, world, 963);
  expect(p.activity?.action).toBe('walk');
  const returnEnd = required(p.activity).endsAt;
  stepCommunity(c, world, returnEnd + 1);
  s.minute = returnEnd + 1;
  passTick(s);
  expect(s.kahyaState.place).toBe('residence');
  expect(s.pass.journey?.returned).toBe(true);
  expect(s.pass.stone).toBe(1);
  expect(s.agha.granary).toBe(7);
});
