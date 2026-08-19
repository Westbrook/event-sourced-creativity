export type ImageAspectRatio = { width: number; height: number };
export type ImageDimensions = { width: number; height: number; unit: "px" };
export type ImageFormat = {
  schema_version: 1;
  aspect_ratio: ImageAspectRatio;
  dimensions: ImageDimensions;
};

export type ImageFormatPreset = ImageFormat & { id: string; label: string };

export const IMAGE_FORMAT_PRESETS: readonly ImageFormatPreset[] = [
  { id:"1:1", label:"Square", schema_version:1, aspect_ratio:{width:1,height:1}, dimensions:{width:1024,height:1024,unit:"px"} },
  { id:"3:2", label:"Landscape", schema_version:1, aspect_ratio:{width:3,height:2}, dimensions:{width:1536,height:1024,unit:"px"} },
  { id:"2:3", label:"Portrait", schema_version:1, aspect_ratio:{width:2,height:3}, dimensions:{width:1024,height:1536,unit:"px"} },
  { id:"4:5", label:"Portrait social", schema_version:1, aspect_ratio:{width:4,height:5}, dimensions:{width:1200,height:1500,unit:"px"} },
  { id:"5:4", label:"Landscape social", schema_version:1, aspect_ratio:{width:5,height:4}, dimensions:{width:1500,height:1200,unit:"px"} },
  { id:"16:9", label:"Widescreen", schema_version:1, aspect_ratio:{width:16,height:9}, dimensions:{width:1920,height:1080,unit:"px"} },
  { id:"9:16", label:"Vertical", schema_version:1, aspect_ratio:{width:9,height:16}, dimensions:{width:1080,height:1920,unit:"px"} },
] as const;

export const DEFAULT_IMAGE_FORMAT: ImageFormat = IMAGE_FORMAT_PRESETS[1];

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finiteInt = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
const clampDimension = (value: unknown, fallback: number) => Math.max(64, Math.min(8192, finiteInt(value, fallback)));
const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : Math.abs(left);

export function reducedAspectRatio(width: number, height: number): ImageAspectRatio {
  const divisor = gcd(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))) || 1;
  return { width:Math.round(width) / divisor, height:Math.round(height) / divisor };
}

export function normalizeImageFormat(value: unknown, fallback: ImageFormat = DEFAULT_IMAGE_FORMAT): ImageFormat {
  const input = record(value); const dimensions = record(input.dimensions); const ratio = record(input.aspect_ratio);
  const hasDimensions = dimensions.width !== undefined || dimensions.height !== undefined || input.width !== undefined || input.height !== undefined;
  let width = clampDimension(dimensions.width ?? input.width, fallback.dimensions.width);
  let height = clampDimension(dimensions.height ?? input.height, fallback.dimensions.height);
  const suppliedRatioWidth = finiteInt(ratio.width, 0); const suppliedRatioHeight = finiteInt(ratio.height, 0);
  if (!hasDimensions && suppliedRatioWidth > 0 && suppliedRatioHeight > 0) {
    const scale = Math.min(fallback.dimensions.width / suppliedRatioWidth, fallback.dimensions.height / suppliedRatioHeight);
    width = clampDimension(suppliedRatioWidth * scale, fallback.dimensions.width);
    height = clampDimension(suppliedRatioHeight * scale, fallback.dimensions.height);
  }
  const aspect_ratio = reducedAspectRatio(width, height);
  return { schema_version:1, aspect_ratio, dimensions:{ width, height, unit:"px" } };
}

export function imageFormatForPreset(id: string): ImageFormat {
  return normalizeImageFormat(IMAGE_FORMAT_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_IMAGE_FORMAT);
}

export function imageAspectRatioLabel(format: ImageFormat) {
  const ratio = reducedAspectRatio(format.aspect_ratio.width, format.aspect_ratio.height);
  return `${ratio.width}:${ratio.height}`;
}

export function imageOrientationLabel(value: unknown) {
  const format = normalizeImageFormat(value);
  if (format.aspect_ratio.width === format.aspect_ratio.height) return "square";
  return format.aspect_ratio.width > format.aspect_ratio.height ? "landscape" : "portrait";
}

export function imageFormatLabel(value: unknown) {
  const format = normalizeImageFormat(value);
  return `${imageAspectRatioLabel(format)} · ${format.dimensions.width} × ${format.dimensions.height} px`;
}

type ImageFormatCandidate = { id?: string; block_id?: string; type?: unknown; active?: unknown; position?: unknown; properties?: unknown };

export function documentImageFormat(source: unknown): { format: ImageFormat; blockId: string | null } {
  const root = record(source); const candidates = (Array.isArray(source) ? source : Array.isArray(root.facts) ? root.facts : Array.isArray(root.blocks) ? root.blocks : []) as ImageFormatCandidate[];
  const formatBlocks = candidates.filter((candidate) => candidate.type === "format" && candidate.active !== false);
  const selected = [...formatBlocks].sort((left, right) => {
    const leftProperties = record(left.properties); const rightProperties = record(right.properties);
    const weightDelta = Number(rightProperties.weight ?? .5) - Number(leftProperties.weight ?? .5);
    return weightDelta || String(left.position ?? "").localeCompare(String(right.position ?? ""));
  })[0];
  const properties = record(selected?.properties);
  const blockId = selected?.id ?? selected?.block_id;
  return { format:normalizeImageFormat(properties.image_format), blockId:blockId ? String(blockId) : null };
}

export const PROVIDER_IMAGE_SIZE_CONSTRAINTS = {
  dimensionMultiple: 16,
  minimumPixels: 655_360,
  maximumPixels: 8_294_400,
  maximumEdge: 3_840,
  maximumAspectRatio: 3,
} as const;

export type ProviderImageSizeValidation = {
  valid: boolean;
  width: number;
  height: number;
  pixels: number;
  issues: string[];
};

const ceilMultiple = (value: number, multiple = PROVIDER_IMAGE_SIZE_CONSTRAINTS.dimensionMultiple) => Math.max(multiple, Math.ceil(value / multiple) * multiple);
const lcm = (left: number, right: number) => Math.abs(left * right) / (gcd(left, right) || 1);

export function validateProviderImageDimensions(width: number, height: number): ProviderImageSizeValidation {
  const constraints = PROVIDER_IMAGE_SIZE_CONSTRAINTS; const pixels = width * height; const shortEdge = Math.min(width, height); const longEdge = Math.max(width, height); const issues: string[] = [];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) issues.push("Width and height must be positive integers.");
  if (width % constraints.dimensionMultiple || height % constraints.dimensionMultiple) issues.push(`Both edges must be multiples of ${constraints.dimensionMultiple}.`);
  if (pixels < constraints.minimumPixels) issues.push(`The image must contain at least ${constraints.minimumPixels.toLocaleString()} pixels.`);
  if (pixels > constraints.maximumPixels) issues.push(`The image must contain no more than ${constraints.maximumPixels.toLocaleString()} pixels.`);
  if (longEdge > constraints.maximumEdge) issues.push(`Neither edge may exceed ${constraints.maximumEdge.toLocaleString()} pixels.`);
  if (shortEdge > 0 && longEdge / shortEdge > constraints.maximumAspectRatio) issues.push(`The long edge may be at most ${constraints.maximumAspectRatio} times the short edge.`);
  return { valid:issues.length === 0, width, height, pixels, issues };
}

export function validateProviderImageSize(size: string): ProviderImageSizeValidation {
  const match = /^(\d+)x(\d+)$/.exec(size); if (!match) return { valid:false, width:0, height:0, pixels:0, issues:["The image size must use the WIDTHxHEIGHT format."] };
  return validateProviderImageDimensions(Number(match[1]), Number(match[2]));
}

function exactAlignedRenderSize(ratio: ImageAspectRatio, preferredLongEdge: number) {
  const constraints = PROVIDER_IMAGE_SIZE_CONSTRAINTS; const ratioWidth = Math.max(1, Math.round(ratio.width)); const ratioHeight = Math.max(1, Math.round(ratio.height));
  const alignmentScale = lcm(constraints.dimensionMultiple / gcd(ratioWidth, constraints.dimensionMultiple), constraints.dimensionMultiple / gcd(ratioHeight, constraints.dimensionMultiple));
  const baseWidth = ratioWidth * alignmentScale; const baseHeight = ratioHeight * alignmentScale; const basePixels = baseWidth * baseHeight; const baseLongEdge = Math.max(baseWidth, baseHeight);
  const scale = Math.max(1, Math.ceil(Math.max(preferredLongEdge / baseLongEdge, Math.sqrt(constraints.minimumPixels / basePixels))));
  const width = baseWidth * scale; const height = baseHeight * scale; const validation = validateProviderImageDimensions(width, height);
  const ratioMagnitude = Math.max(ratioWidth / ratioHeight, ratioHeight / ratioWidth); const efficientPixelTarget = Math.max(constraints.minimumPixels, preferredLongEdge * preferredLongEdge / ratioMagnitude);
  return validation.valid && validation.pixels <= efficientPixelTarget * 1.5 ? validation : null;
}

function approximateAlignedRenderSize(ratio: number, preferredLongEdge: number) {
  const constraints = PROVIDER_IMAGE_SIZE_CONSTRAINTS; const landscape = ratio >= 1; const magnitude = Math.min(constraints.maximumAspectRatio, Math.max(1, landscape ? ratio : 1 / ratio));
  const longEdge = ceilMultiple(Math.max(preferredLongEdge, Math.sqrt(constraints.minimumPixels * magnitude)));
  const shortEdge = ceilMultiple(longEdge / magnitude);
  return landscape ? { width:longEdge, height:shortEdge } : { width:shortEdge, height:longEdge };
}

export function providerRenderFormat(value: unknown, purpose: "preview" | "full") {
  const target = normalizeImageFormat(value); const ratio = target.aspect_ratio.width / target.aspect_ratio.height; const preferredLongEdge = purpose === "preview" ? 816 : 1536;
  const ratioMagnitude = Math.max(ratio, 1 / ratio); const exact = ratioMagnitude <= PROVIDER_IMAGE_SIZE_CONSTRAINTS.maximumAspectRatio ? exactAlignedRenderSize(target.aspect_ratio, preferredLongEdge) : null;
  const render = exact ?? approximateAlignedRenderSize(ratio, preferredLongEdge); const { width, height } = render; const validation = validateProviderImageDimensions(width, height);
  if (!validation.valid) throw new Error(`Unable to derive a valid provider image size: ${validation.issues.join(" ")}`);
  return {
    target,
    width,
    height,
    size:`${width}x${height}` as `${number}x${number}`,
    aspectRatio:imageAspectRatioLabel(target),
  };
}

export function imageFormatEventFields(value: unknown, purpose: "preview" | "full", blockId: string | null = null) {
  const render = providerRenderFormat(value, purpose); const target = render.target;
  return {
    image_format_block_id:blockId,
    target_aspect_ratio:render.aspectRatio,
    target_width:target.dimensions.width,
    target_height:target.dimensions.height,
    target_unit:target.dimensions.unit,
    provider_render_size:render.size,
    size:render.size,
  };
}
