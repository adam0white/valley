import type { ValleyState } from '../sim/valley.ts';

/** An optional closing grain account, never a judgement of the people or their lives. */
export function closingGrain(s: ValleyState, enabled: boolean): string {
  if (!enabled || !s.flags.ended) return '';
  const remaining = Math.round(s.agha.granary);
  const given = Math.round(s.stats.given ?? 0);
  return `The office’s grain reckoning: ${remaining + given} kile total = ${remaining} left in the granary + ${given} given away. Each component is rounded to the nearest whole kile before adding. This game’s account counts grain, not the worth of the people or your term.`;
}
