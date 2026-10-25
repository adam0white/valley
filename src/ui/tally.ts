import type { ValleyState } from '../sim/valley.ts';

/** An optional closing grain account, never a judgement of the people or their lives. */
export function closingGrain(s: ValleyState, enabled: boolean): string {
  if (!enabled || !s.flags.ended) return '';
  const remaining = Math.round(s.agha.granary);
  const given = Math.round(s.stats.given ?? 0);
  return `Your grain account: ${remaining + given} grain measures total = ${remaining} left in the granary + ${given} given away. Each amount is rounded to the nearest whole grain measure before adding. This account counts only grain. It does not measure the value of the people or your time as steward.`;
}
