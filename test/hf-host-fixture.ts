/** Authored host-boundary fixtures, not recorded public Valley playthroughs.
 * Actors start at the stated calendar frame and all behavior uses the public Run.
 */
import * as HF from '@adam0white/human-framework';
import { newGame } from '../src/sim/game.ts';
import {
  archiveCommunity,
  authoringOf,
  createCommunity,
  createPerson,
  type Person,
  stepCommunity,
  type World,
} from '../src/sim/hf.ts';
import { makeWorld } from '../src/sim/valley.ts';
import { exampleSpec, need } from './hf-fixture.ts';

export function hostFixture(
  at: number,
  id = 'osman',
  goal?: string,
  configure?: (person: Person, steward: Person) => void,
) {
  const game = newGame(7, undefined, false, true, 'valley-public-2026-10');
  const s = game.valley;
  const person = createPerson({
    id,
    name: id,
    sex: id === 'zehra' ? 'female' : 'male',
    now: at,
    bornAt: at - 40 * 525600,
    seed: 7,
  });
  const steward = createPerson({
    id: 'kahya',
    name: 'Steward',
    sex: 'male',
    now: at,
    bornAt: at - 35 * 525600,
    seed: 8,
  });
  if (goal)
    person.agenda.goals.push({
      id: 'fixture-task',
      label: 'the authored task',
      serves: ['meaning'],
      advancedBy: [{ action: goal, amount: 1 }],
      importance: 1,
      progress: 0,
      status: 'active',
      adoptedAt: at,
    });
  configure?.(person, steward);
  const spec = exampleSpec(7);
  const day = Math.floor(at / 1440);
  const actions = new Set([
    'cook',
    'store-check',
    'build',
    'flock-care',
    'gather-grain',
    'observe-route',
    'draw-water',
    'digging-advice',
    'household-work',
    'terms-help-assent',
    'terms-help-decline',
    'terms-carry-food',
    'terms-walk-home',
    'walk',
    'rest',
    'sleep',
    'eat',
    'drink',
    'relieve',
    'tend',
    'chat',
    'reap',
    'sow',
    'reap-agha',
    'build-mill',
    'bring-share',
    'glean-agha',
    'ask-kahya',
    'leave',
    'pray',
    'christian-prayer',
    'early-sack',
    'neighbour-loan',
    'repay-neighbour',
    'levy-service',
  ]);
  spec.start = at * 60000;
  spec.host = { ...spec.host, id: 'valley' };
  spec.definitions.actions = [...actions].map((id) => ({
    id,
    label: id,
    demands: { effort: 0, focus: 0, mode: 'awake', requires: {} },
    tags: [],
    norms: [],
  }));
  spec.definitions.skills = [{ id: 'farming', label: 'farming', domain: 'general' }];
  spec.definitions.sources = [
    { type: 'host', id: 'valley' },
    { type: 'voice', id: 'kahya' },
  ];
  spec.definitions.calendar.days = Array.from({ length: 12 }, (_, i) => ({
    dayIndex: day + i,
    start: (day + i) * 86400000,
    windows: [],
  }));
  const raw = need(HF.createRun(spec));
  need(HF.createPerson(raw, authoringOf(person)));
  need(HF.createPerson(raw, authoringOf(steward)));
  const c = createCommunity([person, steward], {
    archive: HF.exportRun(raw),
    fidelity: { mode: 'daily', dayMs: 86400000, anchor: 0 },
    ingress: at * 60000,
    next: 1,
    offers: {},
    revisions: {},
    active: {},
    interrupts: {},
  });
  s.minute = at;
  s.people = [person];
  s.kahya = steward;
  s.community = archiveCommunity(c);
  const physical = makeWorld(s);
  const world: World = {
    ...physical,
    affordancesFor: (p: Person) => (p.id === id ? physical.affordancesFor(p) : []),
  };
  function advance(to: number) {
    stepCommunity(c, world, to);
    s.minute = to;
  }
  function verify() {
    const archive = HF.exportRun(c.run as HF.Run);
    const replay = need(HF.replay(archive));
    if (replay.fullHash !== archive.hashes.full) throw Error('Native replay differs');
    return archive;
  }
  return { game, s, person, steward, c, world, advance, verify };
}
