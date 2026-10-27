import { expect, it } from 'vitest';
import { newGame } from '../src/sim/game.ts';
import { give } from '../src/sim/valley.ts';
import { clockWords, grainReceipt, paceWords, skipBlock, travelWords } from '../src/ui/clarity.ts';
import { automaticRate } from '../src/ui/pacing.ts';

it('shows advancing clock minutes and the slowdown that still overrides Skip', () => {
  expect(clockWords(420)).toBe('07:00');
  expect(clockWords(450)).toBe('07:30');
  const waiting = { waiting: true, reading: true, hurrying: true };
  expect(paceWords(waiting)).toContain('door');
  expect(automaticRate({ ...waiting, night: false, travelling: false })).toBe(1);
  expect(skipBlock({ ...waiting, hurrying: false })).toMatch(/door/);
  // Only delayed replies open: slower than usual, and Skip still runs time quickly.
  const replies = {
    waiting: false,
    reading: false,
    hurrying: false,
    replies: true,
    night: false,
    travelling: false,
  };
  expect(paceWords(replies)).toContain('replies');
  expect(automaticRate(replies)).toBe(30);
  expect(automaticRate({ ...replies, hurrying: true })).toBe(960);
  expect(skipBlock(replies)).toBeNull();
  // An open question almost stops time, over every other pace.
  expect(automaticRate({ ...replies, waiting: true, asked: true })).toBe(0.25);
  expect(skipBlock({ waiting: false, hurrying: false, asked: true })).toMatch(/answer/);
  expect(paceWords({ waiting: false, reading: true, hurrying: true })).toContain('reading');
});
it('reports actual transferred grain and the next visit boundary', () => {
  expect(grainReceipt('the Çoban house', 6, 18, 12)).toBe(
    'Dispatched 6 measures to the Çoban house. Net granary cost: 6 measures. Your granary now holds 12 measures.',
  );
  const visit = { arrive: 440, leave: 530, back: 550 };
  expect(travelWords(visit, 420)).toBe('20 game minutes until arrival; 130 until home.');
  expect(travelWords(visit, 450)).toBe('80 game minutes left here; 100 until home.');
  expect(travelWords(visit, 540)).toBe('10 game minutes until home.');
});

it('distinguishes an actual returned sack from forwarding, preserving fractional dispatch', () => {
  const s = newGame(42).valley;
  for (const h of s.households) h.store = 10000;
  s.agha.granary = 2.5;
  const before = s.agha.granary;
  const sent = give(s, 'coban', 6);
  expect(sent).toBe(2.5);
  const returned = s.notes.findLast((n) => n.kind === 'gift')?.text;
  expect(returned).toContain('The sack came back');
  expect(grainReceipt('the Çoban house', sent, before, s.agha.granary, returned)).toBe(
    'Dispatched 2.5 measures to the Çoban house. The sack returned. Net granary cost: 0 measures. Your granary now holds 2.5 measures.',
  );
  const needy = s.households.find((h) => h.id !== 'coban' && h.hamlet === 'lower' && h.members.length);
  if (!needy) throw new Error('Missing actual forwarding house');
  needy.store = 0;
  const forwarded = give(s, 'coban', 6);
  expect(forwarded).toBe(2.5);
  expect(
    grainReceipt(
      'the Çoban house',
      forwarded,
      before,
      s.agha.granary,
      s.notes.findLast((n) => n.kind === 'gift')?.text,
    ),
  ).toBe(
    `Dispatched 2.5 measures to the Çoban house. They carried it on to ${needy.name} before dark. Net granary cost: 2.5 measures. Your granary now holds 0 measures.`,
  );
});

it('previews the granary remainder before a gift without claiming the sack was delivered', async () => {
  const { grainPreview } = await import('../src/ui/clarity.ts');
  expect(grainPreview('the Çoban house', 30)).toBe(
    'Send 6 measures of grain to the Çoban house? Your granary will hold 24 measures before any returned grain. No grain has been sent.',
  );
  expect(grainPreview('the Çoban house', 2.5)).toContain('will hold 0 measures');
});
