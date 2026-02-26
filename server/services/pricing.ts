import type { BuildingRoofData } from './solar';

export interface RoofQuote {
  roofSquares: number;
  totalAreaSqFt: number;
  wasteFactor: number;
  lowEstimate: number;
  highEstimate: number;
  avgPitchDegrees: number;
  pitchCategory: string;
  materialNote: string;
}

// K&D Pricing: $350-$450 per square installed (architectural shingles)
const PRICE_PER_SQUARE_LOW = 450;
const PRICE_PER_SQUARE_HIGH = 555;
const WASTE_FACTOR = 1.15; // 15% waste
const STEEP_PITCH_THRESHOLD = 35; // degrees
const STEEP_SURCHARGE = 1.10; // 10% surcharge for steep roofs

export function calculateQuote(building: BuildingRoofData): RoofQuote {
  const totalWithWaste = building.totalAreaSqFt * WASTE_FACTOR;
  const roofSquares = totalWithWaste / 100; // 1 roofing square = 100 sq ft

  const isSteep = building.avgPitch > STEEP_PITCH_THRESHOLD;
  const pitchMultiplier = isSteep ? STEEP_SURCHARGE : 1.0;

  const lowEstimate = Math.round(roofSquares * PRICE_PER_SQUARE_LOW * pitchMultiplier / 100) * 100;
  const highEstimate = Math.round(roofSquares * PRICE_PER_SQUARE_HIGH * pitchMultiplier / 100) * 100;

  let pitchCategory = 'Standard';
  if (building.avgPitch > STEEP_PITCH_THRESHOLD) pitchCategory = 'Steep';
  else if (building.avgPitch < 10) pitchCategory = 'Low';

  return {
    roofSquares: Math.round(roofSquares * 10) / 10,
    totalAreaSqFt: Math.round(building.totalAreaSqFt),
    wasteFactor: WASTE_FACTOR,
    lowEstimate,
    highEstimate,
    avgPitchDegrees: Math.round(building.avgPitch * 10) / 10,
    pitchCategory,
    materialNote: 'Architectural shingles (30-year warranty), includes tear-off, underlayment, and cleanup',
  };
}
