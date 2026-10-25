import type { Response } from 'express';

/** Keep these names in sync with src/publicFormGuard.ts. */
export const HONEYPOT_FIELD = 'contactPref_x';
export const FORM_STARTED_AT_FIELD = 'formStartedAt';

export const MIN_SUBMIT_MS = 2_000;
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
export const CLOCK_SKEW_MS = 5_000;

const KD_PHONE = '919-977-4074';

export const SPAM_HONEYPOT_MESSAGE =
  `We couldn't submit that form. Please try again, or call K&D Roofing at ${KD_PHONE}.`;
export const SPAM_TOO_FAST_MESSAGE =
  `Please wait a moment and try again. If you need a quote right away, call K&D Roofing at ${KD_PHONE}.`;
export const SPAM_RELOAD_MESSAGE =
  `Please reload the page and try again. If you need a quote right away, call K&D Roofing at ${KD_PHONE}.`;
export const LEAD_SAVE_ERROR =
  `We couldn't save your information. Please call K&D Roofing at ${KD_PHONE}.`;

export type SpamCheck = { ok: true } | { ok: false; error: string };

let nowMs: () => number = () => Date.now();

export function setSpamClockForTests(clock: () => number): void {
  nowMs = clock;
}

export function resetSpamClockForTests(): void {
  nowMs = () => Date.now();
}

function isBlankHoneypot(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Hidden field must be empty, and the form must have been open for a short moment. */
export function checkPublicSubmission(body: unknown, now = nowMs()): SpamCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: SPAM_RELOAD_MESSAGE };
  }
  const record = body as Record<string, unknown>;
  if (!isBlankHoneypot(record[HONEYPOT_FIELD])) {
    return { ok: false, error: SPAM_HONEYPOT_MESSAGE };
  }
  const started = record[FORM_STARTED_AT_FIELD];
  if (typeof started !== 'number' || !Number.isFinite(started)) {
    return { ok: false, error: SPAM_RELOAD_MESSAGE };
  }
  if (started > now + CLOCK_SKEW_MS || started < now - MAX_FORM_AGE_MS) {
    return { ok: false, error: SPAM_RELOAD_MESSAGE };
  }
  if (now - started < MIN_SUBMIT_MS) {
    return { ok: false, error: SPAM_TOO_FAST_MESSAGE };
  }
  return { ok: true };
}

/** Sends 400 and returns true when the public form failed the spam checks. */
export function rejectIfSpam(body: unknown, res: Response): boolean {
  const result = checkPublicSubmission(body);
  if (result.ok) return false;
  res.status(400).json({ error: result.error });
  return true;
}
