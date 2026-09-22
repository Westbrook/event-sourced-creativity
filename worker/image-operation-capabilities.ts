import { selectImageAdapter } from "./image-adapter-selection.ts";
import { OPENAI_IMAGE_GENERATION_CONTRACT } from "./openai-image-route-contract.ts";
import type { CreativeImageOptions } from "./openai-adapter.ts";
import type { WorkerEnv } from "./runtime.ts";

export const IMAGE_CAPABILITY_VERSION = "image-capability-2026-09-22-v1";
export const IMAGE_ROUTING_POLICY_VERSION = "shared-low-flare-11470186-v1";
export const IMAGE_CANDIDATE_MODELS = Object.freeze([
  "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare", "gpt-image-2.5-flare-2026-09-08",
]);
export type ImageEndpoint = "/v1/images/generations" | "/v1/images/edits" | "/v1/responses";
export type ImagePolicyConfiguration = {
  imageProvider?: string; openAIImageModel?: string; falConfigured: boolean;
  falImageModel?: string; falImageEditModel?: string;
};
export type SettingPresence<T> = { state: "omitted" } | { state: "explicit"; value: T };
const presence = <T>(value: T | undefined): SettingPresence<T> => value === undefined ? { state: "omitted" } : { state: "explicit", value };
function setting<T>(requested: T | undefined, sent: T | undefined, effective: T | null, source: string) {
  return { requested: presence(requested), sent: presence(sent), effective, source };
}
export function imageModelIdentity(model: string) {
  const pinned = /-\d{4}-\d{2}-\d{2}$/.test(model);
  return { modelSnapshot: pinned ? model : null, aliasResolution: pinned ? "pinned" as const : "unknown" as const };
}

/** Read-only evidence for the shared image adapter, not native Output/Fal or recovery.
 * Accept sanitized configuration only. The sentinel lets the existing selector use
 * its configured/unconfigured branch without this module receiving any credential. */
export function resolveProductionImageOperation(config: ImagePolicyConfiguration, options: CreativeImageOptions = {}) {
  if (options.outputFalImage !== undefined) throw new Error("native_output_requires_own_operation_contract");
  const env = { FORMA_IMAGE_PROVIDER: config.imageProvider, OPENAI_IMAGE_MODEL: config.openAIImageModel,
    FAL_KEY: config.falConfigured ? "configured-presence-only" : undefined,
    FAL_IMAGE_MODEL: config.falImageModel, FAL_IMAGE_EDIT_MODEL: config.falImageEditModel } as WorkerEnv;
  const selected = selectImageAdapter(env, options);
  const defaults = OPENAI_IMAGE_GENERATION_CONTRACT.defaults;
  const quality = options.quality ?? defaults.quality, size = options.size ?? defaults.size;
  const fal = selected.providerName === "fal";
  const format = fal ? (options.outputFormat === "png" ? "png" : "jpeg") : options.outputFormat ?? defaults.outputFormat;
  const partials = fal ? 0 : options.partialImages ?? 0;
  const compression = fal || format === "png" ? undefined : Math.max(0, Math.min(100, Math.round(options.outputCompression ?? 100)));
  const referenceCount = options.references?.length ?? 0;
  return {
    version: IMAGE_CAPABILITY_VERSION, routingPolicyVersion: IMAGE_ROUTING_POLICY_VERSION,
    selectionMode: "production" as const, provider: selected.providerName, model: selected.model,
    ...imageModelIdentity(selected.model), adapterId: selected.adapterId, adapterVersion: selected.adapterVersion,
    reason: selected.reason, referenceCount,
    endpoint: fal ? `https://queue.fal.run/${selected.model}` : referenceCount ? "/v1/images/edits" : "/v1/images/generations",
    routeFactor: referenceCount ? "reference-presence-selects-edit" : "no-reference-generation",
    settings: {
      quality: setting(options.quality, fal ? undefined : quality, quality, fal ? "adapter-quality-mapping" : options.quality === undefined ? "application-default" : "caller"),
      size: setting(options.size, size, size, options.size === undefined ? "application-default" : "caller"),
      outputFormat: setting(options.outputFormat, format, format, options.outputFormat === undefined ? "application-default" : "caller"),
      outputCompression: setting(options.outputCompression, compression, compression ?? null, compression === undefined ? "not-applicable" : "application-clamped"),
      partialImages: setting(options.partialImages, partials ? partials : undefined, partials, fal ? "not-supported" : "application-default"),
      stream: setting<boolean>(undefined, partials ? true : undefined, Boolean(partials), "derived-from-partial-images"),
      moderation: setting<string>(undefined, undefined, fal ? null : "auto", fal ? "provider-specific-safety-checker" : "documented-provider-default"),
    },
  };
}

export type ImageExperimentCell = {
  model: string; endpoint: ImageEndpoint; referenceCount: number;
  settings: { quality?: string; size?: string; outputFormat?: string; outputCompression?: number;
    moderation?: string; stream?: boolean; partialImages?: number; background?: string };
  mainlineModel?: string; action?: "auto" | "generate" | "edit";
  policyExperiment?: { id: string; benignCorpus: true; automaticRefusalFallback: false };
};
export type CapabilityIssue = { code: string; field: string; reason: string };

/** Admission for the deliberately narrow offline experiment contract. Documented
 * options outside this schema need a new version plus budget/endpoint qualification. */
export function validateImageExperimentCell(cell: ImageExperimentCell) {
  const issues: CapabilityIssue[] = [];
  const fail = (code: string, field: string, reason: string) => issues.push({ code, field, reason });
  const s = cell.settings;
  const allowedSettings = ["quality", "size", "outputFormat", "outputCompression", "moderation", "stream", "partialImages", "background"];
  for (const field of Object.keys(s)) if (!allowedSettings.includes(field)) fail("setting_unqualified", field, "This setting is outside the reviewed endpoint contract; it cannot be silently omitted.");
  if (!IMAGE_CANDIDATE_MODELS.includes(cell.model)) fail("model_unsupported", "model", "Only reviewed Sunburst/Flare aliases and 2026-09-08 snapshots are candidates.");
  if (!["/v1/images/generations", "/v1/images/edits", "/v1/responses"].includes(cell.endpoint)) fail("endpoint_unsupported", "endpoint", "Endpoint is not in this contract.");
  if (!Number.isSafeInteger(cell.referenceCount) || cell.referenceCount < 0 || cell.referenceCount > 16) fail("reference_count_invalid", "referenceCount", "Provide zero to sixteen references, retaining every selected input.");
  if (cell.endpoint === "/v1/images/generations" && cell.referenceCount !== 0) fail("route_reference_mismatch", "endpoint", "Direct reference inputs require edits; record the route factor.");
  if (cell.endpoint === "/v1/images/edits" && cell.referenceCount < 1) fail("route_reference_mismatch", "endpoint", "Edits require at least one reference.");
  if (s.quality !== undefined && !["low", "medium", "high", "auto", "xhigh", "max"].includes(s.quality)) fail("quality_unsupported", "quality", "Unknown quality.");
  if (s.quality === "xhigh" || s.quality === "max") fail("quality_runtime_unqualified", "quality", "Documented only: schema, endpoint and budget qualification remain required.");
  if (s.size !== undefined && !["auto", "1024x1024", "1536x1024", "1024x1536"].includes(s.size)) fail("size_runtime_unqualified", "size", "Custom sizes require an opt-in contract with exact pixel, edge and budget limits.");
  if (s.outputFormat !== undefined && !["png", "jpeg", "webp"].includes(s.outputFormat)) fail("format_unsupported", "outputFormat", "Unknown output format.");
  if (s.outputCompression !== undefined && (!Number.isInteger(s.outputCompression) || s.outputCompression < 0 || s.outputCompression > 100 || !["jpeg", "webp"].includes(s.outputFormat ?? "png"))) fail("compression_invalid", "outputCompression", "Compression 0–100 requires explicit JPEG or WebP.");
  if (s.background !== undefined && !["auto", "opaque", "transparent"].includes(s.background)) fail("background_unsupported", "background", "Unknown background.");
  if (s.background === "transparent" && s.outputFormat === "jpeg") fail("alpha_format_invalid", "outputFormat", "Transparent output requires PNG or WebP.");
  if (s.moderation !== undefined && !["auto", "low"].includes(s.moderation)) fail("moderation_unsupported", "moderation", "Unknown moderation mode.");
  if (s.moderation === "low" && (!cell.policyExperiment?.id.trim() || cell.policyExperiment.benignCorpus !== true || cell.policyExperiment.automaticRefusalFallback !== false)) fail("moderation_policy_experiment_required", "moderation", "Low is a separate optional benign-corpus policy experiment, never an automatic refusal fallback.");
  if (s.stream !== undefined && typeof s.stream !== "boolean") fail("stream_invalid", "stream", "Streaming must be boolean.");
  if (s.partialImages !== undefined && (!Number.isInteger(s.partialImages) || s.partialImages < 0 || s.partialImages > 3)) fail("partial_images_invalid", "partialImages", "Partial image count must be an integer from zero to three.");
  if ((s.partialImages ?? 0) > 0 && s.stream !== true) fail("partial_requires_stream", "stream", "Partial images require explicit streaming.");
  if (s.stream === true) fail("stream_runtime_unqualified", "stream", "Model cards conflict with endpoint streaming docs; require endpoint-specific receipt and billing qualification in a later opt-in contract.");
  if (cell.endpoint === "/v1/responses") {
    if (!cell.mainlineModel?.trim() || cell.mainlineModel.startsWith("gpt-image")) fail("mainline_model_required", "mainlineModel", "Responses needs a separate supported mainline model.");
    if (!["auto", "generate", "edit"].includes(cell.action ?? "auto")) fail("action_unsupported", "action", "Unknown image-tool action.");
    if (cell.action === "edit" && cell.referenceCount === 0) fail("edit_input_required", "action", "This stateless contract requires explicit edit inputs.");
    fail("responses_runtime_unqualified", "endpoint", "Task D must qualify the exact mainline/tool schema, prompt revision and overhead before submission.");
  } else if (cell.mainlineModel !== undefined || cell.action !== undefined) fail("responses_settings_on_direct_route", "endpoint", "Mainline model and action belong to Responses only.");
  return { version: IMAGE_CAPABILITY_VERSION, valid: issues.length === 0, issues };
}

/** No environment writes, provider calls or paid authorization; returns a plan. */
export function resolveExperimentImageOperation(input: ImageExperimentCell & { enabled?: boolean }) {
  if (input.enabled !== true) throw new Error("image_experiment_disabled");
  const validation = validateImageExperimentCell(input);
  if (!validation.valid) throw new Error(`image_experiment_invalid:${validation.issues.map(i => i.code).join(",")}`);
  return { version: IMAGE_CAPABILITY_VERSION, routingPolicyVersion: "experiment-fixed-model-v1", selectionMode: "experiment" as const,
    provider: "openai" as const, model: input.model, requestedModel: input.model, ...imageModelIdentity(input.model), endpoint: input.endpoint,
    referenceCount: input.referenceCount, routeFactor: input.referenceCount ? "reference-presence-selects-edit" : "no-reference-generation",
    settings: Object.fromEntries(Object.entries({ quality: "auto", size: "auto", outputFormat: "png", outputCompression: null, moderation: "auto", stream: false, partialImages: 0, background: "auto" }).map(([key, fallback]) => {
      const value = input.settings[key as keyof ImageExperimentCell["settings"]];
      return [key, setting(value, value, value ?? fallback, value === undefined ? "documented-provider-default" : "experiment-explicit")];
    })), liveDispatchAuthorized: false as const };
}
