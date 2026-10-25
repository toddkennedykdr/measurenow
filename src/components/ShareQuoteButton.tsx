import { useState } from 'react';
import { shareQuote, type SharePayload } from '../shareQuote';

export function ShareQuoteButton({ payload }: { payload: SharePayload }) {
  const [status, setStatus] = useState<'idle' | 'shared' | 'copied' | 'failed'>('idle');
  const fallback = `${payload.text}\n${payload.url}`;

  const onShare = async () => {
    try {
      const result = await shareQuote(payload, {
        share: typeof navigator.share === 'function' ? navigator.share.bind(navigator) : undefined,
        clipboard: navigator.clipboard,
        legacyCopy: (text) => {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.top = '0';
          area.style.left = '0';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.focus();
          area.select();
          const ok = document.execCommand('copy');
          area.remove();
          return ok;
        },
      });
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
