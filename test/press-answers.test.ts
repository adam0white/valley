import { expect, it } from 'vitest';
import { PressAnswers } from '../scripts/press-answers.ts';
import { act, DAY, newGame, step } from '../src/sim/game.ts';
import { required } from './required.ts';

it('credits the actual later reply and never the grouped report or an old reply', () => {
  const g = newGame(7);
  act(g, { verb: 'call', job: 'reap-agha', houses: ['coban'] });
  step(g, 21 * 60);
  const ask = required(g.valley.asks[0]);
  const person = 'yusuf';
  const tracker = new PressAnswers();
  tracker.sent(ask.id, person, g.valley);
  expect(tracker.read(g.valley)).toEqual([]);
  expect(act(g, { verb: 'insist', ask: ask.id, pid: person })).toBe(true);
  step(g, DAY + 6 * 60);
  const reply = required(ask.replies[person]);
  expect(reply.at).toBeGreaterThan(21 * 60);
  const original = g.valley.notes;
  g.valley.notes = original.filter((n) => n.ask !== ask.id);
  g.valley.notes.push({
    id: 9000,
    at: reply.at,
    kind: 'reply',
    text: 'They came when pressed earlier.',
    weight: 3,
    ask: ask.id,
    who: person,
    group: `pressed-${ask.id}`,
  });
  expect(tracker.read(g.valley)).toEqual([]);
  g.valley.notes = original;
  const answers = tracker.read(g.valley);
  expect(answers.map((a) => a.id)).toEqual([`press:${ask.id}:${person}`]);
  expect(required(answers[0]).note.at).toBeGreaterThan(21 * 60);
  expect(tracker.read(g.valley)).toEqual([]);
});
