/** Valley authoring drafts and detached HF4 public inspection views. No actor state lives here. */
import {
  type DeepReadonly,
  exportRun,
  type InspectQuery,
  inspect,
  type PersonAuthoring,
  type PortableCalendar,
  type PortablePerson,
  preview,
  type Run,
  restoreRun,
} from '@adam0white/human-framework';
import type {
  Activity,
  Affordance,
  Person as LegacyPerson,
  PersonSpec as LegacyPersonSpec,
  Suggestion,
} from './hf-legacy-types.d.ts';

export type * from './hf-legacy-types.d.ts';
export type Person = LegacyPerson;
export type PersonSpec = LegacyPersonSpec & {
  review?: { style: 'accounting' | 'ruminating' | 'none'; at: number };
  promptings?: { reading: 'none' | 'whisper' | 'inclination' | 'intrusion' | 'fault' };
};
export const MS_PER_MINUTE = 60_000;
const runs = new WeakMap<Person, Run>();
const readCaches = new WeakMap<Run, Map<string, unknown>>();
export function invalidatePersonReads(run: Run): void {
  readCaches.delete(run);
}
function cached<T>(run: Run, key: string, get: () => T): T {
  let cache = readCaches.get(run);
  if (!cache) {
    cache = new Map();
    readCaches.set(run, cache);
  }
  if (cache.has(key)) return cache.get(key) as T;
  const result = get();
  cache.set(key, result);
  return result;
}
const authored = new WeakMap<Person, PersonAuthoring>();
const specs = new WeakMap<Person, PersonSpec>();
const activityReaders = new WeakMap<Person, () => Activity | null>();
const minutes = (n: number) => n / MS_PER_MINUTE;
const ms = (n: number) => Math.round(n * MS_PER_MINUTE);
function unavailable(slice: string): never {
  throw new Error(`HF4 public inspection does not expose ${slice}; this Valley operation is unsupported.`);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const x of Object.values(value)) freeze(x);
    Object.freeze(value);
  }
  return value;
}
function read(p: Person, select: InspectQuery['select'][number]): unknown {
  const run = runs.get(p);
  if (!run) throw new Error('Person has not been admitted to a Run');
  return cached(run, `${p.id}:${select}`, () => {
    const result = inspect(run, { perspective: { kind: 'host' }, people: [p.id], select: [select] });
    if (!result.ok) throw new Error(result.error.message);
    const view = result.value.people[0];
    if (view?.kind !== 'host') return unavailable(select);
    const part = view.parts.find((x) => x.select === select);
    if (!part) return unavailable(select);
    return part.value;
  });
}
/** All initial values below are Valley authored premises, not framework defaults. */
export function createPerson(spec: PersonSpec): Person {
  const now = spec.now ?? 0;
  const traits = {
    honesty: 0.5,
    emotionality: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    conscientiousness: 0.5,
    openness: 0.5,
    ...spec.traits,
  };
  const values = {
    benevolence: 0.5,
    universalism: 0.5,
    tradition: 0.5,
    conformity: 0.5,
    security: 0.5,
    achievement: 0.5,
    power: 0.5,
    hedonism: 0.5,
    stimulation: 0.5,
    selfDirection: 0.5,
    ...spec.values,
  };
  const draft = {
    id: spec.id,
    name: spec.name,
    now,
    life: { bornAt: spec.bornAt, sex: spec.sex },
    traits,
    values,
    body: {
      satiety: 0.8,
      hydration: 0.8,
      sleepPressure: 0.1,
      exertion: 0,
      fitness: 0.5,
      health: 1,
      pain: 0,
      sleepDebt: 0,
      circadianPeak: 15 * 60,
      asleep: false,
      since: now,
      alive: true,
      injuries: [],
      illnesses: [],
      ...spec.body,
    },
    needs: {
      safety: 0.7,
      belonging: 0.7,
      esteem: 0.7,
      autonomy: 0.7,
      competence: 0.7,
      leisure: 0.7,
      meaning: 0.7,
      ...spec.needs,
    },
    skills: Object.fromEntries(
      Object.entries(spec.skills ?? {}).map(([id, level]) => [
        id,
        { level, practice: 0, lastPracticed: now },
      ]),
    ),
    conscience: { norms: structuredClone(spec.norms ?? []) },
    habits: [],
    social: { relationships: structuredClone(spec.relationships ?? []), groups: { memberOf: [] } },
    will: { voices: structuredClone(spec.voices ?? []).map((v) => ({ ...v, trust: v.trust ?? 0.5 })) },
    agenda: {
      commitments: structuredClone(spec.commitments ?? []),
      goals: structuredClone(spec.goals ?? []),
      precommitments: [],
      owed: [],
    },
    family: { aptitudes: {}, ...structuredClone(spec.family ?? {}) },
    bonds: { courtships: [], marriages: [] },
    memory: { episodes: [], beliefs: [], sourceTrust: {} },
    activity: null,
    retention: structuredClone(spec.retention ?? {}),
  } as unknown as Person;
  specs.set(draft, structuredClone(spec));
  return draft;
}
function translate(value: unknown, key = '', factor = MS_PER_MINUTE): unknown {
  if (Array.isArray(value)) return value.map((v) => translate(v, '', factor));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translate(v, k, factor)]));
  if (
    typeof value === 'number' &&
    /^(at|from|until|since|lastAt|lastInteraction|deceasedAt|endedAt|lastWithheldAt|lastAdvancedAt|engagedAt|lastPracticed|bornAt|dueAt|conceivedAt|startedAt|endsAt|recurEvery|adoptedAt)$/.test(
      key,
    )
  )
    return value * factor;
  return value;
}
export function authoringOf(p: Person): PersonAuthoring {
  if (runs.has(p)) throw new Error('Person authoring is closed after Run admission');
  const exact = authored.get(p);
  if (exact) return exact;
  const spec = specs.get(p);
  if (!spec) throw new Error('Unknown Person authoring draft');
  const basis = { kind: 'evidence' as const, id: `valley-opening:${p.id}` };
  const body = p.body;
  const state = {
    traits: p.traits,
    values: p.values,
    body: {
      satiety: body.satiety,
      hydration: body.hydration,
      sleepPressure: body.sleepPressure,
      exertion: body.exertion,
      fitness: body.fitness,
      health: body.health,
      pain: body.pain,
      sleepDebtHours: body.sleepDebt,
      depletion: body.depletion ?? 0,
      circadianPeakMs: ms(body.circadianPeak),
      asleep: body.asleep,
      since: ms(body.since),
      doze: {
        context: { posture: 'upright', stimulation: 0.5 },
        basis: { kind: 'authored', author: 'valley', at: ms(p.now) },
      },
      bladder: { fill: 0, pending: 0 },
      injuries: translate(body.injuries),
      illnesses: translate(body.illnesses),
      exposures: Object.entries(body.exposures ?? {}).map(([agent, e]) => ({
        agent,
        ...(translate(e) as object),
      })),
    },
    needs: p.needs,
    skills: Object.entries(p.skills).map(([id, s]) => ({
      id,
      level: s.level,
      practicedMs: 0,
      lastPracticed: ms(s.lastPracticed),
    })),
    heldNorms: p.conscience.norms.map((n) => ({
      ...n,
      provenance: {
        kind: 'authored-world',
        author: 'valley',
        ruleId: n.normId,
        edition: 'valley-public-2026-10',
      },
    })),
    beliefs: [],
    consequences: [],
    sourceTrust: [],
    context: { scarcity: { kind: 'unobserved' }, smoking: { kind: 'unobserved' } },
    relationships: p.social.relationships.map((t) => ({
      affection: 0,
      trust: 0.5,
      respect: 0,
      familiarity: 0,
      roles: [],
      ledger: 0,
      lastInteraction: ms(p.now),
      ...(translate(t) as object),
    })),
    voices: p.will.voices.map((v) => ({ voiceId: v.voiceId, trust: v.trust })),
    agenda: {
      exemptions: { traveling: { kind: 'unobserved' }, illnessSeverity: { kind: 'unobserved' } },
      commitments: p.agenda.commitments.map((c) => {
        const { status: _status, exempt: _exempt, ...rest } = c;
        const {
          createdAt: _createdAt,
          madeAt: _madeAt,
          recurEvery,
          ...data
        } = rest as typeof rest & { createdAt?: number; madeAt?: number };
        return {
          ...(translate(data) as object),
          ...(recurEvery === undefined ? {} : { recurEveryMs: ms(recurEvery) }),
        };
      }),
      goals: p.agenda.goals.map((g) => {
        const { status: _status, adoptedAt: _adoptedAt, ...rest } = g;
        return {
          ...(translate(rest) as object),
          completionHalfLifeMs: ms(1440 * 30),
          baseImportance: g.importance,
        };
      }),
      precommitments: [],
      owed: [],
    },
    family: {
      contactCovered: [],
      aptitudes: p.family?.aptitudes ?? {},
      ...(p.family?.attachment === undefined ? {} : { attachment: p.family.attachment }),
      ...(p.family?.pregnancy
        ? {
            pregnancy: {
              id: `opening-pregnancy:${p.id}`,
              mother: { kind: 'actor', id: p.id },
              father: { kind: 'identified', entity: { kind: 'entity', id: p.family.pregnancy.fatherId } },
              offspring: { kind: 'entity', id: `opening-unborn:${p.id}` },
              conceivedAt: ms(p.family.pregnancy.conceivedAt),
              dueAt: ms(p.family.pregnancy.dueAt),
              basis: { kind: 'authored', evidence: basis },
            },
          }
        : {}),
    },
    groups: p.social.groups?.memberOf ?? [],
    reserve: {},
    retention: { trace: 0, chronicleDays: 31, ...p.retention },
    habits: translate(p.habits),
    expectations: [],
    affect: { mood: { valence: 0, arousal: 0.3 }, regulation: 0.5, emotions: [] },
    promptings: { reading: spec.promptings?.reading ?? 'none', responses: [] },
    review: { style: spec.review?.style ?? 'none', atMsOfDay: ms(spec.review?.at ?? 1290) },
    bonds: translate(p.bonds ?? { courtships: [], marriages: [] }),
  };
  return structuredClone({
    id: p.id,
    identity: { name: p.name, birthAt: ms(p.life.bornAt), sex: p.life.sex },
    biography: [],
    origin: { kind: 'authored', basis, traits: { kind: 'explicit-authoring', evidence: basis } },
    state,
  }) as unknown as PersonAuthoring;
}
export function personFromAuthoring(a: DeepReadonly<PersonAuthoring>): Person {
  const p = createPerson({
    id: a.id,
    name: a.identity.name,
    seed: 0,
    now: minutes(a.state.body.since),
    bornAt: minutes(a.identity.birthAt),
    sex: a.identity.sex,
    traits: a.state.traits,
    values: a.state.values,
  });
  authored.set(p, structuredClone(a) as PersonAuthoring);
  return p;
}
export function personRun(p: Person): Run | undefined {
  return runs.get(p);
}
export function bindPersonActivityView(p: Person, reader: () => Activity | null): void {
  activityReaders.set(p, reader);
}
export function bindPerson(p: Person, run: Run): void {
  if (runs.has(p)) throw new Error('Person is already admitted');
  const identity = authoringOf(p).identity;
  const portable = authoringOf(p).portable;
  const bornAt =
    portable?.person.version === 2
      ? portable.person.retained.bornAt + portable.mapping.offsetMs
      : identity.birthAt;
  runs.set(p, run);
  authored.delete(p);
  specs.delete(p);
  const getters: Record<string, () => unknown> = {
    now: () =>
      cached(run, 'clock', () => {
        const r = inspect(run, { perspective: { kind: 'host' }, people: [p.id], select: [] });
        if (!r.ok) throw new Error(r.error.message);
        return minutes(r.value.at);
      }),
    name: () => (read(p, 'summary') as { name: string }).name,
    body: () => {
      const b = read(p, 'body') as { state: Record<string, unknown> };
      return freeze({
        ...b.state,
        alive: (read(p, 'summary') as { alive: boolean }).alive,
        sleepDebt: b.state.sleepDebtHours,
        circadianPeak: minutes(b.state.circadianPeakMs as number),
        since: minutes(b.state.since as number),
      });
    },
    traits: () => read(p, 'traits'),
    needs: () =>
      Object.fromEntries((read(p, 'needs') as { id: string; level: number }[]).map((n) => [n.id, n.level])),
    skills: () =>
      Object.fromEntries(
        (
          read(p, 'skills') as {
            id: string;
            competence: number;
            practicedMs: number;
            lastPracticed: number;
          }[]
        ).map((s) => [
          s.id,
          {
            level: s.competence,
            practice: s.practicedMs / MS_PER_MINUTE,
            lastPracticed: minutes(s.lastPracticed),
          },
        ]),
      ),
    conscience: () => ({ norms: read(p, 'heldNorms') }),
    social: () => ({
      relationships: translate((read(p, 'relationships') as { ties: unknown }).ties, '', 1 / MS_PER_MINUTE),
    }),
    will: () => ({ voices: (read(p, 'relationships') as { voices: unknown }).voices }),
    agenda: () => translate(read(p, 'agenda'), '', 1 / MS_PER_MINUTE),
    methods: () => read(p, 'methods'),
    review: () => read(p, 'review'),
    activity: () => {
      const reader = activityReaders.get(p);
      if (reader) return reader();
      const summary = read(p, 'summary') as { activity: unknown };
      return summary.activity === null ? null : unavailable('full activity');
    },
  };
  getters.life = () => ({ sex: identity.sex, bornAt: minutes(bornAt) });
  getters.memory = () => ({
    episodes: (read(p, 'events') as import('@adam0white/human-framework').VisibleEvent[]).flatMap((e) =>
      e.data.kind === 'observation-attended' &&
      e.data.episodeId &&
      e.data.attention > 0 &&
      e.data.summary !== undefined
        ? [{ id: e.data.episodeId, at: minutes(e.data.occurredAt), summary: e.data.summary }]
        : [],
    ),
  });
  getters.family = () => {
    const value = lifecycle(p, { kind: 'pregnancy', person: p.id, at: ms(p.now) }) as {
      pregnancy: { father: { kind: string; entity?: { id: string } } } | null;
    };
    if (!value || !('pregnancy' in value)) return unavailable('pregnancy');
    return value.pregnancy
      ? {
          pregnancy: {
            ...(translate(value.pregnancy, '', 1 / MS_PER_MINUTE) as object),
            fatherId:
              value.pregnancy.father.kind === 'identified' ? value.pregnancy.father.entity?.id : undefined,
          },
        }
      : {};
  };
  for (const key of [
    'values',
    'bonds',
    'habits',
    'affect',
    'rng',
    'trace',
    'character',
    'chronicle',
    'lexicon',
    'retention',
  ])
    getters[key] = () => unavailable(key);
  for (const [key, get] of Object.entries(getters))
    Object.defineProperty(p, key, {
      get: () => freeze(get()),
      set: () => {
        throw new Error(`Person.${key} is read-only after admission`);
      },
      enumerable: true,
      configurable: false,
    });
  Object.freeze(p);
}
export function refreshPerson(_p: Person): void {
  /* Each getter requests a fresh detached public inspection. */
}
function lifecycle(
  p: Person,
  query: Extract<NonNullable<InspectQuery['lifecycle']>, { kind: 'host' }>['query'],
): unknown {
  const run = runs.get(p);
  if (!run) throw new Error('Lifecycle inspection requires an admitted Person');
  return cached(run, `lifecycle:${JSON.stringify(query)}`, () => {
    const r = inspect(run, {
      perspective: { kind: 'host' },
      people: [p.id],
      select: [],
      lifecycle: { kind: 'host', query },
    });
    if (!r.ok) throw new Error(r.error.message);
    if (!r.value.lifecycle || !('value' in r.value.lifecycle)) return unavailable('lifecycle reading');
    return r.value.lifecycle.value;
  });
}
export function ageYears(p: Person): number {
  if (!runs.has(p)) return (p.now - p.life.bornAt) / 525600;
  const age = lifecycle(p, { kind: 'age', person: p.id, at: ms(p.now) });
  if (typeof age !== 'number') return unavailable('age');
  return age;
}
export function readBody(p: Person): import('./hf-legacy-types.d.ts').BodyReadout {
  return (read(p, 'body') as { readout: import('./hf-legacy-types.d.ts').BodyReadout }).readout;
}
export function spousesOf(p: Person): string[] {
  if (!runs.has(p))
    return p.social.relationships.filter((t) => t.roles?.includes('spouse')).map((t) => t.otherId);
  const spouses = lifecycle(p, { kind: 'spouses', person: p.id, at: ms(p.now) });
  if (!Array.isArray(spouses)) return unavailable('spouses');
  return spouses;
}
export function successChance(p: Person, skill: string, difficulty: number, support = 0): number {
  const run = runs.get(p);
  if (!run) throw new Error('Skill reading requires an admitted Person');
  const result = inspect(run, {
    perspective: { kind: 'host' },
    people: [p.id],
    select: [],
    skill: { person: p.id, skill, difficulty, support },
  });
  if (!result.ok) throw new Error(result.error.message);
  if (!result.value.skill) return unavailable('skill success');
  return result.value.skill.successChance;
}
export function predictAs(
  observer: Person,
  target: Person,
  _offers: readonly Affordance[],
  _suggestion?: Suggestion,
  _options?: unknown,
): { resolution: { verdict: string; reason: string }; confidence: number } {
  const run = runs.get(observer);
  if (!run || run !== runs.get(target)) throw new Error('Prediction requires people in one Run');
  const result = preview(run, {
    perspective: { kind: 'person', observer: observer.id },
    person: target.id,
    until: ms(observer.now),
    inputs: [],
  });
  if (!result.ok) throw new Error(result.error.message);
  return unavailable('legacy prediction verdict; preview supplies observer impressions only');
}
export function portableFromPerson(
  p: Person,
  castId: string,
  castRevision: string,
): { person: PortablePerson; calendar: PortableCalendar } {
  const run = runs.get(p);
  if (!run) throw new Error('Portable projection requires an admitted Person');
  const r = inspect(run, {
    perspective: { kind: 'host' },
    people: [p.id],
    select: ['persona', 'calendar'],
    portable: { person: p.id, castId, castRevision },
  });
  if (!r.ok) throw new Error(r.error.message);
  const parts = r.value.people[0]?.parts;
  const person = parts?.find((x) => x.select === 'persona')?.value;
  const calendar = parts?.find((x) => x.select === 'calendar')?.value;
  if (!person || !calendar || !('format' in person) || !('definition' in calendar))
    return unavailable('portable projection');
  return { person: person as PortablePerson, calendar: calendar as PortableCalendar };
}

function scalarLifecycle(p: Person, query: Parameters<typeof lifecycle>[1]): number {
  const value = lifecycle(p, query);
  if (typeof value !== 'number') return unavailable(query.kind);
  return value;
}
export function conceptionChance(mother: Person, father: Person, days: number): number {
  return scalarLifecycle(mother, {
    kind: 'conception-chance',
    mother: mother.id,
    father: father.id,
    durationMs: ms(days * 1440),
  });
}
export function pregnancyDue(p: Person, at = p.now): boolean {
  const value = lifecycle(p, { kind: 'pregnancy', person: p.id, at: ms(at) });
  if (!value || typeof value !== 'object' || !('due' in value) || typeof value.due !== 'boolean')
    return unavailable('pregnancy due');
  return value.due;
}
export function attraction(a: Person, b: Person): number {
  return scalarLifecycle(a, { kind: 'attraction', a: a.id, b: b.id });
}
export function compatibility(a: Person, b: Person): number {
  return scalarLifecycle(a, { kind: 'compatibility', a: a.id, b: b.id });
}
export function courtshipStage(p: Person, other: string, at = p.now): string {
  const value = lifecycle(p, { kind: 'courtship-stage', person: p.id, other, at: ms(at) });
  if (typeof value !== 'string') return unavailable('courtship stage');
  return value;
}

export interface FrozenPerson {
  format: 'valley-frozen-person-1';
  id: string;
  name: string;
  bornAt: number;
  sex: 'male' | 'female';
  archive: HFRunArchive;
  activity: Activity | null;
}
type HFRunArchive = ReturnType<typeof exportRun>;
export function serializeFrozenPerson(p: Person): FrozenPerson {
  const run = personRun(p);
  if (!run) throw new Error('Frozen person requires an admitted Run');
  return {
    format: 'valley-frozen-person-1',
    id: p.id,
    name: p.name,
    bornAt: p.life.bornAt,
    sex: p.life.sex,
    archive: exportRun(run),
    activity: structuredClone(p.activity),
  };
}
export function restoreFrozenPerson(source: FrozenPerson): Person {
  if (source.format !== 'valley-frozen-person-1') throw new Error('Unsupported frozen Person archive');
  const restored = restoreRun(source.archive);
  if (!restored.ok) throw new Error(restored.error.message);
  const p = createPerson({
    id: source.id,
    name: source.name,
    seed: 0,
    bornAt: source.bornAt,
    sex: source.sex,
  });
  bindPerson(p, restored.value);
  frozenArchives.set(p, exportRun(restored.value));
  const activity = freeze(structuredClone(source.activity));
  bindPersonActivityView(p, () => activity);
  return p;
}
export function frozenPerson(p: Person): Person {
  return restoreFrozenPerson(serializeFrozenPerson(p));
}
const frozenArchives = new WeakMap<Person, HFRunArchive>();
export function frozenArchiveOf(p: Person): HFRunArchive | undefined {
  return frozenArchives.get(p);
}
export function personFromFrozenRef(ref: {
  id: string;
  name: string;
  life: { bornAt: number; sex: 'male' | 'female' };
  sourceArchive: HFRunArchive;
}): Person {
  return restoreFrozenPerson({
    format: 'valley-frozen-person-1',
    id: ref.id,
    name: ref.name,
    bornAt: ref.life.bornAt,
    sex: ref.life.sex,
    archive: ref.sourceArchive,
    activity: null,
  });
}
