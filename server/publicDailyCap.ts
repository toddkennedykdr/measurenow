import type { Response } from 'express';

/** Shared budget for public POST /api/roof/geocode and POST /api/roof/quote. */
export const ROOF_PUBLIC_DAILY_CAP_ENV = 'ROOF_PUBLIC_DAILY_CAP';
export const DEFAULT_PUBLIC_DAILY_CAP = 500;
export const PUBLIC_DAILY_CAP_STATUS = 503;
export const PUBLIC_DAILY_CAP_MESSAGE =
  'Our online estimate is busy right now. Please call K&D Roofing at 919-977-4074.';

const EASTERN = 'America/New_York';

let nowMs: () => number = () => Date.now();
let usageDay = '';
let usageCount = 0;

/** Calendar day in America/New_York, `YYYY-MM-DD`. */
export function easternCalendarDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EASTERN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function publicDailyCapLimit(): number {
  const raw = process.env[ROOF_PUBLIC_DAILY_CAP_ENV];
  if (raw === undefined) return DEFAULT_PUBLIC_DAILY_CAP;
  const trimmed = raw.trim();
  // Only a plain non-negative integer. 1e3, 0x10, 5.5, and blanks fall back.
  if (!/^\d+$/.test(trimmed)) return DEFAULT_PUBLIC_DAILY_CAP;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_PUBLIC_DAILY_CAP;
  return parsed;
}

/**
 * Take one slot from today's shared cap. False when the cap is already full.
 * The count is in memory and resets when the Eastern calendar day changes.
 */
export function takePublicDailySlot(): boolean {
  const day = easternCalendarDay(nowMs());
  if (day !== usageDay) {
    usageDay = day;
    usageCount = 0;
  }
  if (usageCount >= publicDailyCapLimit()) return false;
  usageCount += 1;
  return true;
}

/** Fail closed: no upstream call. Returns true when the response was sent. */
export function rejectIfPublicDailyCap(res: Response): boolean {
  if (takePublicDailySlot()) return false;
  res.status(PUBLIC_DAILY_CAP_STATUS).json({ error: PUBLIC_DAILY_CAP_MESSAGE });
  return true;
}

export function setPublicDailyCapClock(clock: () => number): void {
  nowMs = clock;
}

export function resetPublicDailyCapForTests(): void {
  usageDay = '';
  usageCount = 0;
  nowMs = () => Date.now();
}
