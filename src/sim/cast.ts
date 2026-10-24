/** Canonical profiles come from the exact released public registry. Secrets stay in authored encounters. */
import { canonicalCast, castForGame } from '@adam0white/lab-client';
export const CAST_IDS: Record<string, string> = {
  yusuf: 'hf.cast.yusuf.well',
  maryam: 'hf.cast.maryam.well',
  'yusuf-usta': 'hf.cast.yusuf.warren',
  'meryem-visitor': 'hf.cast.meryem.warren',
  samira: 'hf.cast.samira.well',
  danyal: 'hf.cast.danyal.well',
};
export const ALLOCATION = castForGame('valley');
export const localRole = (castId: string) => {
  const role = Object.keys(CAST_IDS).find((id) => CAST_IDS[id] === castId);
  if (!role) throw new Error('No authored Valley role for this identity.');
  return role;
};
export function canonicalOpening(id: string) {
  return CAST_IDS[id] ? canonicalCast(CAST_IDS[id]) : undefined;
}

export const DISCLOSURES: Record<string, string> = {
  yusuf:
    'Yusuf brings out a timber token of his own accord. “I promised a neighbour a repair before checking the timber. I used what I had kept for our roof. I called the shortage a leak. Zehra has not agreed to that choice.” The account is now known; neither debt nor household disagreement is settled.',
  maryam:
    'Maryam asks for a smooth scrap of wood, then shows you a little puzzle. “I collect these. Not everything needs to feed someone.” She puts the cooking aside for a while. Her collection is hers to share; no one must solve a puzzle to receive food.',
  'yusuf-usta':
    'Yusuf Usta chooses to unfold his private map. “That passage was unstable. I also kept the shift going to prove another man wrong. Someone was injured. I paid through another person; I never spoke to him.” This is his acknowledgment, not the injured worker’s forgiveness or a repaired obligation.',
  'meryem-visitor':
    'Meryem agrees to show the map she has been working on. “I traced Grandfather’s survey and called it new. I corrected parts, but I did not walk all of this.” She points to two marks in her own notebook: observed and inherited. You have heard her account; the ground remains unverified.',
  samira:
    'Samira asks whether you have an empty shell, then chooses to show her painted scraps: the same bowl beside a window in several uneven colours. “This yellow never came again.” The pigments come from permitted scraps. She makes no claim that they are safe for skin.',
  danyal:
    'Danyal invites you to fetch an empty jar. “I made that shelf after my wife died. She had asked for it while I kept putting public work first. People say she always supported it. We quarrelled too.” He lets the account stand without turning her into an excuse. His own grain stays distinct from the common store.',
};
