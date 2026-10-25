/** Customer copy when geocoding or Solar cannot be reached. */
export const MAP_SERVICE_ERROR =
  "We couldn't reach the map service. Please try again or call K&D Roofing at 919-977-4074.";

/** Thrown only for an upstream failure, never for a genuine empty result. */
export class MapServiceError extends Error {
  constructor() {
    super(MAP_SERVICE_ERROR);
    this.name = 'MapServiceError';
  }
}
