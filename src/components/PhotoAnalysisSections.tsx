import { clampComplexityRating, type SafeDamage, type SafeFeature, type SafeInspection } from '../lib/safeInspection';

export function conditionBadgeClass(rating: string, base: string): string {
  const kind = rating.toLowerCase();
  if (kind === 'good' || kind === 'fair' || kind === 'poor') return `${base} ${base}--${kind}`;
  return base;
}

function severityColor(severity: string) {
  if (severity === 'major') return '#E2312B';
  if (severity === 'minor') return '#ca8a04';
  return '#16a34a';
}

export function SidingDamageList({ items }: { items: SafeDamage[] }) {
  if (!items.length) return null;
  return (
    <div className="hover-damage-list">
      {items.map((item, i) => (
        <div key={i} className="hover-damage-item">
          <span className="hover-damage-dot" style={{ background: severityColor(item.severity) }} />
          <div>
            <strong>{item.type}</strong>{' '}
            <span className="hover-damage-sev" style={{ color: severityColor(item.severity) }}>({item.severity})</span>
            <div className="hover-damage-desc">{item.description}{item.location ? ` — ${item.location}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeatureList({ features }: { features: SafeFeature[] }) {
  if (!features.length) return null;
  return (
    <>
      <h4 className="hover-table-title">Features Detected</h4>
      <div className="hover-badges">
        {features.map((feature, i) => (
          <span key={i} className="hover-feature-badge">
            {feature.type} <strong>×{feature.count}</strong>
          </span>
        ))}
      </div>
    </>
  );
}

/** Labeled photo-analysis sections. One condition line, separate recommendation lists. */
export function AiInspectionNotes({ view }: { view: SafeInspection }) {
  return (
    <div className="card hover-section photo-analysis-notes">
      <h2 className="hover-section__title">AI Inspection Notes</h2>
      <div className="hover-condition-block">
        {view.overallRating ? (
          <span className={conditionBadgeClass(view.overallRating, 'hover-condition-badge')}>
            {view.overallRating.toUpperCase()}
          </span>
        ) : null}
        <span className="hover-condition-text">{view.overallNotes}</span>
      </div>
      <div className="hover-complexity">
        <span className="hover-complexity__label">Complexity Rating</span>
        <div className="hover-complexity__bar">
          {[1, 2, 3, 4, 5].map((n) => {
            const rating = clampComplexityRating(view.complexityRating);
            const active = n <= rating;
            return (
              <div
                key={n}
                className={`hover-complexity__segment ${active ? 'hover-complexity__segment--active' : ''}`}
                style={{ background: active ? (rating >= 4 ? '#E2312B' : rating >= 3 ? '#ca8a04' : '#16a34a') : undefined }}
              />
            );
          })}
        </div>
        <span className="hover-complexity__text">
          {`${clampComplexityRating(view.complexityRating)}/5`}
          {view.complexityExplanation ? ` — ${view.complexityExplanation}` : ''}
        </span>
      </div>
      {view.damage.length > 0 && (
        <>
          <h4 className="hover-table-title">Roof Damage Findings</h4>
          <div className="hover-damage-list">
            {view.damage.map((item, i) => (
              <div key={i} className="hover-damage-item">
                <span className="hover-damage-dot" style={{ background: severityColor(item.severity) }} />
                <div>
                  <strong>{item.type}</strong>{' '}
                  <span className="hover-damage-sev" style={{ color: severityColor(item.severity) }}>({item.severity})</span>
                  <div className="hover-damage-desc">{item.description}{item.location ? ` — ${item.location}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {view.accessIssues.length > 0 && (
        <>
          <h4 className="hover-table-title">⚠️ Access Issues</h4>
          <div className="hover-badges">
            {view.accessIssues.map((issue, i) => (
              <span key={i} className="hover-feature-badge hover-feature-badge--warn">{issue}</span>
            ))}
          </div>
        </>
      )}
      {view.recommendations.length > 0 && (
        <>
          <h4 className="hover-table-title">Recommendations</h4>
          <ul className="hover-recs">
            {view.recommendations.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </>
      )}
      {view.sidingRecommendations.length > 0 && (
        <>
          <h4 className="hover-table-title">Siding Recommendations</h4>
          <ul className="hover-recs">
            {view.sidingRecommendations.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
