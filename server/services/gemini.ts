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
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'request failed';
    return unavailable('upstream', `model=${GEMINI_MODEL} request failed: ${message}`);
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

  const blockReason = parsedBody.promptFeedback?.blockReason;
  if (blockReason) {
    return unavailable('upstream', `model=${GEMINI_MODEL} blocked: ${blockReason}`);
  }

  const raw = responseText(parsedBody);
  if (!raw) {
    const finish = parsedBody.candidates?.[0]?.finishReason || 'empty';
    return unavailable('invalid response', `model=${GEMINI_MODEL} empty analysis finish=${finish}`);
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const analysis = JSON.parse(cleaned) as Record<string, unknown>;
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
      return unavailable('invalid response', `model=${GEMINI_MODEL} analysis was not a JSON object`);
    }
    return { ok: true, analysis };
  } catch {
    return unavailable('invalid response', `model=${GEMINI_MODEL} could not parse analysis JSON`);
  }
}
