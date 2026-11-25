import { calculateQuote, type RoofQuote } from './pricing';
import { calculateWallArea, type BuildingRoofData } from './solar';

/** Same roof summary POST /api/roof/quote already returns. */
export interface AddressRoofData {
  totalAreaSqFt: number;
  segments: number;
  avgPitchDegrees: number;
  imageryQuality: string;
  footprintSqFt: number;
  estimatedPerimeterFt: number;
  estimatedLength: number;
  estimatedWidth: number;
}

export interface AddressBuildingMeasurements {
  footprintSqFt: number;
  buildingPerimeter: number;
  buildingLength: number;
  buildingWidth: number;
  stories: number;
  wallHeightPerStory: number;
  grossWallArea: number;
  calculatedWallArea: number;
  openingsDeduction: number;
  openingsPercent: number;
  measurementSource: 'satellite';
}

export interface AddressRoofReport {
  roofData: AddressRoofData;
  quote: RoofQuote;
  buildingMeasurements: AddressBuildingMeasurements;
  analysis: null;
}

const DEFAULT_STORIES = 2;
const WALL_HEIGHT_PER_STORY = 9;
const OPENINGS_PERCENT = 15;

/**
 * Roof report from satellite building insights. No photos and no AI.
 * Wall area uses the same footprint math as the photo path, with a
 * 2-story assumption because story count comes from photos.
 */
export function buildAddressRoofReport(building: BuildingRoofData): AddressRoofReport {
  const quote = calculateQuote(building);
  const wallCalc = calculateWallArea(
    building,
    DEFAULT_STORIES,
    WALL_HEIGHT_PER_STORY,
    OPENINGS_PERCENT / 100,
  );

  return {
    analysis: null,
    roofData: {
      totalAreaSqFt: Math.round(building.totalAreaSqFt),
      segments: building.segments.length,
      avgPitchDegrees: Math.round(building.avgPitch * 10) / 10,
      imageryQuality: building.imageryQuality,
      footprintSqFt: building.footprintSqFt,
      estimatedPerimeterFt: building.estimatedPerimeterFt,
      estimatedLength: building.estimatedLength,
      estimatedWidth: building.estimatedWidth,
    },
    quote,
    buildingMeasurements: {
      footprintSqFt: building.footprintSqFt,
      buildingPerimeter: building.estimatedPerimeterFt,
      buildingLength: building.estimatedLength,
      buildingWidth: building.estimatedWidth,
      stories: DEFAULT_STORIES,
      wallHeightPerStory: WALL_HEIGHT_PER_STORY,
      grossWallArea: wallCalc.grossWallArea,
      calculatedWallArea: wallCalc.netSidingArea,
      openingsDeduction: wallCalc.openingsArea,
      openingsPercent: OPENINGS_PERCENT,
      measurementSource: 'satellite',
    },
  };
}
