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
    'Yusuf chooses to bring out a wooden token. “I promised a neighbour a repair before checking the timber. I used what I had kept for our roof. I blamed a leak in our roof for the shortage. Zehra has not agreed to that choice.” You now know what happened. His debt remains, and the household still disagrees.',
  maryam:
    'Maryam asks for a smooth scrap of wood, then shows you a little puzzle. “I collect these. Not everything needs to feed someone.” She puts the cooking aside for a while. She chooses whether to share her collection. Nobody has to solve a puzzle to receive food.',
  'yusuf-usta':
    'Yusuf Usta, the master craftsman, chooses to unfold his private map. “That passage was unstable. I also kept the shift going to prove another man wrong. Someone was injured. I paid through another person; I never spoke to him.” He has admitted what he did. His admission does not tell you whether the injured worker has forgiven him. His duty to the worker remains.',
  'meryem-visitor':
    'Meryem agrees to show the map she has been working on. “I traced Grandfather’s survey and called it new. I corrected parts, but I did not walk all of this.” She shows two marks in her notebook. One marks what she saw herself. The other marks what she copied. You have heard her story. You still do not know whether the map matches the ground.',
  samira:
    'Samira asks whether you have an empty shell. She then chooses to show you her painted scraps. Each shows the same bowl beside a window, in several uneven colours. “This yellow never came again.” She makes the paint from scraps she is allowed to use. She does not say it is safe to put on skin.',
  danyal:
    'Danyal invites you to fetch an empty jar. “I made that shelf after my wife died. She had asked for it while I kept putting public work first. People say she always supported it. We quarrelled too.” He tells you this without using his wife’s memory to excuse his choices. His own grain stays separate from the shared store.',
};
