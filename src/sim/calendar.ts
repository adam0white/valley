/**
 * The valley's calendar. Minute 0 is midnight before the first day of play, the 18th of Temmuz (July) in the
 * kahya's first year. Months are named as the valley names them. Weather is pre-rolled per day from the seed.
 */
import { DRAW, hashUnit } from './rng.ts';

export const DAY = 1440;
export const HOUR = 60;
/** Day of the year (0 = 1 January) on which play begins. */
export const START_DOY = 198;
export const YEAR_DAYS = 365;

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];
const MONTH_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const dayOfMinute = (m: number) => Math.floor(m / DAY);
export const minuteOfDay = (m: number) => ((m % DAY) + DAY) % DAY;
/** Day of the year for a play day. */
export const doyOf = (day: number) => (START_DOY + day) % YEAR_DAYS;
/** The kahya's year (1 = the first) for a play day; years turn on 1 January. */
export const yearOf = (day: number) => 1 + Math.floor((START_DOY + day) / YEAR_DAYS);

export function monthDay(doy: number): { month: number; date: number } {
  let d = doy;
  for (let m = 0; m < 12; m++) {
    const len = MONTH_LEN[m] ?? 30;
    if (d < len) return { month: m, date: d + 1 };
    d -= len;
  }
  return { month: 11, date: 31 };
}

/** "the 18th of Temmuz" */
export function dateWords(day: number): string {
  const { month, date } = monthDay(doyOf(day));
  return `${date} ${MONTHS[month]}`;
}
export function monthEnglish(day: number): string {
  return MONTH_EN[monthDay(doyOf(day)).month] ?? '';
}
export function monthName(day: number): string {
  return MONTHS[monthDay(doyOf(day)).month] ?? '';
}

export type Season = 'harvest' | 'threshing' | 'autumn' | 'sowing' | 'winter' | 'spring' | 'summer';

/** The farming season of a day of the year. */
export function seasonOf(doy: number): Season {
  if (doy >= 180 && doy < 216) return 'harvest';
  if (doy >= 216 && doy < 262) return 'threshing';
  if (doy >= 262 && doy < 280) return 'autumn';
  if (doy >= 280 && doy < 318) return 'sowing';
  if (doy >= 318 || doy < 75) return 'winter';
  if (doy >= 75 && doy < 150) return 'spring';
  return 'summer';
}

export type Sky = 'clear' | 'cloud' | 'rain' | 'storm' | 'snow' | 'frost';

/** The weather of a play day: a pure function of seed and day. The second day of play always brings the storm. */
export function weatherOf(seed: number, day: number): { sky: Sky; cold: number } {
  const doy = doyOf(day);
  const s = seasonOf(doy);
  const u = hashUnit(seed, DRAW.weather, day);
  const winter = s === 'winter';
  const cold = winter
    ? 0.6 + 0.4 * hashUnit(seed, DRAW.weather, day, 1)
    : s === 'sowing' || s === 'spring'
      ? 0.3
      : 0;
  if (day === 2) return { sky: 'storm', cold: 0 };
  if (s === 'harvest' || s === 'summer') {
    if (u < 0.035) return { sky: 'storm', cold };
    if (u < 0.12) return { sky: 'rain', cold };
    if (u < 0.3) return { sky: 'cloud', cold };
    return { sky: 'clear', cold };
  }
  if (winter) {
    if (u < 0.3) return { sky: 'snow', cold };
    if (u < 0.55) return { sky: 'frost', cold };
    if (u < 0.75) return { sky: 'cloud', cold };
    return { sky: 'clear', cold };
  }
  if (u < 0.25) return { sky: 'rain', cold };
  if (u < 0.5) return { sky: 'cloud', cold };
  return { sky: 'clear', cold };
}

/** Sunrise and sunset, minutes of day, by day of year (latitude about 39° N, rounded). */
export function daylight(doy: number): { rise: number; set: number } {
  const t = Math.cos(((doy - 172) / YEAR_DAYS) * 2 * Math.PI); // 1 at midsummer, -1 at midwinter
  const half = 6 * 60 + 90 * t + 15; // half the day length
  const noon = 12 * 60 + 20;
  return { rise: Math.round(noon - half), set: Math.round(noon + half) };
}
