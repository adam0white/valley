/** Public scene context only. Valley owns physical conditions and outward source words.
 * This projection never changes a Person, advances time or supplies assent. */
import { dialogueChoices } from '../sim/dialogue.ts';
import { houseOf, type Note, personOf, type ValleyState } from '../sim/valley.ts';

export function zehraScene(s: ValleyState, house: string): { reason: string; source?: Note } | undefined {
  const h = houseOf(s, house);
  if (!h || (!h.members.includes('zehra') && h.id !== 'coban')) return undefined;
  const p = personOf(s, 'zehra');
  const source = s.notes.findLast(
    (n) =>
      n.who === 'zehra' &&
      n.house === house &&
      n.at <= s.minute &&
      (n.kind === 'reply' || n.kind === 'voice') &&
      !!n.words,
  );
  const result = (reason: string) => ({ reason, ...(source ? { source } : {}) });
  if (!s.dialogue)
    return result('This saved term has no Zehra question action. Your existing place and rules are kept.');
  if (!p?.body.alive) return result('Zehra is not available for a visit.');
  if (!h.members.includes('zehra')) return result('Zehra does not live at this house now.');
  if (s.flags.ended || !s.kahya.body.alive)
    return result('Your service has ended. You cannot begin another visit.');
  const v = s.kahyaState.visit;
  if (!v || v.back <= s.minute)
    return result('Visit this house to ask Zehra about her words. She may choose not to answer.');
  if (v.house !== house) return result('You are away on another visit. Return before visiting this house.');
  if (s.minute < v.arrive) return result('You are still walking to this house. You cannot ask Zehra yet.');
  if (s.minute >= v.leave) return result('You have left the house. You cannot ask Zehra on the walk home.');
  const exchange = s.dialogue.exchanges.findLast((e) => ['pending', 'heard', 'talking'].includes(e.status));
  if (exchange)
    return result('Your current question has no completed answer yet. End it before asking another.');
  if (v.leave - s.minute < 5)
    return result('Less than five minutes remain here. There is not enough time for this question.');
  if (p.activity?.mode === 'sleep') return result('Zehra is asleep. This question does not wake her.');
  const place = p.activity?.affordance.placeId ?? s.dialogue.place;
  if (place !== `house:${house}`)
    return result('Zehra is not at this house now. A visit does not bring her home.');
  if (!source) return result('You have no retained public words from Zehra to ask about.');
  if (dialogueChoices(s).length)
    return result('You can ask Zehra about her words. She may choose not to answer.');
  return result('No Zehra question is available during this visit.');
}
