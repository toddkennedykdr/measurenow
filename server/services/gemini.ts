import { z } from 'zod';

/**
 * Inspect photo analysis via the Gemini Developer API.
 *
 * GEMINI_API_KEY is only for this call. Roof measurements use
 * GOOGLE_SOLAR_API_KEY (server) and the pin map uses GOOGLE_MAPS_BROWSER_KEY
 * (browser). Those keys are not accepted here.
 *
 * Model: gemini-3.5-flash-lite
 * Checked against Google's model card and pricing (Nov 2026):
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
 * https://ai.google.dev/gemini-api/docs/pricing
 * Stable id, accepts images, and is the cheap fast tier
 * ($0.30 / 1M input tokens, $2.50 / 1M output tokens, including thinking).
 * thinkingLevel MINIMAL keeps photo JSON extraction on that cheap tier.
 * https://ai.google.dev/api/generate-content
 */

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

export const ANALYSIS_UNAVAILABLE_MESSAGE =
  'Photo analysis is unavailable right now. Your roof report from the address is still ready.';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const REQUEST_TIMEOUT_MS = 45_000;

const INSPECTION_PROMPT = `You are an expert roofing and siding inspector analyzing photos of a residential property. Analyze ALL provided photos and return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "roofType": "gable|hip|flat|mansard|gambrel|shed|combination|other",
  "material": { "type": "asphalt shingle|metal|tile|slate|wood shake|flat/TPO|other", "condition": "good|fair|poor" },
  "features": [{ "type": "dormer|skylight|chimney|vent|pipe|satellite dish|gutter|valley|hip ridge|ridge|rake|eave", "count": 1, "location": "description" }],
  "complexity": { "rating": 3, "explanation": "reason" },
  "damage": [{ "type": "missing shingles|cracking|moss/algae|sagging|flashing damage|storm damage|wear", "severity": "none|minor|major", "location": "description", "description": "details" }],
  "accessIssues": ["steep slope", "tall building", "trees close to roof", "power lines nearby"],
  "estimatedStories": 2,
  "overallCondition": { "rating": "good|fair|poor", "notes": "summary" },
  "recommendations": ["recommendation 1", "recommendation 2"],
  "sidingMaterial": "vinyl|HardiBoard/fiber cement|wood|brick|stone|stucco|aluminum|mixed|other",
  "sidingCondition": { "rating": "good|fair|poor", "notes": "description of siding condition" },
  "sidingDamage": [{ "type": "cracking|fading|warping|moisture damage|holes|loose panels|rot|peeling paint", "severity": "none|minor|major", "location": "description", "description": "details" }],
  "estimatedWallArea": 2000,
  "sidingRecommendations": ["recommendation 1", "recommendation 2"],
  "estimatedOpeningsArea": 400,
  "estimatedTrimLength": 200,
  "estimatedRidgeLength": 40,
  "estimatedValleyLength": 30,
  "estimatedRakeLength": 80,
  "estimatedEaveLength": 120,
  "estimatedDripEdge": 200,
  "estimatedCorners": { "inside": 4, "outside": 6 },
  "estimatedFacets": 8
}
MEASUREMENT ESTIMATION GUIDELINES:
- estimatedOpeningsArea: total sq ft of windows and doors visible on the exterior
- estimatedTrimLength: total linear feet of exterior trim (around windows, doors, corners, fascia)
- estimatedRidgeLength: total linear feet of roof ridges (main peak + any secondary ridges)
- estimatedValleyLength: total linear feet of roof valleys
- estimatedRakeLength: total linear feet of rakes (sloped edges of the roof at gable ends)
- estimatedEaveLength: total linear feet of eaves (horizontal edges of the roof)
- estimatedDripEdge: total linear feet of drip edge (perimeter of roof — typically rakes + eaves)
- estimatedCorners: count of inside and outside corners on the building exterior
- estimatedFacets: total number of distinct roof planes/faces
- estimatedWallArea: total exterior wall sq ft based on visible walls, stories, and approximate footprint. For a ~1500 sq ft footprint 2-story house, walls are roughly 2400-3000 sq ft.
Use your best professional judgment for all estimates. If you cannot determine something, use reasonable defaults. Always provide the full structure.`;

const stringSchema = { type: 'STRING' };
const numberSchema = { type: 'NUMBER' };

/** Gemini responseSchema. Required fields match what the report renders. */
export const INSPECTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    roofType: stringSchema,
    material: {
      type: 'OBJECT',
      properties: { type: stringSchema, condition: stringSchema },
      required: ['type', 'condition'],
    },
    features: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { type: stringSchema, count: numberSchema, location: stringSchema },
        required: ['type', 'count', 'location'],
      },
    },
    complexity: {
      type: 'OBJECT',
      properties: { rating: numberSchema, explanation: stringSchema },
      required: ['rating', 'explanation'],
    },
    damage: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: stringSchema,
          severity: stringSchema,
          location: stringSchema,
          description: stringSchema,
        },
        required: ['type', 'severity', 'location', 'description'],
      },
    },
    accessIssues: { type: 'ARRAY', items: stringSchema },
    estimatedStories: numberSchema,
    overallCondition: {
      type: 'OBJECT',
      properties: { rating: stringSchema, notes: stringSchema },
      required: ['rating', 'notes'],
    },
    recommendations: { type: 'ARRAY', items: stringSchema },
    sidingMaterial: stringSchema,
    sidingCondition: {
      type: 'OBJECT',
      properties: { rating: stringSchema, notes: stringSchema },
      required: ['rating', 'notes'],
    },
    sidingDamage: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: stringSchema,
          severity: stringSchema,
          location: stringSchema,
          description: stringSchema,
        },
        required: ['type', 'severity', 'location', 'description'],
      },
    },
    sidingRecommendations: { type: 'ARRAY', items: stringSchema },
    estimatedWallArea: numberSchema,
    estimatedOpeningsArea: numberSchema,
    estimatedTrimLength: numberSchema,
    estimatedRidgeLength: numberSchema,
    estimatedValleyLength: numberSchema,
    estimatedRakeLength: numberSchema,
    estimatedEaveLength: numberSchema,
    estimatedDripEdge: numberSchema,
    estimatedFacets: numberSchema,
    estimatedCorners: {
      type: 'OBJECT',
      properties: { inside: numberSchema, outside: numberSchema },
      required: ['inside', 'outside'],
    },
  },
  required: [
    'roofType',
    'material',
    'features',
    'complexity',
    'damage',
    'accessIssues',
    'overallCondition',
    'recommendations',
    'sidingMaterial',
    'sidingCondition',
    'sidingDamage',
    'sidingRecommendations',
  ],
};

const finiteNumber = z.coerce.number().finite();
const requiredText = z.string().min(1);
const damageItem = z.object({
  type: requiredText,
  severity: z.string(),
  location: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

const inspectionAnalysisSchema = z.object({
  roofType: requiredText,
  material: z.object({
    type: requiredText,
    condition: requiredText,
  }),
  features: z.array(z.object({
    type: requiredText,
    count: finiteNumber,
    location: z.string().optional().default(''),
  })),
  complexity: z.object({
    rating: finiteNumber,
    explanation: z.string(),
  }),
  damage: z.array(damageItem),
  accessIssues: z.array(z.string()),
  estimatedStories: finiteNumber.optional(),
  overallCondition: z.object({
    rating: requiredText,
    notes: z.string(),
  }),
  recommendations: z.array(z.string()),
  sidingMaterial: requiredText,
  sidingCondition: z.object({
    rating: requiredText,
    notes: z.string(),
  }),
  sidingDamage: z.array(damageItem),
  sidingRecommendations: z.array(z.string()),
  estimatedWallArea: finiteNumber.optional(),
  estimatedOpeningsArea: finiteNumber.optional(),
  estimatedTrimLength: finiteNumber.optional(),
  estimatedRidgeLength: finiteNumber.optional(),
  estimatedValleyLength: finiteNumber.optional(),
  estimatedRakeLength: finiteNumber.optional(),
  estimatedEaveLength: finiteNumber.optional(),
  estimatedDripEdge: finiteNumber.optional(),
  estimatedFacets: finiteNumber.optional(),
  estimatedCorners: z.object({
    inside: finiteNumber,
    outside: finiteNumber,
  }).optional(),
});

/** Accept a complete analysis and coerce numeric strings. Reject partial or mis-typed JSON. */
export function normalizeInspectionAnalysis(value: unknown): Record<string, unknown> | null {
  const parsed = inspectionAnalysisSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export interface GeminiImage {
  mimeType: string;
  dataBase64: string;
}

export type GeminiAnalysisResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; userMessage: string };

interface GeminiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiSuccessBody {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiPart[] };
  }>;
  promptFeedback?: { blockReason?: string };
}

function geminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

/** Drop known server keys so a provider echo cannot land in logs. */
export function redactSecrets(text: string): string {
  let out = text;
  const secrets = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_SOLAR_API_KEY,
    process.env.GOOGLE_MAPS_BROWSER_KEY,
  ];
  for (const secret of secrets) {
    const trimmed = secret?.trim() ?? '';
    if (trimmed.length < 4) continue;
    out = out.split(trimmed).join('[redacted]');
  }
  return out;
}

function classifyProviderFailure(status: number, errorStatus: string, message: string): string {
  const blob = `${errorStatus} ${message}`.toUpperCase();
  if (status === 404 || blob.includes('NOT_FOUND') || blob.includes('NOT FOUND')) {
    return 'model not found';
  }
  if (
    status === 429 ||
    blob.includes('RESOURCE_EXHAUSTED') ||
    blob.includes('QUOTA') ||
    blob.includes('RATE_LIMIT')
  ) {
    return 'quota';
  }
  if (
    status === 401 ||
    status === 403 ||
    blob.includes('API KEY') ||
    blob.includes('API_KEY') ||
    blob.includes('PERMISSION_DENIED') ||
    blob.includes('UNAUTHENTICATED')
  ) {
    return 'bad key';
  }
  return 'upstream';
}

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message);
}

function unavailable(reason: string, detail: string): GeminiAnalysisResult {
  console.error(`Gemini API error (${reason}): ${redactSecrets(detail)}`);
  return { ok: false, userMessage: ANALYSIS_UNAVAILABLE_MESSAGE };
}

function responseText(body: GeminiSuccessBody): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();
}

export async function analyzeInspectionPhotos(input: {
  images: GeminiImage[];
  address: string;
  lat: number;
  lng: number;
}): Promise<GeminiAnalysisResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    return unavailable(
      'missing key',
      'GEMINI_API_KEY is not set. Photo analysis was skipped. This key is separate from GOOGLE_SOLAR_API_KEY and GOOGLE_MAPS_BROWSER_KEY.',
    );
  }

  const where = input.address || `${input.lat}, ${input.lng}`;
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `Analyze these ${input.images.length} photos of a property at ${where}. Provide a detailed roofing AND siding inspection analysis.`,
    },
    ...input.images.map((image) => ({
      inlineData: { mimeType: image.mimeType, data: image.dataBase64 },
    })),
  ];

  let response: Response;
  try {
    response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSPECTION_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: INSPECTION_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'request failed';
    const reason = isTimeout(err) ? 'timeout' : 'upstream';
    return unavailable(reason, `model=${GEMINI_MODEL} request failed: ${message}`);
  }

  const rawBody = await response.text();
  if (!response.ok) {
    let errorStatus = '';
    let message = rawBody.slice(0, 500);
    try {
      const parsed = JSON.parse(rawBody) as GeminiErrorBody;
      errorStatus = parsed.error?.status || '';
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // Non-JSON error bodies are logged as a short snippet only.
    }
    const reason = classifyProviderFailure(response.status, errorStatus, message);
    return unavailable(
      reason,
      `model=${GEMINI_MODEL} http=${response.status} status=${errorStatus || 'unknown'} message=${message}`,
    );
  }

  let parsedBody: GeminiSuccessBody;
  try {
    parsedBody = JSON.parse(rawBody) as GeminiSuccessBody;
  } catch {
    return unavailable('invalid response', `model=${GEMINI_MODEL} response was not JSON`);
  }

  const finishReason = parsedBody.candidates?.[0]?.finishReason;
  const blockReason = parsedBody.promptFeedback?.blockReason
    || (finishReason === 'SAFETY' ? 'SAFETY' : '');
  if (blockReason) {
    return unavailable('safety block', `model=${GEMINI_MODEL} blockReason=${blockReason}`);
  }

  const raw = responseText(parsedBody);
  if (!raw) {
    const finish = parsedBody.candidates?.[0]?.finishReason || 'empty';
    return unavailable('invalid response', `model=${GEMINI_MODEL} empty analysis finish=${finish}`);
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return unavailable('invalid response', `model=${GEMINI_MODEL} could not parse analysis JSON`);
  }
  const analysis = normalizeInspectionAnalysis(parsed);
  if (!analysis) {
    return unavailable('invalid response', `model=${GEMINI_MODEL} analysis failed validation`);
  }
  return { ok: true, analysis };
}
