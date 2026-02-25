import type { QuoteResponse } from '../types';

interface Props {
  name: string;
  data: QuoteResponse;
  onStartOver: () => void;
}

export function ThankYou({ name, data, onStartOver }: Props) {
  const firstName = name.split(' ')[0];
  const formatPrice = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="card">
      <div className="thank-you">
        <div className="thank-you__icon">🏠</div>
        <h2 className="thank-you__title">Thanks, {firstName}!</h2>
        <p className="thank-you__text">
          Your estimated roof replacement cost is{' '}
          <strong>
            {formatPrice(data.quote.lowEstimate)} – {formatPrice(data.quote.highEstimate)}
          </strong>
          .
        </p>
        <p className="thank-you__text">
          A K&amp;D Roofing specialist will reach out within 24 hours to schedule your free
          on-site inspection and provide a detailed written estimate.
        </p>

        <a href="tel:+19195551234" className="thank-you__phone">
          📞 Call Us Now: (919) 555-1234
        </a>

        <div className="next-steps">
          <div className="next-steps__title">What happens next?</div>
          <ul className="next-steps__list">
            <li>We'll call or text you to schedule a free inspection</li>
            <li>Our inspector visits your property (30 min)</li>
            <li>You receive a detailed written estimate within 24 hours</li>
            <li>No pressure — your quote is good for 30 days</li>
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="btn btn--primary" onClick={onStartOver}>
          Get Another Quote
        </button>
      </div>
    </div>
  );
}
