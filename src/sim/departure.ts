/** A portable person cannot remove an unfinished host agreement or attended scene. */
import type { ValleyState } from './valley.ts';

export function departureObligations(s: ValleyState, person: string): string[] {
  const obligations: string[] = [];
  const help = s.receivedTerms?.help;
  if (
    help?.person === person &&
    (!help.workClosed || help.earned > help.delivered + 1e-10 || help.cargo > 1e-10)
  )
    obligations.push('The food and work agreement still needs to be finished here.');
  if (
    s.dialogue?.exchanges.some(
      (e) => e.person === person && ['pending', 'heard', 'talking'].includes(e.status),
    )
  )
    obligations.push('Finish or end the current question before this person leaves.');
  return obligations;
}
