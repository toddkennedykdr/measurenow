import { useState } from 'react';

/** Keep these names in sync with server/spamGuard.ts. */
export const HONEYPOT_FIELD = 'contactPref_x';
export const FORM_STARTED_AT_FIELD = 'formStartedAt';

export type PublicFormExtras = {
  contactPref_x: string;
  formStartedAt: number;
};

/**
 * One clock per page load. Later steps reuse it, so a fast confirm or
 * lead form does not look like a brand-new visit.
 */
let visitStartedAt: number | undefined;

export function visitFormStartedAt(now = Date.now()): number {
  if (visitStartedAt === undefined) visitStartedAt = now;
  return visitStartedAt;
}

export function usePublicFormGuard(): {
  contactPref: string;
  setContactPref: (value: string) => void;
  extras: PublicFormExtras;
} {
  const startedAt = visitFormStartedAt();
  const [contactPref, setContactPref] = useState('');
  return {
    contactPref,
    setContactPref,
    extras: {
      contactPref_x: contactPref,
      formStartedAt: startedAt,
    },
  };
}
