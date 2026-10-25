/** Explicit Valley receiver for published site-cast/1 (Well/Watch) and this host's own
 * valley-cast/1. Zero-duration clock translation preserves age/calendar; no lived travel,
 * healing, family consent, skill qualification or source private memories are inferred.
 */
import {
  admitCalendarPersona,
  ENGINE_VERSION,
  isContinuingCommitment,
  MINUTES_PER_YEAR,
  type NormDefinition,
  type Person,
  projectCalendarPersona,
  restore,
  snapshot,
  validateCalendarPersona,
} from '@adam0white/human-framework';
import {
  canonicalCast,
  canonicalPersona,
  type LifePreparation,
  lifeAdmission,
  type PersonaEnvelope,
  preparePersonaLife,
} from '@adam0white/lab-client';
import { ALLOCATION, CAST_IDS, localRole } from './cast.ts';
import { SITE_CAST_NORMS } from './transport-norms.ts';
export const HOST_RULES = 'valley-cast-3';
export const VALLEY_DUES: NormDefinition = {
  id: 'dues',
  label: 'The valley household’s agreed share',
  standing: 'obligatory',
  sources: [
    { kind: 'assumption', ref: 'Valley household share; each person understands the agreement locally' },
  ],
};
export const TRUSTED_NORMS = [...SITE_CAST_NORMS, VALLEY_DUES];
const identity = (xs: string[]) => Object.fromEntries(xs.map((id) => [id, id]));
export function calendarPassport(p: Person, version = 'valley-calendar/1') {
  const retained = p.agenda.commitments.filter((c) => isContinuingCommitment(p.agenda, c));
  const owed = p.agenda.owed ?? [];
  return projectCalendarPersona(p, {
    version,
    skills: identity(Object.keys(p.skills)),
    calendar: {
      version: 'hf-persona-calendar-map/1',
      offset: 0,
      references: {
        commitments: identity([
          ...retained.flatMap((c) => [c.id, ...(c.makeUpOf ? [c.makeUpOf] : [])]),
          ...owed.flatMap((d) => [d.ofId, ...(d.scheduledAs ? [d.scheduledAs] : [])]),
        ]),
        chains: identity(retained.flatMap((c) => (c.chain ? [c.chain] : []))),
        actions: identity([
          ...retained.flatMap((c) => [...c.actions, ...(c.violatedBy ?? [])]),
          ...owed.flatMap((d) => [...d.actions, ...(d.violatedBy ?? [])]),
        ]),
        entities: identity(
          retained.flatMap((c) => [c.toId, c.targetId].filter((x): x is string => x !== undefined)),
        ),
        norms: identity(TRUSTED_NORMS.map((n) => n.id)),
      },
      sourceNorms: TRUSTED_NORMS,
    },
  });
}
export async function checkpointReceipt(raw: Person) {
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPersona(raw)))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  return { schema: raw.schema, sourceMinute: raw.now, rng: structuredClone(raw.rng), sha256 };
}
const SITE_ROLES: Record<string, Record<string, string>> = {
  well: {
    maryam: 'hf.cast.maryam.well',
    yusuf: 'hf.cast.yusuf.well',
    samira: 'hf.cast.samira.well',
    danyal: 'hf.cast.danyal.well',
  },
  watch: { samira: 'hf.cast.samira.well', danyal: 'hf.cast.danyal.well', meryem: 'hf.cast.meryem.warren' },
};
const ACTIONS = new Set([
  'sleep',
  'rest',
  'eat',
  'drink',
  'pray',
  'christian-prayer',
  'reap',
  'sow',
  'reap-agha',
  'build-mill',
  'bring-share',
  'cook',
  'store-check',
  'build',
  'flock-care',
  'gather-grain',
  'observe-route',
  'draw-water',
  'survey',
  'household-work',
  'digging-advice',
]);
export function admitCast(
  opening: Person,
  input: LifePreparation,
): { person: Person; limitations: string[] } {
  const parent = input.parent;
  if (!['2.17.0', '2.21.0', ENGINE_VERSION].includes(parent.source.engine))
    throw new Error('Unsupported source engine dialect.');
  const role = localRole(parent.castId);
  const publicPerson = canonicalCast(parent.castId);
  if (opening.id !== role || parent.castRevision !== publicPerson.revision || parent.terminal)
    throw new Error('Unsupported cast identity/revision or closed branch.');
  if (canonicalPersona(preparePersonaLife(parent, input.clockMs).life) !== canonicalPersona(input.life))
    throw new Error('Pinned life differs from its source/clock.');
  const dialect = parent.transfer.castPassport;
  if (dialect === 'site-cast/1') {
    if (SITE_ROLES[parent.source.game]?.[String(parent.transfer.sourceRole)] !== parent.castId)
      throw new Error('Unsupported site source role.');
  } else if (dialect === 'valley-cast/1') {
    if (parent.source.game !== 'valley' || CAST_IDS[String(parent.transfer.sourceRole)] !== parent.castId)
      throw new Error('Unsupported Valley source role.');
  } else throw new Error('Unsupported passport dialect; public profiles are not portable history.');
  const portable = validateCalendarPersona(parent.transfer.person);
  const mapping = dialect === 'site-cast/1' ? 'site-cast-calendar/1' : 'valley-calendar/1';
  if (portable.person.mappingVersion !== mapping || portable.person.source.id !== parent.transfer.sourceRole)
    throw new Error('Passport mapping/role conflict.');
  const receipt = parent.transfer.checkpoint as
    | { schema?: unknown; sourceMinute?: unknown; rng?: unknown; sha256?: unknown }
    | undefined;
  if (
    !receipt ||
    Object.keys(receipt).sort().join(',') !== 'rng,schema,sha256,sourceMinute' ||
    receipt.schema !== portable.person.source.schema ||
    receipt.sourceMinute !== portable.person.source.now ||
    canonicalPersona(receipt.rng) !== canonicalPersona(portable.person.rng) ||
    typeof receipt.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256)
  )
    throw new Error('Missing full source checkpoint receipt.');
  const norms = portable.calendar.norms.map((n) => {
    const known = TRUSTED_NORMS.find((x) => x.id === n.id);
    if (!known || canonicalPersona(known) !== canonicalPersona(n))
      throw new Error('Unsupported source norm meaning.');
    return known;
  });
  if (
    portable.calendar.owed.length ||
    portable.calendar.lapse ||
    portable.calendar.commitments.some(
      (c) =>
        c.kind !== 'worship' ||
        !['salah', 'daily-prayer'].includes(c.normId ?? '') ||
        c.actions.some((a) => !['pray', 'christian-prayer'].includes(a)),
    )
  )
    throw new Error(
      'A source care, work or owed duty has no equivalent handover here. Keep the source chapter; no obligation is waived.',
    );
  const actions = [
    ...portable.calendar.commitments.flatMap((c) => [...c.actions, ...(c.violatedBy ?? [])]),
    ...portable.calendar.owed.flatMap((d) => [...d.actions, ...(d.violatedBy ?? [])]),
  ];
  if (actions.some((a) => !ACTIONS.has(a)))
    throw new Error('A source duty has no implemented Valley action. Keep that chapter or export it.');
  const shifted = structuredClone(portable);
  const offset = opening.now - portable.person.source.now;
  shifted.calendar.offset = offset;
  for (const c of shifted.calendar.commitments) {
    c.from += offset;
    c.until += offset;
    if (c.recurUntil !== undefined) c.recurUntil += offset;
    if (c.exempt) c.exempt.at += offset;
  }
  for (const d of shifted.calendar.owed) {
    d.at += offset;
    if (d.lapseSince !== undefined) d.lapseSince += offset;
  }
  if (shifted.calendar.lapse) shifted.calendar.lapse.since += offset;
  const target = restore(snapshot(opening));
  target.body.fitness = portable.person.health.fitness;
  const age = portable.person.source.now - portable.person.life.bornAt;
  if (age < publicPerson.age * MINUTES_PER_YEAR || age > (publicPerson.age + 200) * MINUTES_PER_YEAR)
    throw new Error('Unsupported age provenance.');
  target.life.bornAt = portable.person.life.bornAt + offset;
  const omitted = Object.keys(shifted.person.skills).filter((id) => !Object.hasOwn(target.skills, id));
  for (const id of omitted) delete shifted.person.skills[id];
  if (omitted.length)
    shifted.person.limitations.push(`Source archive retains unmapped skills: ${omitted.join(', ')}`);
  // Only the unplayed authored calendar is replaced. HF still verifies family/bonds and clinical body.
  target.agenda.commitments = [];
  delete target.agenda.owed;
  delete target.agenda.lapse;
  const result = admitCalendarPersona(shifted, target, {
    mappingVersion: mapping,
    sourceId: portable.person.source.id,
    targetId: role,
    targetNorms: norms,
  });
  return { person: result.person, limitations: result.report.limitations };
}
export interface CastStart {
  version: typeof HOST_RULES;
  people: Record<string, Person>;
  inputs: LifePreparation[];
  claims: PersonaEnvelope[];
  limitations: Record<string, string[]>;
}
export function prepareCastStart(
  openings: Person[],
  inputs: LifePreparation[],
  claims: PersonaEnvelope[] = [],
): CastStart {
  if (inputs.length > 6 || new Set(inputs.map((i) => i.parent.castId)).size !== inputs.length)
    throw new Error('Invalid cast batch.');
  const people: Record<string, Person> = {};
  const limitations: Record<string, string[]> = {};
  for (const c of ALLOCATION) {
    const role = localRole(c.castId);
    const opening = openings.find((p) => p.id === role);
    if (!opening) throw new Error('Missing opening actor.');
    const input = inputs.find((i) => i.parent.castId === c.castId);
    const result = input
      ? admitCast(opening, input)
      : { person: restore(snapshot(opening)), limitations: [] };
    people[c.castId] = snapshot(result.person);
    limitations[c.castId] = result.limitations;
  }
  for (const input of inputs)
    if (!ALLOCATION.some((c) => c.castId === input.parent.castId)) throw new Error('Outside cast batch.');
  return {
    version: HOST_RULES,
    people,
    inputs: structuredClone(inputs),
    claims: structuredClone(claims),
    limitations,
  };
}
export function validateCastStart(openings: Person[], header: CastStart, preflight = false) {
  if (header.version !== HOST_RULES) throw new Error('Older cast chapter; start fresh.');
  if (!preflight && header.claims.length !== header.inputs.length)
    throw new Error('Missing complete cast claims.');
  for (const input of preflight ? [] : header.inputs) {
    const claim = header.claims.find((p) => p.castId === input.parent.castId);
    if (
      !claim ||
      claim.parentRevision !== input.parent.revision ||
      claim.branchId !== input.parent.branchId ||
      claim.source.game !== 'valley' ||
      claim.source.rules !== HOST_RULES ||
      canonicalPersona(claim.transfer) !== canonicalPersona({ ...input.parent.transfer, life: input.life })
    )
      throw new Error('Claim differs from its pinned parent and life.');
  }
  const expected = prepareCastStart(openings, header.inputs, header.claims);
  if (canonicalPersona(expected) !== canonicalPersona(header))
    throw new Error('Pinned cast admission differs from semantic preflight.');
  return expected;
}
export function lifeFacts(input: LifePreparation) {
  return lifeAdmission(input, 'valley');
}
