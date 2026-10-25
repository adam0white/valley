import { createCommunity, type Person, tellDeath } from '@adam0white/human-framework';

/** Deliver news at each listener's own clock, including residents advanced by routines. */
export function tellValleyDeath(people: Person[], dead: Person, at: number): void {
  tellDeath(createCommunity(people), dead, at, { late: 'now' });
}
