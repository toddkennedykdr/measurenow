import { useState, type FormEvent } from 'react';
import type { QuoteResponse } from '../types';

interface Props {
  onQuoteReceived: (data: QuoteResponse) => void;
}

export function AddressForm({ onQuoteReceived }: Props) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/roof/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      onQuoteReceived(data);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h1 className="card__title">Get Your Instant Roof Quote</h1>
      <p className="card__subtitle">
        Enter your address and get a ballpark estimate in seconds — no appointment needed.
      </p>

      {error && <div className="error-msg">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="address">Property Address</label>
          <input
            id="address"
            type="text"
            className={`input ${error ? 'input--error' : ''}`}
            placeholder="123 Main St, Raleigh, NC 27601"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={loading}
            autoComplete="street-address"
            autoFocus
          />
        </div>

        <button type="submit" className="btn btn--primary" disabled={loading || !address.trim()}>
          {loading && <span className="spinner" />}
          {loading ? 'Analyzing Your Roof...' : 'Get My Free Quote'}
        </button>
      </form>
    </div>
  );
}
