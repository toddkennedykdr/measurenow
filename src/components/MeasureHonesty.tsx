import {
  AI_ESTIMATE_LABEL,
  warningList,
} from '../../server/services/quoteHonesty';

export function AiEstimateLabel() {
  return <span className="ai-estimate-label">{AI_ESTIMATE_LABEL}</span>;
}

export function MeasureWarnings({
  warnings,
}: {
  warnings?: { code?: string; message?: string }[] | null;
}) {
  const items = warningList(warnings);
  if (items.length === 0) return null;
  return (
    <div className="measure-warnings">
      {items.map((warning) => (
        <p key={`${warning.code}:${warning.message}`} className="measure-warning" role="status">
          {warning.message}
        </p>
      ))}
    </div>
  );
}
