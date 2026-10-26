/** Structural local-ledger admission, before replay or any cast ownership claim.
 * Does not grant ownership: CastSession still validates exact native receipts.
 */

import { DAY } from '../sim/calendar.ts';
import { ALLIANCE_EDITION, grainEdition, knownEdition, passEdition, REPLY_EDITION } from '../sim/edition.ts';
import { END_DAY, GAME_VERSION, QUANTUM } from '../sim/game.ts';

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown, max: number) =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
const name = (x: unknown) => typeof x === 'string' && /^[\p{L}\p{N}_-]{1,100}$/u.test(x);
export function validLocalLog(value: unknown): boolean {
  if (!object(value)) return false;
  const v = value;
  if (
    v.game !== 'valley' ||
    v.version !== GAME_VERSION ||
    !integer(v.seed, 0xffffffff) ||
    !integer(v.minute, (END_DAY + 1) * DAY) ||
    !integer(v.volume, 100000) ||
    typeof v.plainEnglish !== 'boolean' ||
    (v.rules !== undefined && !knownEdition(v.rules)) ||
    !Array.isArray(v.inputs) ||
    v.inputs.length > 20000
  )
    return false;
  if (
    v.continuity !== undefined &&
    (!object(v.continuity) ||
      typeof v.continuity.runId !== 'string' ||
      !/^[A-Za-z0-9-]{1,80}$/.test(v.continuity.runId))
  )
    return false;
  let prior = 0;
  for (const input of v.inputs) {
    if (
      !object(input) ||
      !integer(input.at, v.minute as number) ||
      (input.at as number) % QUANTUM ||
      (input.at as number) < prior
    )
      return false;
    prior = input.at as number;
    switch (input.verb) {
      case 'broker':
        if (
          v.rules !== ALLIANCE_EDITION ||
          !['meeting', 'proposal', 'ceremony'].includes(input.choice as string)
        )
          return false;
        break;
      case 'alliance':
        if (
          v.rules !== ALLIANCE_EDITION ||
          !['accept', 'decline', 'collect', 'withdraw'].includes(input.choice as string)
        )
          return false;
        break;
      case 'pass':
        if (!passEdition(v.rules) || !['depart', 'buy', 'deliver'].includes(input.choice as string))
          return false;
        break;
      case 'introduce':
        if (!passEdition(v.rules)) return false;
        break;
      case 'call':
        if (
          !['reap-agha', 'build-mill', 'bring-share'].includes(input.job as string) ||
          !Array.isArray(input.houses) ||
          input.houses.length > 30 ||
          !input.houses.every(name) ||
          (input.wage !== undefined && typeof input.wage !== 'boolean')
        )
          return false;
        break;
      case 'give':
        if (
          !name(input.house) ||
          typeof input.kile !== 'number' ||
          !Number.isFinite(input.kile) ||
          input.kile <= 0 ||
          input.kile > 100000
        )
          return false;
        break;
      case 'borrow':
        if (
          typeof input.kile !== 'number' ||
          !Number.isFinite(input.kile) ||
          input.kile <= 0 ||
          input.kile > 100000
        )
          return false;
        break;
      case 'visit':
        if (
          !name(input.house) ||
          (input.why !== undefined &&
            !['grain', 'wedding', 'birth', 'death', 'call'].includes(input.why as string))
        )
          return false;
        break;
      case 'ease':
      case 'seize':
      case 'contribute':
        if (!name(input.house)) return false;
        break;
      case 'insist':
        if (!name(input.ask) || !name(input.pid)) return false;
        break;
      case 'turn-away':
        if (!name(input.knock)) return false;
        break;
      case 'release-cast':
        if (!name(input.person)) return false;
        break;
      case 'reply':
        if (v.rules !== REPLY_EDITION || !name(input.house)) return false;
        break;
      case 'topic':
        if (
          !grainEdition(v.rules) ||
          !name(input.house) ||
          !['person', 'debt', 'grievance'].includes(input.topic as string)
        )
          return false;
        break;
      case 'term-choice':
        if (
          !grainEdition(v.rules) ||
          typeof input.id !== 'string' ||
          input.id.length > 120 ||
          typeof input.choice !== 'string' ||
          input.choice.length > 120
        )
          return false;
        break;
      default:
        return false;
    }
  }
  return true;
}
