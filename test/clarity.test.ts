import { expect, it } from 'vitest';
import { clockWords, grainReceipt, paceWords, travelWords } from '../src/ui/clarity.ts';
import { automaticRate } from '../src/ui/pacing.ts';

it('shows advancing clock minutes and the slowdown that still overrides Skip', () => {
  expect(clockWords(420)).toBe('07:00');
  expect(clockWords(450)).toBe('07:30');
  const waiting = { waiting: true, reading: true, hurrying: true };
  expect(paceWords(waiting)).toContain('replies');
  expect(automaticRate({ ...waiting, night: false, travelling: false })).toBe(1);
  expect(paceWords({ waiting: false, reading: true, hurrying: true })).toContain('reading');
});
it('reports actual transferred grain and the next visit boundary', () => {
  expect(grainReceipt('the Çoban house', 18, 12)).toContain('Sent grain to the Çoban house');
  expect(grainReceipt('the Çoban house', 18, 12)).not.toMatch(/[0-9]/);
  expect(grainReceipt('the Çoban house', 18, 18)).toBe('No grain was sent.');
  const visit = { arrive: 440, leave: 530, back: 550 };
  expect(travelWords(visit, 420)).toBe('20 game minutes until arrival; 130 until home.');
  expect(travelWords(visit, 450)).toBe('80 game minutes left here; 100 until home.');
  expect(travelWords(visit, 540)).toBe('10 game minutes until home.');
});
