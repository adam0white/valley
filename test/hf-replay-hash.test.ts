import { replay as replayNative } from '@adam0white/human-framework';
import { expect, it } from 'vitest';
import { compactRun, load, newGame, replay, save, stateJson, step } from '../src/sim/game.ts';

it('verifies current native replay hashes, exact restores, and corruption refusal for one quantum', () => {
  const game = newGame(7, undefined, false, true, 'valley-public-2026-10');
  step(game, game.valley.minute + 30);
  const full = save(game);
  const archive = full.state.community?.archive;
  if (!archive) throw new Error('Missing the authoritative native archive');
  const native = replayNative(archive);
  expect(native.ok).toBe(true);
  if (!native.ok) throw new Error(native.error.message);
  expect(native.value.verified).toBe(true);
  expect(native.value.fullHash).toBe(archive.hashes.full);
  expect(archive.hashes.full).toBe('2ea2408e49510f0b912545b6a68cc4df348201cd784b91732b01d3ebb62d759d');
  const independentlyReplayed = replay(7, [], game.valley.minute, undefined, true, 'valley-public-2026-10');
  const restored = [load(full), load(compactRun(full)), independentlyReplayed];
  for (const copy of restored) expect(stateJson(copy.valley)).toEqual(full.state);
  const corrupt = { ...structuredClone(archive), hashes: { ...archive.hashes, full: '0'.repeat(64) } };
  const refused = replayNative(corrupt);
  expect(refused.ok && refused.value.verified).toBe(false);
  const corruptFull = structuredClone(full);
  if (!corruptFull.state.community) throw new Error('Missing the saved native community');
  corruptFull.state.community.archive = corrupt;
  expect(() => load(corruptFull)).toThrow();
  for (const copy of [game, ...restored]) step(copy, full.minute + 30);
  for (const copy of restored) expect(stateJson(copy.valley)).toEqual(stateJson(game.valley));
});
