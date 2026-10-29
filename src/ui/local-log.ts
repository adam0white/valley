/** Structural local-ledger admission, before replay or any cast ownership claim.
 * Does not grant ownership: CastSession still validates exact native receipts.
 */

import { DAY } from '../sim/calendar.ts';
import {
  allianceEdition,
  dialogueEdition,
  grainEdition,
  knownEdition,
  PUBLIC_EDITION,
  passEdition,
  replyEdition,
} from '../sim/edition.ts';
import { END_DAY, GAME_VERSION, QUANTUM } from '../sim/game.ts';

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown, max: number) =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
// HF visit anchors use exact integer milliseconds projected into game minutes.
const instant = (x: unknown, max: number) =>
  typeof x === 'number' &&
  x >= 0 &&
  x <= max &&
  Number.isSafeInteger(Math.round(x * 60000)) &&
  Math.round(x * 60000) / 60000 === x;
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
      case 'keep-words':
      case 'help-offer':
      case 'help-end':
      case 'help-deliver':
      case 'help-return': {
        if (v.rules !== PUBLIC_EDITION) return false;
        const keys =
          input.verb === 'keep-words'
            ? ['at', 'verb', 'note']
            : input.verb === 'help-offer'
              ? ['at', 'verb', 'person', 'house', 'ask', 'visit']
              : ['at', 'verb', 'contract'];
        if (Object.keys(input).length !== keys.length || Object.keys(input).some((k) => !keys.includes(k)))
          return false;
        if (
          input.verb === 'keep-words'
            ? !integer(input.note, Number.MAX_SAFE_INTEGER)
            : input.verb === 'help-offer'
              ? !name(input.person) ||
                !name(input.house) ||
                !name(input.ask) ||
                !instant(input.visit, input.at as number)
              : !name(input.contract)
        )
          return false;
        break;
      }
      case 'dialogue':
        // The new public line carries no caller-authored history or field facts.
        // Only deterministic acceptance creates its prospective request anchor.
        if (
          ['after-cut', 'birth', 'son', 'friendship', 'reciprocal-help'].includes(input.line as string) &&
          (Object.keys(input).some(
            (k) => !['at', 'verb', 'turn', 'house', 'person', 'visit', 'prior', 'line'].includes(k),
          ) ||
            !integer(input.turn, 20000) ||
            !name(input.house) ||
            input.person !==
              (
                {
                  birth: 'yusuf',
                  son: 'serife',
                  friendship: 'danyal',
                  'reciprocal-help': 'zehra',
                  'after-cut': 'zehra',
                } as Record<string, string>
              )[input.line as string] ||
            !instant(input.visit, input.at as number) ||
            !integer(input.prior, Number.MAX_SAFE_INTEGER))
        )
          return false;
        if (!dialogueEdition(v.rules)) return false;
        break;
      case 'dialogue-cancel':
        // Replay performs semantic admission and must retain every accepted input.
        if (!dialogueEdition(v.rules)) return false;
        break;
      case 'broker':
        if (
          !allianceEdition(v.rules) ||
          !['meeting', 'proposal', 'ceremony'].includes(input.choice as string)
        )
          return false;
        break;
      case 'alliance':
        if (
          !allianceEdition(v.rules) ||
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
        if (
          !replyEdition(v.rules) ||
          !name(input.house) ||
          (input.saying !== undefined && !['listen', 'finish', 'rain'].includes(input.saying as string))
        )
          return false;
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
