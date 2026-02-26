import { useState, type FormEvent } from 'react';
import type { QuoteResponse } from '../types';

interface Props {
  data: QuoteResponse;
  onLeadSubmitted: (name: string) => void;
}

export function QuoteResult({ data, onLeadSubmitted }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { quote, roofData, address } = data;

  const formatPrice = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/lead/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address,
          quoteLow: quote.lowEstimate,
          quoteHigh: quote.highEstimate,
          roofSqFt: roofData.totalAreaSqFt,
          roofSquares: quote.roofSquares,
          avgPitchDegrees: quote.avgPitchDegrees,
          pitchOver12: quote.pitchOver12,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Something went wrong.');
        return;
      }

      onLeadSubmitted(name.trim());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="quote-result">
        <p className="quote-result__address">📍 {address}</p>

        <div className="quote-result__price">
          {formatPrice(quote.lowEstimate)} – {formatPrice(quote.highEstimate)}
        </div>
        <p className="quote-result__price-label">Estimated roof replacement cost</p>

        <div className="quote-stats">
          <div className="quote-stat">
            <span className="quote-stat__value">{roofData.totalAreaSqFt.toLocaleString()}</span>
            <span className="quote-stat__label">Sq Ft</span>
          </div>
          <div className="quote-stat">
            <span className="quote-stat__value">{quote.roofSquares}</span>
            <span className="quote-stat__label">Squares</span>
          </div>
          <div className="quote-stat">
            <span className="quote-stat__value">{quote.pitchOver12}/12</span>
            <span className="quote-stat__label">{quote.pitchCategory} Pitch</span>
          </div>
        </div>

        <div className="quote-material">
          <strong>Includes:</strong> {quote.materialNote}
        </div>
      </div>

      <div className="divider" />

      <div className="lead-section__title">Want an exact quote?</div>
      <p className="lead-section__subtitle">
        Share your info and we'll follow up with a detailed, no-obligation estimate.
      </p>

      {error && <div className="error-msg">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Full Name</label>
          <input
            id="name"
            type="text"
            className="input"
            placeholder="John Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            autoComplete="name"
          />
        </div>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder="john@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            autoComplete="email"
          />
        </div>
        <div className="form-group">
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            type="tel"
            className="input"
            placeholder="(919) 555-1234"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={loading}
            autoComplete="tel"
          />
        </div>
        <button type="submit" className="btn btn--secondary" disabled={loading}>
          {loading && <span className="spinner" />}
          {loading ? 'Submitting...' : 'Get My Detailed Estimate'}
        </button>
      </form>
    </div>
  );
}
