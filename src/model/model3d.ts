/** Rodin v2.5's fal wrapper contract, checked against both OpenAPI schemas 2026-08-31. */
export const RODIN_TEXT_MODEL = "fal-ai/hyper3d/rodin/v2.5/text-to-3d" as const;
export const RODIN_IMAGE_MODEL = "fal-ai/hyper3d/rodin/v2.5" as const;
export type RodinModelId = typeof RODIN_TEXT_MODEL | typeof RODIN_IMAGE_MODEL;
export const RODIN_ADAPTER_VERSION = "fal-rodin-v2.5-2026-08-31";
export const RODIN_PROMPT_MAX_CHARS = 1024;
export const RODIN_MAX_IMAGE_REFERENCES = 5;
/** Application transfer policy; the provider publishes no matching output byte limit. */
export const MODEL3D_PRIVATE_TRANSFER_MAX_BYTES = 64 * 1024 * 1024;
export const MODEL3D_FORMATS = ["glb", "usdz", "fbx", "obj", "stl"] as const;
export type Model3dFormat = typeof MODEL3D_FORMATS[number];
export const RODIN_TIERS = ["Gen-2.5-Minimum", "Gen-2.5-Extreme-Low", "Gen-2.5-Low", "Gen-2.5-Medium", "Gen-2.5-High", "Gen-2.5-Extreme-High"] as const;
export const RODIN_MATERIALS = ["PBR", "Shaded", "All", "None"] as const;
export const RODIN_QUALITY_MESH_OPTIONS = ["Auto", "4K Quad", "8K Quad", "18K Quad", "50K Quad", "100K Quad", "200K Quad", "2K Triangle", "20K Triangle", "50K Triangle", "150K Triangle", "500K Triangle", "1M Triangle", "2M Triangle"] as const;
export const RODIN_TEXTURE_MODES = ["auto", "legacy", "extreme-low", "low", "medium", "high"] as const;
export const RODIN_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type RodinTier = typeof RODIN_TIERS[number];
export type Model3dSettings = {
  tier: RodinTier;
  geometry_file_format: Model3dFormat;
  material: typeof RODIN_MATERIALS[number];
  quality_mesh_option: typeof RODIN_QUALITY_MESH_OPTIONS[number];
  /** App-only sentinel: omit texture_mode entirely when this is auto. */
  texture_mode: typeof RODIN_TEXTURE_MODES[number];
  seed: number | null;
  enable_creative_mode: boolean;
  hd_texture: boolean;
  texture_delight: boolean;
  is_micro: boolean;
  TAPose: boolean;
  use_original_alpha: boolean;
  preview_render: boolean;
  bbox_condition: { width: number; height: number; length: number } | null;
  addons: { high_pack: boolean };
};

export const DEFAULT_MODEL3D_SETTINGS: Readonly<Model3dSettings> = Object.freeze({
  tier: "Gen-2.5-High", geometry_file_format: "glb", material: "All", quality_mesh_option: "Auto", texture_mode: "auto", seed: null,
  enable_creative_mode: false, hd_texture: false, texture_delight: false, is_micro: false, TAPose: false,
  use_original_alpha: false, preview_render: false, bbox_condition: null, addons: Object.freeze({ high_pack: false }),
});

export const MODEL3D_FORMAT_MIME_TYPES: Readonly<Record<Model3dFormat, string>> = {
  glb: "model/gltf-binary", usdz: "model/vnd.usdz+zip", fbx: "application/octet-stream", obj: "model/obj", stl: "model/stl",
};

export const RODIN_GUIDANCE = [
  "Describe one subject in 1,024 characters or fewer. Review the exact submitted prompt before generating.",
  "For image guidance, select one to five views of the subject. The first reference guides the materials.",
  "JPG, PNG, and WebP are supported. Clear subject visibility and consistent views can improve the result.",
  "Provider content checks apply to prompts and images, including the image created internally from a text prompt. Acceptance cannot be guaranteed.",
  "Existing 3D models guide a new generation through saved image views; Rodin does not accept a mesh as an input.",
] as const;

export type Model3dValidationIssue = { code: string; field: string; message: string; values?: Record<string, string | number> };
export type Model3dPreflight = {
  valid: boolean;
  issues: Model3dValidationIssue[];
  warnings: string[];
  promptCharacters: number;
  model: RodinModelId;
  settings: Model3dSettings;
  estimatedCostMicrousd: number;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isRecord = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Fill absent settings only. Preserve invalid authored values so preflight can explain them. */
export function normalizeModel3dSettings(value?: unknown): Model3dSettings {
  const source = record(value);
  const result: Record<string, unknown> = { ...DEFAULT_MODEL3D_SETTINGS, ...source };
  for (const key of Object.keys(DEFAULT_MODEL3D_SETTINGS)) if (result[key] === undefined) result[key] = DEFAULT_MODEL3D_SETTINGS[key as keyof Model3dSettings];
  if (!Object.hasOwn(source, "addons") || source.addons === undefined) result.addons = { high_pack: false };
  else if (isRecord(source.addons)) result.addons = { high_pack: false, ...record(source.addons) };
  return result as Model3dSettings;
}

/** JSON Schema maxLength counts Unicode code points, not UTF-16 code units. */
export function model3dPromptLength(prompt: string) { return Array.from(prompt).length; }
export function rodinModelForReferences(referenceCount: number): RodinModelId { return referenceCount > 0 ? RODIN_IMAGE_MODEL : RODIN_TEXT_MODEL; }
export function isRodinModel(value: unknown): value is RodinModelId { return value === RODIN_TEXT_MODEL || value === RODIN_IMAGE_MODEL; }
export function isModel3dFormat(value: unknown): value is Model3dFormat { return (MODEL3D_FORMATS as readonly unknown[]).includes(value); }

function isRodinImageUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}

/** fal's published USD rates, including its documented Extreme-High multiplier. */
export function estimateModel3dCostMicrousd(input?: unknown) {
  const settings = normalizeModel3dSettings(input);
  return (settings.tier === "Gen-2.5-Extreme-High" ? 800_000 : 400_000) + (settings.addons?.high_pack === true ? 800_000 : 0);
}

export function validateModel3dRequest(input: {
  prompt: unknown;
  settings?: unknown;
  referenceCount?: number;
  referenceMimeTypes?: readonly string[];
  mode?: "text" | "image";
}): Model3dPreflight {
  const settings = normalizeModel3dSettings(input.settings);
  const issues: Model3dValidationIssue[] = [];
  const warnings: string[] = [];
  const issue = (code: string, field: string, message: string, values?: Record<string, string | number>) => issues.push({ code, field, message, ...(values ? { values } : {}) });
  const count = input.referenceCount ?? input.referenceMimeTypes?.length ?? 0;
  const imageMode = input.mode === "image" || input.mode !== "text" && count > 0;
  const model = imageMode ? RODIN_IMAGE_MODEL : RODIN_TEXT_MODEL;
  const promptCharacters = typeof input.prompt === "string" ? model3dPromptLength(input.prompt) : 0;
  if (typeof input.prompt !== "string") issue("model3d_prompt_invalid", "prompt", "Write the exact text to send to Rodin.");
  else {
    if (!imageMode && !input.prompt.trim()) issue("model3d_prompt_required", "prompt", "Describe the 3D subject, or select at least one image reference.");
    if (promptCharacters > RODIN_PROMPT_MAX_CHARS) issue("model3d_prompt_too_long", "prompt", `The prepared 3D prompt has ${promptCharacters.toLocaleString("en-US")} characters. Shorten it to ${RODIN_PROMPT_MAX_CHARS.toLocaleString("en-US")} or fewer; your text will not be truncated.`, { count: promptCharacters, limit: RODIN_PROMPT_MAX_CHARS });
  }
  if (!Number.isInteger(count) || count < 0 || count > RODIN_MAX_IMAGE_REFERENCES || imageMode && count === 0) issue("model3d_reference_count", "references", "Image-to-3D accepts one to five ordered image references. Choose the views to send before generating.");
  if (input.mode === "text" && count > 0) issue("model3d_text_images_unsupported", "references", "Use image-to-3D when sending image references.");
  if (input.referenceMimeTypes) {
    if (input.referenceMimeTypes.length !== count) issue("model3d_reference_count_mismatch", "references", "The selected reference count does not match the prepared images.");
    input.referenceMimeTypes.forEach((mime, index) => {
      if (!(RODIN_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) issue("model3d_reference_format", `references.${index}`, "Use a JPG, PNG, or WebP image. Save a view of a 3D model before using it as a reference.");
    });
  }
  if (input.settings !== undefined && !isRecord(input.settings)) issue("model3d_settings_invalid", "settings", "The 3D settings must be an object.");
  for (const key of Object.keys(record(input.settings))) if (!Object.hasOwn(DEFAULT_MODEL3D_SETTINGS, key)) issue("model3d_setting_unsupported", key, `Rodin v2.5 does not accept the setting “${key}”. Remove it before generating.`, { field: key });
  const enums: Array<[keyof Model3dSettings, readonly unknown[]]> = [
    ["tier", RODIN_TIERS], ["geometry_file_format", MODEL3D_FORMATS], ["material", RODIN_MATERIALS],
    ["quality_mesh_option", RODIN_QUALITY_MESH_OPTIONS], ["texture_mode", RODIN_TEXTURE_MODES],
  ];
  for (const [key, values] of enums) if (!values.includes(settings[key])) issue("model3d_setting_enum_invalid", key, `Choose a supported ${key.replaceAll("_", " ")} value.`, { field: key });
  const booleans = ["enable_creative_mode", "hd_texture", "texture_delight", "is_micro", "TAPose", "use_original_alpha", "preview_render"] as const;
  for (const key of booleans) if (typeof settings[key] !== "boolean") issue("model3d_setting_boolean_invalid", key, `Set ${key.replaceAll("_", " ")} to on or off.`, { field: key });
  if (settings.seed !== null && (!Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > 65535)) issue("model3d_seed_invalid", "seed", "Choose a whole-number seed from 0 to 65,535, or leave it empty for a random seed.");
  if (!isRecord(settings.addons) || typeof settings.addons?.high_pack !== "boolean") issue("model3d_addons_invalid", "addons.high_pack", "Set HighPack to on or off.");
  for (const key of Object.keys(record(settings.addons))) if (key !== "high_pack") issue("model3d_addon_unsupported", `addons.${key}`, "HighPack is the only add-on exposed by these fal Rodin endpoints.");
  if (settings.bbox_condition !== null) {
    if (!isRecord(settings.bbox_condition)) issue("model3d_bbox_object_invalid", "bbox_condition", "Provide width, height, and length together, or disable the bounding box.");
    for (const axis of ["width", "height", "length"] as const) {
      const value = record(settings.bbox_condition)[axis];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2048) issue("model3d_bbox_dimension_invalid", `bbox_condition.${axis}`, "Each bounding-box dimension must be a whole number from 1 to 2,048. The provider does not specify physical units.");
    }
    for (const key of Object.keys(record(settings.bbox_condition))) if (!["width", "height", "length"].includes(key)) issue("model3d_bbox_field_unsupported", `bbox_condition.${key}`, "The bounding box accepts width, height, and length only.");
  }
  const highTier = settings.tier === "Gen-2.5-High" || settings.tier === "Gen-2.5-Extreme-High";
  if (settings.quality_mesh_option === "2M Triangle" && !highTier && settings.tier !== "Gen-2.5-Minimum") issue("model3d_mesh_maximum_for_tier", "quality_mesh_option", "2M Triangle requires the High or Extreme-High tier. Choose up to 1M Triangle for this tier.");
  if (settings.quality_mesh_option === "2K Triangle" && highTier) issue("model3d_mesh_minimum_for_tier", "quality_mesh_option", "The fal contract documents at least 20K Triangle for High and Extreme-High. Choose 20K Triangle or higher, or Auto.");
  if (settings.tier === "Gen-2.5-Minimum" && !["Auto", "50K Triangle"].includes(settings.quality_mesh_option)) warnings.push("Minimum tier always produces 50K Triangle; the provider overrides the selected mesh setting.");
  if (settings.enable_creative_mode && !["Gen-2.5-Medium", "Gen-2.5-High", "Gen-2.5-Extreme-High"].includes(settings.tier)) issue("model3d_creative_tier_mismatch", "enable_creative_mode", "Creative mode requires Medium, High, or Extreme-High. Turn it off for this tier.");
  if (settings.is_micro && settings.tier !== "Gen-2.5-Extreme-High") issue("model3d_micro_tier_mismatch", "is_micro", "Micro detail requires Extreme-High. Turn it off or change the tier.");
  if (!imageMode && settings.use_original_alpha) issue("model3d_alpha_requires_image", "use_original_alpha", "Original transparency is available only with image references.");
  if (!imageMode && settings.preview_render) issue("model3d_preview_requires_image", "preview_render", "The fal preview-render parameter is available only on image-to-3D. Turn it off for text-to-3D; a saved GLB view can provide a preview.");
  if (settings.addons?.high_pack && settings.material === "None") warnings.push("HighPack adds a texture charge, but geometry-only material does not include textures. Turn off HighPack to avoid that add-on cost.");
  if (settings.tier === "Gen-2.5-Extreme-High" || ["1M Triangle", "2M Triangle"].includes(settings.quality_mesh_option) || settings.addons?.high_pack) warnings.push("Forma transfers individual files up to 64 MiB. Higher-detail settings can exceed this app limit; start with High and Auto mesh settings, with HighPack off. Original provider files and the paid receipt are retained if a file exceeds the limit.");
  if (settings.geometry_file_format !== "glb") warnings.push("The interactive viewer uses GLB. Other formats remain downloadable; retain a saved image view for reuse in image and video generations.");
  if (imageMode) warnings.push("Reference order matters: the first image guides the materials. The prompt can be empty when the images supply the direction.");
  warnings.push(RODIN_GUIDANCE[3]);
  return { valid: !issues.length, issues, warnings, promptCharacters, model, settings, estimatedCostMicrousd: estimateModel3dCostMicrousd(settings) };
}

/** Construct each endpoint's payload explicitly; never spread arbitrary settings into it. */
export function serializeRodinInput(prompt: string, settingsInput?: unknown, imageUrls: string[] = []) {
  const checked = validateModel3dRequest({ prompt, settings: settingsInput, referenceCount: imageUrls.length });
  if (!checked.valid) throw new Model3dInputError(checked.issues);
  if (imageUrls.some((url) => !isRodinImageUrl(url))) throw new Model3dInputError([{ code: "model3d_reference_url_invalid", field: "references", message: "Each prepared image needs an accessible HTTP(S) URL or a JPG, PNG, or WebP data URI." }]);
  const s = checked.settings;
  const input: Record<string, unknown> = {
    prompt, tier: s.tier, geometry_file_format: s.geometry_file_format, material: s.material, quality_mesh_option: s.quality_mesh_option,
    enable_creative_mode: s.enable_creative_mode, hd_texture: s.hd_texture, texture_delight: s.texture_delight, is_micro: s.is_micro, TAPose: s.TAPose,
    addons: { high_pack: s.addons.high_pack },
  };
  if (s.seed !== null) input.seed = s.seed;
  if (s.texture_mode !== "auto") input.texture_mode = s.texture_mode;
  if (s.bbox_condition !== null) input.bbox_condition = { width: s.bbox_condition.width, height: s.bbox_condition.height, length: s.bbox_condition.length };
  if (checked.model === RODIN_IMAGE_MODEL) Object.assign(input, { image_urls: [...imageUrls], use_original_alpha: s.use_original_alpha, preview_render: s.preview_render });
  return { model: checked.model, input, settings: s, estimatedCostMicrousd: checked.estimatedCostMicrousd };
}

export class Model3dInputError extends Error {
  readonly issues: Model3dValidationIssue[];
  constructor(issues: Model3dValidationIssue[]) { super(issues.map((issue) => issue.message).join(" ")); this.name = "Model3dInputError"; this.issues = issues; }
}
