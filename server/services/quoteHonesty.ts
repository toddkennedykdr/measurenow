/**
 * Honest labels and warnings for roof numbers that come from a model.
 *
 * Thresholds are named constants. A warning is raised only from numbers the
 * caller already has. Missing inputs stay null and produce no warning and
 * no stand-in date or area.
 */

/** Square feet in one square meter. */
export const SQ_M_TO_SQ_FT = 10.764;

/**
 * Feet in one degree of latitude. Matches the footprint estimate in solar.ts.
 * Longitude is scaled by cos(latitude).
 */
export const FT_PER_DEG_LAT = 364_000;

/**
 * Clear gap, in feet, between roof-segment bounding boxes before they count
 * as separate roof structures. Planes on one roof overlap or touch, so their
 * gap is 0. A detached building is usually farther apart than this.
 */
export const SEPARATE_STRUCTURE_GAP_FT = 25;

/** Warn when at least this many separated roof structures come back. */
export const MULTI_STRUCTURE_MIN = 2;

/**
 * The measured roof area is far smaller than a known building size when it
 * is below this fraction of that size. Half means less than half the building.
 */
export const ROOF_AREA_FAR_SMALLER_RATIO = 0.5;

/**
 * A HIGH imagery-quality result is a large miss when the measured roof area
 * differs from another area by more than this fraction of the larger number.
 * A gap of exactly 25% is not treated as a large miss.
 */
export const HIGH_QUALITY_MISS_FRACTION = 0.25;

export const AI_ESTIMATE_LABEL = 'AI estimate';

export const DIAGRAM_ESTIMATE_NOTE = 'Area and pitch in this diagram are an AI estimate.';

export const MULTI_BUILDING_WARNING =
  'This address may include more than one building. Please confirm the measurement is for the building you want.';

export const PARCEL_AREA_WARNING =
  'The roof area is much smaller than the building size on file for this property. Please confirm the measurement before you rely on it.';

export const HIGH_QUALITY_MISS_WARNING =
  'This result is marked high quality, but the roof area does not line up with another area from the same imagery. Please confirm the measurement before you rely on it.';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface ImageryDateParts {
  year: number;
  month?: number;
  day?: number;
}

export interface SegmentBox {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
}

export interface QuoteWarning {
  code: 'multi_building' | 'roof_below_parcel' | 'high_quality_miss';
  message: string;
}

export interface HonestyInput {
  measuredRoofSqFt: number;
  imageryQuality: string;
  /** Solar imageryDate only. Null when that field was not a usable date. */
  imageryDate: ImageryDateParts | null;
  segmentBoxes: SegmentBox[];
  /** wholeRoofStats roof area in sq ft, or null when the response omitted it. */
  wholeRoofAreaSqFt: number | null;
  /** wholeRoofStats ground area in sq ft, or null when the response omitted it. */
  wholeRoofGroundSqFt: number | null;
  /**
   * buildingStats ground area in sq ft. This is the imagery footprint, not a
   * county or parcel record. Null when the response omitted it.
   */
  buildingGroundSqFt: number | null;
  /**
   * County or parcel building size in sq ft. Pass null when the app does not
   * already have that number. This module never looks one up.
   */
  parcelBuildingSqFt: number | null;
}

export interface QuoteHonesty {
  imageryDateLabel: string | null;
  structureCount: number | null;
  warnings: QuoteWarning[];
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Read Solar `imageryDate` ({ year, month, day }). Month or day of 0 means
 * unspecified. A contradictory day is rejected instead of repaired.
 * `imageryProcessedDate` is a different field and is not read here.
 */
export function imageryDateFromSolar(raw: unknown): ImageryDateParts | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { year?: unknown; month?: unknown; day?: unknown };
  const { year, month, day } = record;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1990 || year > 2100) return null;

  const monthGiven = typeof month === 'number' && month !== 0;
  const dayGiven = typeof day === 'number' && day !== 0;
  const monthOk = typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12;
  if (monthGiven && !monthOk) return null;
  if (!monthOk) {
    if (dayGiven) return null;
    return { year };
  }
  if (!dayGiven) return { year, month };
  if (typeof day !== 'number' || !Number.isInteger(day) || !isRealCalendarDay(year, month, day)) return null;
  return { year, month, day };
}

export function formatImageryDate(parts: ImageryDateParts | null | undefined): string | null {
  if (!parts) return null;
  if (parts.month && parts.day) return `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
  if (parts.month) return `${MONTHS[parts.month - 1]} ${parts.year}`;
  return String(parts.year);
}

export function satelliteImageryCaption(label: string | null | undefined): string | null {
  if (typeof label !== 'string' || label.trim() === '') return null;
  return `Satellite imagery: ${label}`;
}

export function squareFeetFromMeters(meters: unknown): number | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) return null;
  return meters * SQ_M_TO_SQ_FT;
}

function finiteCoord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Solar bounding box uses latitude/longitude. Returns null when a corner is missing. */
export function readSegmentBox(raw: unknown): SegmentBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const box = raw as { sw?: { latitude?: unknown; longitude?: unknown }; ne?: { latitude?: unknown; longitude?: unknown } };
  const swLat = finiteCoord(box.sw?.latitude);
  const swLng = finiteCoord(box.sw?.longitude);
  const neLat = finiteCoord(box.ne?.latitude);
  const neLng = finiteCoord(box.ne?.longitude);
  if (swLat === null || swLng === null || neLat === null || neLng === null) return null;
  if (neLat < swLat || neLng < swLng) return null;
  return { sw: { lat: swLat, lng: swLng }, ne: { lat: neLat, lng: neLng } };
}

export function segmentBoxesFromStats(stats: unknown): SegmentBox[] {
  if (!Array.isArray(stats)) return [];
  const boxes: SegmentBox[] = [];
  for (const seg of stats) {
    if (!seg || typeof seg !== 'object') continue;
    const box = readSegmentBox((seg as { boundingBox?: unknown }).boundingBox);
    if (box) boxes.push(box);
  }
  return boxes;
}

function boxGapFt(a: SegmentBox, b: SegmentBox): number {
  const lat = (a.sw.lat + a.ne.lat + b.sw.lat + b.ne.lat) / 4;
  const lngFtPerDeg = FT_PER_DEG_LAT * Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.01);
  const ax0 = a.sw.lng * lngFtPerDeg;
  const ax1 = a.ne.lng * lngFtPerDeg;
  const bx0 = b.sw.lng * lngFtPerDeg;
  const bx1 = b.ne.lng * lngFtPerDeg;
  const ay0 = a.sw.lat * FT_PER_DEG_LAT;
  const ay1 = a.ne.lat * FT_PER_DEG_LAT;
  const by0 = b.sw.lat * FT_PER_DEG_LAT;
  const by1 = b.ne.lat * FT_PER_DEG_LAT;
  const dx = axisGap(ax0, ax1, bx0, bx1);
  const dy = axisGap(ay0, ay1, by0, by1);
  return Math.hypot(dx, dy);
}

function axisGap(a0: number, a1: number, b0: number, b1: number): number {
  const overlapEnd = Math.min(a1, b1);
  const overlapStart = Math.max(a0, b0);
  return overlapStart > overlapEnd ? overlapStart - overlapEnd : 0;
}

/**
 * How many separated roof structures the segment boxes describe.
 * Null when fewer than two boxes were provided, so a normal roof with no
 * boxes is not called a single building or a multi-building lot.
 */
export function countRoofStructures(boxes: SegmentBox[]): number | null {
  if (boxes.length < 2) return null;
  const parent = boxes.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const unite = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[a] = b;
  };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxGapFt(boxes[i], boxes[j]) <= SEPARATE_STRUCTURE_GAP_FT) unite(i, j);
    }
  }
  return new Set(boxes.map((_, index) => find(index))).size;
}

function largeMiss(measured: number, other: number): boolean {
  const larger = Math.max(measured, other);
  if (!(larger > 0)) return false;
  return Math.abs(measured - other) / larger > HIGH_QUALITY_MISS_FRACTION;
}

function otherRoofAreas(input: HonestyInput): number[] {
  const areas: number[] = [];
  if (isPositive(input.wholeRoofAreaSqFt)) areas.push(input.wholeRoofAreaSqFt);
  if (
    isPositive(input.wholeRoofAreaSqFt) &&
    isPositive(input.wholeRoofGroundSqFt) &&
    isPositive(input.buildingGroundSqFt)
  ) {
    const scaled = input.wholeRoofAreaSqFt * (input.buildingGroundSqFt / input.wholeRoofGroundSqFt);
    if (isPositive(scaled)) areas.push(scaled);
  }
  return areas;
}

export function assessQuoteHonesty(input: HonestyInput): QuoteHonesty {
  const structureCount = countRoofStructures(input.segmentBoxes);
  const warnings: QuoteWarning[] = [];

  if (structureCount !== null && structureCount >= MULTI_STRUCTURE_MIN) {
    warnings.push({ code: 'multi_building', message: MULTI_BUILDING_WARNING });
  }

  if (
    isPositive(input.measuredRoofSqFt) &&
    isPositive(input.parcelBuildingSqFt) &&
    input.measuredRoofSqFt < input.parcelBuildingSqFt * ROOF_AREA_FAR_SMALLER_RATIO
  ) {
    warnings.push({ code: 'roof_below_parcel', message: PARCEL_AREA_WARNING });
  }

  const highQuality = input.imageryQuality.trim().toUpperCase() === 'HIGH';
  if (highQuality && isPositive(input.measuredRoofSqFt)) {
    const missed = otherRoofAreas(input).some((area) => largeMiss(input.measuredRoofSqFt, area));
    if (missed) warnings.push({ code: 'high_quality_miss', message: HIGH_QUALITY_MISS_WARNING });
  }

  return {
    imageryDateLabel: formatImageryDate(input.imageryDate),
    structureCount,
    warnings,
  };
}

export function warningList(
  warnings: { code?: string; message?: string }[] | null | undefined,
): { code: string; message: string }[] {
  if (!Array.isArray(warnings)) return [];
  const items: { code: string; message: string }[] = [];
  for (const warning of warnings) {
    if (!warning || typeof warning.message !== 'string' || warning.message.trim() === '') continue;
    const code = typeof warning.code === 'string' && warning.code.trim() !== '' ? warning.code : 'note';
    items.push({ code, message: warning.message });
  }
  return items;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

/** Date line and warnings for the emailed report. Empty when neither applies. */
export function honestyEmailFragment(roofData: {
  imageryDateLabel?: string | null;
  warnings?: { code?: string; message?: string }[] | null;
} | null | undefined): string {
  const caption = satelliteImageryCaption(roofData?.imageryDateLabel);
  const warnings = warningList(roofData?.warnings);
  const parts: string[] = [];
  if (caption) {
    parts.push(`<p style="font-size:13px;color:#374151;margin:8px 0">${escapeHtml(caption)}</p>`);
  }
  for (const warning of warnings) {
    parts.push(
      `<p style="font-size:13px;color:#0a1628;background:#fff8eb;border:1px solid #f5a623;border-radius:8px;padding:8px 12px;margin:8px 0">${escapeHtml(warning.message)}</p>`,
    );
  }
  return parts.join('');
}
