/** K&D rebrand danger, warning, and success. White text on each fill meets WCAG AA. */
const POOR = '#c62828';
const FAIR = '#7a5300';
const GOOD = '#166534';

export function conditionColor(rating: string): string {
  if (rating === 'poor') return POOR;
  if (rating === 'fair') return FAIR;
  return GOOD;
}

export function severityColor(severity: string): string {
  if (severity === 'major') return POOR;
  if (severity === 'minor') return FAIR;
  return GOOD;
}
