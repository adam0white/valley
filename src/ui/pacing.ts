/** Presentation only. Replies and unanswered doors remain readable at every menu pace. */
export const READING_MS = 12_000;
export type Pace = 'automatic' | 'slow' | 'steady' | 'fast';
export function automaticRate(s: {
  night: boolean;
  travelling: boolean;
  reading: boolean;
  waiting: boolean;
  hurrying: boolean;
  working?: boolean;
  pace?: Pace;
}): number {
  if (s.waiting) return 1;
  if (s.reading) return 2;
  const chosen = { slow: 30, steady: 120, fast: 480 };
  const base = s.pace && s.pace !== 'automatic' ? chosen[s.pace] : s.working ? 120 : 240;
  const rate = s.hurrying ? 960 : base;
  return s.night && !s.travelling ? rate * 3 : rate;
}
