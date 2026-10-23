/** Canonical one-cast-1 content, pending consumption of the published shared registry.
 * This host implements voluntary disclosures through visits, not automatic biographical knowledge.
 * It grants no hidden repair, forgiveness, family outcome or qualification.
 */
import type { PersonSpec } from '@adam0white/human-framework';

const values = {
  benevolence: 0.5,
  universalism: 0.5,
  tradition: 0.5,
  conformity: 0.5,
  security: 0.5,
  achievement: 0.5,
  power: 0.5,
  hedonism: 0.5,
  stimulation: 0.5,
  selfDirection: 0.5,
};
const profiles = {
  yusuf: [
    'hf.cast.yusuf.well',
    {
      honesty: 0.75,
      emotionality: 0.4,
      extraversion: 0.5,
      agreeableness: 0.6,
      conscientiousness: 0.85,
      openness: 0.5,
    },
  ],
  maryam: [
    'hf.cast.maryam.well',
    {
      honesty: 0.8,
      emotionality: 0.6,
      extraversion: 0.6,
      agreeableness: 0.8,
      conscientiousness: 0.8,
      openness: 0.4,
    },
  ],
  'yusuf-usta': [
    'hf.cast.yusuf.warren',
    {
      honesty: 0.75,
      emotionality: 0.45,
      extraversion: 0.5,
      agreeableness: 0.5,
      conscientiousness: 0.7,
      openness: 0.75,
    },
  ],
  'meryem-visitor': [
    'hf.cast.meryem.warren',
    {
      honesty: 0.6,
      emotionality: 0.5,
      extraversion: 0.45,
      agreeableness: 0.55,
      conscientiousness: 0.55,
      openness: 0.85,
    },
  ],
  samira: [
    'hf.cast.samira.well',
    {
      honesty: 0.7,
      emotionality: 0.85,
      extraversion: 0.5,
      agreeableness: 0.7,
      conscientiousness: 0.85,
      openness: 0.5,
    },
  ],
  danyal: [
    'hf.cast.danyal.well',
    {
      honesty: 0.9,
      emotionality: 0.4,
      extraversion: 0.4,
      agreeableness: 0.7,
      conscientiousness: 0.8,
      openness: 0.5,
    },
  ],
} satisfies Record<string, [string, NonNullable<PersonSpec['traits']>]>;

export function canonicalOpening(id: string) {
  const profile = profiles[id as keyof typeof profiles];
  return profile
    ? { castId: profile[0], revision: '1', traits: { ...profile[1] }, values: { ...values } }
    : undefined;
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
