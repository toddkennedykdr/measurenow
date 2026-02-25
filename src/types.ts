export interface QuoteResponse {
  address: string;
  lat: number;
  lng: number;
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
    materialNote: string;
  };
}

export type Step = 'address' | 'quote' | 'thankyou';
