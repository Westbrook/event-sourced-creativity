/** Shared values used by the real request builders and read-only admission
 * evidence. This extraction changes no request fields, ordering, or defaults.
 * The moderation count/input describe the text-only Image route; other callers
 * still moderate every selected reference separately. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export const OPENAI_IMAGE_DIRECTION_SCHEMA = freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "rationale", "scene", "palette", "next_moves"],
  properties: {
    title: { type: "string" }, rationale: { type: "string" }, scene: { type: "string" },
    palette: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    next_moves: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
  },
} as const);

export const OPENAI_IMAGE_DIRECTION_CONTRACT = freeze({
  api: "https://api.openai.com/v1/responses",
  text: { verbosity: "low", format: { type: "json_schema", name: "forma_creative_direction", strict: true, schema: OPENAI_IMAGE_DIRECTION_SCHEMA } },
  reasoning: { effort: "low" }, maximumOutputTokens: 1200, store: false,
} as const);
export const OPENAI_IMAGE_GENERATION_CONTRACT = freeze({
  api: "https://api.openai.com/v1/images/generations",
  defaults: { model: "gpt-image-2.5-sunburst", quality: "high", size: "1536x1024", outputFormat: "png", outputCompression: 100, partialImages: 0 },
  outputCount: 1,
} as const);
export const OPENAI_IMAGE_MODERATION_CONTRACT = freeze({
  api: "https://api.openai.com/v1/moderations", model: "omni-moderation-latest", maximumCalls: 1, input: "text",
} as const);
