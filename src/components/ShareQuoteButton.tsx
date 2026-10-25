import { useState } from 'react';
import { shareQuote, type SharePayload } from '../shareQuote';

export function ShareQuoteButton({ payload }: { payload: SharePayload }) {
  const [status, setStatus] = useState<'idle' | 'shared' | 'copied' | 'failed'>('idle');
  const fallback = `${payload.text}\n${payload.url}`;

  const onShare = async () => {
    try {
      const result = await shareQuote(payload, navigator);
      if (result === 'copied') setStatus('copied');
      else if (result === 'shared') setStatus('shared');
      else setStatus('idle');
    } catch {
      setStatus('failed');
    }
  };

  const label = status === 'copied' ? 'Copied' : status === 'shared' ? 'Shared' : 'Share';

  return (
    <div className="share-quote no-print">
      <button type="button" className="btn btn--outline" onClick={onShare}>
        {label}
      </button>
      <p className="share-quote__status" aria-live="polite">
        {status === 'copied' ? 'Copied the quote link.' : status === 'failed' ? 'Copy the quote link below.' : ''}
      </p>
      {status === 'failed' && (
        <textarea
          className="input share-quote__manual"
          readOnly
          rows={4}
          value={fallback}
          aria-label="Quote link"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}
