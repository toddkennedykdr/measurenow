import { useRef, useState } from 'react';

/** Keep these names in sync with server/spamGuard.ts. */
export const HONEYPOT_FIELD = 'companyWebsite';
export const FORM_STARTED_AT_FIELD = 'formStartedAt';

export type PublicFormExtras = {
  companyWebsite: string;
  formStartedAt: number;
};

/** Clock starts when the form mounts. The server rejects an instant submit. */
export function usePublicFormGuard(): {
  companyWebsite: string;
  setCompanyWebsite: (value: string) => void;
  extras: PublicFormExtras;
} {
  const startedAt = useRef(Date.now()).current;
  const [companyWebsite, setCompanyWebsite] = useState('');
  return {
    companyWebsite,
    setCompanyWebsite,
    extras: {
      companyWebsite,
      formStartedAt: startedAt,
    },
  };
}
