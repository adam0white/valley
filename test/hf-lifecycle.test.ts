import * as HF from '@adam0white/human-framework';
import { describe, expect, it } from 'vitest';
import {
  bridgeAt,
  bridgeInput,
  bridgeKinEvidence,
  createCommunity,
  serve,
  stepCommunity,
  type World,
} from '../src/sim/hf.ts';
import {
  betroth,
  birth,
  canMarry,
  conceive,
  court,
  courtingOffer,
  deliver,
  familyVoices,
  marry,
  prepareKinScope,
  proposalOffers,
  proposeOffer,
  tellDeath,
} from '../src/sim/hf-lifecycle.ts';
import {
  type Affordance,
  courtshipStage,
  createPerson,
  invalidatePersonReads,
  type Suggestion,
  spousesOf,
} from '../src/sim/hf-person.ts';

function family() {
  const father = createPerson({
    id: 'father-test',
    name: 'Father',
    seed: 1,
    sex: 'male',
    bornAt: -30 * 525600,
  });
  const mother = createPerson({
    id: 'mother-test',
    name: 'Mother',
    seed: 2,
    sex: 'female',
    bornAt: -28 * 525600,
  });
  return { father, mother, c: createCommunity([father, mother]) };
}
describe('HF4 lifecycle receipts', () => {
  it('keeps real alternatives through completed meetings, proposal, engagement and both confirmations', () => {
    const person = (id: string, sex: 'male' | 'female') =>
      createPerson({
        id,
        name: id,
        seed: 7,
        sex,
        bornAt: -25 * 525600,
        needs: { belonging: 0.1, meaning: 0.1 },
        traits: { extraversion: 0.9, agreeableness: 0.9 },
        voices: [{ voiceId: 'omer', trust: 0.9 }],
      });
    const man = person('ali', 'male'),
      woman = person('esma', 'female'),
      guardian = person('omer', 'male'),
      c = createCommunity([man, woman, guardian]);
    let now = 0,
      choices: Record<string, Affordance[]> = {};
    const rest: Affordance = {
      id: 'rest',
      action: 'rest',
      label: 'Rest instead',
      duration: 10,
      effort: 0,
      advertises: { leisure: 0.05 },
    };
    const world: World = {
      now: () => now,
      affordancesFor: (p) => [...(choices[p.id] ?? []), rest],
      perceptsFor: () => [],
      scarcityFor: () => 0,
      beginOptions: () => undefined,
      resolve: (p, a, reason) => {
        if (reason === 'ended' && a.action !== 'rest') delete choices[p.id];
        return {
          at: a.endsAt,
          action: a.action,
          affordanceId: a.affordanceId,
          status: reason === 'ended' ? 'completed' : 'interrupted',
        };
      },
      colocated: () => true,
    };
    function phase(
      offers: Record<string, Affordance[]>,
      suggestions: Record<string, Suggestion[]> = {},
      target = c,
    ) {
      choices = offers;
      for (let i = 0; i < 500 && Object.keys(choices).length; i++) {
        stepCommunity(target, world, now + 1, { suggestions });
        now += 1;
      }
      expect(Object.keys(choices)).toEqual([]);
    }
    expect(marry(man, woman, 0).ok).toBe(false);
    expect(() => betroth(man, woman, 0)).toThrow('acceptance');
    for (let meeting = 0; meeting < 6; meeting++) {
      phase({
        ali: [{ ...courtingOffer(woman, { id: `meeting:${meeting}:ali` }), with: [], duration: 20 }],
        esma: [{ ...courtingOffer(man, { id: `meeting:${meeting}:esma` }), with: [], duration: 20 }],
      });
      court(man, woman, now);
    }
    expect(courtshipStage(man, woman.id)).toBe('courting');
    phase({
      omer: [
        {
          id: 'broker:1:guardian:approve',
          action: 'approve-match',
          label: 'Approve this match',
          duration: 10,
          effort: 0,
          advertises: { belonging: 0.2, meaning: 0.2 },
        },
      ],
    });
    phase({
      ali: [{ ...proposeOffer(man, woman, { id: 'broker:1:proposal:propose' }), with: [], duration: 10 }],
    });
    const answer = proposalOffers(woman, man).map((a, i) => ({
      ...a,
      id: `broker:1:answer:${i ? 'decline' : 'accept'}`,
    })) as [Affordance, Affordance];
    phase({ esma: answer }, { esma: familyVoices(answer, [{ voiceId: 'omer', approval: 1 }]) });
    betroth(man, woman, now);
    expect(courtshipStage(man, woman.id)).toBe('engaged');

    expect(marry(man, woman, now, undefined, { guardian: 'consented' }).ok).toBe(false);
    const ceremony = (p: typeof man, q: typeof woman) =>
      proposalOffers(p, q).map((a, i) => ({
        ...a,
        id: `broker:1:ceremony:${i ? 'decline' : 'accept'}`,
        duration: 240,
      })) as [Affordance, Affordance];
    const his = ceremony(man, woman),
      hers = ceremony(woman, man);
    phase(
      { ali: his, esma: hers },
      {
        ali: familyVoices(his, [{ voiceId: 'omer', approval: 1 }]),
        esma: familyVoices(hers, [{ voiceId: 'omer', approval: 1 }]),
      },
    );
    prepareKinScope(man, woman, now);
    const before = HF.exportRun(c.run as HF.Run);
    const evidence = bridgeKinEvidence(c);
    prepareKinScope(man, woman);
    expect(bridgeKinEvidence(c)).toBe(evidence);
    expect(HF.exportRun(c.run as HF.Run)).toEqual(before);
    expect(canMarry(man, woman, undefined, { guardian: 'consented' }).ok).toBe(true);
    expect(HF.exportRun(c.run as HF.Run)).toEqual(before);
    expect(marry(man, woman, now, undefined, { guardian: 'consented' }).ok).toBe(true);
    expect(spousesOf(man)).toEqual([woman.id]);
    expect(spousesOf(woman)).toEqual([man.id]);
  });
  it('keeps an actual declined answer separate from engagement and marriage', () => {
    const man = createPerson({ id: 'ali', name: 'Ali', sex: 'male', seed: 7, bornAt: -25 * 525600 }),
      woman = createPerson({ id: 'esma', name: 'Esma', sex: 'female', seed: 7, bornAt: -25 * 525600 }),
      c = createCommunity([man, woman]);
    let now = 0,
      asked = true,
      answer: string | undefined;
    const world: World = {
      now: () => now,
      affordancesFor: (p) => [
        ...(p === woman && asked ? proposalOffers(woman, man) : []),
        {
          id: 'rest',
          action: 'rest',
          label: 'Rest instead',
          duration: 10,
          effort: 0,
          advertises: { leisure: 0.05 },
        },
      ],
      perceptsFor: () => [],
      scarcityFor: () => 0,
      beginOptions: () => undefined,
      resolve: (p, a, reason) => {
        if (p === woman && a.action !== 'rest' && reason === 'ended') {
          answer = a.action;
          asked = false;
        }
        return {
          at: a.endsAt,
          action: a.action,
          affordanceId: a.affordanceId,
          status: reason === 'ended' ? 'completed' : 'interrupted',
        };
      },
    };
    for (let attempts = 0; attempts < 200 && asked; attempts++) {
      stepCommunity(c, world, now + 1);
      now++;
    }
    expect(answer).toBe('decline-proposal');
    expect(() => betroth(man, woman, now)).toThrow();
    expect(marry(man, woman, now).ok).toBe(false);
    expect(courtshipStage(man, woman.id)).toBe('none');
    expect(spousesOf(woman)).toEqual([]);
  });
  it('creates an inherited child and closes the actual open pregnancy', () => {
    const father = createPerson({
      id: 'birth-father',
      name: 'Father',
      seed: 1,
      sex: 'male',
      bornAt: -30 * 525600,
    });
    const mother = createPerson({
      id: 'birth-mother',
      name: 'Mother',
      seed: 2,
      sex: 'female',
      bornAt: -28 * 525600,
    });
    mother.family = { pregnancy: { fatherId: father.id, conceivedAt: -268 * 1440, dueAt: 1, seed: 7 } };
    const c = createCommunity([father, mother]);
    const priorKin = bridgeKinEvidence(c);
    const ready = deliver(mother, { id: 'birth-child', name: 'Child' }, 1);
    expect(ready).not.toBeNull();
    const child = birth(c, mother, father, {
      id: 'birth-child',
      name: 'Child',
      seed: 0,
      now: 1,
      bornAt: 1,
      sex: 'female',
    });
    if (c.run) invalidatePersonReads(c.run);
    expect(child.body.alive).toBe(true);
    expect(child.life.sex).toBe('female');
    expect(mother.family?.pregnancy).toBeUndefined();
    if (!c.run) throw new Error('Expected admitted birth Run');
    const currentKin = bridgeKinEvidence(c),
      nativeKin = HF.exportRun(c.run).current.lifecycle;
    expect(currentKin).not.toBe(priorKin);
    expect(currentKin).toEqual({
      kinRevision: nativeKin.kinRevision,
      premiseIds: nativeKin.kinPremises.map((p) => p.id),
    });
    const kin = HF.inspect(c.run, {
      perspective: { kind: 'host' },
      people: [child.id, mother.id],
      select: [],
      lifecycle: {
        kind: 'host',
        query: {
          kind: 'kinship',
          a: child.id,
          b: mother.id,
          kinScopeId: `kin:${[child.id, mother.id].sort().join(':')}`,
        },
      },
    });
    if (!kin.ok) throw new Error(kin.error.message);
    expect(
      kin.value.lifecycle && 'value' in kin.value.lifecycle ? kin.value.lifecycle.value : undefined,
    ).toEqual({ kind: 'known', value: 'parent' });
  });
  it('records a real conception through HF and refuses delivery before due', () => {
    const { father, mother, c } = family();
    conceive(mother, father, 7, 0);
    if (c.run) invalidatePersonReads(c.run);
    expect(mother.family?.pregnancy?.fatherId).toBe(father.id);
    expect(deliver(mother, { id: 'child-test', name: 'Child' }, mother.now)).toBeNull();
  });
  it('records actual death before delivering death news', () => {
    const { father, mother, c } = family();
    expect(() => tellDeath({ people: [mother] }, father, 0)).toThrow('actual dead');
    const stamp = bridgeAt(c, 0);
    serve(c, stamp, [
      bridgeInput(
        c,
        'lifecycle.received',
        {
          type: 'death',
          person: { kind: 'actor', id: father.id },
          basis: { evidence: { kind: 'evidence', id: 'death-test' }, worldRevision: c.revision ?? 0 },
        },
        stamp,
      ),
    ]);
    if (c.run) invalidatePersonReads(c.run);
    expect(father.body.alive).toBe(false);
    tellDeath({ people: [mother] }, father, mother.now);
  });
});
