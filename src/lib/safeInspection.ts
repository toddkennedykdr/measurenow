export interface SafeFeature {
  type: string;
  count: number;
  location: string;
}

export interface SafeDamage {
  type: string;
  severity: string;
  location: string;
  description: string;
}

export interface SafeInspection {
  roofType: string;
  materialType: string;
  features: SafeFeature[];
  damage: SafeDamage[];
  sidingDamage: SafeDamage[];
  accessIssues: string[];
  recommendations: string[];
  sidingRecommendations: string[];
  sidingMaterial: string;
  sidingRating: string;
  sidingNotes: string;
  overallRating: string;
  overallNotes: string;
  complexityRating: number;
  complexityExplanation: string;
  estimatedFacets: number;
  estimatedRidgeLength: number;
  estimatedValleyLength: number;
  estimatedRakeLength: number;
  estimatedEaveLength: number;
  estimatedDripEdge: number;
  estimatedOpeningsArea: number;
  estimatedTrimLength: number;
  estimatedWallArea: number;
  estimatedStories: number;
  estimatedCorners: { inside: number; outside: number } | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asDamage(value: unknown): SafeDamage[] {
  return asList(value).map((item) => {
    const row = asRecord(item);
    return {
      type: asText(row.type),
      severity: asText(row.severity),
      location: asText(row.location),
      description: asText(row.description),
    };
  }).filter((item) => item.type || item.description);
}

/** Every field the report reads, filled in so a partial analysis cannot throw. */
export function safeInspection(analysis: unknown): SafeInspection {
  const row = asRecord(analysis);
  const material = asRecord(row.material);
  const overall = asRecord(row.overallCondition);
  const siding = asRecord(row.sidingCondition);
  const complexity = asRecord(row.complexity);
  const corners = row.estimatedCorners && typeof row.estimatedCorners === 'object'
    ? asRecord(row.estimatedCorners)
    : null;
  const features = asList(row.features).map((item) => {
    const feature = asRecord(item);
    return {
      type: asText(feature.type),
      count: asNumber(feature.count),
      location: asText(feature.location),
    };
  }).filter((feature) => feature.type);

  return {
    roofType: asText(row.roofType),
    materialType: asText(material.type),
    features,
    damage: asDamage(row.damage),
    sidingDamage: asDamage(row.sidingDamage),
    accessIssues: asList(row.accessIssues).filter((item): item is string => typeof item === 'string'),
    recommendations: asList(row.recommendations).filter((item): item is string => typeof item === 'string'),
    sidingRecommendations: asList(row.sidingRecommendations).filter((item): item is string => typeof item === 'string'),
    sidingMaterial: asText(row.sidingMaterial),
    sidingRating: asText(siding.rating),
    sidingNotes: asText(siding.notes),
    overallRating: asText(overall.rating),
    overallNotes: asText(overall.notes),
    complexityRating: asNumber(complexity.rating),
    complexityExplanation: asText(complexity.explanation),
    estimatedFacets: asNumber(row.estimatedFacets),
    estimatedRidgeLength: asNumber(row.estimatedRidgeLength),
    estimatedValleyLength: asNumber(row.estimatedValleyLength),
    estimatedRakeLength: asNumber(row.estimatedRakeLength),
    estimatedEaveLength: asNumber(row.estimatedEaveLength),
    estimatedDripEdge: asNumber(row.estimatedDripEdge),
    estimatedOpeningsArea: asNumber(row.estimatedOpeningsArea),
    estimatedTrimLength: asNumber(row.estimatedTrimLength),
    estimatedWallArea: asNumber(row.estimatedWallArea),
    estimatedStories: asNumber(row.estimatedStories),
    estimatedCorners: corners
      ? { inside: asNumber(corners.inside), outside: asNumber(corners.outside) }
      : null,
  };
}
