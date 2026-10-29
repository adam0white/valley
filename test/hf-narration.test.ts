import { exportRun, replay as replayRun } from '@adam0white/human-framework';
import { expect, it } from 'vitest';
import { compactRun, fingerprint, load, newGame, save, step } from '../src/sim/game.ts';
import { personRun } from '../src/sim/hf.ts';

it('pins the complete community to published HF4 and retains authored names in its archive', () => {
  const game = newGame(7);
  const run = personRun(game.valley.kahya);
  if (!run) throw new Error('The steward must share the community Run.');
  for (const person of game.valley.people) expect(personRun(person)).toBe(run);
  const archive = exportRun(run);
  expect(archive.engine.package).toBe('@adam0white/human-framework@4.8.0');
  expect(archive.initial.spec.definitions.lexicon.names.yusuf).toBe('Yusuf');
  expect(archive.initial.spec.definitions.lexicon.roles.kahya).toBe('the steward');
  const verified = replayRun(archive);
  expect(verified.ok && verified.value.verified).toBe(true);
  if (!verified.ok) throw new Error(verified.error.message);
  expect(verified.value.fullHash).toBe(archive.hashes.full);
});

it('retains the exact new-pin archive through native and playtest exports', () => {
  const game = newGame(7);
  step(game, 480);
  const file = save(game);
  const full = load(JSON.parse(JSON.stringify(file)));
  const compact = load(JSON.parse(JSON.stringify(compactRun(game))));
  expect(fingerprint(full.valley)).toBe(file.fingerprint);
  expect(fingerprint(compact.valley)).toBe(file.fingerprint);
  const archiveOf = (g: typeof game) => {
    const run = personRun(g.valley.kahya);
    if (!run) throw new Error('Missing Run');
    return exportRun(run);
  };
  expect(archiveOf(full)).toEqual(archiveOf(game));
  expect(archiveOf(compact)).toEqual(archiveOf(game));
});
