import { useState } from 'react';
import type { QuoteResponse } from '../types';

interface Props {
  data: QuoteResponse;
  onConfirm: () => void;
  onReject: () => void;
}

export function ConfirmAddress({ data, onConfirm, onReject }: Props) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="card">
      <h1 className="card__title">Is this your home?</h1>
      <p className="card__subtitle">📍 {data.address}</p>

      <div className="confirm-image-wrapper">
        {imgError ? (
          <div className="confirm-image-error">
            <p>📷 Street View image unavailable for this address.</p>
            <p style={{ fontSize: 12, marginTop: 8, color: 'var(--gray-500)' }}>
              This may happen if Google Street View hasn't covered this area yet.
              You can still proceed if the address above looks correct.
            </p>
          </div>
        ) : (
          <img
            src={data.streetViewUrl}
            alt={`Street view of ${data.address}`}
            className="confirm-image"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      <div className="confirm-buttons">
        <button className="btn btn--primary" onClick={onConfirm}>
          Yes, that's my home!
        </button>
        <button className="btn btn--outline" onClick={onReject}>
          No, let me re-enter my address
        </button>
      </div>
    </div>
  );
}
