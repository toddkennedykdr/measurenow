import { safeInspection } from '../lib/safeInspection';

function severityColor(s: string) {
  if (s === 'major') return '#E2312B';
  if (s === 'minor') return '#ca8a04';
  return '#16a34a';
}

/** Renders whatever fields a photo analysis actually has. Missing fields stay blank. */
export function PartialAnalysisView({ analysis }: { analysis: unknown }) {
  const view = safeInspection(analysis);
  return (
    <div className="partial-analysis">
      {view.roofType ? <p className="partial-analysis__roof-type">{view.roofType}</p> : null}
      {view.materialType ? <p className="partial-analysis__material">{view.materialType}</p> : null}
      {view.overallRating ? (
        <span className="hover-condition-badge">{view.overallRating.toUpperCase()}</span>
      ) : null}
      {view.overallNotes ? <span className="hover-condition-text">{view.overallNotes}</span> : null}
      {view.complexityExplanation ? (
        <span className="hover-complexity__text">
          {view.complexityRating > 0 ? `${view.complexityRating}/5 — ` : ''}
          {view.complexityExplanation}
        </span>
      ) : null}
      {view.features.length > 0 && (
        <div className="hover-badges">
          {view.features.map((feature, i) => (
            <span key={i} className="hover-feature-badge">
              {feature.type} <strong>×{feature.count}</strong>
            </span>
          ))}
        </div>
      )}
      {view.damage.length > 0 && (
        <div className="hover-damage-list">
          {view.damage.map((item, i) => (
            <div key={i} className="hover-damage-item">
              <span className="hover-damage-dot" style={{ background: severityColor(item.severity) }} />
              <div>
                <strong>{item.type}</strong>
                {item.severity ? <span> ({item.severity})</span> : null}
                <div className="hover-damage-desc">{item.description}{item.location ? ` — ${item.location}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {view.sidingDamage.length > 0 && (
        <div className="hover-damage-list">
          {view.sidingDamage.map((item, i) => (
            <div key={i} className="hover-damage-item">
              <strong>{item.type}</strong>
              <div className="hover-damage-desc">{item.description}</div>
            </div>
          ))}
        </div>
      )}
      {view.accessIssues.length > 0 && (
        <div className="hover-badges">
          {view.accessIssues.map((issue, i) => (
            <span key={i} className="hover-feature-badge hover-feature-badge--warn">{issue}</span>
          ))}
        </div>
      )}
      {view.recommendations.length > 0 && (
        <ul className="hover-recs">
          {view.recommendations.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
      {view.sidingRecommendations.length > 0 && (
        <ul className="hover-recs">
          {view.sidingRecommendations.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}
