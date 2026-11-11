import type { BuildingRoofData } from './solar';

export interface RoofQuote {
  roofSquares: number;
  totalAreaSqFt: number;
  wasteFactor: number;
  /** GAF Timberline HDZ total. Also copied to lowEstimate for existing readers. */
  hdzEstimate: number;
  /** GAF Timberline UHDZ total. Also copied to highEstimate for existing readers. */
  uhdzEstimate: number;
  hdzPricePerSquare: number;
  uhdzUpgradePerSquare: number;
  uhdzPricePerSquare: number;
  lowEstimate: number;
  highEstimate: number;
  avgPitchDegrees: number;
  pitchOver12: number;
  pitchCategory: string;
  materialNote: string;
}

// GAF Timberline HDZ is $430 per square. Optional UHDZ upgrade is +$40 per square ($470).
// Totals still add 15% waste, and pitch over 35° still adds 10%.
export const HDZ_PRICE_PER_SQUARE = 430;
export const UHDZ_UPGRADE_PER_SQUARE = 40;
export const UHDZ_PRICE_PER_SQUARE = HDZ_PRICE_PER_SQUARE + UHDZ_UPGRADE_PER_SQUARE;
const WASTE_FACTOR = 1.15; // 15% waste
const STEEP_PITCH_THRESHOLD = 35; // degrees
const STEEP_SURCHARGE = 1.10; // 10% surcharge for steep roofs

function roundEstimate(roofSquares: number, pricePerSquare: number, pitchMultiplier: number): number {
  return Math.round(roofSquares * pricePerSquare * pitchMultiplier / 100) * 100;
}

export function calculateQuote(building: BuildingRoofData): RoofQuote {
  const totalWithWaste = building.totalAreaSqFt * WASTE_FACTOR;
  const roofSquares = totalWithWaste / 100; // 1 roofing square = 100 sq ft

  const isSteep = building.avgPitch > STEEP_PITCH_THRESHOLD;
  const pitchMultiplier = isSteep ? STEEP_SURCHARGE : 1.0;

  const hdzEstimate = roundEstimate(roofSquares, HDZ_PRICE_PER_SQUARE, pitchMultiplier);
  const uhdzEstimate = roundEstimate(roofSquares, UHDZ_PRICE_PER_SQUARE, pitchMultiplier);

  let pitchCategory = 'Standard';
  if (building.avgPitch > STEEP_PITCH_THRESHOLD) pitchCategory = 'Steep';
  else if (building.avgPitch < 10) pitchCategory = 'Low';

  // Convert degrees to X/12 pitch format
  const pitchOver12 = Math.round(Math.tan(building.avgPitch * Math.PI / 180) * 12 * 10) / 10;

  return {
    roofSquares: Math.round(roofSquares * 10) / 10,
    totalAreaSqFt: Math.round(building.totalAreaSqFt),
    wasteFactor: WASTE_FACTOR,
    hdzEstimate,
    uhdzEstimate,
    hdzPricePerSquare: HDZ_PRICE_PER_SQUARE,
    uhdzUpgradePerSquare: UHDZ_UPGRADE_PER_SQUARE,
    uhdzPricePerSquare: UHDZ_PRICE_PER_SQUARE,
    lowEstimate: hdzEstimate,
    highEstimate: uhdzEstimate,
    avgPitchDegrees: Math.round(building.avgPitch * 10) / 10,
    pitchOver12,
    pitchCategory,
    materialNote: 'Architectural shingles (30-year warranty), includes tear-off, underlayment, and cleanup',
  };
}
