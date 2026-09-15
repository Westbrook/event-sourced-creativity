import { readVideoExecutionOffer } from "../model/output-video-offer.ts";
import type { VideoOutputContract } from "../model/output-video-contract.ts";
import { readModel3dExecutionOffer } from "../model/output-model3d-offer.ts";
import type { Model3dOutputContract } from "../model/output-model3d-contract.ts";
import type { Model3dMiniAppCostPreview } from "../model/model3d-mini-app-consent.ts";
import { EXPERIENCE_AUDIO_INTENT } from "./contracts.ts";
import { parseAudioOutputContract, type AudioOutputContract } from "../model/output-audio-contract.ts";
import { parseAudioMiniAppCostPreview, type AudioMiniAppCostPreview } from "../model/audio-mini-app-consent.ts";
import { parseShortStoryNarrativeContract } from "../model/output-narrative-contract.ts";
import { parseSceneOutputContract, type SceneOutputContract } from "../model/output-scene-contract.ts";
import { parseSceneMiniAppCostPreview, type SceneMiniAppCostPreview } from "../model/scene-mini-app-consent.ts";
import { readOutputFalImageContract } from "../model/output-fal-image-contract.ts";
import { readStoryboardExecutionOffer } from "../model/output-storyboard-offer.ts";
import type { StoryboardOutputSource } from "../model/output-storyboard-contract.ts";
import { canonicalJson } from "./compiler.ts";
import type { OutputGrantRow, OutputPreflight } from "../model/output-delivery-contract.ts";

/** Display projection only. Native activation, original ownership and permission stay host/server-owned. */
export type OutputTermsRow = Readonly<{ label: string; value: string }>;
/** Primary disclosure copied only after the existing closed projection succeeds.
 * Display data, never a replacement for host/server admission checks. */
export type OutputTermsSummary = Readonly<{
  output: string;
  constraints: readonly OutputTermsRow[];
  maximumSpend: string;
  maximumGenerationCalls: number;
  requests: string;
  source: string;
  transfer: string;
  recipients: readonly Readonly<{ provider: string; model: string }>[];
  safety: Readonly<{ maximumChecks: number; provider: string; model: string; input: string }> | null;
  expiresAt: string;
  caveats: readonly string[];
  usage: Readonly<{ expiresAt: string; usedSpend: string; unresolvedExposure: string; pendingCalls: number; payer: string; differentPayer: boolean }> | null;
}>;
export type OutputTermsTarget = Readonly<{
  targetId: string;
  rows: readonly OutputTermsRow[];
  calls: readonly Readonly<{ stage: string; rows: readonly OutputTermsRow[] }>[];
  settings: string;
}>;
export type OutputTerms = Readonly<{
  available: boolean;
  reasonCode: "terms_unavailable" | "terms_expired" | null;
  grantAvailable: boolean;
  grantReasonCode: "grant_unavailable" | "grant_expired" | "grant_not_authorized" | null;
  expiresAt: string | null;
  rows: readonly OutputTermsRow[];
  targets: readonly OutputTermsTarget[];
  grantRows: readonly OutputTermsRow[];
  /** Missing on a not-yet-projected route: the host must retain its full disclosure. */
  summary?: OutputTermsSummary;
}>;
export type OutputTermsOptions = Readonly<{
  now: number;
  output: "image" | "slides" | "short_story" | "scene" | "storyboard" | "audio" | "video" | "model3d";
  targetId: string;
  grant?: OutputGrantRow | null;
  /** Display eligibility only. Host separately proves server permission and the exact original recorded run. */
  allowRecordedResume?: boolean;
  /** Optional additional exact-size comparison. The host independently checks the full fixed target contract. */
  expectedImageSize?: string;
  /** Original retained intake contract and separately decoded server disclosure.
   * Display comparison only; native source and consent authority remain server-owned. */
  expectedSceneContract?: SceneOutputContract;
  expectedSceneContractDigest?: string;
  sceneCostPreview?: SceneMiniAppCostPreview | null;
  expectedModel3dContract?: Model3dOutputContract;
  model3dCostPreview?: Model3dMiniAppCostPreview | null;
  expectedAudioContract?: AudioOutputContract;
  audioCostPreview?: AudioMiniAppCostPreview | null;
  expectedVideo?: Readonly<{ contract: VideoOutputContract; actorUserId: string; projectId: string; documentId: string }>;
  expectedStoryboard?: Readonly<{ source: StoryboardOutputSource; actorUserId: string; projectId: string; documentId: string }>;
}>;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Data = { [key: string]: Json };
const unknownTerms: OutputTerms = Object.freeze({
  available: false, reasonCode: "terms_unavailable", grantAvailable: false,
  grantReasonCode: "grant_unavailable", expiresAt: null,
  rows: Object.freeze([]), targets: Object.freeze([]), grantRows: Object.freeze([]),
});

// Closed Image/Slides semantics from output-execution-policy and the two native ready disclosures.
// Deliberately no runtime imports from the canonical component, locale registry or execution graph.
function policy(value: Json | undefined): value is Data {
  const p = record(value);
  return Boolean(p && Object.keys(p).length === 3 && p.maximumMilliseconds === 240_000
    && p.heartbeatMilliseconds === 60_000 && p.maximumRenewals === 3);
}
function record(value: Json | undefined): Data | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value: Json | undefined, maximum = 2048): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    // Reject ASCII control characters in displayed terms deliberately.
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
function ceiling(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: Json | undefined): value is number {
  return ceiling(value) && value > 0;
}
function stamp(value: Json | undefined): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return null;
  const n = Date.parse(value);
  if (!Number.isFinite(n)) return null;
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return new Date(n).toISOString() === normalized ? n : null;
}
/** Integer arithmetic preserves all six microUSD digits; invalid values never become zero. */
export function outputTermsMoney(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0{1,4}$/u, "");
  return `USD ${whole}.${fraction}`;
}
function row(label: string, value: string | number): OutputTermsRow {
  return Object.freeze({ label, value: String(value) });
}
function moneyRow(label: string, value: number): OutputTermsRow {
  return row(label, outputTermsMoney(value)!);
}
function rows(...values: OutputTermsRow[]): readonly OutputTermsRow[] { return Object.freeze(values); }
function same(left: Json, right: Json): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function settingCeilings(value: Json): boolean {
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, child]) =>
    (!/^(?:maximum|used|exposed|pending)(?:Microusd|Calls|Tokens|InputTokens|OutputTokens)$/u.test(key) || ceiling(child))
      && settingCeilings(child));
}

function imageSettings(settings: Data, payload: Data, target: Data, expectedSize?: string): OutputTermsRow[] | null {
  const render = record(settings.imageRender), budget = record(settings.imageBudget);
  const format = record(render?.format), ratio = record(format?.aspect_ratio), dimensions = record(format?.dimensions);
  const imageMaximum = record((settings.calls as Json[])[1])?.maximumMicrousd;
  if (settings.kind !== "generate" || target.model !== "gpt-image-2" || !render || !budget || !format || !ratio || !dimensions
    || !text(render.size) || (expectedSize !== undefined && render.size !== expectedSize)
    || format.schema_version !== 1 || dimensions.unit !== "px" || !positive(dimensions.width) || !positive(dimensions.height)
    || !positive(ratio.width) || !positive(ratio.height) || !same(payload.outputImageFormat!, format)) return null;
  const width = dimensions.width, height = dimensions.height, pixels = width * height;
  if (width % 16 || height % 16 || pixels < 655_360 || pixels > 8_294_400 || Math.max(width, height) > 3_840
    || Math.max(width, height) / Math.min(width, height) > 3 || render.size !== `${width}x${height}`
    || !Number.isSafeInteger(width * ratio.height) || !Number.isSafeInteger(height * ratio.width)
    || width * ratio.height !== height * ratio.width) return null;
  if (budget.version !== "gpt-image-2-doc-calculator-2026-08-27" || budget.quality !== "high"
    || budget.allowanceCode !== "output_native_image_allowance_verified" || !text(budget.allowanceDescription, 16384)
    || budget.maximumPromptBytes !== 32_000 || budget.maximumReferenceImages !== 0
    || !positive(budget.estimatedOutputTokens) || !positive(budget.maximumOutputTokens)
    || budget.maximumOutputTokens !== budget.estimatedOutputTokens * 2 || budget.maximumInputTokens !== 36_096
    || !ceiling(budget.maximumMicrousd) || !ceiling(imageMaximum) || budget.maximumMicrousd > imageMaximum) return null;
  return [row("Image size", render.size), row("Aspect ratio", `${ratio.width}:${ratio.height}`), row("Quality", budget.quality),
    row("Maximum prompt bytes", budget.maximumPromptBytes), row("Maximum image input tokens", budget.maximumInputTokens),
    row("Estimated image output tokens", budget.estimatedOutputTokens), row("Maximum image output tokens", budget.maximumOutputTokens),
    moneyRow("Image allowance", budget.maximumMicrousd), row("Generation calls", "1 direction; 1 image"),
    row("Safety provider", "OpenAI"), row("Safety model", "omni-moderation-latest"),
    row("Safety input", "Exact final image prompt; text"), row("Maximum safety checks", "1 additional; excluded from generation calls"),
    row("Safety charge", "Free in retained native disclosure"), row("Reference pixels", "Unavailable"),
    row("Cost accounting", "Provider receipts"), row("After overrun or uncertain response", "No additional request")];
}

function falImageSettings(settings: Data, payload: Data, target: Data, expectedSize?: string): OutputTermsRow[] | null {
  const contract = readOutputFalImageContract(payload.outputFalImage), render = record(settings.imageRender);
  const format = record(render?.format), dimensions = record(format?.dimensions), ratio = record(format?.aspect_ratio);
  const calls = settings.calls as Json[], planner = record(calls[0]), image = record(calls[1]);
  if (!contract || settings.kind !== "generate" || target.model !== contract.model || target.maximumTokens !== 128_000
    || Object.keys(settings).length !== 5 || Object.keys(payload).length !== 6
    || !["productionMode", "budgetAcknowledged", "preflightAcknowledged", "outputTargetInstructions", "outputImageFormat", "outputFalImage"].every(key => Object.hasOwn(payload, key))
    || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim()
    || !render || Object.keys(render).length !== 2 || !format || Object.keys(format).length !== 3
    || format.schema_version !== 1 || !dimensions || Object.keys(dimensions).length !== 3 || dimensions.unit !== "px"
    || dimensions.width !== contract.width || dimensions.height !== contract.height
    || !ratio || Object.keys(ratio).length !== 2 || !positive(ratio.width) || !positive(ratio.height)
    || !Number.isSafeInteger(contract.width * ratio.height) || !Number.isSafeInteger(contract.height * ratio.width)
    || contract.width * ratio.height !== contract.height * ratio.width
    || render.size !== `${contract.width}x${contract.height}` || expectedSize !== undefined && render.size !== expectedSize
    || !same(payload.outputImageFormat!, format) || !planner || !image || Object.keys(planner).length !== 4 || Object.keys(image).length !== 4
    || planner.model !== contract.plannerModel || !positive(planner.maximumMicrousd) || image.maximumMicrousd !== contract.maximumMicrousd) return null;
  return [row("Image size", String(render.size)), row("Aspect ratio", `${ratio.width}:${ratio.height}`), row("Image format", "PNG"),
    row("Quality", contract.renderingSpeed), row("Prompt expansion", contract.expansionModel), row("Acceleration", contract.acceleration),
    row("Prompt adapter", contract.promptAdapterVersion), row("Image adapter", contract.adapterVersion),
    row("Planning provider", "OpenAI"), row("Planning model", contract.plannerModel), row("Image provider", "fal.ai / Ideogram V4"),
    row("Generation calls", "1 direction; 1 image"), row("Safety provider", "OpenAI"), row("Safety model", "omni-moderation-latest"),
    row("Safety input", "Exact adapted image prompt; text"), row("Maximum safety checks", "1 additional; excluded from generation calls"),
    row("Reference pixels", "Unavailable"), row("Pricing version", contract.pricingVersion),
    moneyRow("Estimated image cost", contract.estimatedMicrousd), moneyRow("Image allowance", contract.maximumMicrousd),
    row("Cost accounting", "Published-rate estimate; not invoice precision"), row("Allowance", "Application cap; separate provider billing"),
    row("After uncertain response", "No additional paid request"), row("Result recovery", "Original request only")];
}

/** Snapshot only plain bounded data, without invoking getters or toJSON. */
function snapshot(value: unknown, maximumDepth = 14): Json {
  let remaining = 4096;
  const visit = (entry: unknown, depth: number): Json => {
    if (--remaining < 0 || depth > maximumDepth) throw new TypeError("Terms unavailable");
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry === "string" && entry.length <= 16384) return entry;
    if (!entry || typeof entry !== "object") throw new TypeError("Terms unavailable");
    const prototype = Object.getPrototypeOf(entry);
    if (Array.isArray(entry)) {
      if (prototype !== Array.prototype || entry.length > 256) throw new TypeError("Terms unavailable");
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      if (Reflect.ownKeys(descriptors).length !== entry.length + 1) throw new TypeError("Terms unavailable");
      const copy: Json[] = [];
      for (let index = 0; index < entry.length; index++) {
        const descriptor = descriptors[index];
        if (!descriptor || !("value" in descriptor)) throw new TypeError("Terms unavailable");
        copy.push(visit(descriptor.value, depth + 1));
      }
      return copy;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Terms unavailable");
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 256 || keys.some(key => typeof key !== "string")) throw new TypeError("Terms unavailable");
    const copy: Data = Object.create(null);
    for (const key of (keys as string[]).sort()) {
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || !descriptor.enumerable || key.length > 256) throw new TypeError("Terms unavailable");
      copy[key] = visit(descriptor.value, depth + 1);
    }
    return copy;
  };
  return visit(value, 0);
}

function sceneSettings(settings: Data, payload: Data, target: Data, options: OutputTermsOptions): OutputTermsRow[] | null {
  const option = record(payload.outputScene), contract = record(option?.contract), call = record((settings.calls as Json[])[0]);
  const scene = parseSceneOutputContract(option?.sceneContract), expected = parseSceneOutputContract(options.expectedSceneContract);
  const preview = parseSceneMiniAppCostPreview(option?.costPreview), original = parseSceneMiniAppCostPreview(options.sceneCostPreview);
  if (!option || Object.keys(option).length !== 4 || !record(option.intake) || !contract || Object.keys(contract).length !== 18
    || !scene || !expected || !same(snapshot(scene), snapshot(expected)) || !preview || !original || !same(snapshot(preview), snapshot(original))
    || preview.sceneContractDigest !== options.expectedSceneContractDigest || Date.parse(preview.expiresAt) <= options.now
    || settings.kind !== "render_document" || Object.keys(settings).length !== 4 || Object.keys(payload).length !== 9
    || payload.artifactKind !== "scene" || payload.sceneMedium !== "visual" || payload.itemCount !== 1 || payload.sceneRequestId !== preview.requestId
    || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim()
    || contract.schemaVersion !== 1 || contract.qualification !== "request-only" || contract.artifactKind !== "scene"
    || contract.sourceRequestDigest !== scene.source.requestHash || contract.model !== "gpt-5.6-terra"
    || contract.maximumCalls !== 1 || contract.maximumOutputTokens !== 3000 || contract.maximumInputTokens !== preview.maximumInputTokens
    || contract.stage !== "planning:0:initial" || contract.reasoningEffort !== "low" || contract.cachePolicy !== "disabled-explicit"
    || contract.layoutQualification !== "unqualified" || !text(contract.pricingVersion) || !text(contract.input, 65536)
    || !text(contract.instructions, 65536) || !record(contract.responseSchema)
    || typeof contract.compiledInputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(contract.compiledInputSha256)
    || typeof contract.adapterRequestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(contract.adapterRequestDigest)
    || !call || Object.keys(call).length !== 6 || call.model !== contract.model || call.maximumInputTokens !== preview.maximumInputTokens
    || call.maximumOutputTokens !== 3000 || call.maximumMicrousd !== preview.maximumMicrousd
    || target.maximumMicrousd !== preview.maximumMicrousd || target.maximumTokens !== preview.maximumTokens) return null;
  return [row("Format", "Written screenplay · Action and dialogue"), row("Generation calls", "1 initial · No automatic repair"),
    row("Scene request", preview.requestId), row("Scene approval deadline", preview.expiresAt),
    row("Page layout", "1–2 US Letter pages · DM Mono 12 pt"),
    row("Validation failure", "Charges may remain; no automatic second request")];
}

function audioSettings(settings: Data, payload: Data, target: Data, options: OutputTermsOptions): OutputTermsRow[] | null {
  const contract = parseAudioOutputContract(payload.outputAudio), expected = parseAudioOutputContract(options.expectedAudioContract);
  const preview = parseAudioMiniAppCostPreview(settings.costPreview), original = parseAudioMiniAppCostPreview(options.audioCostPreview);
  const captured = record(settings.original), duration = record(settings.duration), constraints = record(settings.constraints);
  const calls = settings.calls as Json[], first = record(calls[0]), repair = record(calls[1]), media = record(calls[2]);
  if (!contract || !expected || !same(snapshot(contract), snapshot(expected))
    || !preview || !original || !same(snapshot(preview), snapshot(original))
    || preview.draftId !== contract.source.draftId || !captured || Object.keys(captured).length !== 8
    || ["requestId", "expiresAt", "draftId", "actorUserId", "projectId", "documentId", "sourceDigest", "requirementsDigest"]
      .some(key => captured[key] !== preview[key as keyof typeof preview])
    || settings.kind !== "render_document" || Object.keys(settings).length !== 11 || Object.keys(payload).length !== 8
    || settings.preparationOnly !== false || settings.explicitCostAndTransferApprovalRequired !== true || settings.executionAvailable !== true
    || payload.artifactKind !== "audio" || payload.itemCount !== 1 || !same(snapshot(payload.audioProfile), snapshot(EXPERIENCE_AUDIO_INTENT))
    || payload.audioProviderModel !== preview.audioModel || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim()
    || !duration || Object.keys(duration).length !== 2 || duration.requestedSeconds !== 20 || duration.measuredSeconds !== null || !constraints
    || !first || !repair || !media || Object.keys(first).length !== 6 || Object.keys(repair).length !== 6 || Object.keys(media).length !== 4
    || first.model !== preview.planningModel || repair.model !== preview.planningModel || media.model !== preview.audioModel
    || !positive(first.maximumInputTokens) || first.maximumInputTokens > 61000 || repair.maximumInputTokens !== first.maximumInputTokens
    || first.maximumOutputTokens !== 3000 || repair.maximumOutputTokens !== 3000
    || !positive(first.maximumMicrousd) || first.maximumMicrousd < 500000 || repair.maximumMicrousd !== first.maximumMicrousd
    || media.maximumMicrousd !== payload.audioEstimatedCostMicrousd || !positive(media.maximumMicrousd)
    || target.maximumMicrousd !== preview.maximumMicrousd || target.maximumTokens !== preview.maximumTokens) return null;
  return [row("Output", "1 instrumental track · about 20 seconds"), row("Generation calls", "1 planning call; at most 1 repair; 1 audio request"),
    row("Audio request", preview.requestId), row("Approval deadline", preview.expiresAt),
    row("Duration", "20-second request; measured duration only after media inspection"),
    row("Source files", "None"), row("Audio input", "Document-derived musical direction; no lyrics or spoken script"),
    row("Cost accounting", "Published-rate estimate; not invoice precision"), row("After uncertain response", "No additional paid request")];
}

function targetProjection(target: Data, options: OutputTermsOptions): OutputTermsTarget | null {
  if(options.output==="video"){
    const parsed=readVideoExecutionOffer(target),expected=options.expectedVideo;
    if(!parsed||!expected||target.targetId!==options.targetId||canonicalJson(parsed.contract)!==canonicalJson(expected.contract)
      ||parsed.original.actorUserId!==expected.actorUserId||parsed.original.projectId!==expected.projectId||parsed.original.documentId!==expected.documentId
      ||Date.parse(String(parsed.original.expiresAt))<=options.now)return null;
    const calls=parsed.calls.map(call=>{const v=call as Record<string,unknown>;return Object.freeze({stage:String(v.stage),rows:rows(row("Provider",String(v.provider)),row("Model",String(v.model)),moneyRow("Maximum spend",Number(v.maximumMicrousd)),row("Maximum input tokens",Number(v.maximumInputTokens)),row("Maximum output tokens",Number(v.maximumOutputTokens)))});});
    return Object.freeze({targetId:options.targetId,calls:Object.freeze(calls),settings:JSON.stringify(parsed.settings,null,2),rows:rows(
      row("Output","1 video · 4 s · 480p · Silent"),row("Generation calls","1 planner · 1 video"),moneyRow("Maximum spend",parsed.maximumMicrousd),
      row("Original job",String(parsed.original.requestId)),row("Deadline",String(parsed.original.expiresAt)),row("Planning provider","OpenAI · gpt-5.6-terra"),
      row("Video provider","fal.ai · Seedance 2.0"),row("Source transfer","Document text → OpenAI · Selected image and direction → fal.ai"),row("Automatic retry","None"),row("Result review","Required"))});
  }
  if (options.output === "model3d") {
    const checked = readModel3dExecutionOffer(target);
    if (!checked || target.targetId !== options.targetId || !options.expectedModel3dContract || !options.model3dCostPreview
      || canonicalJson(checked.contract) !== canonicalJson(options.expectedModel3dContract)
      || canonicalJson(checked.preview) !== canonicalJson(options.model3dCostPreview)) return null;
    const preview = checked.preview;
    return Object.freeze({ targetId: options.targetId, settings: JSON.stringify(checked.settings, null, 2),
      calls: Object.freeze([Object.freeze({ stage: "model3d:initial", rows: rows(row("Provider", "fal.ai / Hyper3D"), row("Model", preview.model), moneyRow("Maximum spend", preview.maximumMicrousd)) })]),
      rows: rows(row("Output", "1 static GLB assembly"), row("Generation calls", "1 Rodin request · No planner or automatic retry"),
        row("Subject", "One requested object; structural checks do not prove semantic object count"),
        row("Original job", preview.requestId), row("Approval deadline", preview.expiresAt),
        row("Source files", preview.sourceFilesTransferred ? "1 owned image or saved PNG view; no mesh transfer" : "None"),
        ...(preview.referenceSha256 ? [row("Exact reference SHA-256", preview.referenceSha256), row("Reference bytes", preview.referenceBytes), row("Reference type", preview.referenceMimeType!)] : []),
        row("Submitted prompt", checked.description.prompt), row("Settings", "Gen-2.5-High · GLB · Auto mesh · No HD pack"),
        row("Result review", "Static rooted assembly, not semantic-object or visual-quality acceptance"),
        row("After uncertain response", "No automatic paid retry; a separately authorized replacement may be available")) });
  }
  if(options.output==="storyboard"){
    const parsed=readStoryboardExecutionOffer(target),expected=options.expectedStoryboard;
    if(!parsed||!expected||target.targetId!==options.targetId||canonicalJson(parsed.contract.source)!==canonicalJson(expected.source)
      ||parsed.original.actorUserId!==expected.actorUserId||parsed.original.projectId!==expected.projectId||parsed.original.documentId!==expected.documentId
      ||Date.parse(String(parsed.original.expiresAt))<=options.now)return null;
    const calls=parsed.calls.map((call)=>{const value=call as Record<string,unknown>;return Object.freeze({stage:String(value.stage),rows:rows(
      row("Provider",String(value.provider)),row("Model",String(value.model)),moneyRow("Maximum spend",Number(value.maximumMicrousd)),
      row("Maximum input tokens",Number(value.maximumInputTokens)),row("Maximum output tokens",Number(value.maximumOutputTokens)))});});
    return Object.freeze({targetId:options.targetId,calls:Object.freeze(calls),settings:JSON.stringify(parsed.settings,null,2),rows:rows(
      row("Output","Exactly 4 storyboard frames"),row("Image size","1536 × 1024 · PNG"),row("Generation calls","1 planner; 4 images · 5 paid stages"),
      moneyRow("Maximum spend",parsed.maximumMicrousd),row("Original job",String(parsed.original.requestId)),row("Deadline",String(parsed.original.expiresAt)),
      row("Planning provider","OpenAI · gpt-5.6-terra"),row("Image provider","fal.ai · Ideogram V4"),row("Pricing version",parsed.fal.pricingVersion),
      row("Cost accounting","Published-rate estimate; not provider invoice precision"),row("Safety provider","OpenAI · omni-moderation-latest"),
      row("Safety input","Exact final text prompt before each image"),row("Maximum safety checks","4 additional; separate from 5 paid generation stages"),
      row("Source transfer",String(parsed.offer.transferDescription)),row("Reference pixels","None"),row("Repair and automatic retry","None"),
      row("Result review","Four images require your visual review"),row("Execution window","240 seconds; original source/grant deadline still applies"))});
  }
  const audio = options.output === "audio", image = options.output === "image", story = options.output === "short_story", scene = options.output === "scene", single = story || scene, fal = (image || audio) && target.provider === "fal";
  const settings = record(target.settings);
  if (!settings || target.targetId !== options.targetId || target.available !== true
    || target.reasonCode !== (audio ? "output_audio_ready_for_separate_approval" : scene ? "output_scene_ready" : story ? "output_narrative_ready" : fal ? "output_native_fal_image_ready" : image ? "output_native_image_ready" : "output_native_slides_ready")
    || target.transferCode !== (audio ? "output_transfer_audio_not_yet_authorized" : scene ? "output_transfer_scene_after_authorization" : story ? "output_transfer_narrative_after_authorization" : fal ? "output_transfer_fal_image_after_authorization" : "output_transfer_document_after_authorization")
    || !text(target.reason, 16384) || !text(target.transferDescription, 16384)
    || target.provider !== (fal ? "fal" : "openai") || !text(target.model) || !text(target.route)
    || target.route !== (audio ? "document-audio-timed-music-manual-v1" : scene ? "document-scene-screenplay-manual-v1" : story ? "document-short-story-manual-v1" : fal ? "document-image-fal-manual-v1" : image ? "document-image-manual-v1" : "document-slides-manual-v1")
    || !ceiling(target.maximumMicrousd) || target.maximumCalls !== (audio ? 3 : single ? 1 : 2) || !positive(target.maximumTokens)
    || !policy(settings.executionPolicy) || !settingCeilings(settings)) return null;
  const reasonValues = target.reasonValues === undefined ? null : record(target.reasonValues);
  if (target.reasonValues !== undefined && (!reasonValues
    || Object.keys(reasonValues).some(key => key !== "maximumExecutionSeconds")
    || reasonValues.maximumExecutionSeconds !== 240)) return null;
  const payload = record(settings.payload);
  if (!payload || payload.productionMode !== "manual"
    || (audio ? Object.hasOwn(payload, "budgetAcknowledged") || Object.hasOwn(payload, "preflightAcknowledged")
      : payload.budgetAcknowledged !== true || payload.preflightAcknowledged !== true)) return null;
  const calls = settings.calls;
  if (!Array.isArray(calls) || calls.length !== (audio ? 3 : single ? 1 : 2)) return null;
  const expectedStages = audio ? ["planning:0:initial", "planning:0:repair", "audio:initial"] : single ? ["planning:0:initial"] : image ? ["planning:initial", "image:initial"] : ["planning:0:initial", "planning:0:repair"];
  const projectedCalls: Array<Readonly<{ stage: string; rows: readonly OutputTermsRow[] }>> = [];
  let callCost = 0;
  for (let index = 0; index < calls.length; index++) {
    const call = record(calls[index]);
    if (!call || call.stage !== expectedStages[index] || call.provider !== (fal && index === (audio ? 2 : 1) ? "fal" : "openai")
      || !text(call.model) || !ceiling(call.maximumMicrousd)) return null;
    callCost += call.maximumMicrousd;
    if (!Number.isSafeInteger(callCost)) return null;
    const callRows = [row("Provider", call.provider), row("Model", call.model), moneyRow("Maximum spend", call.maximumMicrousd)];
    if (audio) {
      if (index < 2) {
        if (!positive(call.maximumInputTokens) || call.maximumOutputTokens !== 3000) return null;
        callRows.push(row("Maximum input tokens", call.maximumInputTokens), row("Maximum output tokens", call.maximumOutputTokens));
      }
    } else if (single) {
      if (!positive(call.maximumInputTokens) || !positive(call.maximumOutputTokens)) return null;
      callRows.push(row("Maximum input tokens", call.maximumInputTokens), row("Maximum output tokens", call.maximumOutputTokens));
    } else if (!image) {
      if (!positive(call.maximumInputTokens) || !positive(call.maximumOutputTokens) || !record(call.presentationRoute)
        || record(call.presentationRoute)!.model !== call.model) return null;
      callRows.push(row("Maximum input tokens", call.maximumInputTokens), row("Maximum output tokens", call.maximumOutputTokens),
        row("Model route", JSON.stringify(call.presentationRoute)));
    } else {
      for (const key of ["maximumInputTokens", "maximumOutputTokens"] as const) {
        if (call[key] !== undefined) {
          if (!ceiling(call[key])) return null;
          callRows.push(row(key === "maximumInputTokens" ? "Maximum input tokens" : "Maximum output tokens", call[key]));
        }
      }
    }
    projectedCalls.push(Object.freeze({ stage: call.stage, rows: Object.freeze(callRows) }));
  }
  if (callCost !== target.maximumMicrousd || target.model !== record(calls[audio ? 2 : image ? 1 : 0])?.model) return null;
  const detail: OutputTermsRow[] = [row("Output", audio ? "1 instrumental track · about 20 seconds" : scene ? "1 written scene · 2 characters · 1 location · 1–2 pages" : story ? "1 story · 600–800 words" : image ? "1 image" : "5 slides"), row("Target", options.targetId),
    row("Provider", target.provider), row("Model", target.model), row("Route", target.route),
    moneyRow("Maximum spend", target.maximumMicrousd), row("Maximum generation calls", target.maximumCalls),
    row("Maximum tokens", target.maximumTokens), row("Execution window", "240 seconds"),
    row("Heartbeat interval", "60 seconds"), row("Maximum renewals", 3)];
  if (audio) {
    const projected = audioSettings(settings, payload, target, options);
    if (!projected) return null;
    detail.push(...projected);
  } else if (image) {
    const imageRows = fal ? falImageSettings(settings, payload, target, options.expectedImageSize) : imageSettings(settings, payload, target, options.expectedImageSize);
    if (!imageRows) return null;
    detail.push(...imageRows);
  } else if (scene) {
    const projected = sceneSettings(settings, payload, target, options);
    if (!projected) return null;
    detail.push(...projected);
  } else if (story) {
    const narrative = record(payload.outputNarrative), call = record(calls[0]);
    if (settings.kind !== "render_document" || payload.artifactKind !== "short_story" || payload.itemCount !== 3 || !narrative || Object.keys(narrative).length !== 11
      || narrative.schemaVersion !== 1 || !parseShortStoryNarrativeContract(narrative.contract) || typeof narrative.contractDigest !== "string" || !/^[a-f0-9]{64}$/u.test(narrative.contractDigest)
      || narrative.model !== "gpt-5.6-terra" || narrative.model !== call?.model || narrative.maximumCalls !== 1 || narrative.maximumOutputTokens !== 6000
      || !positive(narrative.maximumInputTokens) || Number(narrative.maximumInputTokens) < 4096 || Number(narrative.maximumInputTokens) > 122000
      || call.maximumInputTokens !== narrative.maximumInputTokens || call.maximumOutputTokens !== narrative.maximumOutputTokens || target.maximumTokens !== 128000
      || narrative.stage !== "planning:0:initial" || narrative.reasoningEffort !== "low" || narrative.cachePolicy !== "disabled-explicit" || !text(narrative.pricingVersion)) return null;
    detail.push(row("Language", "English"), row("Format", "Fiction · Plain prose"), row("Word count", "600–800"), row("Generation calls", "1 initial · No automatic repair"));
  } else {
    const count = record(payload.slideCountPolicy);
    if (settings.kind !== "render_document" || payload.artifactKind !== "slides" || payload.itemCount !== 5
      || payload.requestedSlideCount !== 5 || !count || count.kind !== "exact" || count.unit !== "slide"
      || count.value !== 5 || Object.keys(count).length !== 3) return null;
    detail.push(row("Slide count", "Exactly 5"), row("Generation calls", "1 initial; at most 1 repair"));
  }
  detail.push(row("Source transfer", "Authorized Document context; selected target instructions"),
    row("Transfer timing", "After authorization and Create"), row("Preflight transfer", "None"));
  return Object.freeze({ targetId: options.targetId, rows: Object.freeze(detail),
    calls: Object.freeze(projectedCalls), settings: JSON.stringify(settings, null, 2) });
}

function grantProjection(value: Json, offer: Data, targetId: string, now: number, allowRecordedResume: boolean): {
  available: boolean; reason: OutputTerms["grantReasonCode"]; rows: readonly OutputTermsRow[]; usage?: OutputTermsSummary["usage"];
} {
  const invalid = { available: false, reason: "grant_unavailable" as const, rows: Object.freeze([]) };
  const grant = record(value);
  if (!grant || !text(grant.id) || grant.planRevisionId !== offer.planRevisionId
    || !text(grant.actorUserId) || !text(grant.payerUserId) || !record(grant.disclosure)
    || !same(grant.disclosure, offer) || !["authorized", "active", "completed", "revoked", "exceeded"].includes(String(grant.status))
    || !Array.isArray(grant.operations) || grant.operations.length !== 1) return invalid;
  for (const key of ["maximumMicrousd", "maximumCalls", "usedMicrousd", "exposedMicrousd", "usedCalls", "pendingCalls"] as const)
    if (!ceiling(grant[key])) return invalid;
  if (grant.maximumMicrousd !== offer.maximumMicrousd || grant.maximumCalls !== offer.maximumCalls) return invalid;
  const operation = record(grant.operations[0]);
  if (!operation || !text(operation.id) || !text(operation.jobId) || operation.targetId !== targetId || !text(operation.status)) return invalid;
  for (const key of ["maximumMicrousd", "maximumCalls", "usedMicrousd", "exposedMicrousd", "usedCalls", "pendingCalls"] as const)
    if (!ceiling(operation[key])) return invalid;
  const target = record((offer.targets as Json[])[0])!;
  if (operation.maximumMicrousd !== target.maximumMicrousd || operation.maximumCalls !== target.maximumCalls) return invalid;
  const expiry = stamp(grant.expiresAt);
  if (expiry === null) return invalid;
  const grantRows = rows(row("Grant", grant.id), row("Status", String(grant.status)), row("Actor", grant.actorUserId), row("Payer", grant.payerUserId),
    row("Deadline", String(grant.expiresAt)), moneyRow("Maximum spend", grant.maximumMicrousd as number), row("Maximum calls", String(grant.maximumCalls)),
    moneyRow("Used spend", grant.usedMicrousd as number), moneyRow("Unresolved exposure", grant.exposedMicrousd as number),
    row("Used calls", String(grant.usedCalls)), row("Pending calls", String(grant.pendingCalls)), row("Operation", operation.id),
    row("Target", targetId), row("Job", operation.jobId), row("Operation status", operation.status),
    moneyRow("Operation maximum spend", operation.maximumMicrousd as number), row("Operation maximum calls", String(operation.maximumCalls)),
    moneyRow("Operation used spend", operation.usedMicrousd as number), moneyRow("Operation unresolved exposure", operation.exposedMicrousd as number),
    row("Operation used calls", String(operation.usedCalls)), row("Operation pending calls", String(operation.pendingCalls)));
  const eligibleStatus = grant.status === "authorized" || (allowRecordedResume === true && grant.status === "active");
  return { available: expiry > now && eligibleStatus,
    reason: expiry <= now ? "grant_expired" : !eligibleStatus ? "grant_not_authorized" : null, rows: grantRows,
    usage: Object.freeze({ expiresAt: String(grant.expiresAt), usedSpend: outputTermsMoney(grant.usedMicrousd)!,
      unresolvedExposure: outputTermsMoney(grant.exposedMicrousd)!, pendingCalls: grant.pendingCalls as number,
      payer: String(grant.payerUserId), differentPayer: grant.payerUserId !== grant.actorUserId }) };
}

function summaryProjection(offer: Data, target: Data, options: OutputTermsOptions, usage: OutputTermsSummary["usage"]): OutputTermsSummary | undefined {
  if (!["image", "slides", "short_story", "scene", "audio", "storyboard", "model3d"].includes(options.output)) return undefined;
  // Called only after targetProjection validates these exact snapshotted settings.
  // Do not select, omit or reinterpret terms by their translated display labels.
  const settings = record(target.settings)!, calls = settings.calls as Data[];
  const model3d = options.output === "model3d", image = options.output === "image", audio = options.output === "audio", storyboard = options.output === "storyboard", fal = image && target.provider === "fal";
  const story = options.output === "short_story", scene = options.output === "scene";
  const output = model3d ? "1 static GLB assembly" : storyboard ? "Exactly 4 storyboard frames" : audio ? "1 instrumental track · about 20 seconds" : scene ? "1 written scene · 2 characters · 1 location · 1–2 pages" : story ? "1 story · 600–800 words" : image ? "1 image" : "5 slides";
  const constraints: OutputTermsRow[] = [];
  if (model3d) constraints.push(row("Format", "GLB · Static rooted assembly"), row("Reference files", options.model3dCostPreview?.sourceFilesTransferred ? "1 owned image or saved PNG view; no mesh transfer" : "None"));
  else if (storyboard) constraints.push(row("Image size", "1536 × 1024 · PNG"), row("Reference pixels", "None"));
  else if (audio) constraints.push(row("Duration", "20-second request; measured duration only after media inspection"), row("Source files", "None"));
  else if (image) {
    const render = record(settings.imageRender)!, ratio = record(record(render.format)!.aspect_ratio)!;
    constraints.push(row("Image size", String(render.size)));
    constraints.push(row("Aspect ratio", `${ratio.width}:${ratio.height}`), row("Reference pixels", "Unavailable"));
    if (fal) constraints.push(row("Image format", "PNG"), row("Quality", String(record(record(settings.payload)!.outputFalImage)!.renderingSpeed)));
    else constraints.push(row("Quality", "high"));
  } else if (story) constraints.push(row("Language", "English"), row("Format", "Fiction · Plain prose"));
  else if (scene) constraints.push(row("Format", "Written screenplay · Action and dialogue"), row("Page layout", "1–2 US Letter pages · DM Mono 12 pt"));
  const caveats = [
    "Charges may remain if validation fails.",
    "A timeout does not confirm provider cancellation; unresolved allowance remains held.",
    "This is Forma’s admission cap; provider billing and account limits are separate.",
  ];
  if (fal || audio || storyboard || model3d) caveats.push("Costs use a published-rate estimate, not invoice precision.", "After an uncertain response, no additional paid request; recover the original request only.");
  else if (image) caveats.push("Cost accounting uses provider receipts. No additional request after overrun or an uncertain response.", "The separate safety check is free in the retained native disclosure.");
  if (model3d) caveats.push("Structural checks do not prove semantic object count or visual quality. Inspect the resulting model.");
  if (storyboard) caveats.push("No repair request or automatic retry. Review all four resulting images.");
  const recipients = [...new Map(calls.map(call => [JSON.stringify([call.provider, call.model]),
    Object.freeze({ provider: call.provider === "openai" ? "OpenAI" : "fal.ai", model: String(call.model) })])).values()];
  return Object.freeze({ output, constraints: Object.freeze(constraints),
    maximumSpend: outputTermsMoney(offer.maximumMicrousd)!, maximumGenerationCalls: offer.maximumCalls as number,
    requests: model3d ? "1 Rodin request · No planner or automatic retry" : storyboard ? "1 planner; 4 images · 5 paid stages" : audio ? "1 planning call; at most 1 repair; 1 audio request" : image ? "1 direction; 1 image" : story || scene ? "1 initial · No automatic repair" : "1 initial; at most 1 repair",
    source: model3d ? "The displayed Document-derived prompt, fixed settings and listed owned image or saved PNG view go to fal.ai / Hyper3D Rodin; original mesh bytes are not transferred" : storyboard ? "Current Document context goes to OpenAI for planning; each planned frame direction goes to fal.ai / Ideogram 4" : audio ? "Document context goes to OpenAI for planning; musical direction goes to fal.ai, with no lyrics, spoken script or source files" : "Authorized Document context; selected target instructions",
    transfer: "Transfer starts after authorization and Create. Check cost sends no source content.",
    recipients: Object.freeze(recipients), safety: image || storyboard ? Object.freeze({ maximumChecks: storyboard ? 4 : 1, provider: "OpenAI", model: "omni-moderation-latest",
      input: storyboard ? "Exact final text prompt before each image" : fal ? "Exact adapted image prompt; text" : "Exact final image prompt; text" }) : null,
    expiresAt: String(offer.expiresAt), caveats: Object.freeze(caveats), usage });
}

export type OutputTermsNotice = "terms_unavailable" | "terms_expired" | "review" | "authorized" | "grant_expired" | "grant_unavailable" | "pending" | "uncertain" | "finished";
/** Presentation only. Recorded work is never converted into a new-create offer. */
export function outputTermsNotice(terms: OutputTerms | null, state: {
  status: string; originalRunRecorded: boolean; authorize: boolean; run: boolean; resumeRun: boolean;
}): OutputTermsNotice {
  if (state.originalRunRecorded) {
    if (state.status === "queued" || state.status === "running") return "pending";
    if (state.status === "uncertain") return "uncertain";
    if (["succeeded", "failed", "cancelled", "partial"].includes(state.status)) return "finished";
  }
  if (!terms?.rows.length) return "terms_unavailable";
  if (state.authorize) return terms.available ? "review" : terms.reasonCode === "terms_expired" ? "terms_expired" : "terms_unavailable";
  if (state.run || state.resumeRun || state.status === "authorized") return (state.run || state.resumeRun) && terms.grantAvailable ? "authorized" : terms.grantReasonCode === "grant_expired" ? "grant_expired" : "grant_unavailable";
  return terms.reasonCode === "terms_expired" ? "terms_expired" : "terms_unavailable";
}

export function outputTerms(preflight: OutputPreflight, options: OutputTermsOptions): OutputTerms {
  try {
    if (!options || !Number.isFinite(options.now) || options.now < 0 || !["image", "slides", "short_story", "scene", "storyboard", "audio", "video", "model3d"].includes(options.output)
      || typeof options.targetId !== "string" || !options.targetId.trim()) return unknownTerms;
    // The closed Scene response schema reaches depth 19 in the quoted offer.
    // Keep the same node/string bounds and preserve other output limits.
    const offer = record(snapshot(preflight, options.output === "scene" ? 24 : 14));
    if (!offer || !Array.isArray(offer.targets) || offer.targets.length !== 1
      || !ceiling(offer.maximumMicrousd) || !positive(offer.maximumCalls)) return unknownTerms;
    for (const key of ["id", "planRevisionId", "termsDigest", "sourceDigest", "requirementsDigest"])
      if (!text(offer[key])) return unknownTerms;
    const created = stamp(offer.createdAt), expiry = stamp(offer.expiresAt);
    if (created === null || expiry === null || expiry <= created || created > options.now) return unknownTerms;
    const target = record(offer.targets[0]);
    if (!target || !ceiling(target.maximumMicrousd) || !ceiling(target.maximumCalls)
      || target.maximumMicrousd > offer.maximumMicrousd || target.maximumCalls > offer.maximumCalls) return unknownTerms;
    const attempt = record(record(offer.operationAttempts)?.[options.targetId]);
    if (!attempt || !ceiling(attempt.ordinal) || attempt.previousSlotId !== null
      || Object.keys(record(offer.operationAttempts)!).length !== 1) return unknownTerms;
    if (target.provider === "fal" && (offer.maximumMicrousd !== target.maximumMicrousd || offer.maximumCalls !== (options.output==="storyboard"?5:options.output==="audio"?3:options.output==="model3d"?1:2) || attempt.ordinal !== 0)) return unknownTerms;
    if(options.output==="storyboard"||options.output==="video"){
      const checked=options.output==="video"?readVideoExecutionOffer(target):readStoryboardExecutionOffer(target);
      if(!checked||checked.original.sourceDigest!==offer.sourceDigest||checked.original.requirementsDigest!==offer.requirementsDigest
        ||expiry>Date.parse(String(checked.original.expiresAt)))return unknownTerms;
    }
    if ((options.output === "short_story" || options.output === "scene") && (offer.maximumMicrousd !== target.maximumMicrousd || offer.maximumCalls !== 1 || attempt.ordinal !== 0)) return unknownTerms;
    if (options.output === "model3d") {
      const checked = readModel3dExecutionOffer(target);
      if (!checked || checked.preview.sourceDigest !== offer.sourceDigest || checked.preview.requirementsDigest !== offer.requirementsDigest
        || expiry > Date.parse(checked.preview.expiresAt)) return unknownTerms;
    }
    const projected = targetProjection(target, options);
    if (!projected) return unknownTerms;
    const grantData=options.grant==null?null:snapshot(options.grant,options.output==="scene"?24:14);
    if((options.output==="storyboard"||options.output==="video")&&grantData){
      const checked=options.output==="video"?readVideoExecutionOffer(target):readStoryboardExecutionOffer(target),g=record(grantData),operation=Array.isArray(g?.operations)?record(g.operations[0]):null;
      if(!checked||!g||operation?.jobId!==checked.original.requestId||stamp(g.expiresAt)===null||(stamp(g.expiresAt)??Infinity)>Date.parse(String(checked.original.expiresAt)))return unknownTerms;
    }
    if (options.output === "model3d" && grantData) {
      const checked = readModel3dExecutionOffer(target), g = record(grantData), operation = Array.isArray(g?.operations) ? record(g.operations[0]) : null;
      if (!checked || !g || operation?.jobId !== checked.preview.requestId || stamp(g.expiresAt) === null
        || (stamp(g.expiresAt) ?? Infinity) > Date.parse(checked.preview.expiresAt)) return unknownTerms;
    }
    const grant = grantData===null?null:grantProjection(grantData, offer, options.targetId, options.now, options.allowRecordedResume === true);
    const available = expiry > options.now;
    return Object.freeze({ available, reasonCode: available ? null : "terms_expired",
      grantAvailable: grant?.available === true,
      grantReasonCode: grant?.reason ?? (options.grant == null ? "grant_unavailable" : null),
      expiresAt: String(offer.expiresAt),
      rows: rows(moneyRow("Maximum spend", offer.maximumMicrousd), row("Maximum generation calls", offer.maximumCalls),
        row("Target maximum tokens", target.maximumTokens as number), row("Deadline", String(offer.expiresAt)),
        row("Validation failure", "Charges may remain"), row("Timeout cancellation", "Unconfirmed; unresolved allowance held"),
        row("Billing limits", "Application admission cap; separate provider and account ceilings")),
      targets: Object.freeze([projected]), grantRows: grant?.rows ?? Object.freeze([]),
      summary: summaryProjection(offer, target, options, grant?.usage ?? null) });
  } catch { return unknownTerms; }
}
