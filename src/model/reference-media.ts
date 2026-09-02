import { isModel3dMediaSource, normalizeModel3dView } from "./model3d-view.ts";

export type ReferenceMedium = "image" | "audio" | "video" | "model3d" | "document" | "text" | "unknown";

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
]);

const IMAGE_EXTENSIONS = new Set(["apng", "avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const AUDIO_EXTENSIONS = new Set(["aac", "aif", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"]);
const MODEL3D_EXTENSIONS = new Set(["glb", "gltf", "fbx", "obj", "stl", "usd", "usdz"]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odp", "ods", "odt", "pdf", "ppt", "pptx", "rtf", "xls", "xlsx"]);
const TEXT_EXTENSIONS = new Set(["csv", "json", "jsonl", "md", "markdown", "text", "tsv", "txt", "xml", "yaml", "yml"]);

function fromMime(value: unknown): ReferenceMedium {
  if (typeof value !== "string") return "unknown";
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("model/") || ["application/x-fbx", "application/vnd.autodesk.fbx", "application/x-wavefront-obj", "application/x-stl", "application/sla"].includes(mime)) return "model3d";
  if (mime.startsWith("text/")) return "text";
  if (DOCUMENT_MIME_TYPES.has(mime) || mime.startsWith("application/vnd.openxmlformats-officedocument.")) return "document";
  if (/^application\/(?:json|xml|(?:[\w.-]+\+)(?:json|xml)|(?:x-)?yaml)$/.test(mime)) return "text";
  return "unknown";
}

function fromKind(value: unknown): ReferenceMedium {
  if (typeof value !== "string") return "unknown";
  const kind = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["image", "image-upload", "generated-image", "image-reference", "photo", "photograph", "picture", "illustration", "visual"].includes(kind)) return "image";
  if (["audio", "audio-upload", "audio-reference", "sound", "soundtrack", "speech", "voice", "music"].includes(kind)) return "audio";
  if (["video", "video-upload", "video-reference", "movie", "film"].includes(kind)) return "video";
  if (["model3d", "3d-model", "model-upload", "model3d-upload", "generated-model3d"].includes(kind)) return "model3d";
  if (["document", "document-upload", "pdf", "word", "presentation", "spreadsheet", "slides", "powerpoint", "excel"].includes(kind)) return "document";
  if (["text", "text-upload", "pasted-text", "plain-text", "plaintext", "markdown", "written", "excerpt"].includes(kind)) return "text";
  return "unknown";
}

function fromExtension(value: unknown): ReferenceMedium {
  if (typeof value !== "string") return "unknown";
  const path = value.split(/[?#]/, 1)[0] ?? "";
  const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return "unknown";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (MODEL3D_EXTENSIONS.has(extension)) return "model3d";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unknown";
}

/**
 * Classifies existing reference metadata without fetching, trusting, or authorizing its URL.
 * Server-issued MIME and extracted source kind precede presentation hints; unknown bytes never
 * silently become an image solely because a block happens to have the reference type.
 */
export function referenceMedium(properties: Record<string, unknown>): ReferenceMedium {
  const mediaUrl = typeof properties.media_url === "string" ? properties.media_url.trim() : "";
  const modelUrl = typeof properties.model_url === "string" ? properties.model_url.trim() : "";
  // An original mesh is separate from its authored image view. Older or invalid
  // blocks must not turn model bytes into pixels through a generic image hint.
  if (modelUrl && (!mediaUrl || mediaUrl === modelUrl)) return "model3d";
  for (const value of [properties.source_mime_type, properties.media_type, properties.mime_type, properties.mimeType]) {
    const medium = fromMime(value);
    if (medium !== "unknown") return medium;
  }

  for (const value of [properties.source_kind, properties.source_type, properties.reference_kind, properties.medium, properties.media_kind]) {
    const medium = fromKind(value);
    if (medium !== "unknown") return medium;
  }

  if (mediaUrl) {
    for (const value of [mediaUrl, properties.file_name, properties.filename, properties.label]) {
      const medium = fromExtension(value);
      if (medium !== "unknown") return medium;
    }

    if (properties.actual_image === true || properties.source_output_id || properties.focal_point || properties.image_width || properties.image_height
      || properties.image_caption || Array.isArray(properties.extraction_preferences) || properties.pixel_reference_mode) return "image";
    if (properties.source_evidence_hash || Array.isArray(properties.source_citations)) return "document";
  }

  if (!mediaUrl && [properties.text, properties.artifact_markdown, properties.source_excerpt].some((value) => typeof value === "string" && value.trim())) return "text";
  return "unknown";
}

export function isImageReference(properties: Record<string, unknown>): boolean {
  return referenceMedium(properties) === "image";
}

/** Readiness for the visual-use control; the server separately verifies asset ownership and rights. */
export function hasSavedModel3dView(properties: Record<string, unknown>): boolean {
  const mediaUrl = properties.media_url;
  const originalUrl = properties.model_url;
  return isModel3dMediaSource(originalUrl) && isModel3dMediaSource(mediaUrl) && mediaUrl !== originalUrl
    && properties.model_mime_type === "model/gltf-binary" && properties.media_type === "image/png" && properties.source_mime_type === "image/png"
    && /^[a-f0-9]{64}$/i.test(String(properties.model_content_hash ?? "")) && /^[a-f0-9]{64}$/i.test(String(properties.source_content_hash ?? ""))
    && typeof properties.model_reference_id === "string" && Boolean(properties.model_reference_id)
    && typeof properties.reference_id === "string" && Boolean(properties.reference_id) && properties.reference_id !== properties.model_reference_id
    && normalizeModel3dView(properties.model_view) !== null;
}
