/** Presentation only. Quiet stretches advance briskly; replies and unanswered doors remain readable. */
export const READING_MS = 12_000;
export function automaticRate(s: {
  night: boolean;
  travelling: boolean;
  reading: boolean;
  waiting: boolean;
  hurrying: boolean;
  selectedRate?: number;
}): number {
  if (s.waiting) return 1;
  if (s.reading) return 2;
  const rate = s.hurrying ? 960 : (s.selectedRate ?? 30);
  return s.night && !s.travelling ? rate * 3 : rate;
}
