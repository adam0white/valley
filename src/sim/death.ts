import { type Person, tellDeath } from './hf.ts';

/** Deliver news at the Run clock without constructing a second community. */
export function tellValleyDeath(people: Person[], dead: Person, at: number): void {
  tellDeath({ people }, dead, at, { late: 'now' });
}
