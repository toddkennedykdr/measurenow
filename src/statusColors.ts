/** Status colors from the K&D sheet. White text on these solids stays above WCAG AA. */
export function severityColor(s: string) {
  if (s === 'major') return '#c62828';
  if (s === 'minor') return '#7a5300';
  return '#166534';
}

export function conditionColor(c: string) {
  if (c === 'poor') return '#c62828';
  if (c === 'fair') return '#7a5300';
  return '#166534';
}

export function complexityColor(rating: number) {
  if (rating >= 4) return '#c62828';
  if (rating >= 3) return '#7a5300';
  return '#166534';
}
