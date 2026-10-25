/** Fail a fixture setup explicitly instead of silencing a missing value's type. */
export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Required test fixture is missing.');
  return value;
}
