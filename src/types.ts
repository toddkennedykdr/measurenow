export interface QuoteResponse {
  address: string;
  lat: number;
  lng: number;
  streetViewUrl: string;
  roofData: {
    totalAreaSqFt: number;
    segments: number;
    avgPitchDegrees: number;
    imageryQuality: string;
  };
  quote: {
    roofSquares: number;
    totalAreaSqFt: number;
    wasteFactor: number;
    lowEstimate: number;
    highEstimate: number;
    avgPitchDegrees: number;
    pitchCategory: string;
    pitchOver12: number;
    materialNote: string;
  };
}

export type Step = 'address' | 'confirm' | 'quote' | 'thankyou';
