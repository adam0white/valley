/** Optional Valley host rules. HF owns every resident's choice; this module owns sacks,
 * completed work, local debts and authored requests. Unmarked runs keep the old term.
 * Costs are engineering assumptions: mill 0.15 grain/hour, sacks six, levy buyout twelve.
 * No private biography, inferred confession or new framework faculty is used here.
 */
import {
  type Activity,
  type Affordance,
  ageYears,
  type DecisionRecord,
  type Outcome,
  type Person,
  recall,
  type Suggestion,
} from '@adam0white/human-framework';
import { DAY, daylight, dayOfMinute, doyOf, HOUR, minuteOfDay, seasonOf, yearOf } from './calendar.ts';
import { householdLabel, KAHYA, personLabel } from './people.ts';
import {
  give,
  houseOf,
  note,
  openAsksFor,
  personOf,
  promote,
  shareOwed,
  underSeal,
  type ValleyState,
} from './valley.ts';
export const RULES_EDITION = 'valley-2026-10';
export const PASS_EDITION = 'valley-pass-2026-10';
export const ALLIANCE_EDITION = 'valley-alliance-2026-10';
export const passEdition = (rules: unknown): boolean => rules === PASS_EDITION || rules === ALLIANCE_EDITION;
export type RulesEdition = typeof RULES_EDITION | typeof PASS_EDITION | typeof ALLIANCE_EDITION;
export const knownEdition = (rules: unknown): rules is RulesEdition =>
  rules === RULES_EDITION || passEdition(rules);
export type HearthTopic = 'person' | 'debt' | 'grievance';
interface Request {
  id: string;
  person: string;
  house: string;
  to?: string;
  action: 'early-sack' | 'neighbour-loan' | 'repay-neighbour' | 'levy-service';
  from: number;
  until: number;
  service?: Record<string, number>;
  completed?: string[];
  reply?: string;
  verdict?: string;
  settled?: boolean;
  status: 'pending' | 'working' | 'done' | 'refused' | 'expired';
}
export interface TermDecision {
  id: string;
  kind: 'winter' | 'levy' | 'inspection';
  house?: string;
  other?: string;
  text: string;
  from: number;
  until: number;
  answered?: string;
}
interface Debt {
  id: string;
  from: string;
  to: string;
  amount: number;
  paid: boolean;
}
export interface EditionState {
  id: RulesEdition;
  wages?: Record<string, number>;
  requests?: Request[];
  decisions?: TermDecision[];
  debts?: Debt[];
  topics?: string[];
  forecast?: number;
  reserve?: number;
  hiddenYears?: number[];
  inspectionAt?: number;
}
const houseLabel = (s: ValleyState, id: string) => {
  const h = houseOf(s, id);
  return h ? householdLabel(h) : 'a former household';
};
const emit = (s: ValleyState, text: string, house?: string) =>
  note(s, { at: s.minute, kind: 'story', text, ...(house ? { house } : {}), weight: 3 });
const head = (s: ValleyState, id: string) => {
  const h = houseOf(s, id);
  return h?.members
    .map((pid) => personOf(s, pid))
    .find((p) => p?.body.alive && ageYears(p) >= 18 && !!h && h.field.size > 0);
};
const spare = (s: ValleyState, hid: string) => {
  const h = houseOf(s, hid);
  return h ? Math.max(0, h.store - h.members.length * 0.03 * 180 - Math.max(0, shareOwed(h) - h.paid)) : 0;
};
export function millPay(
  s: ValleyState,
  pid: string,
  receipt: string,
  hours: number,
  completed: boolean,
): number {
  const e = s.edition;
  const h = s.households.find((h) => h.members.includes(pid));
  if (!e || !h || !completed || !Number.isFinite(hours) || hours <= 0) return 0;
  e.wages ??= {};
  if (Object.hasOwn(e.wages, receipt)) return 0;
  const amount = Math.min(s.agha.granary, hours * 0.15);
  e.wages[receipt] = amount;
  s.agha.granary -= amount;
  h.store += amount;
  return amount;
}
function request(s: ValleyState, hid: string, action: Request['action'], to?: string): boolean {
  const e = s.edition;
  const p = head(s, hid);
  const h = houseOf(s, hid);
  if (!e || !p || !h || !underSeal(s, h)) return false;
  const day = dayOfMinute(s.minute);
  const id = `${action}:${hid}:${yearOf(day)}${to ? `:${to}` : ''}`;
  e.requests ??= [];
  if (e.requests.some((r) => r.id === id)) return false;
  e.requests.push({
    id,
    person: p.id,
    house: hid,
    ...(to ? { to } : {}),
    action,
    from: s.minute,
    until: s.minute + 7 * DAY,
    status: 'pending',
  });
  promote(s, p.id);
  emit(
    s,
    `You asked ${personLabel(p)} ${action === 'levy-service' ? 'to spend two days carrying supplies with the rider, four hours each day. They can refuse. Their fields will wait' : action === 'neighbour-loan' ? 'to lend a small sack to a neighbour. They can refuse. Repayment depends on the next harvest' : 'to bring a small sack before the rider comes. This is extra grain, not a reduction of their share. They can refuse'}.`,
    hid,
  );
  return true;
}
export function requestContribution(s: ValleyState, hid: string): boolean {
  if (s.edition?.forecast !== yearOf(dayOfMinute(s.minute))) return false;
  return request(s, hid, 'early-sack');
}
export function termSuggestion(s: ValleyState, p: Person, at: number): Suggestion | undefined {
  const r = s.edition?.requests?.findLast(
    (r) =>
      r.person === p.id && r.from <= at && r.until > at && (r.status === 'pending' || r.status === 'working'),
  );
  return r ? { voiceId: KAHYA, action: r.action, strength: 0.45, appeal: 'duty', since: r.from } : undefined;
}
export function termOffers(s: ValleyState, p: Person, at: number): Affordance[] {
  const day = dayOfMinute(at);
  const { rise, set } = daylight(doyOf(day));
  if (minuteOfDay(at) < rise || minuteOfDay(at) >= set - 30) return [];
  return (s.edition?.requests ?? [])
    .filter(
      (r) =>
        r.person === p.id &&
        r.from <= at &&
        r.until > at &&
        (r.status === 'pending' || r.status === 'working'),
    )
    .flatMap((r) => {
      if (r.action !== 'levy-service' && spare(s, r.house) < 6) return [];
      const levy = r.action === 'levy-service';
      if (levy && (r.service?.[String(day)] ?? 0) >= 4) return [];
      return [
        {
          id: r.id,
          action: r.action,
          label: levy
            ? 'carry supplies with the rider for two days'
            : r.action === 'neighbour-loan'
              ? 'lend a sack to our neighbour'
              : r.action === 'repay-neighbour'
                ? 'repay the neighbour’s sack'
                : 'bring an extra sack to the granary',
          duration: levy ? 2 * HOUR : HOUR,
          effort: levy ? 0.35 : 0.2,
          placeId: levy ? 'pass' : 'konak',
          advertises: { belonging: 0.08, esteem: 0.04 },
          material: levy ? 0 : -2,
          tags: ['work', 'social'],
        },
      ];
    });
}
export function captureTermReply(s: ValleyState, p: Person, offer: Affordance, record: DecisionRecord) {
  const r = s.edition?.requests?.findLast(
    (r) =>
      r.person === p.id &&
      r.from <= p.now &&
      r.until > p.now &&
      (r.status === 'pending' || r.status === 'working'),
  );
  const reply =
    record.suggestion?.voiceId === KAHYA
      ? record.suggestion
      : record.suggestions?.find((r) => r.voiceId === KAHYA);
  const ask = openAsksFor(s, p.id, p.now).at(-1);
  if (!r || !reply || (ask && ask.from > r.from)) return false;
  if (r.status === 'working') return true;
  if (offer.id === r.id) {
    r.status = 'working';
    return true;
  }
  if (['sleep', 'rest', 'eat', 'drink', 'pray', 'christian-prayer'].includes(offer.action)) return true;
  if (reply.verdict === 'deferred') {
    if (r.reply !== reply.says || r.verdict !== reply.verdict)
      emit(s, `${personLabel(p)} put your request off. ${reply.says}`, r.house);
    r.reply = reply.says;
    r.verdict = reply.verdict;
    return true;
  }
  r.status = 'refused';
  emit(
    s,
    `${personLabel(p)} did not agree to ${r.action === 'levy-service' ? 'the rider’s service' : 'bring the sack'}. ${reply.says || 'They have their own work and household to consider.'}`,
    r.house,
  );
  return true;
}
function expireRequest(s: ValleyState, r: Request) {
  if (r.status === 'done' || r.status === 'expired' || r.settled) return;
  r.settled = true;
  if (r.action === 'levy-service') {
    s.agha.arrears = (s.agha.arrears ?? 0) + 12;
    s.agha.due += 12;
    emit(
      s,
      'No volunteer completed the rider’s service in time. Twelve grain measures were added to the due.',
    );
  }
  if (r.status === 'refused') return;
  r.status = 'expired';
  emit(s, `${houseLabel(s, r.house)} sent no sack or worker before your request expired.`, r.house);
}
export function resolveTermWork(
  s: ValleyState,
  p: Person,
  activity: Activity,
  reason: 'ended' | 'interrupted',
): Outcome | undefined {
  const e = s.edition;
  const r = e?.requests?.find((r) => r.id === activity.affordanceId && r.person === p.id);
  if (!r || !e) return undefined;
  const out: Outcome = {
    action: activity.action,
    affordanceId: activity.affordanceId,
    status: reason === 'ended' ? 'completed' : 'interrupted',
    at: p.now,
  };
  if (r.status === 'done' || r.status === 'refused' || r.status === 'expired') return out;
  const completedAt = reason === 'ended' ? Math.max(p.now, activity.endsAt) : p.now;
  if (completedAt > r.until) {
    expireRequest(s, r);
    return out;
  }
  if (reason !== 'ended') {
    r.status = 'pending';
    return out;
  }
  if (r.action === 'levy-service') {
    const receipt = `${activity.startedAt}:${activity.endsAt}`;
    r.completed ??= [];
    if (r.completed.includes(receipt)) return out;
    r.completed.push(receipt);
    const day = String(dayOfMinute(activity.startedAt));
    r.service ??= {};
    r.service[day] = Math.min(4, (r.service[day] ?? 0) + 2);
    const completedDays = Object.values(r.service).filter((hours) => hours >= 4).length;
    r.status = completedDays >= 2 ? 'done' : 'pending';
    if (r.status !== 'done') return { ...out, needs: { competence: 0.03 } };
    emit(
      s,
      `${personLabel(p)} returned from two days carrying the rider’s supplies. Their own work waited.`,
      r.house,
    );
    return { ...out, needs: { rest: -0.2, competence: 0.1 } };
  }
  r.status = 'done';
  const from = houseOf(s, r.house);
  const to = r.to ? houseOf(s, r.to) : undefined;
  if (!from || (r.to && !to)) return out;
  const outstanding =
    r.action === 'repay-neighbour'
      ? (e.debts?.find((d) => d.from === r.house && d.to === r.to && !d.paid)?.amount ?? 0)
      : 6;
  const amount = Math.min(outstanding, spare(s, from.id));
  from.store -= amount;
  if (to) to.store += amount;
  else s.agha.granary += amount;
  if (r.action === 'neighbour-loan' && to && amount > 0) {
    e.debts ??= [];
    e.debts.push({ id: r.id, from: to.id, to: from.id, amount, paid: false });
  }
  if (r.action === 'repay-neighbour') {
    const debt = e.debts?.find((d) => d.from === r.house && d.to === r.to && !d.paid);
    if (debt) {
      debt.amount -= amount;
      debt.paid = debt.amount <= 0;
    }
  }
  const helpedBefore = (s.kahyaState.acts?.[from.id] ?? []).some((a) => a.what === 'gave');
  emit(
    s,
    amount > 0
      ? `${householdLabel(from)} brought a small sack ${to ? `to ${householdLabel(to)}` : 'to the granary'}.${r.action === 'neighbour-loan' ? ' The household receiving it owes that grain after harvest. The lender may still have to wait.' : r.action === 'early-sack' && helpedBefore ? ' Your book records the grain you sent this house before. Today they chose to help meet the payment. That does not erase earlier quarrels.' : ''}`
      : `${householdLabel(from)} could spare no grain when the carrying was finished. Nothing changed hands.`,
    from.id,
  );
  return { ...out, material: -amount };
}
function decision(s: ValleyState, d: Omit<TermDecision, 'from' | 'until'>) {
  const e = s.edition;
  if (!e) return;
  e.decisions ??= [];
  if (e.decisions.some((x) => x.id === d.id)) return;
  e.decisions.push({ ...d, from: s.minute, until: s.minute + 7 * DAY });
  emit(s, d.text, d.house);
}
export function termDay(s: ValleyState, day: number) {
  const e = s.edition;
  if (!e) return;
  const year = yearOf(day);
  // Early enough to ask while the first barley still stands; no implied guaranteed donation.
  if (doyOf(day) >= 198 && doyOf(day) <= 201 && e.forecast !== year) {
    e.forecast = year;
    emit(
      s,
      'The local overseer says the payment assumes a good harvest and full household shares. The barley is still standing. You can ask houses with full jars for an extra sack now. They may refuse, and any sack they send leaves less food in their own house.',
    );
  }
  for (const d of e.decisions ?? [])
    if (!d.answered && d.until <= s.minute) {
      d.answered = 'ignored';
      if (d.kind !== 'winter') {
        const cost = d.kind === 'levy' ? 12 : 6;
        s.agha.arrears = (s.agha.arrears ?? 0) + cost;
        s.agha.due += cost;
        emit(
          s,
          `You left the ${d.kind === 'levy' ? 'rider’s service request' : 'inspector’s request'} unanswered. The due grew by ${cost} grain measures.`,
        );
      }
    }
  for (const r of e.requests ?? []) if (r.until <= s.minute) expireRequest(s, r);
  if (seasonOf(doyOf(day)) === 'winter' && day % 21 === 3) {
    const knock = s.knocks.find(
      (k) => k.what === 'grain' && !k.answered && k.at <= s.minute && k.until > s.minute,
    );
    const poor = knock ? houseOf(s, knock.house) : undefined;
    const p = poor && head(s, poor.id);
    const tie = p?.social.relationships.find((t) => {
      const other = s.households.find((h) => h.id !== poor?.id && h.members.includes(t.otherId));
      return (
        t.familiarity > 0.3 && other && underSeal(s, other) && spare(s, other.id) >= 6 && head(s, other.id)
      );
    });
    const other = tie && s.households.find((h) => h.members.includes(tie.otherId));
    if (poor && other)
      decision(s, {
        id: `winter:${day}`,
        kind: 'winter',
        house: poor.id,
        other: other.id,
        text: `${householdLabel(poor)} asks for a sack to last the cold. They know ${householdLabel(other)} and ask you to arrange a loan. Ask that neighbour, who can refuse, or use the landowner’s grain. A loan will remain owed after harvest.`,
      });
  }
  if (year === 3 && doyOf(day) >= 198)
    decision(s, {
      id: 'levy:3',
      kind: 'levy',
      text: 'The rider asks for a household worker to carry supplies over the pass on two days, four hours each day. You can ask for a volunteer, who can refuse and lose time in their own field, or send twelve grain measures in place of service. If nobody completes the service within a week, twelve grain measures are added to the due.',
    });
  if (e.inspectionAt !== undefined && s.minute >= e.inspectionAt) {
    const inspectionAt = e.inspectionAt;
    delete e.inspectionAt;
    if ((e.reserve ?? 0) > 0) {
      const witnessHouse = s.households.find((h) => s.kahyaState.acts?.[h.id]?.length && head(s, h.id));
      const witness = witnessHouse && head(s, witnessHouse.id);
      const memory = witness && recall(witness, { actorId: KAHYA, limit: 1 })[0];
      const testimony = witness && memory ? `${personLabel(witness)} recalls: ${memory.summary}. ` : '';
      const acts = Object.values(s.kahyaState.acts ?? {})
        .flat()
        .slice(-3)
        .map((a) => a.what)
        .join('; ');
      decision(s, {
        id: `inspection:${inspectionAt}`,
        kind: 'inspection',
        text: `The inspector asks the village what it remembers. ${testimony}${acts ? `Your book records: ${acts}. ` : 'There are no household acts in your book yet. '}He asks you to open the separate grain store. Return its grain to the account, or refuse and accept six more grain measures on the next due. Leaving his request unanswered also adds six grain measures. He does not know anyone’s private thoughts.`,
      });
    }
  }
  if (seasonOf(doyOf(day)) === 'threshing')
    for (const debt of e.debts ?? []) {
      if (!debt.paid && spare(s, debt.from) >= 6) request(s, debt.from, 'repay-neighbour', debt.to);
    }
}
export function chooseTerm(s: ValleyState, id: string, choice: string): boolean {
  const e = s.edition;
  if (!e || s.flags.ended) return false;
  if (id.startsWith('reserve:') && choice === 'give') {
    const hid = id.slice(8);
    const h = houseOf(s, hid);
    if (!h?.members.length || (e.reserve ?? 0) <= 0) return false;
    const amount = Math.min(6, e.reserve ?? 0);
    e.reserve = (e.reserve ?? 0) - amount;
    s.agha.granary += amount;
    give(s, hid, amount);
    emit(
      s,
      'You opened the separate store and recorded a sack sent down the lane. It is no longer hidden grain.',
      hid,
    );
    return true;
  }
  if (id === 'reserve' && choice === 'hide') {
    const year = yearOf(dayOfMinute(s.minute));
    e.hiddenYears ??= [];
    if (e.hiddenYears.includes(year) || s.agha.granary < 6) return false;
    s.agha.granary -= 6;
    e.reserve = (e.reserve ?? 0) + 6;
    e.hiddenYears.push(year);
    e.inspectionAt ??= s.minute + 7 * DAY;
    emit(
      s,
      'You put a small sack in a separate store and left it out of the granary account. It is still grain in your care. An inspector may ask you to account for it.',
    );
    return true;
  }
  const d = e.decisions?.find((d) => d.id === id && !d.answered && d.from <= s.minute && d.until > s.minute);
  if (!d) return false;
  if (d.kind === 'winter') {
    if (choice === 'neighbour') {
      if (!d.other || !request(s, d.other, 'neighbour-loan', d.house)) return false;
    } else if (choice === 'grain') {
      const h = d.house && houseOf(s, d.house);
      if (!h || s.agha.granary < 6) return false;
      s.agha.granary -= 6;
      h.store += 6;
      s.stats.given = (s.stats.given ?? 0) + 6;
      emit(
        s,
        `You sent a small sack from the granary to ${householdLabel(h)}. That grain will not be there for the rider.`,
        h.id,
      );
    } else return false;
  } else if (d.kind === 'levy') {
    if (choice === 'grain') {
      if (s.agha.granary < 12) return false;
      s.agha.granary -= 12;
      emit(s, 'The rider took twelve grain measures instead of a worker. The due is unchanged.');
    } else if (choice.startsWith('ask:')) {
      if (!request(s, choice.slice(4), 'levy-service')) return false;
    } else return false;
  } else {
    if (choice === 'return') {
      s.agha.granary += e.reserve ?? 0;
      e.reserve = 0;
      emit(s, 'You opened the separate store. The inspector entered its grain in the granary account.');
    } else if (choice === 'refuse') {
      s.agha.arrears = (s.agha.arrears ?? 0) + 6;
      s.agha.due += 6;
      emit(
        s,
        'You kept the separate store closed. The inspector added six grain measures to the due. The grain remains in your care.',
      );
    } else return false;
  }
  if (d.kind === 'winter')
    for (const knock of s.knocks) {
      if (knock.what === 'grain' && knock.house === d.house && !knock.answered)
        knock.answered = choice === 'grain' ? 'gave' : 'arranged';
    }
  d.answered = choice;
  return true;
}
export function talkAtHearth(s: ValleyState, hid: string, topic: HearthTopic): boolean {
  const e = s.edition;
  const visit = s.kahyaState.visit;
  const h = houseOf(s, hid);
  if (!e || !h || !visit || visit.house !== hid || visit.arrive > s.minute || visit.leave <= s.minute)
    return false;
  const key = `${hid}:${visit.arrive}:${topic}`;
  e.topics ??= [];
  if (e.topics.includes(key)) return false;
  e.topics.push(key);
  const p = head(s, hid);
  if (!p) return false;
  let words: string;
  if (topic === 'debt') {
    const debt = e.debts?.find((d) => !d.paid && (d.from === hid || d.to === hid));
    words = debt
      ? `Your book records a sack owed by ${houseLabel(s, debt.from)} to ${houseLabel(s, debt.to)}. It has not been repaid.`
      : 'You have heard no account of a grain loan involving this household. That does not mean it has no debts.';
  } else if (topic === 'grievance') {
    const act = s.kahyaState.acts?.[hid]?.at(-1);
    words = act
      ? `You ask about the last thing you did here. Your book says you ${act.what}. ${personLabel(p)} says, “We remember. Sitting here does not settle every quarrel.”`
      : `${personLabel(p)} says, “Tell me what you want to discuss. I will not answer for the whole valley.”`;
  } else {
    const heard = s.notes.findLast(
      (n) => n.house === hid && n.kind === 'voice' && n.at <= s.minute && n.words && n.who !== undefined,
    );
    words = heard
      ? `You ask about the person who spoke here. You heard: “${heard.words}” There is no promise of a further confidence.`
      : `${personLabel(p)} says, “Ask them yourself when they are here. I cannot speak for them.”`;
  }
  note(s, {
    at: s.minute,
    kind: 'voice',
    text: `You ask ${personLabel(p)} about ${topic === 'person' ? 'someone in the household' : topic === 'debt' ? 'a grain debt' : 'a grievance'}:`,
    words,
    who: p.id,
    house: hid,
    weight: 3,
  });
  return true;
}
