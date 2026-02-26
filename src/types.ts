export interface GeocodeResponse {
  address: string;
  lat: number;
  lng: number;
}

export interface QuoteResponse {
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
    pitchOver12: number;
    materialNote: string;
  };
}

export interface FullQuoteData extends QuoteResponse {
  address: string;
}

export type Step = 'address' | 'confirm' | 'quote' | 'thankyou';
