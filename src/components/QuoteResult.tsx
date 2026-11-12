import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { FullQuoteData } from '../types';
import { KD_CALL, QUOTE_DISCLAIMER } from '../quoteChrome';
import { GAF_CONTRACTOR_ID, GAF_MASTER_ELITE_LABEL, QUOTE_INCLUDES, QUOTE_WARRANTY } from '../quoteIncludes';

interface Props {
  data: FullQuoteData;
  onLeadSubmitted: (name: string) => void;
}

type ShingleOption = 'hdz' | 'uhdz';

function QuoteChoiceDetails() {
  return (
    <div className="quote-choice__details">
      <div className="quote-warranty">
        <p className="quote-warranty__line">
          <strong className="quote-warranty__label">{`${QUOTE_WARRANTY.label} `}</strong>
          {QUOTE_WARRANTY.lines[0]}
        </p>
        {QUOTE_WARRANTY.lines.slice(1).map((line) => (
          <p className="quote-warranty__line" key={line}>{line}</p>
        ))}
      </div>
      <div className="quote-material">
        <div className="quote-material__title">What's included</div>
        <ul className="quote-material__list">
          {QUOTE_INCLUDES.map((item) => (
            <li key={item.text}>
              {item.href && item.linkText ? (
                <>
                  {`${item.text} `}
                  <a href={item.href} target="_blank" rel="noopener noreferrer">{item.linkText}</a>
                </>
              ) : item.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function QuoteResult({ data, onLeadSubmitted }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Display-only. The lead still sends both HDZ and UHDZ totals.
  const [option, setOption] = useState<ShingleOption>('hdz');
  const optionRefs = useRef<Record<ShingleOption, HTMLButtonElement | null>>({ hdz: null, uhdz: null });

  function onOptionsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next: ShingleOption = option === 'hdz' ? 'uhdz' : 'hdz';
    setOption(next);
    optionRefs.current[next]?.focus();
  }

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
          quoteLow: quote.hdzEstimate,
          quoteHigh: quote.uhdzEstimate,
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
        <p className="quote-result__address">{address}</p>

        <div className="quote-stats" role="group" aria-label="Roof measurement">
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

        <h2 id="shingle-options-label" className="quote-result__heading">Shingle options</h2>
        <div
          className="quote-options"
          role="radiogroup"
          aria-labelledby="shingle-options-label"
          onKeyDown={onOptionsKeyDown}
        >
          <div className={option === 'hdz' ? 'quote-choice quote-choice--selected' : 'quote-choice'}>
            <button
              type="button"
              role="radio"
              aria-checked={option === 'hdz'}
              tabIndex={option === 'hdz' ? 0 : -1}
              ref={(node) => { optionRefs.current.hdz = node; }}
              className={option === 'hdz' ? 'quote-option quote-option--selected' : 'quote-option'}
              onClick={() => setOption('hdz')}
            >
              <span className={option === 'hdz' ? 'quote-option__mark quote-option__mark--on' : 'quote-option__mark'}>
                {option === 'hdz' ? 'Selected' : 'Select'}
              </span>
              <span className="quote-option__name">GAF Timberline HDZ</span>
              <span className="quote-result__price">{formatPrice(quote.hdzEstimate)}</span>
              <span className="quote-option__rate">{`$${quote.hdzPricePerSquare}/sq`}</span>
            </button>
            <QuoteChoiceDetails />
          </div>
          <div className={option === 'uhdz' ? 'quote-choice quote-choice--selected' : 'quote-choice'}>
            <button
              type="button"
              role="radio"
              aria-checked={option === 'uhdz'}
              tabIndex={option === 'uhdz' ? 0 : -1}
              ref={(node) => { optionRefs.current.uhdz = node; }}
              className={option === 'uhdz' ? 'quote-option quote-option--selected' : 'quote-option'}
              onClick={() => setOption('uhdz')}
            >
              <span className={option === 'uhdz' ? 'quote-option__mark quote-option__mark--on' : 'quote-option__mark'}>
                {option === 'uhdz' ? 'Selected' : 'Select'}
              </span>
              <span className="quote-option__name">GAF Timberline UHDZ</span>
              <span className="quote-result__price">{formatPrice(quote.uhdzEstimate)}</span>
              <span className="quote-option__rate quote-result__upgrade">
                {`+$${quote.uhdzUpgradePerSquare}/sq ($${quote.uhdzPricePerSquare}/sq)`}
              </span>
            </button>
            <QuoteChoiceDetails />
          </div>
        </div>

        <p className="quote-elite">{GAF_MASTER_ELITE_LABEL}</p>
        <p className="quote-elite__id">{`Contractor ID ${GAF_CONTRACTOR_ID}`}</p>

        <p className="quote-result__disclaimer">{QUOTE_DISCLAIMER}</p>
        <a className="quote-result__call" href={KD_CALL.href} aria-label={KD_CALL.label}>
          <span className="quote-result__call-label">Call K&D Roofing:</span>
          <span className="quote-result__call-number">(919) 977-4074</span>
        </a>

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
            placeholder="Your phone number"
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
