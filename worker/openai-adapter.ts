import type { WorkerEnv } from "./runtime.ts";
import { ApiError, createFalClient } from "@fal-ai/client";
import { BLOCK_TYPES, sendsReferencePixels, type AdaptiveStructure, type BlockKind, type ReferencePixelMode } from "../src/model/block-types.ts";
import type { LiveReplayPlan } from "../src/model/live-replay.ts";
import { buildBoundedPromptRepresentation, buildReferencePromptDirectives, buildSpatialPromptDirectives, normalizePromptTechnique, type PromptReferenceDescriptor, type PromptTechnique } from "../src/model/prompt-structures.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse, type ProviderAttemptAccounting, type ProviderFailureDetail } from "./provider-errors.ts";
import { normalizeImageFormat, validateProviderImageSize } from "../src/model/image-format.ts";
import { buildReplayDevelopmentStages, type CreativeStudyKind, type ReplayDevelopmentStage } from "../src/model/replay-development.ts";
import { moderateExactImagePrompt } from "./openai-moderation.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent, resolveDocumentArtifactContextGroups, slideCopyIsNearDuplicate, slideCopyIssues, slideDeckCopyIssues, slideVisualIsComplete, SLIDE_LAYOUTS, SLIDE_STYLE_PRESET_IDS, SLIDE_VISUAL_KINDS, type DocumentArtifactContextGroupContract, type DocumentArtifactDraft, type DocumentArtifactKind, type DocumentArtifactValidationIssue, type SlidePresentation, type SlideStylePresetId, type SlideVisualData, type SlideVisualDatum } from "../src/model/document-artifacts.ts";
import { combinedContextGroups, combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { creativeEvaluationPromptGuardrails, creativePromptGuardrails, promptFactIsActive, providerFacingCreativeContext, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { REPLAY_EXPERIENCE_PROFILES, replayExperienceDefinition, type ReplayExperienceId } from "../src/model/replay-experiences.ts";
import { DEFAULT_REFERENCE_VIDEO_MODEL, DEFAULT_VIDEO_MODEL, isVideoAudioMode, isVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, type VideoAudioMode, type VideoDurationSeconds } from "../src/model/video-adapter.ts";
import { VIDEO_AUDIO_REFERENCE_CONTRACT, AudioAdapterSelectionError, audioRightsAllowed, type AudioRequestProfile } from "../src/model/audio.ts";
import { AudioProviderInputError } from "../src/model/audio-provider-contracts.ts";
import { adaptAudioPrompt, audioPreparationConstraints } from "./audio-prompt-adapter.ts";
import { selectAudioAdapter } from "./audio-selection.ts";
import { productionTeamFor, productionTeamInstructions, providerFacingProductionContinuity, type ManagedProductionPlan, type ProductionMode, type ProductionScene } from "../src/model/managed-production.ts";
import { createSceneConfiguration, type SceneConfiguration, type SceneMedium } from "../src/model/scene-configuration.ts";
import { buildPresentationSourceContract, inferPresentationAudienceLocale, providerFacingPresentationSourceContract, repairProtectedPresentationMessages, resolvePresentationSourceReferences, type PresentationSourceContract, type PresentationSourceSlide } from "../src/model/presentation-source.ts";
import { PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS } from "../src/model/presentation-layout.ts";
import { safePresentationCandidateIssues } from "../src/model/presentation-candidates.ts";
import { generationValidationReceipt } from "./generation-self-healing.ts";
import { adaptVideoPrompt, compactVideoCombinedContextPlan, resolveVideoAudioPolicy, videoPlannerCreativeContext, type VideoPromptAdaptation } from "./video-prompt-adapter.ts";
import { projectVideoSourceCopy, videoOutputScopedContext } from "./video-source-scope.ts";
import { definitiveProviderRejection, type PaidProviderSubmission, type PaidProviderSubmissionObserver } from "../src/model/provider-submission.ts";
import { priceImageUsageBreakdownMicrousd, priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";

type OpenAIError = { message?: string; type?: string; code?: string | null; param?: string | null };
type OpenAIResponse = { id?: string; model?: string; status?: string; incomplete_details?:{reason?:string}; output_text?: string; output?: Array<{ type?:string; content?: Array<{ type?: string; text?: string; refusal?:string }> }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: OpenAIError };
type OpenAIImageUsage = { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
type OpenAIImageResponse = { created?: number; data?: Array<{ b64_json?: string; revised_prompt?: string }>; usage?: OpenAIImageUsage; error?: OpenAIError };
type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
type FalQueueResponse = { status?: FalQueueStatus; request_id?: string; response_url?:string; status_url?:string; cancel_url?:string; queue_position?: number; logs?: Array<{ message?: string; timestamp?: string }>; metrics?: { inference_time?: number }; error?: OpenAIError };
type FalVideoFile = { url?: string; content_type?: string; file_name?: string; file_size?: number };
type FalVideoResponse = { video?: FalVideoFile; data?: { video?: FalVideoFile }; error?: OpenAIError };
type OpenAIImageStreamEvent = { type?: string; b64_json?: string; created_at?: number; size?: string; output_format?: ImageOutputFormat; partial_image_index?: number; usage?: OpenAIImageUsage; error?: { message?: string } };
export type CreativeChatMutation = { operation: "create" | "edit" | "remove"; target_block_id: string | null; type: BlockKind; subtype: string; instruction: string; handle: string; reference_pixel_mode: ReferencePixelMode | "unchanged"; image_format: { aspect_ratio:string; width:number; height:number } | null };
export type CreativeChatResponse = { reply: string; mutations: CreativeChatMutation[]; preview_direction: string; preview_worthy: boolean };
export type ImageReference = { bytes: Uint8Array; mimeType: string; blockId?: string; referenceId?: string; label?: string; mode?: ReferencePixelMode; source: "uploaded-reference" | "ideation-preview" | "locked-study"; provider?:string|null; providerModel?:string|null; providerRequestId?:string|null; providerMediaUrl?:string|null };
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type CreativeImagePartial = { bytes: Uint8Array; index: number; mimeType: string; width: number; height: number };
export type CreativeImageOptions = {
  onProviderSubmission?: PaidProviderSubmissionObserver;
  providerClientRequestId?: string;
  quality?: "low" | "medium" | "high";
  size?: `${number}x${number}`;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  partialImages?: 0 | 1 | 2 | 3;
  onPartial?: (partial: CreativeImagePartial) => void | Promise<void>;
  references?: ImageReference[];
  promptTechnique?: PromptTechnique;
  /** Internal evaluation/provider bridge. The caller must retain the compiler receipt. */
  preparedPrompt?: string;
  /** Ideogram-only routing. Native captions are deterministic; expanded plain text delegates rewriting to Fal. */
  ideogramPromptMode?: "native_caption" | "expanded_plain";
  /** Ideogram-only prompt expansion override. Production native captions default to None. */
  ideogramExpansionModel?: "None" | "Medium" | "Large";
  /** Evaluation-only native-caption emphasis profile. */
  ideogramCaptionStrategy?: "balanced" | "spatial_strict" | "material_explicit" | "spatial_material" | "all_facts" | "composition_lock" | "semantic_checklist" | "constraint_first" | "compact_literal" | "literal_contract" | "production_director" | "shot_plan" | "clean_editorial";
  /** Evaluation-only immutable candidate identity. Production callers omit this. */
  ideogramAdapterVersion?: string;
  /** Evaluation-only Fal image-to-image transformation-strength override. */
  ideogramReferenceStrength?: number;
  /** Evaluation-only deterministic Fal seed. Retained in the provider receipt. */
  ideogramSeed?: number;
  signal?: AbortSignal;
  onStage?: (stage:string,message:string) => void | Promise<void>;
};
export type LiveReplayPlanningContext = { stage: ReplayDevelopmentStage; lockedStudies: Array<{ kind: CreativeStudyKind; label: string; lockSummary: string; lockedDecisions: LiveReplayPlan["development"]["locked_decisions"] }>; experienceProfile?:ReplayExperienceId };
export type ProductionPageContext = {
  pageIndex: number;
  pageCount: number;
  globalStartIndex: number;
  totalItems: number;
  phase: "complete" | "opening" | "continuation" | "final";
  priorSummary: string;
  priorEnding: string;
  priorVisibleCopy: string[];
  authoredSlideNumbers?: number[];
  lockedPresentation?: SlidePresentation | null;
  repairIssues?: string[];
};
export type ProviderAttemptReceipt = { model:string; responseId:string; responseIds:string[]; usage:{inputTokens:number;outputTokens:number;totalTokens:number}; latencyMs:number };
export const PRESENTATION_ADAPTER_VERSION="2026-08-26-source-aware-render-v4";
export const MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES=512*1024;
export type ProviderResponseReceipt=ProviderAttemptReceipt&{candidateRaw:string|null;candidateBytes:number;candidateTruncated:boolean;completionStatus?:string;incompleteReason?:string};
export type ProviderAttemptPreflight = {model:string;maximumInputTokens:number;maximumOutputTokens:number;clientRequestId:string};
export type DocumentArtifactOptions = { itemCount?:number; audience?:string; tone?:string; locale?:string; outputLocale?:string; presentationStyle?:SlideStylePresetId; presentationFidelity?:"faithful"|"creative"; requestedSlideCount?:number; authoredSlideCount?:number; videoSeconds?:VideoDurationSeconds; videoSize?:"1280x720"|"720x1280"; videoAudioMode?:VideoAudioMode; audioProfile?:AudioRequestProfile; audioProviderModel?:string; sceneMedium?:SceneMedium; sceneConfiguration?:SceneConfiguration; productionMode?:ProductionMode; productionPlan?:ManagedProductionPlan; productionScenes?:ProductionScene[]; productionPage?:ProductionPageContext; signal?:AbortSignal; onProviderSubmission?:PaidProviderSubmissionObserver; onProviderResponse?:(receipt:ProviderResponseReceipt)=>void|Promise<void>;onProviderAttempt?:(receipt:ProviderAttemptReceipt)=>void|Promise<void>;onBeforeProviderAttempt?:(attempt:ProviderAttemptPreflight)=>void|Promise<void> };
export type VideoReference = { bytes:Uint8Array; mimeType:string; blockId:string; referenceId:string; label:string; mode:ReferencePixelMode; sequence:number|null; shotDirection:string; cameraDirection:string; framePrompt:string; sourceArtifactId:string|null; sourceArtifactItemId:string|null; sourceArtifactKind:string|null; storyboardTitle:string; contextGroups?:Array<{id:string;name:string;target:string;role:string;application:string;relativity:number}>; provider?:string|null; providerModel?:string|null; providerRequestId?:string|null; providerMediaUrl?:string|null };
export type VideoAudioReference = { bytes:Uint8Array; mimeType:string; blockId:string; referenceId:string; label:string; durationSeconds:number; rightsClass:string };
export type CreativeVideoPreparedReceipt = { provider:string; model:string; submittedPrompt:string; parameters:Record<string,unknown>; referenceInputs:Array<Record<string,unknown>>; usedReferencePixels:boolean; adaptation?:VideoPromptAdaptation };
export type CreativeVideoOptions = { seconds:VideoDurationSeconds; size:"1280x720"|"720x1280"; resolution?:"480p"|"720p"; audioMode?:VideoAudioMode; generateAudio?:boolean; endUserId?:string; referencePromptProfile?:"standard"|"positive-only"; providerJobId?:string; providerModel?:string; providerStatusUrl?:string; providerResponseUrl?:string; providerCancelUrl?:string; references?:VideoReference[]; audioReferences?:VideoAudioReference[]; snapshot?:Record<string,unknown>; plan?:Pick<DocumentArtifactDraft,"title"|"summary"|"items">; productionContinuity?:{prohibitions:string[];scopedTargets:Array<{target:string;role:string;prohibitions:string[]}>}; retainedReceipt?:CreativeVideoPreparedReceipt; signal?:AbortSignal; onStage?:(stage:string,message:string)=>void|Promise<void>; onPrepared?:(receipt:CreativeVideoPreparedReceipt)=>void|Promise<void>; onReceipt?:(receipt:{providerJobId:string;provider:string;model:string;providerStatusUrl:string;providerResponseUrl:string;providerCancelUrl:string})=>void|Promise<void> };

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "rationale", "scene", "palette", "next_moves"],
  properties: {
    title: { type: "string" }, rationale: { type: "string" }, scene: { type: "string" },
    palette: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    next_moves: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
  },
};

const adaptiveStructureSchema = {
  type:"object", additionalProperties:false,
  required:["interpretation","active_decision","suggested_blocks","hidden_until_later"],
  properties:{
    interpretation:{type:"string"},
    active_decision:{type:"object",additionalProperties:false,required:["type","label","prompt","why"],properties:{type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},label:{type:"string"},prompt:{type:"string"},why:{type:"string"}}},
    suggested_blocks:{type:"array",minItems:2,maxItems:6,items:{type:"object",additionalProperties:false,required:["type","subtype","label","instruction","reason","relationship_to"],properties:{type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},subtype:{type:"string"},label:{type:"string"},instruction:{type:"string"},reason:{type:"string"},relationship_to:{type:"string"}}}},
    hidden_until_later:{type:"array",maxItems:5,items:{type:"string"}},
  },
};

const creativeChatSchema = {
  type:"object", additionalProperties:false,
  required:["reply","mutations","preview_direction","preview_worthy"],
  properties:{
    reply:{type:"string"},
    mutations:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["operation","target_block_id","type","subtype","instruction","handle","reference_pixel_mode","image_format"],properties:{
      operation:{type:"string",enum:["create","edit","remove"]},
      target_block_id:{type:["string","null"]},
      type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},
      subtype:{type:"string"},instruction:{type:"string"},handle:{type:"string"},reference_pixel_mode:{type:"string",enum:["unchanged","context_only","inspiration","preserve_composition","preserve_subject","preserve_style"]},image_format:{type:["object","null"],additionalProperties:false,required:["aspect_ratio","width","height"],properties:{aspect_ratio:{type:"string"},width:{type:"integer",minimum:64,maximum:8192},height:{type:"integer",minimum:64,maximum:8192}}},
    }}},
    preview_direction:{type:"string"},preview_worthy:{type:"boolean"},
  },
};

const slidePresentationSchema={
  type:"object",additionalProperties:false,required:["aspect_ratio","theme","footer_label","style_preset","mode","palette"],
  properties:{
    aspect_ratio:{type:"string",enum:["16:9"]},theme:{type:"string",minLength:1,maxLength:80},footer_label:{type:"string",minLength:1,maxLength:80},style_preset:{type:"string",enum:SLIDE_STYLE_PRESET_IDS},mode:{type:"string",enum:["light","dark"]},
    palette:{type:"object",additionalProperties:false,required:["background","foreground","accent","muted","surface"],properties:{background:{type:"string",pattern:"^#[0-9A-Fa-f]{6}$"},foreground:{type:"string",pattern:"^#[0-9A-Fa-f]{6}$"},accent:{type:"string",pattern:"^#[0-9A-Fa-f]{6}$"},muted:{type:"string",pattern:"^#[0-9A-Fa-f]{6}$"},surface:{type:"string",pattern:"^#[0-9A-Fa-f]{6}$"}}},
  },
};
const slideVisualSchema={
  type:"object",additionalProperties:false,required:["layout","kicker","bullets","quote","citations","source_ids","section","source_order","visual"],
  properties:{
    layout:{type:"string",enum:SLIDE_LAYOUTS},
    kicker:{type:"string",minLength:1,maxLength:80},
    bullets:{type:"array",maxItems:24,items:{type:"string",minLength:1,maxLength:320}},
    quote:{type:["object","null"],additionalProperties:false,required:["text","speaker","role","source_id","citation"],properties:{text:{type:"string",minLength:1,maxLength:4000},speaker:{type:"string",minLength:1,maxLength:160},role:{type:"string",minLength:1,maxLength:160},source_id:{type:["string","null"],maxLength:80},citation:{type:["string","null"],maxLength:500}}},
    citations:{type:"array",maxItems:24,items:{type:"object",additionalProperties:false,required:["source_id","label","anchor","excerpt"],properties:{source_id:{type:["string","null"],maxLength:80},label:{type:"string",minLength:1,maxLength:200},anchor:{type:"string",maxLength:240},excerpt:{type:"string",maxLength:1200}}}},
    source_ids:{type:"array",maxItems:48,items:{type:"string",minLength:1,maxLength:80}},
    section:{type:["string","null"],maxLength:160},
    source_order:{type:["integer","null"],minimum:1,maximum:100},
    visual:{
      type:"object",additionalProperties:false,required:["kind","label","value","exact_value","display_value","unit","data"],
      properties:{
        kind:{type:"string",enum:SLIDE_VISUAL_KINDS},
        label:{type:"string",maxLength:160},
        value:{type:"string",maxLength:4000},
        exact_value:{type:["string","null"],maxLength:120},
        display_value:{type:["string","null"],maxLength:120},
        unit:{type:["string","null"],maxLength:60},
        data:{
          type:"array",minItems:0,maxItems:48,
          items:{
            type:"object",additionalProperties:false,required:["label","value","weight","exact_value","display_value","source_ids"],
            properties:{label:{type:"string",minLength:1,maxLength:160},value:{type:"string",maxLength:240},weight:{type:"number",minimum:0,maximum:1},exact_value:{type:["string","null"],maxLength:120},display_value:{type:["string","null"],maxLength:120},source_ids:{type:"array",maxItems:12,items:{type:"string",minLength:1,maxLength:80}}},
          },
        },
      },
    },
  },
};
const documentArtifactSchema=(kind:DocumentArtifactKind,lockedPresentation?:SlidePresentation|null,requestedStyle?:SlideStylePresetId,expectedItemCount?:number,audioConstraints?:ReturnType<typeof audioPreparationConstraints>|null)=>{
  const itemProperties:Record<string,unknown>={title:{type:"string",...(kind==="slides"?{minLength:1}:{})},body:{type:"string"},notes:{type:"string"},image_prompt:{type:"string"},context_group_ids:{type:"array",maxItems:24,items:{type:"string"}}};
  const itemRequired=["title","body","notes","image_prompt","context_group_ids"];
  if(kind==="slides"){itemProperties.slide=slideVisualSchema;itemRequired.push("slide");}
  const exactCount=kind==="slides"&&Number.isSafeInteger(expectedItemCount)&&Number(expectedItemCount)>0?Number(expectedItemCount):null;
  const properties:Record<string,unknown>={title:{type:"string",...(kind==="slides"?{minLength:1}:{})},summary:{type:"string"},content_markdown:{type:"string",...(kind==="slides"?{minLength:1}:{})},items:{type:"array",minItems:exactCount??1,maxItems:exactCount??12,items:{type:"object",additionalProperties:false,required:itemRequired,properties:itemProperties}}};
  const required=["title","summary","content_markdown","items"];
  if(kind==="audio"&&audioConstraints){
    properties.content_markdown=audioConstraints.approved_script_present?{type:"string",enum:[""]}:{type:"string",minLength:1,maxLength:audioConstraints.maximum_content_characters};
    properties.summary={type:"string",maxLength:320};
    itemProperties.notes={type:"string",maxLength:audioConstraints.maximum_style_characters??audioConstraints.maximum_prompt_characters};
  }
  if(kind==="slides"){
    const presentation=structuredClone(slidePresentationSchema);
    if(requestedStyle&&!lockedPresentation){
      const presentationProperties=presentation.properties as Record<string,Record<string,unknown>>;
      presentationProperties.style_preset={...presentationProperties.style_preset,enum:[requestedStyle]};
    }
    if(lockedPresentation){
      const presentationProperties=presentation.properties as Record<string,Record<string,unknown>>;
      presentationProperties.theme={...presentationProperties.theme,enum:[lockedPresentation.theme]};
      presentationProperties.footer_label={...presentationProperties.footer_label,enum:[lockedPresentation.footerLabel]};
      presentationProperties.style_preset={...presentationProperties.style_preset,enum:[lockedPresentation.stylePreset]};
      presentationProperties.mode={...presentationProperties.mode,enum:[lockedPresentation.mode]};
      for(const [key,value] of Object.entries(lockedPresentation.palette)){
        const paletteProperties=presentation.properties.palette.properties as Record<string,Record<string,unknown>>;
        paletteProperties[key]={...paletteProperties[key],enum:[value]};
      }
    }
    properties.presentation=presentation;required.push("presentation");
  }
  return{type:"object",additionalProperties:false,required,properties};
};

const replayDirectionSchema={type:"object",additionalProperties:false,required:["title","rationale","scene","palette","next_moves"],properties:{title:{type:"string"},rationale:{type:"string"},scene:{type:"string"},palette:{type:"array",minItems:3,maxItems:6,items:{type:"string"}},next_moves:{type:"array",minItems:2,maxItems:4,items:{type:"string"}}}};
const replayOutputBriefSchema={type:"object",additionalProperties:false,required:["title","purpose","audience","content_direction","success_signal","beats"],properties:{title:{type:"string",minLength:1,maxLength:120},purpose:{type:"string",minLength:1,maxLength:500},audience:{type:"string",minLength:1,maxLength:160},content_direction:{type:"string",minLength:1,maxLength:1200},success_signal:{type:"string",minLength:1,maxLength:500},beats:{type:"array",minItems:3,maxItems:8,items:{type:"string",minLength:1,maxLength:500}}}};
const replayExperienceSchema={type:"object",additionalProperties:false,required:["profile","value_proposition","creative_arc","library","canvas","outputs","slides_style_preset"],properties:{
  profile:{type:"string",enum:REPLAY_EXPERIENCE_PROFILES.map((profile)=>profile.id)},value_proposition:{type:"string",minLength:1,maxLength:800},creative_arc:{type:"array",minItems:5,maxItems:9,items:{type:"string",minLength:1,maxLength:320}},
  library:{type:"object",additionalProperties:false,required:["goal","reusable_context","search_intent","reuse_decision"],properties:{goal:{type:"string"},reusable_context:{type:"array",minItems:4,maxItems:8,items:{type:"string"}},search_intent:{type:"string"},reuse_decision:{type:"string"}}},
  canvas:{type:"object",additionalProperties:false,required:["goal","synthesis","arrangement","suggested_next_move"],properties:{goal:{type:"string"},synthesis:{type:"string"},arrangement:{type:"string"},suggested_next_move:{type:"string"}}},
  outputs:{type:"object",additionalProperties:false,required:["image","short_story","scene","slides","storyboard","video","audio"],properties:{image:replayOutputBriefSchema,short_story:replayOutputBriefSchema,scene:replayOutputBriefSchema,slides:replayOutputBriefSchema,storyboard:replayOutputBriefSchema,video:replayOutputBriefSchema,audio:replayOutputBriefSchema}},
  slides_style_preset:{type:"string",enum:SLIDE_STYLE_PRESET_IDS},
}};
const liveReplayPlanSchema={
  type:"object",additionalProperties:false,required:["title","summary","user_goal","project_name","document_title","experience","image_format","development","reference","chat_turns","blocks","draft","final","critique","collection","memory","fan_review","friction"],properties:{
    title:{type:"string"},summary:{type:"string"},user_goal:{type:"string"},project_name:{type:"string"},document_title:{type:"string"},experience:replayExperienceSchema,
    image_format:{type:"object",additionalProperties:false,required:["schema_version","aspect_ratio","dimensions"],properties:{schema_version:{type:"integer",enum:[1]},aspect_ratio:{type:"object",additionalProperties:false,required:["width","height"],properties:{width:{type:"integer",minimum:1,maximum:32},height:{type:"integer",minimum:1,maximum:32}}},dimensions:{type:"object",additionalProperties:false,required:["width","height","unit"],properties:{width:{type:"integer",minimum:64,maximum:8192},height:{type:"integer",minimum:64,maximum:8192},unit:{type:"string",enum:["px"]}}}}},
    development:{type:"object",additionalProperties:false,required:["stage_kind","stage_label","focus","purpose","success_criteria","lock_summary","locked_decisions","consumes_studies"],properties:{stage_kind:{type:"string",enum:["character","location","logo","prop","wardrobe","material","lighting","composition"]},stage_label:{type:"string"},focus:{type:"string"},purpose:{type:"string"},success_criteria:{type:"array",minItems:2,maxItems:6,items:{type:"string"}},lock_summary:{type:"string"},locked_decisions:{type:"array",minItems:2,maxItems:8,items:{type:"object",additionalProperties:false,required:["block_type","label","value"],properties:{block_type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},label:{type:"string"},value:{type:"string"}}}},consumes_studies:{type:"array",maxItems:7,items:{type:"string",enum:["character","location","logo","prop","wardrobe","material","lighting"]}}}},
    reference:{type:"object",additionalProperties:false,required:["label","description","source_strategy","source_rationale","generation_prompt","internet_search_query","mood","composition","materials","lighting","spatial","palette"],properties:{label:{type:"string"},description:{type:"string"},source_strategy:{type:"string",enum:["generated","licensed-web"]},source_rationale:{type:"string",maxLength:500},generation_prompt:{type:"string",maxLength:1200},internet_search_query:{type:"string",maxLength:240},mood:{type:"string"},composition:{type:"string"},materials:{type:"string"},lighting:{type:"string"},spatial:{type:"string"},palette:{type:"array",minItems:4,maxItems:6,items:{type:"string"}}}},
    chat_turns:{type:"array",minItems:3,maxItems:5,items:{type:"object",additionalProperties:false,required:["user_message","assistant_reply","resolved_change","live_preview"],properties:{user_message:{type:"string"},assistant_reply:{type:"string"},resolved_change:{type:"string"},live_preview:{type:"boolean"}}}},
    blocks:{type:"array",minItems:BLOCK_TYPES.length,maxItems:BLOCK_TYPES.length,items:{type:"object",additionalProperties:false,required:["type","subtype","label","instruction","intent","applies_to","spatial_method","weight"],properties:{type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},subtype:{type:"string"},label:{type:"string"},instruction:{type:"string"},intent:{type:"string",enum:["include","prefer","avoid","prohibit"]},applies_to:{type:"string",enum:["document","left","right","top","bottom","foreground","background"]},spatial_method:{type:"string",enum:["document","region","aabb","subject","path"]},weight:{type:"number",minimum:0,maximum:1}}}},
    draft:replayDirectionSchema,final:replayDirectionSchema,
    critique:{type:"object",additionalProperties:false,required:["axis","polarity","value","note"],properties:{axis:{type:"string"},polarity:{type:"string",enum:["positive","negative"]},value:{type:"string"},note:{type:"string"}}},
    collection:{type:"object",additionalProperties:false,required:["name","reason"],properties:{name:{type:"string"},reason:{type:"string"}}},
    memory:{type:"object",additionalProperties:false,required:["preference","resurface_condition"],properties:{preference:{type:"string"},resurface_condition:{type:"string"}}},
    fan_review:{type:"object",additionalProperties:false,required:["preferred_technique","promoted_techniques","comparison_note","reasons"],properties:{preferred_technique:{type:"string",enum:["prose","bullets","json","xml"]},promoted_techniques:{type:"array",minItems:1,maxItems:4,items:{type:"string",enum:["prose","bullets","json","xml"]}},comparison_note:{type:"string"},reasons:{type:"object",additionalProperties:false,required:["prose","bullets","json","xml"],properties:{prose:{type:"string"},bullets:{type:"string"},json:{type:"string"},xml:{type:"string"}}}}},
    friction:{type:"object",additionalProperties:false,required:["stuck_moment","recovery_action","view"],properties:{stuck_moment:{type:"string"},recovery_action:{type:"string"},view:{type:"string",enum:["document","board","guided","layers","adaptive","editor","chat"]}}},
  },
};

async function safetyIdentifier(userId: string) {
  const bytes = new TextEncoder().encode(userId); const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `forma_${Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

function openAIAuthHeaders(env: WorkerEnv) {
  return {
    authorization: `Bearer ${env.OPENAI_API_KEY}`,
    ...(env.OPENAI_PROJECT ? { "OpenAI-Project": env.OPENAI_PROJECT } : {}),
  };
}
function openAIHeaders(env: WorkerEnv) { return { ...openAIAuthHeaders(env), "content-type": "application/json" }; }

export const OPENAI_REQUEST_MAX_ATTEMPTS = 3;
export function shouldAutomaticallyRetryProviderFailure(detail: ProviderFailureDetail) {
  return detail.category === "rate_limit" || detail.category === "server" && (detail.httpStatus === 502 || detail.httpStatus === 503 || detail.httpStatus === 504);
}
export function providerRetryDelay(detail: ProviderFailureDetail, attempt: number) {
  const exponential = 1_000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(30_000, Math.max(exponential, detail.retryAfterMs ?? 0));
}
const wait = (delay: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("The operation was aborted.", "AbortError")); return; }
  const timer = setTimeout(resolve, delay);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("The operation was aborted.", "AbortError")); }, { once: true });
});

async function openAIRequest(input: string, init: RequestInit) {
  const endpoint=new URL(input);
  const paidProviderSubmission=(init.method??"GET").toUpperCase()==="POST"&&(endpoint.hostname==="queue.fal.run"||endpoint.hostname==="api.openai.com"&&["/v1/responses","/v1/images/generations","/v1/images/edits"].includes(endpoint.pathname));
  for (let attempt = 1; attempt <= OPENAI_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      const detail = classifyProviderFailure(error);
      // A network failure is ambiguous for a paid POST: it may have reached the provider.
      // Surface a retry affordance to the user instead of risking a duplicate charge here.
      throw new ProviderRequestError(detail);
    }
    if (response.ok) return response;
    let body: unknown = {};
    try { body = await response.clone().json(); } catch { /* Status and headers still classify the failure. */ }
    const detail = classifyProviderFailure(new Error("openai_request_failed"), response, body);
    if (paidProviderSubmission || !shouldAutomaticallyRetryProviderFailure(detail) || attempt === OPENAI_REQUEST_MAX_ATTEMPTS) return response;
    await wait(providerRetryDelay(detail, attempt), init.signal ?? undefined);
  }
  throw new Error("openai_request_failed");
}

const responseText=(body:OpenAIResponse)=>body.output_text||body.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==="output_text")?.text||"";

const verifiedUsage=(usage:unknown)=>{
  if(!usage||typeof usage!=="object")return false;
  const record=usage as Record<string,unknown>;
  return ["input_tokens","output_tokens","total_tokens"].every((key)=>typeof record[key]==="number"&&Number.isSafeInteger(record[key])&&Number(record[key])>=0)
    &&Number(record.total_tokens)===Number(record.input_tokens)+Number(record.output_tokens);
};
const missingUsageReceipt=(requestId:string|null)=>new ProviderRequestError({code:"provider_usage_receipt_missing",category:"server",scope:"provider",action:"contact_support",message:"The provider returned work without complete cost-accounting evidence. The original reservation is held; a zero-dollar charge cannot be verified.",retryable:false,retryAfterMs:null,requestId,httpStatus:200});

/** Preserve creative group semantics without submitting durable relationship identifiers. */
function providerFacingCombinedContextPlan(snapshot:Record<string,unknown>,kind:"image"|DocumentArtifactKind="image"){
  const activeSnapshot={...snapshot,facts:(Array.isArray(snapshot.facts)?snapshot.facts:[]).filter(promptFactIsActive)};
  const groups=combinedContextGroups(activeSnapshot);
  const instructions=combinedContextPromptDirectives(activeSnapshot,kind);
  const plan=groups.map((group,index)=>({
    context_key:`context_group_${index+1}`,
    name:group.name,
    role:group.role,
    target:group.target,
    application:group.application,
    relativity:group.relativity,
    members:group.members.map(({label,role,relativity,order})=>({label,role,relativity,order})),
    instruction:instructions[index],
  }));
  return{groups,plan};
}

/** Assistant mutations retain editable IDs but never see disabled or private source data. */
function providerFacingAssistantContext<T extends{blocks:Array<Record<string,unknown>>;relationships?:Array<Record<string,unknown>>}>(input:T){
  const activeBlocks=input.blocks.filter(promptFactIsActive);
  const facts=activeBlocks.map((block)=>({...block,block_id:block.block_id??block.id??""}));
  const {plan}=providerFacingCombinedContextPlan({facts,relationships:input.relationships??[]});
  const assistantInput={...input};delete assistantInput.relationships;
  return{
    ...providerFacingCreativeContext({...assistantInput,blocks:activeBlocks}) as T,
    ...(plan.length?{combined_context_plan:plan}:{}),
  };
}

export async function generateLiveReplayPlan(env:WorkerEnv,userId:string,seed:string,planningContext?:LiveReplayPlanningContext){
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");const started=Date.now();
  const stage=planningContext?.stage??buildReplayDevelopmentStages([],1)[0];const lockedStudies=planningContext?.lockedStudies??[];
  const experience=replayExperienceDefinition(planningContext?.experienceProfile);
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:`Create a realistic, coherent, fully populated creative-workflow mock for an event-sourced creative system. This is synthetic evaluation data, not a description of implementation. Make every field specific, natural, and user-readable. The requested experience profile is a narrative contract: demonstrate its value through believable choices and consequences, not a feature checklist. Give the Library reusable, searchable context with meaningful relationships. Give the project Canvas a distinct synthesis goal, spatial organization rationale, assistant suggestion, selected composite context, and document handoff. Make every output brief purpose-built: the image, short story, screen scene, visual presentation, storyboard, and video treatment must serve distinct audiences or decisions while sharing one durable creative world. Give each output three to eight concrete, ordered beats written for that form: narrative turns for story, playable action for scene, presentation arguments for slides, shots for storyboard, and motion or audio progression for video. Do not reuse the same beats across forms. Creative arc beats must be concrete enough to structure re-entry and the user-like replay without replacing the output-specific beats. You are planning exactly the supplied development stage. For a study, isolate that subject and define concrete decisions that can be accepted and locked before composition; do not prematurely turn it into the final composed campaign image. For a composition, explicitly preserve and combine every supplied locked study rather than redesigning those accepted parts. Echo the supplied stage kind exactly in development.stage_kind, explain its focus and success criteria, and populate locked_decisions with concise, visually testable decisions. Choose one deliberate target image aspect ratio and pixel size in image_format; make the Format block explain that production choice and ensure its instruction agrees with the structured values. The reference must be a real image before the simulated upload occurs. Choose source_strategy licensed-web when an existing, freely reusable documentary or factual image would strengthen the workflow; otherwise choose generated. Always provide both a concise Wikimedia Commons search query and a self-contained low-quality fallback generation prompt, and explain the choice. Supply exactly one block for every provided block type, with no duplicates; choose a useful supported subtype. Across the blocks use every spatial_method at least once. Include positive direction, role-specific avoid/prohibit constraints, and several local targets that genuinely matter. Write three to five conversational turns that show the stage becoming more precise; Live preview must be true on at least one turn and false on at least one turn so decisions can be batched. The assistant should acknowledge uncertainty and resolve only the requested change. The draft should be fast and exploratory. The final direction should refine that draft. Compare prose, bullets, JSON, and XML handoffs with a distinct, specific reason for each; choose a preferred technique and outputs worth promoting. Include a plausible moment where the user gets stuck in one document view and a concrete recovery. Use valid CSS hex colors. Avoid repeated output copy, generic tour language, placeholders, and mentions of events, schemas, APIs, tests, or internal metadata. ${creativeEvaluationPromptGuardrails()}`,
    input:JSON.stringify({seed:seed.trim()||"Develop a richly art-directed creative campaign through reusable context, spatial synthesis, conversation, reference analysis, local constraints, iteration, multiple deliverable forms, judgment, memory, and re-entry.",experience_profile:{id:experience.id,label:experience.label,summary:experience.summary,planner_brief:experience.plannerBrief},development_stage:stage,locked_studies:lockedStudies,required_block_types:BLOCK_TYPES.map((item)=>({type:item.type,subtypes:item.subtypes,description:item.description}))}),
    text:{verbosity:"medium",format:{type:"json_schema",name:"live_replay_plan",strict:true,schema:liveReplayPlanSchema}},reasoning:{effort:"medium"},max_output_tokens:7500,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`);const raw=responseText(body);if(!raw)throw new Error("provider_returned_no_output");
  let output:LiveReplayPlan;try{output=JSON.parse(raw) as LiveReplayPlan;output.image_format=normalizeImageFormat(output.image_format);}catch{throw new Error("provider_returned_invalid_json");}
  if(output.development?.stage_kind!==stage.kind)throw new Error("provider_returned_wrong_development_stage");
  if(output.experience?.profile!==experience.id)throw new Error("provider_returned_wrong_experience_profile");
  output.development.stage_label=stage.label;output.development.purpose=stage.purpose;output.development.consumes_studies=stage.consumesStudies;
  const supplied=new Set(output.blocks.map((block)=>block.type));const spatialMethods=new Set(output.blocks.map((block)=>block.spatial_method));if(output.blocks.length!==BLOCK_TYPES.length||BLOCK_TYPES.some((definition)=>!supplied.has(definition.type))||["document","region","aabb","subject","path"].some((method)=>!spatialMethods.has(method as LiveReplayPlan["blocks"][number]["spatial_method"])))throw new Error("provider_returned_incomplete_replay_plan");
  if(!output.reference.source_rationale.trim()||!output.reference.generation_prompt.trim()||!output.reference.internet_search_query.trim())throw new Error("provider_returned_incomplete_reference_plan");
  if(output.chat_turns.length<3||!output.chat_turns.some((turn)=>turn.live_preview)||!output.chat_turns.some((turn)=>!turn.live_preview))throw new Error("provider_returned_incomplete_chat_rehearsal");
  const outputBriefs=Object.values(output.experience.outputs);const outputBeatSignatures=new Set(outputBriefs.map((brief)=>brief.beats.map((beat)=>beat.trim().toLowerCase()).join("|")));
  if(output.experience.creative_arc.length<5||output.experience.library.reusable_context.length<4||new Set(outputBriefs.map((brief)=>brief.title.trim().toLowerCase())).size<5||outputBriefs.some((brief)=>brief.beats.length<3)||outputBeatSignatures.size<5)throw new Error("provider_returned_incomplete_experience_plan");
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output,raw,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

export async function generateCreativeDirection(env: WorkerEnv, userId: string, snapshot: Record<string, unknown>, signal?: AbortSignal, locale?: string, onProviderSubmission?: PaidProviderSubmissionObserver) {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const started = Date.now();
  const responseLocale=assistantResponseLocale(locale);
  const instructions = `You are Forma's creative-direction adapter. Write only newly created, user-facing system copy in the user's selected language (${responseLocale}). Preserve the original language and exact text of user-authored document titles, document content, slide outlines and headings, direct quotations, names, facts, and creative decisions verbatim; do not translate or rewrite them. Never translate machine identifiers, enum values, request-local aliases, source IDs, palette values, or structured field names. Interpret every field of the supplied authored and cited context. Return a concrete visual direction, not hidden reasoning. Treat inferred material as suggestive and never claim it was authored. Each supplied fact is active and has an independent semantic role and intent. Every fact whose intent is avoid or prohibit, whose effect is must_not_include, or whose legacy type is exclusion is a negative constraint: apply the prohibition to its named role, and never let the named content become a positive focus in the title, scene, rationale, palette, or next moves. Prohibit is a hard boundary; avoid is a strong negative preference. Weight expresses the constraint's influence, not creative prominence. Prefer facts are positive preferences, while include facts are ordinary positive instructions. A fact's properties.spatial_scope limits where that fact applies. Preserve its named region, rectangle, subject relationship, or custom path in the scene and rationale; do not silently promote a local decision into a whole-image instruction. Combined-context plans are binding semantic isolation boundaries: their members jointly define only the named character, location, object, sequence, scene, message, slide chapter, or visual system. Respect group relativity and never spread a member's wardrobe, palette, material, behavior, or reference identity to an unrelated target. ${creativePromptGuardrails()}`;
  const {plan} = providerFacingCombinedContextPlan(snapshot);
  const plannerInput = JSON.stringify({...providerFacingRenderingContext(snapshot) as Record<string,unknown>,...(plan.length?{combined_context_plan:plan}:{})});
  const submission:PaidProviderSubmission={clientRequestId:`forma-direction-${crypto.randomUUID()}`,provider:"openai",operation:"planning",model:env.OPENAI_MODEL??"gpt-5.6-terra",status:"pending"};
  const identifier=await safetyIdentifier(userId);
  await onProviderSubmission?.(submission);
  const response = await openAIRequest("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {...openAIHeaders(env),"X-Client-Request-Id":submission.clientRequestId},
    signal,
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? "gpt-5.6-terra",
      instructions,
      input: plannerInput,
      text: { verbosity: "low", format: { type: "json_schema", name: "forma_creative_direction", strict: true, schema: outputSchema } },
      reasoning: { effort: "low" }, max_output_tokens: 1200, store: false,
      safety_identifier: identifier,
    }),
  });
  if(!response.ok&&definitiveProviderRejection(response.status))await onProviderSubmission?.({...submission,status:"rejected",costMicrousd:0});
  const body = await response.json() as OpenAIResponse;
  if (!response.ok) throw providerErrorFromResponse(response, body, `openai_${response.status}`, `Creative-direction planner instructions:\n${instructions}\n\nPlanner input:\n${plannerInput}`);
  const paidUsage={inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)};
  await onProviderSubmission?.({...submission,status:"completed",providerRequestId:body.id??response.headers.get("x-request-id")??undefined,...paidUsage,...(verifiedUsage(body.usage)?{costMicrousd:priceTextUsageBreakdownMicrousd(submission.model,paidUsage).totalMicrousd}:{})});
  if(onProviderSubmission&&!verifiedUsage(body.usage))throw missingUsageReceipt(body.id??null);
  const text = responseText(body);
  if (!text) throw new Error("provider_returned_no_output");
  let parsed: Record<string, unknown>; try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("provider_returned_invalid_json"); }
  return { responseId: body.id ?? "", model: body.model ?? env.OPENAI_MODEL ?? "gpt-5.6-terra", output: parsed, raw: text, latencyMs: Date.now() - started, usage: { inputTokens: Number(body.usage?.input_tokens ?? 0), outputTokens: Number(body.usage?.output_tokens ?? 0), totalTokens: Number(body.usage?.total_tokens ?? 0) } };
}

const referenceDescriptors=(references:ImageReference[]):PromptReferenceDescriptor[]=>references.map((reference)=>({blockId:reference.blockId,referenceId:reference.referenceId,label:reference.label,mode:reference.mode,mimeType:reference.mimeType,source:reference.source}));
export const buildSpatialDirectives=buildSpatialPromptDirectives;
export const buildPixelReferenceDirectives=(references:ImageReference[])=>buildReferencePromptDirectives(referenceDescriptors(references));
export const buildCreativeImagePrompt=(snapshot:Record<string,unknown>,direction:Record<string,unknown>,references:ImageReference[] = [],technique:PromptTechnique="prose",options:Pick<CreativeImageOptions,"size"|"quality"|"partialImages">={})=>{
  const prepared=buildBoundedPromptRepresentation(normalizePromptTechnique(technique),snapshot,direction,referenceDescriptors(references),options);
  if(!prepared.fits)throw new ProviderRequestError({code:"image_prompt_too_long",category:"provider",scope:"request",action:"edit_request",message:`The creative context is still ${prepared.finalLength.toLocaleString()} characters after safe compaction; the image provider accepts at most ${prepared.limit.toLocaleString()}. Shorten unusually long block instructions or split this work into a smaller document.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  return prepared.prompt;
};

const imageMimeType=(format:ImageOutputFormat)=>format==="jpeg"?"image/jpeg":format==="webp"?"image/webp":"image/png";
const decodeBase64Image=(encoded:string)=>{try{const binary=atob(encoded);return Uint8Array.from(binary,(character)=>character.charCodeAt(0));}catch{throw new Error("provider_returned_invalid_image");}};
const SUPPORTED_REFERENCE_MIME_TYPES=new Set(["image/png","image/jpeg","image/webp"]);
const MAX_REFERENCE_IMAGE_BYTES=50*1024*1024;
export const validateImageReferences=(references:ImageReference[])=>{
  for(const [index,reference] of references.entries()){
    if(!reference.bytes.byteLength)throw new ProviderRequestError({code:"reference_image_empty",category:"provider",scope:"request",action:"edit_request",message:`Reference image ${index+1} has no pixels. Replace or remove it before generating.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
    if(!SUPPORTED_REFERENCE_MIME_TYPES.has(reference.mimeType))throw new ProviderRequestError({code:"reference_image_type_unsupported",category:"provider",scope:"request",action:"edit_request",message:`Reference image ${index+1} uses ${reference.mimeType||"an unknown format"}. Convert it to PNG, JPEG, or WebP before generating.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
    if(reference.bytes.byteLength>=MAX_REFERENCE_IMAGE_BYTES)throw new ProviderRequestError({code:"reference_image_too_large",category:"provider",scope:"request",action:"edit_request",message:`Reference image ${index+1} is ${(reference.bytes.byteLength/1024/1024).toFixed(1)} MB. Image-edit inputs must be smaller than 50 MB.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  }
  return references;
};

async function readImageStream(response:Response,onEvent:(event:OpenAIImageStreamEvent)=>Promise<void>){
  if(!response.body)throw new Error("provider_returned_no_stream");
  const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";
  const consume=async(final=false)=>{
    buffer=buffer.replaceAll("\r\n","\n");
    let boundary=buffer.indexOf("\n\n");
    while(boundary>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=block.split("\n").filter((line)=>line.startsWith("data:")).map((line)=>line.slice(5).trimStart()).join("\n");if(data&&data!=="[DONE]"){let event:OpenAIImageStreamEvent;try{event=JSON.parse(data) as OpenAIImageStreamEvent;}catch{throw new Error("provider_returned_invalid_stream_event");}await onEvent(event);}boundary=buffer.indexOf("\n\n");}
    if(final&&buffer.trim()){const data=buffer.split("\n").filter((line)=>line.startsWith("data:")).map((line)=>line.slice(5).trimStart()).join("\n");if(data&&data!=="[DONE]"){let event:OpenAIImageStreamEvent;try{event=JSON.parse(data) as OpenAIImageStreamEvent;}catch{throw new Error("provider_returned_invalid_stream_event");}await onEvent(event);}buffer="";}
  };
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});await consume();}
  buffer+=decoder.decode();await consume(true);
}

export async function generateCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:CreativeImageOptions={}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const model=env.OPENAI_IMAGE_MODEL??"gpt-image-2";const quality=options.quality??"high";const size=options.size??"1536x1024";const sizeValidation=validateProviderImageSize(size);
  if(model.startsWith("gpt-image-2")&&!sizeValidation.valid)throw new ProviderRequestError({code:"invalid_image_size",category:"provider",scope:"request",action:"edit_request",message:`The requested image size ${size} cannot be submitted to ${model}. ${sizeValidation.issues.join(" ")}`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const references=validateImageReferences(options.references??[]);const promptTechnique=normalizePromptTechnique(options.promptTechnique);const prompt=options.preparedPrompt?.trim()||buildCreativeImagePrompt(snapshot,direction,references,promptTechnique,{size,quality,partialImages:options.partialImages});const started=Date.now();
  await options.onStage?.("safety-review","Reviewing the exact image prompt and selected reference pixels.");
  let moderation:Awaited<ReturnType<typeof moderateExactImagePrompt>>;try{moderation=await moderateExactImagePrompt(env,prompt,references,options.signal);}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  if(moderation.flagged)throw new ProviderRequestError({code:"safety_preflight_flagged",category:"safety",scope:"request",action:"edit_request",message:`A preflight review identified likely safety concerns${moderation.categories.length?` in ${moderation.categories.join(", ")}`:""}. Review the exact prompt and the contributing context before retrying.`,retryable:false,retryAfterMs:null,requestId:moderation.requestId,httpStatus:400,riskCategories:moderation.categories,contributingReferenceIds:moderation.referenceIds,probe:"exact-prompt-and-reference-moderation"},prompt);
  await options.onStage?.("provider-wait","Safety preflight passed. Waiting for the image provider.");
  const outputFormat=options.outputFormat??"png";const outputCompression=Math.max(0,Math.min(100,Math.round(options.outputCompression??100)));const partialImages=options.partialImages??0;const user=await safetyIdentifier(userId);
  let response:Response;
  if(references.length){
    const form=new FormData();form.set("model",model);form.set("prompt",prompt);form.set("n","1");form.set("size",size);form.set("quality",quality);form.set("output_format",outputFormat);if(outputFormat!=="png")form.set("output_compression",String(outputCompression));if(partialImages){form.set("stream","true");form.set("partial_images",String(partialImages));}form.set("user",user);
    references.forEach((reference,index)=>{const buffer=reference.bytes.buffer.slice(reference.bytes.byteOffset,reference.bytes.byteOffset+reference.bytes.byteLength) as ArrayBuffer;const extension=reference.mimeType==="image/jpeg"?"jpg":reference.mimeType==="image/webp"?"webp":"png";form.append("image[]",new Blob([buffer],{type:reference.mimeType}),`${reference.source}-${index+1}.${extension}`);});
    await options.onStage?.("provider-submit","Submitting the approved image request.");
    try{response=await openAIRequest("https://api.openai.com/v1/images/edits",{method:"POST",headers:{...openAIAuthHeaders(env),...(options.providerClientRequestId?{"X-Client-Request-Id":options.providerClientRequestId}:{})},body:form,signal:options.signal});}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  }else{
    await options.onStage?.("provider-submit","Submitting the approved image request.");
    try{response=await openAIRequest("https://api.openai.com/v1/images/generations",{method:"POST",headers:{...openAIHeaders(env),...(options.providerClientRequestId?{"X-Client-Request-Id":options.providerClientRequestId}:{})},body:JSON.stringify({model,prompt,n:1,size,quality,output_format:outputFormat,...(outputFormat!=="png"?{output_compression:outputCompression}:{}),...(partialImages?{stream:true,partial_images:partialImages}:{}),user}),signal:options.signal});}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  }
  if(!response.ok){let error:OpenAIImageResponse={};try{error=await response.json() as OpenAIImageResponse;}catch{/* Preserve the provider status when no JSON error body is available. */}throw providerErrorFromResponse(response,error,`openai_image_${response.status}`,prompt);}
  const [requestedWidth,requestedHeight]=size.split("x").map(Number);let encoded="";let revisedPrompt:string|null=null;let createdAt:number|null=null;let usage:OpenAIImageUsage={};let completedSize:string=size;let completedFormat=outputFormat;let partialCount=0;
  if(partialImages){
    try{await readImageStream(response,async(event)=>{if(event.error?.message)throw new ProviderRequestError(classifyProviderFailure(new Error(event.error.message)),prompt);if(event.type?.endsWith(".partial_image")&&event.b64_json){partialCount+=1;const eventSize=event.size??size;const [width,height]=eventSize.split("x").map(Number);await options.onPartial?.({bytes:decodeBase64Image(event.b64_json),index:Number(event.partial_image_index??partialCount-1),mimeType:imageMimeType(event.output_format??outputFormat),width,height});}if(event.type?.endsWith(".completed")&&event.b64_json){encoded=event.b64_json;createdAt=event.created_at??null;usage=event.usage??{};completedSize=event.size??size;completedFormat=event.output_format??outputFormat;}});}catch(error){if(error instanceof ProviderRequestError)throw error;throw new ProviderRequestError(classifyProviderFailure(error),prompt);}
  }else{
    const body=await response.json() as OpenAIImageResponse;encoded=body.data?.[0]?.b64_json??"";revisedPrompt=body.data?.[0]?.revised_prompt??null;createdAt=body.created??null;usage=body.usage??{};
  }
  if(options.onProviderSubmission){
    const paidUsage={inputTokens:Number(usage.input_tokens??0),outputTokens:Number(usage.output_tokens??0),totalTokens:Number(usage.total_tokens??0),textInputTokens:Number(usage.input_tokens_details?.text_tokens??0),imageInputTokens:Number(usage.input_tokens_details?.image_tokens??0)};
    await options.onProviderSubmission({clientRequestId:options.providerClientRequestId??`forma-image-${crypto.randomUUID()}`,provider:"openai",operation:"image",model,status:"completed",providerRequestId:response.headers.get("x-request-id")??undefined,...paidUsage,...(verifiedUsage(usage)?{costMicrousd:priceImageUsageBreakdownMicrousd(model,paidUsage,references.length>0).totalMicrousd}:{})});
    if(!verifiedUsage(usage))throw missingUsageReceipt(response.headers.get("x-request-id"));
  }
  if(!encoded)throw new Error("provider_returned_no_image");const bytes=decodeBase64Image(encoded);const [width,height]=completedSize.split("x").map(Number);
  return{model,prompt,promptTechnique,bytes,revisedPrompt,createdAt,providerRequestId:response.headers.get("x-request-id"),latencyMs:Date.now()-started,usage:{inputTokens:Number(usage.input_tokens??0),outputTokens:Number(usage.output_tokens??0),totalTokens:Number(usage.total_tokens??0),textInputTokens:Number(usage.input_tokens_details?.text_tokens??0),imageInputTokens:Number(usage.input_tokens_details?.image_tokens??0)},width:Number.isFinite(width)?width:requestedWidth,height:Number.isFinite(height)?height:requestedHeight,mimeType:imageMimeType(completedFormat),quality,usedReference:references.length>0,referenceCount:references.length,referenceInputs:references.map((reference)=>({source:reference.source,blockId:reference.blockId??null,referenceId:reference.referenceId??null,label:reference.label??null,mode:reference.mode??null})),safetyProbeCount:moderation.probeCount,safetyCoverage:moderation.coverage,safetyRequestIds:moderation.requestIds,partialCount,outputFormat:completedFormat,outputCompression:completedFormat==="png"?null:outputCompression};
}

function assistantResponseLocale(value?: string) {
  try {
    const locale = Intl.getCanonicalLocales(value || "en")[0] || "en";
    return /^(?:en|fr|ar|ja)(?:-|$)/i.test(locale) ? locale : "en";
  } catch {
    return "en";
  }
}

export async function respondToCreativeChat(env:WorkerEnv,userId:string,input:{documentTitle:string;blocks:Array<Record<string,unknown>>;relationships?:Array<Record<string,unknown>>;history:Array<{role:"user"|"assistant";text:string}>;message:string;locale?:string;signal?:AbortSignal}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const responseLocale=assistantResponseLocale(input.locale);
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),signal:input.signal,body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:`You are Forma, a concise creative collaborator inside a chat-only document view. Write every user-facing assistant reply in the user's selected language (${responseLocale}). Preserve user-authored titles, quoted text, names, and creative decisions verbatim; never translate machine identifiers, enum values, or structured field names. Speak about the user's creative plan and intended image, never about blocks, events, schemas, metadata, adapters, or hidden machinery. Interpret the newest message against the existing plan and recent conversation. Return a helpful reply plus the smallest accurate set of plan mutations. Create adds a new durable decision; edit changes one existing decision and must name its target_block_id; remove deletes one existing decision and must name its target_block_id. Never target a missing item. For create, target_block_id is null. Never create a reference item through chat because an actual uploaded image is required. The reference_pixel_mode field is unchanged for ordinary mutations. When the user says to use a named existing reference image, edit the matching reference and choose inspiration unless they explicitly ask to preserve its composition, subject, or visual style. Choose context_only when they say not to send or use its pixels. Never change reference_pixel_mode on a non-reference item. When the user asks for an image size, resolution, dimensions, orientation, or aspect ratio, create or edit a format item and provide image_format with coherent pixel dimensions and their reduced aspect ratio; otherwise image_format is null. For unused mutation fields return sensible empty strings, but type must always be a valid vocabulary value. If the creative image meaningfully changes, preview_worthy is true and preview_direction is a standalone visual instruction incorporating the whole current intention after your proposed changes. If the user is only asking a question or chatting without changing visual intent, do not mutate and set preview_worthy false. ${creativePromptGuardrails()}`,
    input:JSON.stringify({...providerFacingAssistantContext(input),block_vocabulary:BLOCK_TYPES.map((item)=>({type:item.type,subtypes:item.subtypes})),mutation_rules:{create:"target_block_id must be null",edit:"target_block_id must match an existing id",remove:"target_block_id must match an existing id"}}),
    text:{verbosity:"low",format:{type:"json_schema",name:"forma_creative_chat",strict:true,schema:creativeChatSchema}},reasoning:{effort:"low"},max_output_tokens:1600,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`);
  const text=responseText(body);if(!text)throw new Error("provider_returned_no_output");
  let parsed:CreativeChatResponse;try{parsed=JSON.parse(text) as CreativeChatResponse;}catch{throw new Error("provider_returned_invalid_json");}
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output:parsed,raw:text,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

export async function structureAdaptiveContext(env:WorkerEnv,userId:string,input:{intent:string;documentTitle:string;blocks:Array<Record<string,unknown>>;relationships?:Array<Record<string,unknown>>;locale?:string;signal?:AbortSignal;onBeforeProviderRequest?:()=>Promise<void>}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const responseLocale=assistantResponseLocale(input.locale);
  const providerRequest=JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:`You structure an adaptive creative-context interface. Write every user-facing interpretation, decision label, decision prompt, explanation, suggestion label, instruction, relationship, and future suggestion in the user's selected language (${responseLocale}). Preserve user-authored titles, quoted text, names, and creative decisions verbatim; never translate machine identifiers, block type values, or structured field names. Interpret the user's broad intent together with the currently authored blocks. Propose the next useful decision and 2–6 concise context blocks across intent, scene, craft, evidence, or constraints. Use only the supplied block type vocabulary. Subtypes should match the system suggestions when practical. Explain product-facing reasons, never hidden chain-of-thought. Do not claim proposals were authored and do not mutate anything. ${creativePromptGuardrails()}`,
    input:JSON.stringify({...providerFacingAssistantContext(input),block_vocabulary:BLOCK_TYPES.map((item)=>({type:item.type,description:item.description,subtypes:item.subtypes}))}),
    text:{verbosity:"low",format:{type:"json_schema",name:"forma_adaptive_structure",strict:true,schema:adaptiveStructureSchema}},reasoning:{effort:"low"},max_output_tokens:1400,store:false,safety_identifier:await safetyIdentifier(userId),
  });
  await input.onBeforeProviderRequest?.();
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),signal:input.signal,body:providerRequest});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`);
  const text=responseText(body);if(!text)throw new Error("provider_returned_no_output");
  let parsed:AdaptiveStructure;try{parsed=JSON.parse(text) as AdaptiveStructure;}catch{throw new Error("provider_returned_invalid_json");}
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output:parsed,raw:text,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

const authoredVisualCategoryCopyInstructions="Concise source-authored visual.data row labels may repeat verbatim inside a longer independently meaningful slide title or body when the labels categorize its evidence; preserve both the authored argument and every structured row label. A hero-type or metric visual needs exactly one meaningful source-authored visual.value distinct from its title, body, kicker, and label; it requires no visual.data rows. Preserve the selected evidence source_ids and never invent a claim or add chart rows to satisfy a hero visual. When authored evidence supplies categories without independent measurements or descriptions, use an architecture visual with an empty string for each category-only row value. Never copy a visual.data row label, slide title, or slide body into a category-only row value; a simple source-authored title and question need no duplicate diagram rows. Distinct source-authored rows on different slides may retain the same exact short factual status when their evidence labels differ. Never invent a measurement merely to populate a category. Real scorecard, bars, and matrix measurements must remain complete and exact.";

const artifactInstructions:Record<DocumentArtifactKind,string>={
  audio:"Create an original, production-ready music and sound-design brief. Preserve the document’s narrative purpose, authored emotional arc, ordered dramatic beats, atmosphere, musical texture, tempo when genuinely specified, instrumentation, and deliberate silence. Translate opted-in audio descriptions into musical meaning without copying an existing recording, recognizable melody, artist, or voice. content_markdown is a complete original composition brief with concise timed or ordered sections. Use one item whose body describes the complete arrangement, whose notes describe cue timing and vocal policy, and whose image_prompt describes an optional visual reference without implying that an image was supplied. Never invent measured tempo, duration, transcription, licensed lyrics, or artist approval.",
  short_story:"Write a polished short story, not a treatment. Preserve the document's named subjects, setting, tone, constraints, and spatial relationships. content_markdown is the complete story. Items are titled narrative movements with their prose in body; notes briefly explain continuity, and image_prompt describes an optional illustration.",
  scene:"Write one production-readable scene for film or television. content_markdown must use clear screenplay conventions: scene heading, action, character names, dialogue, and parentheticals only when useful. Build the scene around visible action, composition, visual staging, meaningful camera direction, spatial relationships, atmosphere, and the authored dramatic progression. Items are playable visual beats in order; body contains the beat's visible action and authored dialogue, notes preserve staging and camera continuity, and image_prompt describes its strongest frame.",
  slides:"Create an informative visual presentation, not an essay split at arbitrary points and not a request for raster slide images. presentation defines one accessible 16:9 CSS theme for the deck. Choose the style_preset that best represents the document: gallery for quiet, warm, image-led work; editorial for assertive narrative hierarchy; nocturne for cinematic or atmospheric work; field-notes for research, evidence, and plans. Make mode and palette coherent with that choice while deriving the specific colors from the document. presentation.theme is internal styling metadata; presentation.footer_label is optional-on-screen deck copy and must be a concise name derived from this document, its subject, or the deck title. Never put process language, model names, provider names, system status, or phrases such as Document-derived editorial in footer_label. Each item is one slide: title and body are concise on-slide copy, notes are speaker notes, and slide is reusable visual data. Preserve explicitly numbered authored slides in their original order, section, source attribution, and narrative purpose; never collapse, combine, or invent required outline positions. Choose purposeful quote, scorecard, comparison, matrix, architecture, personas, roadmap, timeline, metric, or existing semantic layouts according to the source evidence, not superficial visual variety. Use visual.data labels, values, and normalized weights to express the actual idea rather than decoration. A scorecard, chart, table, matrix, or comparison MUST retain every required source category; never drop a sixth or subsequent data point, and keep captions, labels, values, summaries, notes, Markdown, and source attribution mutually consistent. Numeric exact_value is the exact unrounded quantity; display_value is its explicitly rounded presentation and must never replace, reverse, or relabel the exact quantity. Place the primary protected attributed quotation completely and verbatim in one slide.quote.text field with its original speaker, role, and authorized source_id; quote-card visual.value must contain the same complete quotation, never a fragment or a continuation hidden in visual.data. When an authored slide contains multiple protected quotations, preserve every additional complete quotation and its original attribution together in one fully visible body or bullet field and in speaker notes. Put citations and request-local source aliases in slide.citations, slide.source_ids, quote.source_id, and visual.data source_ids as appropriate. Preserve authored terminology, device/orientation comparisons, stakeholder representation, recommendations, roadmaps, dates, and section boundaries. Editorially review every slide before returning it: every visible field must add new information. Do not repeat or closely restate the same sentence, quotation, claim, or phrase across its title, body, kicker, bullets, visual label, visual value, or data points. Distinct source-authored visual.data rows with different meaningful labels may and must retain the same exact short measurement, status, or categorical value, including zero; never alter, omit, or invent a value merely to avoid repetition. Treat punctuation, quotation marks, line breaks, capitalization, contractions, and minor word-order changes as irrelevant when checking for repetition. Never split one quotation between body copy and a bullet, and never use a bullet as a shortened echo of the body. Then review every slide against every other slide: each slide must advance the deck with a distinct title and distinct visible claims. Do not reuse body copy, bullets, quotations, conclusions, hero statements, metric explanations, or visual values on later slides. Repeated structural axes or short section labels are acceptable only when they make a direct comparison easier to read. Never emit empty bullets or scaffolding such as Point 2, Item 3, TBD, placeholder, or lorem ipsum. Every visual group must be complete and specific: bars, scorecards, comparison matrices, timelines, and roadmaps need every meaningful required label/value pair; diagrams and color fields need at least two meaningfully named points; an attributed quotation needs its complete text, speaker, and role, not dummy chart rows. If the content supports only one fact, use quote, hero-type, or metric instead of pretending it is a multi-point group. Vary layouts with a coherent opening, progression, and closing; keep all copy readable without clipping on a 16:9 slide, preserving protected quotations and factual data rather than truncating them. image_prompt is a brief visual rationale only—the client renders the slide from structured data. content_markdown is a complete, faithful slide-by-slide textual version of the same deck, including visible complete quotations, score rows, exact/display precision labels, citations, and presentation conclusions.",
  storyboard:"Create a coherent previz storyboard that can be rendered frame by frame. Each item is one camera shot: title names the shot, body describes action and composition, notes specify camera/lens/movement/continuity, and image_prompt is a self-contained frame prompt that preserves recurring subjects and visual continuity. content_markdown is the ordered shot list.",
  video:"Create a concise, production-ready video prompt. content_markdown is the exact visual motion prompt: subject, action, environment, camera, timing, composition, visual style, emotional progression, and ordered authored shots. Communicate dramatic rhythm through visible action, camera movement, weather, and light. Never invent a score, song, soundtrack, dialogue, voice, musician, recording, or audio requirement. Use one item to summarize the visual sequence, with technical direction in notes and the same self-contained visual prompt in image_prompt.",
};
artifactInstructions.slides += ` ${PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS} A visual label is optional: retain a distinct source-authored caption when it adds meaning; otherwise return an empty string, never boilerplate such as Visual emphasis or Stakeholder perspective. A repeated complete opening sentence or substantial lead-in is duplicated copy even when each continuation differs; state that opening once and preserve every distinct, source-authorized continuation.`;

const audioSceneInstructions="Write one production-readable audio scene for an audio drama, radio play, spoken-word production, or designed soundscape. Preserve the same authored narrative, named subjects, setting, chronology, relationships, protected requirements, and dramatic purpose that a visual interpretation would use, while expressing the scene entirely through what a listener can hear. content_markdown must be an ordered audio-scene script with audible action, environmental ambience, distinctive sound cues, authored character voice and dialogue, meaningful silence, sonic transitions, pacing, and emotional dynamics. Respect authored prohibitions and distinguish dialogue, narration, ambience, sound effects, and intentional quiet without inventing a named performer, copyrighted recording, recognizable melody, or unauthorized voice imitation. Items are playable audible beats in order; body describes the audible dramatic action or spoken lines, and notes describe cue timing, vocal treatment, acoustic perspective, silence, and sound-design continuity. Leave optional visual-reference fields empty; never require a camera angle, shot list, image description, visual framing, lighting treatment, or picture-only staging.";

function specialistAudioInstructions(profile: AudioRequestProfile): string {
  if (profile.goal === "narration") {
    return "Write an immediately speakable narration or conversation, not a music brief. For newly written speech, content_markdown must contain ONLY the exact words intended to be spoken aloud. For newly written two-voice dialogue label every line with exactly Speaker1: or Speaker2: so the downstream aliases are already budgeted. When audio.approved_spoken_script is supplied, return an empty content_markdown: Forma inserts those approved words unchanged locally, so never regenerate, summarize, or duplicate that script. Never include production notes, stage directions, policy text, sound effects, music, descriptions of a script, or instructions inside content_markdown. Do not repeat the complete script in item bodies; leave body empty and put concise nonspoken delivery direction in notes.";
  }
  if (profile.goal === "sound_effects" || profile.goal === "video_sound_effects") {
    return "Write a precise original Foley, sound-effect, or environmental sound-design brief, not a musical composition. Describe audible events, order, acoustic perspective, dynamics, timing, texture, and meaningful silence. For video synchronization align effects with visible authored action. Do not add music, dialogue, or narration unless explicitly authored.";
  }
  if (profile.goal === "mixed_audio") return audioSceneInstructions;
  if (profile.goal === "video_music") {
    return "Write a concise original music scoring brief synchronized to the approved video's visual action, authored emotional progression, beat timing, and transitions. Do not imply that narration, protected recordings, imitated voices, or an image reference were authorized.";
  }
  return artifactInstructions.audio;
}

function audioSceneContinuity(plan: Pick<ManagedProductionPlan, "claims">, scene?: ProductionScene) {
  const continuity=providerFacingProductionContinuity(plan,scene);
  return{subjects:continuity.subjects,locations:continuity.locations,wardrobe:continuity.wardrobe,props:continuity.props,style:continuity.style,sound:continuity.sound,prohibitions:continuity.prohibitions};
}

function audioSceneTransition(scene: ProductionScene, boundary: "in" | "out") {
  if(boundary==="in")return scene.startBoundaryId===null
    ?"open with authored audible action, environmental ambience, or intentional silence"
    :"continue the prior audible action, acoustic perspective, character voices, and soundscape";
  return scene.endBoundaryId===null
    ?"resolve with an authored closing sound, spoken line, or purposeful silence"
    :"carry the dramatic action, audible cue, vocal continuity, and ambience into the next beat";
}

function audioSceneProductionInstructions(plan: ManagedProductionPlan, scenes: ProductionScene[]) {
  const sharedClaims=plan.claims.filter((claim)=>!claim.contextGroupIds.length);
  const sharedContinuity=JSON.stringify(audioSceneContinuity({claims:sharedClaims}));
  const assignments=scenes.map((scene)=>{
    const continuity=JSON.stringify(audioSceneContinuity(plan,scene));
    return `${scene.narrativeOrder}. ${scene.title}: ${scene.action}. Preserve its authored audible setting, dramatic purpose, character continuity, scoped narrative context, and transitions: ${audioSceneTransition(scene,"in")}; ${audioSceneTransition(scene,"out")}. Scoped continuity: ${continuity}.`;
  }).join(" ");
  return `Act as a coordinated audio-scene writing, dialogue, sound-design, and continuity team. Preserve this shared authored narrative continuity: ${sharedContinuity}. Turn each assigned source-grounded narrative beat into distinct audible action, sonic atmosphere, voice, deliberate silence, and emotional progression without repeating the complete plot: ${assignments}`;
}

type PresentationSlideSourceResolutionReceipt={
  rawAssignments:string[][];
  canonicalAssignments:string[][];
  unknownAssignments:string[];
  deterministicallyAssigned:number[];
};

const uniquePresentationReferences=(values:readonly unknown[])=>[...new Set(values.flatMap((value)=>typeof value==="string"&&value.trim()?[value.trim()]:[]))];
const presentationProducerInstruction=/\bAuthored presentation[- ]ready narrative only\s*;\s*no generation\s*,\s*spend\s*,\s*publication\s+or\s+unsupported ROI claims\.?/giu;
const audiencePresentationText=(value:string)=>String(value??"").replace(presentationProducerInstruction,"").replace(/[\t ]{2,}/g," ").trim();
const opaquePresentationAlias=(value:string)=>/^(?:(?:blk|grp|clm|source|decision)[_-]\d+|context_group_\d+|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/iu.test(value.trim());

/** Repair a qualitative visual only with terms copied from its own authorized slide. */
function reconcileAuthoredPresentationVisual(slide:SlideVisualData,authored:PresentationSourceSlide|undefined,contract:PresentationSourceContract):SlideVisualData{
  if(!authored||["scorecard","bars","quote"].includes(slide.visual.kind))return slide;
  const roadmap=contract.roadmaps.find((entry)=>entry.slideNumber===authored.number&&(!entry.sourceBlockId||entry.sourceBlockId===authored.sourceBlockId));
  const collapsedRoadmap=Boolean(roadmap&&["roadmap","timeline"].includes(slide.layout)&&["hero-type","metric"].includes(slide.visual.kind)&&slide.visual.data.length<2);
  if(slideVisualIsComplete(slide)&&!collapsedRoadmap)return slide;
  if(authored.sourceBlockId){
    const expectedGroups=contract.sources.find((source)=>source.sourceKind==="block"&&source.sourceId===authored.sourceBlockId)?.contextGroupIds??[];
    const foreignEvidence=slide.visual.data.some((datum)=>(datum.sourceIds??[]).some((reference)=>{
      const resolved=resolvePresentationSourceReferences([reference],contract,{allowDurableIds:true});
      return!resolved.blockIds.includes(authored.sourceBlockId!)&&!resolved.contextGroupIds.some((group)=>expectedGroups.includes(group));
    }));
    if(foreignEvidence)return slide;
  }
  const sourceText=authored.content,afterHeading=sourceText.includes(":")?sourceText.slice(sourceText.indexOf(":")+1).trim():sourceText;
  const sourceIds=authored.sourceBlockId?[authored.sourceBlockId]:[];
  const makeDatum=(label:string,value=""):SlideVisualDatum=>({label:label.trim(),value:value.trim().replace(/[.]$/u,""),weight:1,...(sourceIds.length?{sourceIds}:{})});
  const equalityPairs=afterHeading.split(/\s*;\s*/u).flatMap((entry)=>{
    const match=entry.match(/^([^=]{2,90})\s*=\s*(.+)$/u);
    return match?[makeDatum(match[1]!,match[2]!)]:[];
  });
  const namedModes=[...new Set(sourceText.match(/\b(?:Write|Shape|Present)\b/gu)??[])];
  const roadmapMilestones=roadmap?afterHeading.split(/\s*(?:,|→|->)\s*/u).map((entry)=>entry.trim().replace(/[.]$/u,"")).filter((entry)=>/\p{L}/u.test(entry)):[];
  let data:SlideVisualDatum[]=[];
  let kind=slide.visual.kind,layout=slide.layout,value=slide.visual.value;
  if(equalityPairs.length>=2){data=equalityPairs;if(!["comparison","matrix","personas"].includes(kind)){kind="comparison";layout="comparison";}}
  else if(namedModes.length>=2){data=namedModes.map((label)=>makeDatum(label));kind="architecture";layout="architecture";}
  else if(roadmap&&roadmapMilestones.length>=2){data=roadmapMilestones.map((label)=>makeDatum(label));kind="roadmap";layout="roadmap";value=value||roadmap.value;}
  if(data.length<2)return slide;
  const movedClaims=data.flatMap((datum)=>[datum.label,datum.value,[datum.label,datum.value].filter(Boolean).join(" = ")]).filter(Boolean);
  const bullets=slide.bullets.filter((bullet)=>!movedClaims.some((claim)=>slideCopyIsNearDuplicate(bullet,claim)));
  return{...slide,layout,bullets,visual:{...slide.visual,kind,value,data}};
}

function resolveProviderPresentationSources(output:DocumentArtifactDraft|null,contract:PresentationSourceContract,scenes:readonly ProductionScene[],pageStart=0){
  const rawAssignments:string[][]=[];
  const canonicalAssignments:string[][]=[];
  const unknownAssignments=new Set<string>();
  const deterministicallyAssigned:number[]=[];
  const acceptedPresentationCopy:string[]=[];
  const acceptedSlideTitles:string[]=[];
  const acceptedSlideItems:DocumentArtifactDraft["items"]=[];
  const repairedSlideTitles=new Map<number,{original:string;replacement:string}>();
  if(!output)return{output,receipt:{rawAssignments,canonicalAssignments,unknownAssignments:[],deterministicallyAssigned} satisfies PresentationSlideSourceResolutionReceipt};

  // A provider can return only an alias we actually disclosed. Checking this
  // before local resolution also prevents guessed durable IDs from becoming
  // authenticated if another internal resolver supports canonical references.
  const authorizedAliases=new Set(contract.sources.map((source)=>source.alias));
  const authorizedBlockIds=new Set(contract.sources.filter((source)=>source.sourceKind==="block").map((source)=>source.sourceId));
  const authorizedGroupIds=new Set(contract.sources.filter((source)=>source.sourceKind==="context-group").map((source)=>source.sourceId));
  const safeResolution=(references:readonly unknown[])=>{
    const normalized=uniquePresentationReferences(references);
    const accepted=normalized.filter((reference)=>authorizedAliases.has(reference));
    for(const reference of normalized)if(!authorizedAliases.has(reference))unknownAssignments.add(reference);
    return resolvePresentationSourceReferences(accepted,contract);
  };

  const items=output.items.map((item,index)=>{
    if(!item.slide){rawAssignments.push([]);canonicalAssignments.push([]);return item;}
    const slide=item.slide;
    const raw=uniquePresentationReferences([
      ...(slide.sourceIds??[]),
      slide.quote?.sourceId,
      ...(slide.citations??[]).map((citation)=>citation.sourceId),
      ...slide.visual.data.flatMap((datum)=>datum.sourceIds??[]),
    ]);
    rawAssignments.push(raw);
    const initialUnknownCount=unknownAssignments.size;
    const resolution=safeResolution(raw);
    const scene=scenes[index];
    const expectedNumber=scene?.sourceOutlineOrder??scene?.narrativeOrder??pageStart+index+1;
    const authored=contract.numberedOutline.find((source)=>source.index===pageStart+index)
      ??contract.numberedOutline.find((source)=>source.number===expectedNumber)
      ??contract.numberedOutline[pageStart+index]
      ??contract.numberedOutline[index];
    const sceneSources=uniquePresentationReferences([...(scene?.sourceBlockIds??[]),authored?.sourceBlockId]).filter((sourceId)=>authorizedBlockIds.has(sourceId));
    const soleSource=contract.sources.filter((source)=>source.sourceKind==="block");
    const canonical=uniquePresentationReferences([...resolution.sourceIds,...resolution.blockIds]);
    if(!canonical.length&&unknownAssignments.size===initialUnknownCount){
      const deterministic=sceneSources.length?sceneSources:soleSource.length===1?[soleSource[0]!.sourceId]:[];
      if(deterministic.length){canonical.push(...deterministic);deterministicallyAssigned.push(index);}
    }

    const canonicalReference=(reference?:string)=>{
      if(!reference)return undefined;
      if(!authorizedAliases.has(reference)){unknownAssignments.add(reference);return undefined;}
      return resolvePresentationSourceReferences([reference],contract).sourceIds[0];
    };
    const quote=slide.quote?{
      ...slide.quote,
      ...(slide.quote.sourceId?{sourceId:canonicalReference(slide.quote.sourceId)}:{}),
    }:undefined;
    if(quote&&!quote.sourceId){
      const protectedQuote=contract.protectedQuotes.find((entry)=>entry.text===quote.text&&entry.role===quote.role);
      if(protectedQuote?.sourceBlockId&&authorizedBlockIds.has(protectedQuote.sourceBlockId))quote.sourceId=protectedQuote.sourceBlockId;
    }
    const citations=slide.citations?.map((citation)=>({
      ...citation,
      label:opaquePresentationAlias(citation.label)?authored?.title||"Authored source":audiencePresentationText(citation.label),
      anchor:opaquePresentationAlias(citation.anchor)?"":audiencePresentationText(citation.anchor),
      excerpt:audiencePresentationText(citation.excerpt),
      ...(citation.sourceId?{sourceId:canonicalReference(citation.sourceId)}:{}),
    }));
    if(quote?.citation&&opaquePresentationAlias(quote.citation)){
      const citedSource=(authorizedAliases.has(quote.citation)?canonicalReference(quote.citation):undefined)??quote.sourceId;
      quote.citation=citations?.find((citation)=>citation.sourceId===citedSource)?.label||"Authored source";
    }
    const data=slide.visual.data.map((datum)=>{
      const cleanDatum={...datum,label:audiencePresentationText(datum.label),value:audiencePresentationText(datum.value)};
      if(!datum.sourceIds?.length)return cleanDatum;
      const sources=safeResolution(datum.sourceIds);
      return{...cleanDatum,sourceIds:uniquePresentationReferences([...sources.sourceIds,...sources.blockIds])};
    });
    const nestedSources=uniquePresentationReferences([
      ...canonical,
      quote?.sourceId,
      ...(citations??[]).map((citation)=>citation.sourceId),
      ...data.flatMap((datum)=>datum.sourceIds??[]),
    ]);
    canonicalAssignments.push(nestedSources);
    const contextGroupIds=uniquePresentationReferences([
      ...(item.context_group_ids??[]),
      ...resolution.contextGroupIds.filter((groupId)=>authorizedGroupIds.has(groupId)),
    ]);
    let reconciledSlide=reconcileAuthoredPresentationVisual({
      ...slide,
      kicker:audiencePresentationText(slide.kicker),
      bullets:slide.bullets.map(audiencePresentationText).filter(Boolean),
      ...(nestedSources.length?{sourceIds:nestedSources}:{sourceIds:[]}),
      ...(quote?{quote}:{}),
      ...(citations?{citations}:{}),
      ...(authored?.section&&!slide.section?{section:authored.section}:{}),
      ...(!slide.sourceOrder&&(scene?.sourceOutlineOrder??authored?.number)?{sourceOrder:scene?.sourceOutlineOrder??authored!.number}:{}),
      visual:{...slide.visual,label:audiencePresentationText(slide.visual.label),value:audiencePresentationText(slide.visual.value),data},
    },authored,contract);
    if(["hero-type","metric"].includes(reconciledSlide.visual.kind)&&!reconciledSlide.visual.value.trim()){
      const visibleCopy=[item.title,item.body,reconciledSlide.kicker,reconciledSlide.visual.label,...reconciledSlide.bullets,...acceptedPresentationCopy].filter(Boolean);
      const authorizedEvidence=contract.sources.find((source)=>source.sourceKind==="block"
        &&nestedSources.includes(source.sourceId)
        &&(!scene||scene.sourceBlockIds.includes(source.sourceId))
        &&(!scene?.contextGroupIds.length||source.contextGroupIds.length===0||source.contextGroupIds.some((groupId)=>scene.contextGroupIds.includes(groupId)))
        &&Boolean(source.label.trim())
        &&!/^(?:authored source(?:\s+\d+)?|source|evidence|decision|message|direction|context|block|claim|visual emphasis)$/iu.test(source.label.trim())
        &&!opaquePresentationAlias(source.label)
        &&visibleCopy.every((copy)=>!slideCopyIsNearDuplicate(source.label,copy)));
      if(authorizedEvidence){
        const value=audiencePresentationText(authorizedEvidence.label);
        reconciledSlide={...reconciledSlide,sourceIds:uniquePresentationReferences([...(reconciledSlide.sourceIds??[]),authorizedEvidence.sourceId]),visual:{...reconciledSlide.visual,value}};
      }
    }
    let title=audiencePresentationText(item.title);
    const duplicatesEarlierDeckCopy=slideDeckCopyIssues([...acceptedSlideItems,{...item,title,slide:reconciledSlide}]).some((issue)=>issue.secondSlide===acceptedSlideItems.length&&issue.secondPath==="title");
    if(acceptedSlideTitles.some((previous)=>slideCopyIsNearDuplicate(previous,title))||duplicatesEarlierDeckCopy){
      const groupTitles=scene?contract.sources.filter((source)=>source.sourceKind==="context-group"&&scene.contextGroupIds.includes(source.sourceId)).map((source)=>source.label):[];
      const sourceTitles=contract.sources.filter((source)=>source.sourceKind==="block"&&nestedSources.includes(source.sourceId)&&(!scene||scene.sourceBlockIds.includes(source.sourceId))).map((source)=>source.label);
      const candidates=uniquePresentationReferences([authored?.title,...(!contract.authoredSlideCount?[...groupTitles,scene?.title,...sourceTitles]:[])]).map(audiencePresentationText);
      const replacement=candidates.find((candidate)=>Boolean(candidate)&&!/^(?:authored source(?:\s+\d+)?|source|evidence|decision|message|direction|context|block|claim|visual emphasis|slide\s+\d+)$/iu.test(candidate)&&!opaquePresentationAlias(candidate)&&acceptedPresentationCopy.every((copy)=>!slideCopyIsNearDuplicate(candidate,copy))&&slideCopyIssues({...item,title:candidate,slide:reconciledSlide}).every((issue)=>issue.firstPath!=="title"&&issue.secondPath!=="title"));
      if(replacement){repairedSlideTitles.set(index,{original:title,replacement});title=replacement;}
    }
    acceptedSlideTitles.push(title);
    acceptedPresentationCopy.push(title,item.body,...reconciledSlide.bullets,...(reconciledSlide.quote?.text?[reconciledSlide.quote.text]:[]),...reconciledSlide.visual.data.map((datum)=>datum.value),...(["hero-type","metric"].includes(reconciledSlide.visual.kind)&&reconciledSlide.visual.value.trim()?[reconciledSlide.visual.value]:[]));
    const resolvedItem={
      ...item,
      title,
      body:audiencePresentationText(item.body),
      notes:audiencePresentationText(item.notes),
      image_prompt:audiencePresentationText(item.image_prompt),
      context_group_ids:contextGroupIds,
      slide:reconciledSlide,
    };
    acceptedSlideItems.push(resolvedItem);
    return resolvedItem;
  });
  let markdownSlideIndex=0;
  const contentMarkdown=audiencePresentationText(output.content_markdown).split(/\r?\n/u).map((line)=>{
    const heading=line.match(/^#{1,6}\s+(?:slide\s+)?(\d+)[.\s:—-]/iu);
    if(heading){
      markdownSlideIndex=Math.max(0,Number(heading[1])-pageStart-1);
      const repaired=repairedSlideTitles.get(markdownSlideIndex);
      if(repaired){const match=/^(\s*#{1,6}\s+(?:slide\s+)?\d+[.\s:—-]+\s*)(.*?)\s*$/iu.exec(line);if(match&&slideCopyIsNearDuplicate(match[2]??"",repaired.original))return`${match[1]}${repaired.replacement}`;}
      return line;
    }
    const sourceLine=line.match(/^(\s*(?:sources?|出典)\s*[:：]\s*)((?:(?:blk|grp|clm)_\d+(?:\s*[,;]\s*)?)+)\s*$/iu);
    if(!sourceLine)return line;
    const aliases=sourceLine[2]!.split(/\s*[,;]\s*/u).filter(Boolean);
    const citations=items[markdownSlideIndex]?.slide?.citations??[];
    const labels=aliases.flatMap((alias)=>{
      const source=contract.sources.find((entry)=>entry.alias===alias);
      return citations.filter((citation)=>citation.sourceId===source?.sourceId||citation.sourceId===source?.blockId)
        .map((citation)=>[citation.label,citation.anchor].filter(Boolean).join(" · "));
    });
    return`${sourceLine[1]}${[...new Set(labels)].join("; ")||"Authored source"}`;
  }).join("\n");
  const authoredTypography=contract.style.typography??"";
  const safeTypography=/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,69}$/u.test(authoredTypography)?authoredTypography:"";
  const deliveredItems=repairProtectedPresentationMessages(items,contract,{pageStart});
  return{
    output:{...output,title:audiencePresentationText(output.title),summary:audiencePresentationText(output.summary),content_markdown:contentMarkdown,...(safeTypography&&output.presentation?{presentation:{...output.presentation,fontFamily:safeTypography}}:{}),items:deliveredItems},
    receipt:{rawAssignments,canonicalAssignments,unknownAssignments:[...unknownAssignments],deterministicallyAssigned} satisfies PresentationSlideSourceResolutionReceipt,
  };
}

function presentationSourceSupplementalIssues(output:DocumentArtifactDraft|null,contract:PresentationSourceContract,receipt:PresentationSlideSourceResolutionReceipt,options:{complete:boolean;requestedStyle?:SlideStylePresetId;pageStart:number;productionScenes?:readonly ProductionScene[]}):DocumentArtifactValidationIssue[]{
  const issues:DocumentArtifactValidationIssue[]=[];
  if(receipt.unknownAssignments.length){
    const unknown=new Set(receipt.unknownAssignments);
    const positions=receipt.rawAssignments.flatMap((references,index)=>references.some((reference)=>unknown.has(reference))?[index]:[]);
    if(positions.length)for(const index of positions)issues.push({code:"unknown_source_reference",path:`items.${index}.slide.source_ids`,message:`Slide ${options.pageStart+index+1} references a source alias that was not authorized for this request.`});
    else issues.push({code:"unknown_source_reference",path:"items.slide.source_ids",message:"At least one slide references a source alias that was not authorized for this request."});
  }
  if(!output)return issues;
  if(options.requestedStyle&&output.presentation?.stylePreset!==options.requestedStyle)issues.push({code:"presentation_style_mismatch",path:"presentation.style_preset",message:`The presentation must use the explicitly selected ${options.requestedStyle} style.`});
  for(const [index,item] of output.items.entries()){
    const expected=contract.numberedOutline.find((source)=>source.index===options.pageStart+index)
      ??contract.numberedOutline.find((source)=>source.number===options.pageStart+index+1);
    if(expected&&item.slide?.sourceOrder&&item.slide.sourceOrder!==expected.number)issues.push({code:"incorrect_slide_order",path:`items.${index}.slide.source_order`,message:`Slide ${options.pageStart+index+1} does not preserve its authored outline position.`});
    const scene=options.productionScenes?.[index];
    if(scene&&item.slide){
      const allowedBlocks=new Set(scene.sourceBlockIds);
      const allowedGroups=new Set(scene.contextGroupIds);
      const references=uniquePresentationReferences([
        ...(item.slide.sourceIds??[]),
        item.slide.quote?.sourceId,
        ...(item.slide.citations??[]).map((citation)=>citation.sourceId),
        ...item.slide.visual.data.flatMap((datum)=>datum.sourceIds??[]),
      ]);
      const foreignSource=references.some((reference)=>{
        const source=contract.sources.find((candidate)=>candidate.sourceId===reference);
        if(!source)return true;
        if(source.sourceKind==="context-group")return!allowedGroups.has(source.sourceId);
        return!allowedBlocks.has(source.sourceKind==="block"?source.sourceId:source.blockId??"");
      });
      if(foreignSource)issues.push({code:"incorrect_slide_source",path:`items.${index}.slide.source_ids`,message:`Slide ${options.pageStart+index+1} includes source evidence assigned to a different presentation chapter.`});
      if((item.context_group_ids??[]).some((groupId)=>!allowedGroups.has(groupId)))issues.push({code:"incorrect_context_group_assignment",path:`items.${index}.context_group_ids`,message:`Slide ${options.pageStart+index+1} includes Combined Context assigned to a different presentation chapter.`});
    }
  }
  if(!options.complete)return issues;
  const markdown=output.content_markdown;
  for(const quote of contract.protectedQuotes){
    if(!markdown.includes(quote.text)||!markdown.includes(quote.role)||quote.speaker!==quote.role&&!markdown.includes(quote.speaker))issues.push({code:"missing_markdown_quote",path:"content_markdown",message:`The complete ${quote.role} stakeholder quotation, named speaker, and attribution must also appear in the readable presentation.`});
    const item=output.items.find((candidate)=>candidate.slide?.quote?.text===quote.text
      ||candidate.body.includes(quote.text)
      ||candidate.slide?.bullets.some((bullet)=>bullet.includes(quote.text))
      ||candidate.slide?.visual.value.includes(quote.text));
    if(item&&(!item.notes.includes(quote.text)||quote.speaker!==quote.role&&!item.notes.includes(quote.speaker)))issues.push({code:"missing_speaker_note_quote",path:`items.${output.items.indexOf(item)}.notes`,message:`The complete ${quote.role} stakeholder quotation and named speaker must remain available in its speaker notes.`});
  }
  for(const fact of contract.protectedFacts)if(!new RegExp(`(?<![\\d.])${fact.value.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&")}(?!\\d|\\.\\d)`,"u").test(markdown))issues.push({code:"missing_markdown_fact",path:"content_markdown",message:`The protected ${fact.label} value must also appear in the readable presentation.`});
  return issues;
}

function redactPresentationRepairArtifact(raw:string,contract:PresentationSourceContract,groupContracts:readonly DocumentArtifactContextGroupContract[],unknownReferences:readonly string[]){
  if(!raw)return null;
  const replacements=uniquePresentationReferences([
    ...contract.sources.flatMap((source)=>[source.sourceId,source.blockId,...source.contextGroupIds]),
    ...groupContracts.map((group)=>group.id),
    ...unknownReferences,
  ]).sort((left,right)=>right.length-left.length);
  return replacements.reduce((result,reference)=>result.replaceAll(reference,"unauthorized_reference"),raw);
}

function locallyRepairedSlideIssues(raw:string,output:DocumentArtifactDraft|null):DocumentArtifactValidationIssue[]{
  if(!raw||!output)return[];
  try{
    const parsed=JSON.parse(raw) as {items?:unknown[]};
    if(!Array.isArray(parsed.items))return[];
    return parsed.items.flatMap((candidate,index)=>{
      const normalized=output.items[index];
      if(!normalized||!candidate||typeof candidate!=="object")return[];
      const original=candidate as Record<string,unknown>;
      const unresolved=slideCopyIssues(normalized);
      const issues=slideCopyIssues(candidate)
        .filter((issue)=>!unresolved.some((remaining)=>remaining.firstPath===issue.firstPath&&remaining.secondPath===issue.secondPath))
        .map((issue)=>({code:"duplicate_slide_copy",path:`items.${index}.${issue.secondPath}`,message:"Repeated visible slide copy was corrected locally."}));
      const slide=original.slide&&typeof original.slide==="object"?original.slide as Record<string,unknown>:null;
      const visual=slide?.visual&&typeof slide.visual==="object"?slide.visual as Record<string,unknown>:null;
      if(typeof visual?.label==="string"&&/^(?:visual emphasis|stakeholder perspective)$/iu.test(visual.label.trim())&&!normalized.slide?.visual.label){
        issues.push({code:"generic_visual_label",path:`items.${index}.slide.visual.label`,message:"A generic visual label was removed locally."});
      }
      return issues;
    });
  }catch{return[];}
}

/** Reapply the complete current source/alias contract to a retained paid response without contacting a provider. */
export function assessStoredPresentationCandidate(raw:string,snapshot:Record<string,unknown>,options:Pick<DocumentArtifactOptions,"itemCount"|"presentationStyle"|"presentationFidelity"|"requestedSlideCount"|"productionScenes"|"productionPage">={}){
  const itemCount=Math.max(1,Math.min(12,Math.floor(Number(options.itemCount??7))));
  const page=options.productionPage;
  const {groups}=providerFacingCombinedContextPlan(snapshot,"slides");
  const groupContracts:DocumentArtifactContextGroupContract[]=groups.map((group,index)=>({id:group.id,alias:`context_group_${index+1}`}));
  const requestedStyle=SLIDE_STYLE_PRESET_IDS.includes(options.presentationStyle as SlideStylePresetId)?options.presentationStyle:undefined;
  const sourceContract=buildPresentationSourceContract(snapshot,{
    requestedSlideCount:page?.totalItems??options.requestedSlideCount??itemCount,
    itemCount,
    contextGroups:groups,
    presentationStyle:requestedStyle,
    fidelity:options.presentationFidelity,
    authoredSlideNumbers:page?.authoredSlideNumbers,
  });
  const groupResolution=resolveDocumentArtifactContextGroups(parseDocumentArtifactContent(raw),groupContracts);
  const sourceResolution=resolveProviderPresentationSources(groupResolution.output,sourceContract,options.productionScenes??[],page?.globalStartIndex??0);
  const output=sourceResolution.output;
  const complete=Boolean((!page||page.pageCount===1)&&(!sourceContract.authoredSlideCount||sourceContract.authoredSlideCount===itemCount));
  const issues=documentArtifactValidationIssues("slides",output,{
    itemCount,
    contextGroupIds:groups.map((group)=>group.id),
    unknownContextGroupAssignments:groupResolution.receipt.unknownAssignments,
    rawContextGroupAssignments:groupResolution.receipt.rawAssignments,
    sourceContract,
    sourcePageStart:page?.globalStartIndex??0,
    sourcePageSize:itemCount,
    requireSourceGrounding:sourceContract.sources.some((source)=>source.sourceKind==="block"),
    requireAllProtectedContent:complete,
  });
  issues.push(...presentationSourceSupplementalIssues(output,sourceContract,sourceResolution.receipt,{complete,requestedStyle,pageStart:page?.globalStartIndex??0,productionScenes:options.productionScenes}));
  return{output,issues,groupResolution:groupResolution.receipt,sourceResolution:sourceResolution.receipt};
}

export async function generateDocumentArtifact(env:WorkerEnv,userId:string,kind:DocumentArtifactKind,input:{documentTitle:string;snapshot:Record<string,unknown>;options?:DocumentArtifactOptions}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const itemCount=Math.max(1,Math.min(12,Math.floor(Number(input.options?.itemCount??(kind==="slides"?7:kind==="storyboard"?6:kind==="short_story"?3:1)))));
  if(kind==="video")resolveVideoAudioPolicy({snapshot:input.snapshot,audioMode:input.options?.videoAudioMode??VIDEO_ADAPTER_CONTRACT.defaultAudioMode});
  const videoSourceScope=kind==="video"?videoOutputScopedContext(input.snapshot):null;
  const {groups,plan:providerGroups}=providerFacingCombinedContextPlan(videoSourceScope?.snapshot??input.snapshot,kind);
  const groupContracts:DocumentArtifactContextGroupContract[]=groups.map((group,index)=>({id:group.id,alias:`context_group_${index+1}`}));
  const audioMode=input.options?.videoAudioMode??VIDEO_ADAPTER_CONTRACT.defaultAudioMode;
  const sceneConfiguration=kind==="scene"?input.options?.sceneConfiguration??createSceneConfiguration(input.options?.sceneMedium??"visual"):null;
  const audioScene=sceneConfiguration?.medium==="audio";
  const audioSelection=kind==="audio"?selectAudioAdapter(env,input.options?.audioProfile,{snapshot:input.snapshot,preferredModel:input.options?.audioProviderModel}):null;
  const specialistAudio=audioSelection?.profile??null;
  const audioConstraints=audioSelection?audioPreparationConstraints(input.snapshot,{profile:audioSelection.profile,model:audioSelection.model,tone:input.options?.tone,audience:input.options?.audience}):null;
  const managed=input.options?.productionMode==="managed"&&Boolean(input.options.productionPlan);
  // Scene actions and continuity repeat source prose outside creative_context.
  // Apply the same source-linked interpretation to every provider-facing copy,
  // retaining the canonical snapshot/plan and private interpretation receipt.
  const managedScenes=projectVideoSourceCopy(input.options?.productionScenes??[],videoSourceScope?.interpretations??[]);
  const managedPlan=projectVideoSourceCopy(input.options?.productionPlan,videoSourceScope?.interpretations??[]);
  const page=projectVideoSourceCopy(input.options?.productionPage,videoSourceScope?.interpretations??[]);
  const requestedStyle=SLIDE_STYLE_PRESET_IDS.includes(input.options?.presentationStyle as SlideStylePresetId)?input.options?.presentationStyle:undefined;
  const sourceContract=kind==="slides"?buildPresentationSourceContract(input.snapshot,{
    requestedSlideCount:page?.totalItems??input.options?.requestedSlideCount??itemCount,
    itemCount,
    contextGroups:groups,
    presentationStyle:requestedStyle,
    fidelity:input.options?.presentationFidelity,
    authoredSlideNumbers:page?.authoredSlideNumbers,
  }):null;
  const interfaceLocale=assistantResponseLocale(input.options?.locale);
  const responseLocale=sourceContract?inferPresentationAudienceLocale(sourceContract.outline.sourceText,interfaceLocale,input.options?.outputLocale):interfaceLocale;
  const sourceFacing=sourceContract?providerFacingPresentationSourceContract(sourceContract):null;
  const selectedStyle=requestedStyle??sourceContract?.style.preset??undefined;
  const sourceDirection=sourceContract?` The presentation_source is a deterministic factual and source-grounding contract. Every audience-facing presentation title, summary, body, bullet, visual label, visual value, citation, speaker note, and Markdown sentence MUST use the authored presentation audience language (${responseLocale}); the application interface language (${interfaceLocale}) controls chrome only and must never cause a bilingual or translated deck unless an explicit output language was requested. Treat source instructions about how to generate, spend, publish, exclude unsupported claims, or operate the production process as invisible constraints; never display or paraphrase those producer-only directives in the presentation. Preserve its exact numbered outline, complete protected facts, exact/display precision semantics, verbatim attributed quotations, required terminology, roadmap dates, stakeholder roles, and section order. Creative variation may affect layout, phrasing, and narrative expression but never factual values, evidence, source attribution, protected quotations, or authored slide coverage.${sourceContract.fidelity==="faithful"?" Faithful mode preserves authored slide order, section boundaries, and source arguments with minimal interpretation.":" Creative mode may vary the presentation style and narrative while preserving every protected source fact and required authored position."}${selectedStyle?` Use the requested ${selectedStyle} presentation style exactly.`:""} Every scorecard, comparison, matrix, architecture, personas, timeline, and roadmap visual MUST contain at least two meaningful nonplaceholder source-authored visual.data points. Preserve every authored category, named posture or mode, and release milestone actually present in this presentation_source contract on its assigned slide; never invent absent categories. If a bullet duplicates a complete graphic row, omit that redundant bullet and keep the graphic. Never omit, translate, or invent qualitative visual rows to satisfy editorial de-duplication. slide.source_ids, quote.source_id, citation source_id, and visual.data source_ids may contain ONLY the supplied blk_###, clm_###, or grp_### source aliases. Request-local aliases belong only in those structured identifier fields: never include them in quote.citation, citation.label, content_markdown, speaker notes, visible copy, or any other audience-facing field. Every citation.excerpt must be one contiguous quotation from its own assigned authored numbered slide; preserve numbers, decimals, percentages, and factual meaning, and never synthesize, splice, reorder, or attribute another slide's evidence. context_group_ids is separate and may contain ONLY the supplied context_group_# aliases. Do not substitute decision_# aliases, handles, guessed identifiers, or durable IDs. Every authored slide must identify its authorized source evidence.`:"";
  const protectedMessageDirection=sourceContract?.protectedMessages.length?" Every presentation_source.protectedMessages phrase is an exact authored audience-delivery requirement: reproduce its complete text verbatim in the title, body, bullet, quotation, or visual copy of its assigned slideNumber and opening/closing placement. Citation labels, anchors, excerpts, source aliases, production instructions, and speaker notes are private evidence or presenter material; they never satisfy visible protected-message delivery. Preserve a deliberately authored identical opening and closing promise on both positions. These exact, assigned protected messages take precedence over every general de-duplication instruction and prior_visible_copy exclusion; this exception never permits unrelated repeated copy or repetition on an unassigned slide.":"";
  const managedDirection=managed&&managedPlan?audioScene?audioSceneProductionInstructions(managedPlan,managedScenes):productionTeamInstructions(managedPlan,managedScenes):"";
  const formatInstructions=managed&&kind==="video"
    ? "Write one production-ready, independently renderable motion prompt per assigned scene. Each item's body is its unique visual action, notes contain camera, identity, and transition continuity, and image_prompt is its standalone source-grounded clip prompt. content_markdown is the chronological scene script. Never compress multiple assigned scenes into one clip, repeat the complete plot in every item, or invent music, dialogue, voice, or soundtrack requirements."
    : specialistAudio&&audioConstraints?`${specialistAudioInstructions(specialistAudio)} The audio.provider_contract is binding for the selected downstream model, not another model's defaults. Keep the entire resulting audio direction within ${audioConstraints.maximum_prompt_characters} characters; allow room for required context and policy. ${specialistAudio.goal==="narration"?`The final spoken script plus normalized speaker labels must fit ${audioConstraints.maximum_script_utf8_bytes} UTF-8 bytes, with a target of at most ${audioConstraints.target_script_utf8_bytes} bytes for newly written speech. Non-ASCII characters use multiple UTF-8 bytes. Never shorten an approved script or omit protected wording to meet a budget; it has already passed admission. Keep nonspoken delivery notes separate and concise. If duration is requested, pace the script for it without claiming the speech provider enforces an exact runtime.`:"Do not invent unsupported duration, voice, sample-count, reference, or format parameters."}`:audioScene?audioSceneInstructions:kind==="slides"?`${artifactInstructions[kind]} ${authoredVisualCategoryCopyInstructions}`:artifactInstructions[kind];
  const videoContract=kind==="video"?managed
    ? ` Each assigned scene is a separate ${VIDEO_ADAPTER_CONTRACT.supportedDurations[0]}–${VIDEO_ADAPTER_CONTRACT.supportedDurations.at(-1)} second provider generation in ${input.options?.videoSize==="720x1280"?"9:16 portrait":"16:9 landscape"}; the complete production may be much longer. Respect the assigned per-scene duration and chronological source beat. Do not compress the complete narrative into one clip. ${audioMode==="original_ambient"?"Only original nonmelodic environmental ambience is allowed.":"Every clip is silent; communicate rhythm through visible action and light."}`
    : ` The requested output is exactly ${input.options?.videoSeconds??4} seconds in ${input.options?.videoSize==="720x1280"?"9:16 portrait":"16:9 landscape"}. The motion prompt must fit that duration; do not claim or imply a different runtime. Preserve every ordered storyboard shot as chronology, including description-only frames, compressing their beats into the available runtime without dropping named subjects or continuity. ${audioMode==="original_ambient"?"Original nonmelodic, in-scene environmental ambience is explicitly allowed; describe it only as visible natural sources, never as music, dialogue, voices, or a recorded work.":"This is a picture-only silent render. Do not invent or request any soundtrack, score, music, voice, dialogue, or other audio. Translate their implied dramatic rhythm into visible motion and light."}`:"";
  const pageDirection=page?` This is ${page.phase} page ${page.pageIndex+1} of ${page.pageCount}, covering global items ${page.globalStartIndex+1}–${page.globalStartIndex+itemCount} of ${page.totalItems}. ${page.pageIndex>0?audioScene?"Continue directly from the prior audible ending; never restart the soundscape, reintroduce its characters, or repeat earlier sound cues and spoken lines.":"Continue directly from the prior ending; never restart the story, reintroduce its characters, repeat the cover, or duplicate previously visible copy.":"Establish the opening exactly once."} ${page.pageIndex<page.pageCount-1?audioScene?"Do not write the final resolution or end the soundscape yet.":"Do not write a final resolution or closing slide yet.":"Deliver the one definitive resolution or closing."} ${kind==="scene"&&page.pageIndex>0?audioScene?"Continue the same audio scene while preserving its ordered sound cues, acoustic perspective, voice continuity, and intentional silence.":"Continue the same screenplay scene without repeating its slugline.":""}${page.lockedPresentation?" Preserve every locked presentation theme, footer, style, mode, and palette value exactly.":""}${page.repairIssues?.length?` Correct these whole-work issues without repeating earlier pages: ${page.repairIssues.join("; ")}.`:""}`:"";
  const instructions=`You transform a durable creative document into a ${kind.replaceAll("_"," ")} for an end user. Write only newly created, user-facing system copy in the user's selected language (${responseLocale}). Preserve the original language and exact text of user-authored document titles, document content, slide outlines and headings, direct quotations, names, facts, and creative decisions verbatim; do not translate or rewrite them. Never translate machine identifiers, enum values, request-local aliases, source IDs, or structured field names. ${formatInstructions}${sourceDirection}${protectedMessageDirection}${videoContract}${managedDirection?` ${managedDirection}`:""}${pageDirection} ${creativePromptGuardrails()} Treat include and prefer blocks as positive direction; treat avoid and prohibit blocks as negative constraints, never as subjects to feature. Respect every block's spatial scope and authority. Combined contexts are binding authorial units, not tags: keep their members isolated to the named target, co-located or ordered as requested, and weighted by group relativity. For stories and scenes, place a group's members at the same narrative moments or aspects. For slides, assign each group to one slide or contiguous chapter rather than applying it deck-wide. For storyboards and video, bind each group to the same subject, location, or shot range. Every item must return context_group_ids containing only the supplied context_key aliases that shaped that item; use an empty array when no group applies, never invent a key, cover every supplied key at least once, and keep repeated slide assignments contiguous. Context keys are request-local references, not end-user content. Do not mention blocks, events, schemas, context keys, or internal implementation in end-user copy. Return exactly ${itemCount} ordered item${itemCount===1?"":"s"}.`;
  const sharedContinuity=managedPlan?audioScene?audioSceneContinuity({claims:managedPlan.claims.filter((claim)=>!claim.contextGroupIds.length)}):providerFacingProductionContinuity({claims:managedPlan.claims.filter((claim)=>!claim.contextGroupIds.length)}):null;
  const pageProtectedMessages=new Set(sourceContract?.protectedMessages.filter((message)=>{
    const index=sourceContract.numberedOutline.find((slide)=>slide.number===message.slideNumber)?.index??message.slideNumber-1;
    return !page||index>=page.globalStartIndex&&index<page.globalStartIndex+itemCount;
  }).map((message)=>message.text)??[]);
  const providerPage=page?{page_index:page.pageIndex,page_count:page.pageCount,global_start_index:page.globalStartIndex,total_items:page.totalItems,phase:page.phase,prior_summary:page.priorSummary,prior_ending:page.priorEnding,prior_visible_copy:page.priorVisibleCopy.filter((copy)=>!pageProtectedMessages.has(copy)),...(page.lockedPresentation?{locked_presentation:{aspect_ratio:page.lockedPresentation.aspectRatio,theme:page.lockedPresentation.theme,footer_label:page.lockedPresentation.footerLabel,style_preset:page.lockedPresentation.stylePreset,mode:page.lockedPresentation.mode,palette:page.lockedPresentation.palette}}:{}),...(page.repairIssues?.length?{repair_issues:page.repairIssues}:{} )}:undefined;
  const sourceAliasById=new Map(sourceContract?.sources.map((source)=>[`${source.sourceKind}:${source.sourceId}`,source.alias])??[]);
  const groupAliasById=new Map(groupContracts.map((contract)=>[contract.id,contract.alias]));
  const providerScenes=managedScenes.map((scene)=>({
    narrative_order:scene.narrativeOrder,
    title:scene.title,
    action:scene.action,
    ...(!audioScene?{camera_direction:scene.cameraDirection}:{}),
    duration_seconds:scene.durationSeconds,
    transition_in:audioScene?audioSceneTransition(scene,"in"):scene.transitionIn,
    transition_out:audioScene?audioSceneTransition(scene,"out"):scene.transitionOut,
    narrative_purpose:scene.narrativePurpose,
    ...(sourceContract?{
      source_keys:uniquePresentationReferences(scene.sourceBlockIds.map((sourceId)=>sourceAliasById.get(`block:${sourceId}`))),
      source_claim_keys:uniquePresentationReferences(scene.sourceClaimIds.map((sourceId)=>sourceAliasById.get(`claim:${sourceId}`))),
      source_group_keys:uniquePresentationReferences(scene.contextGroupIds.map((sourceId)=>sourceAliasById.get(`context-group:${sourceId}`))),
      context_keys:uniquePresentationReferences(scene.contextGroupIds.map((sourceId)=>groupAliasById.get(sourceId))),
      ...(scene.section?{section:scene.section}:{}),
      ...(scene.sourceOutlineOrder?{source_outline_order:scene.sourceOutlineOrder}:{}),
    }:{}),
    ...(managedPlan?{continuity_bible:audioScene?audioSceneContinuity(managedPlan,scene):providerFacingProductionContinuity(managedPlan,scene)}:{}),
  }));
  const creativeContext=kind==="video"?videoPlannerCreativeContext(input.snapshot):sourceContract?providerFacingRenderingContext(input.snapshot,sourceContract.sources):providerFacingRenderingContext(input.snapshot);
  const providerSceneConfiguration=sceneConfiguration?{
    medium:sceneConfiguration.medium,
    source:sceneConfiguration.source,
    target_format:sceneConfiguration.targetFormat,
    downstream_formats:sceneConfiguration.downstreamFormats,
    alternate_medium:sceneConfiguration.alternateMedium,
    context_continuity:"same-authored-narrative-context",
    alternate_rendering:{medium:sceneConfiguration.alternateMedium,preserve_authored_context:true},
  }:null;
  const providerInput=JSON.stringify({
    document_title:input.documentTitle,
    creative_context:creativeContext,
    combined_context_plan:kind==="video"?compactVideoCombinedContextPlan(providerGroups):providerGroups,
    audience:input.options?.audience??"general",
    tone:input.options?.tone??"derived from the document",
    ...(providerSceneConfiguration?{scene_configuration:providerSceneConfiguration}:{}),
    ...(sourceFacing?{presentation_source:sourceFacing}:{}),
    ...(kind==="video"?{video:{duration_seconds:managed?null:input.options?.videoSeconds??4,maximum_scene_seconds:managed?15:undefined,frame:input.options?.videoSize??"1280x720",aspect_ratio:input.options?.videoSize==="720x1280"?"9:16":"16:9",audio_mode:audioMode,generate_audio:audioMode==="original_ambient"}}:{}),
    ...(specialistAudio?{audio:{goal:specialistAudio.goal,role:specialistAudio.role,destination:specialistAudio.destination,provider_contract:audioConstraints,...(specialistAudio.durationSeconds?{duration_seconds:specialistAudio.durationSeconds}:{}),...(specialistAudio.speakerCount?{speaker_count:specialistAudio.speakerCount}:{}),...(specialistAudio.requireInstrumental?{prefer_instrumental:true}:{}),...(specialistAudio.transcript?{approved_spoken_script:specialistAudio.transcript}:{})}}:{}),
    ...(managed?{production:{team:(audioScene?productionTeamFor("scene","audio"):managedPlan?.team)?.specialists.map((member)=>({role:member.label,deliverable:member.deliverable})),continuity_bible:sharedContinuity,assigned_scenes:providerScenes,...(providerPage?{page:providerPage}:{})}}:{}),
  });
  const model=env.OPENAI_MODEL??"gpt-5.6-terra";
  const identifier=await safetyIdentifier(userId);
  const maxOutputTokens=specialistAudio?.goal==="narration"&&!specialistAudio.transcript?Math.min(12000,(audioConstraints?.maximum_script_utf8_bytes??6000)+1500):managed?Math.max(kind==="slides"?6500:4000,Math.min(12000,itemCount*1200)):kind==="short_story"?6000:kind==="slides"?Math.max(6500,Math.min(12000,itemCount*900)):kind==="storyboard"?4000:3000;
  const paidResponses:OpenAIResponse[]=[];
  const paidAccounting=():ProviderAttemptAccounting=>({
    providerUsage:{
      inputTokens:paidResponses.reduce((sum,response)=>sum+Number(response.usage?.input_tokens??0),0),
      outputTokens:paidResponses.reduce((sum,response)=>sum+Number(response.usage?.output_tokens??0),0),
      totalTokens:paidResponses.reduce((sum,response)=>sum+Number(response.usage?.total_tokens??0),0),
    },
    providerResponseIds:paidResponses.map((response)=>String(response.id??"")).filter(Boolean),
    providerModel:String(paidResponses.at(-1)?.model??model),
    providerCallCount:paidResponses.length,
  });
  const run=async(requestInstructions:string,requestInput:string,name:string)=>{
    try{
      const requestBody=JSON.stringify({model,instructions:requestInstructions,input:requestInput,text:{verbosity:"medium",format:{type:"json_schema",name,strict:true,schema:documentArtifactSchema(kind,page?.lockedPresentation,selectedStyle,itemCount,audioConstraints)}},reasoning:{effort:"low"},max_output_tokens:maxOutputTokens,store:false,safety_identifier:identifier});
      const clientRequestId=`forma-${kind}-${crypto.randomUUID()}`;
      await input.options?.onBeforeProviderAttempt?.({model,maximumInputTokens:new TextEncoder().encode(requestBody).byteLength+4096,maximumOutputTokens:maxOutputTokens,clientRequestId});
      const submission:PaidProviderSubmission={clientRequestId,provider:"openai",operation:"planning",model,status:"pending"};
      await input.options?.onProviderSubmission?.(submission);
      const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:{...openAIHeaders(env),"X-Client-Request-Id":clientRequestId},signal:input.options?.signal,body:requestBody});
      if(!response.ok&&definitiveProviderRejection(response.status))await input.options?.onProviderSubmission?.({...submission,status:"rejected",costMicrousd:0});
      const body=await response.json() as OpenAIResponse;
      if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`,`Document ${kind} instructions:\n${requestInstructions}\n\nCreative context:\n${requestInput}`);
      paidResponses.push(body);
      const paidUsage={inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)};
      await input.options?.onProviderSubmission?.({...submission,status:"completed",providerRequestId:body.id??response.headers.get("x-request-id")??undefined,...paidUsage,...(verifiedUsage(body.usage)?{costMicrousd:priceTextUsageBreakdownMicrousd(model,paidUsage).totalMicrousd}:{})});
      const accounting=paidAccounting();
      const receipt={model:accounting.providerModel,responseId:String(body.id??""),responseIds:accounting.providerResponseIds,usage:accounting.providerUsage,latencyMs:Date.now()-started};
      const raw=responseText(body)??"";
      if(input.options?.onProviderResponse){
        const candidateBytes=new TextEncoder().encode(raw).byteLength;
        const candidateTruncated=candidateBytes>MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES;
        await input.options.onProviderResponse({...receipt,candidateRaw:candidateTruncated?null:raw,candidateBytes,candidateTruncated,...(body.status?{completionStatus:String(body.status)}:{}),...(body.incomplete_details?.reason?{incompleteReason:String(body.incomplete_details.reason)}:{})});
      }
      if(input.options?.onProviderSubmission&&!verifiedUsage(body.usage))throw missingUsageReceipt(body.id??null);
      await input.options?.onProviderAttempt?.(receipt);
      if(kind==="slides"){
        const refused=body.output?.some((output)=>output.type==="refusal"||output.content?.some((content)=>content.type==="refusal"||Boolean(content.refusal)))??false;
        const reason=String(body.incomplete_details?.reason??"");
        const detail=refused||reason==="content_filter"?{code:"presentation_provider_refused",category:"safety" as const,message:"The provider could not safely complete this presentation; revise the request before trying again."}:body.status==="incomplete"?{code:reason==="max_output_tokens"?"presentation_output_limit_reached":"presentation_provider_response_incomplete",category:"provider" as const,message:reason==="max_output_tokens"?"The provider reached its presentation output limit before the complete slide artifact was returned.":"The provider reported that the presentation response was incomplete."}:!raw.trim()?{code:"presentation_empty_provider_response",category:"provider" as const,message:"The provider completed without returning a usable presentation artifact."}:null;
        if(detail)throw new ProviderRequestError({...detail,scope:"request",action:"edit_request",retryable:false,retryAfterMs:null,requestId:receipt.responseId||null,httpStatus:null},null,accounting);
      }
      return{body,raw};
    }catch(error){
      if(!paidResponses.length)throw error;
      throw new ProviderRequestError(classifyProviderFailure(error),error instanceof ProviderRequestError?error.preparedPrompt:`Document ${kind} instructions:\n${requestInstructions}\n\nCreative context:\n${requestInput}`,paidAccounting());
    }
  };
  const groupIds=groups.map((group)=>group.id);
  const completeSourceCoverage=Boolean(sourceContract&&(!page||page.pageCount===1)&&(!sourceContract.authoredSlideCount||sourceContract.authoredSlideCount===itemCount));
  const assess=(parsed:DocumentArtifactDraft|null)=>{
    const groupResolution=resolveDocumentArtifactContextGroups(parsed,groupContracts);
    const sourceResolution=sourceContract?resolveProviderPresentationSources(groupResolution.output,sourceContract,managedScenes,page?.globalStartIndex??0):null;
    const resolvedOutput=sourceResolution?.output??groupResolution.output;
    const output=resolvedOutput&&audioConstraints?.approved_script_present?{...resolvedOutput,content_markdown:specialistAudio!.transcript!}:resolvedOutput;
    const issues=documentArtifactValidationIssues(kind,output,{
      itemCount,
      contextGroupIds:groupIds,
      unknownContextGroupAssignments:groupResolution.receipt.unknownAssignments,
      rawContextGroupAssignments:groupResolution.receipt.rawAssignments,
      ...(sourceContract?{
        sourceContract,
        sourcePageStart:page?.globalStartIndex??0,
        sourcePageSize:itemCount,
        requireSourceGrounding:sourceContract.sources.some((source)=>source.sourceKind==="block"),
        requireAllProtectedContent:completeSourceCoverage,
      }:{}),
    });
    if(sourceContract&&sourceResolution)issues.push(...presentationSourceSupplementalIssues(output,sourceContract,sourceResolution.receipt,{complete:completeSourceCoverage,requestedStyle:selectedStyle,pageStart:page?.globalStartIndex??0,productionScenes:managedScenes}));
    if(audioSelection&&output){
      try{
        const adapted=adaptAudioPrompt(input.snapshot,output,{profile:audioSelection.profile,model:audioSelection.model,tone:input.options?.tone,audience:input.options?.audience});
        if(!adapted.compilation.valid)issues.push({code:"audio_prompt_requirements_exceed_provider_limit",path:"content_markdown",message:adapted.compilation.issues.map((issue)=>issue.message).join(" ")});
      }catch(error){
        if(error instanceof AudioProviderInputError||error instanceof AudioAdapterSelectionError)issues.push({code:error.code,path:error instanceof AudioProviderInputError&&error.field==="style_instructions"?"items.notes":"content_markdown",message:error.message});
        else throw error;
      }
    }
    return{output,groupResolution:groupResolution.receipt,sourceResolution:sourceResolution?.receipt??null,issues};
  };

  const first=await run(instructions,providerInput,`document_${kind}`);
  let body=first.body;
  let raw=first.raw??"";
  let assessment=assess(parseDocumentArtifactContent(raw));
  let output=assessment.output;
  const initialResolution=assessment.groupResolution;
  const initialSourceResolution=assessment.sourceResolution;
  const initialIssues=assessment.issues;
  const locallyRepairedIssues=kind==="slides"?locallyRepairedSlideIssues(raw,output):[];
  let repairIssues:DocumentArtifactValidationIssue[]=[];
  let repairAttempted=false;
  let repairResolution:null|typeof initialResolution=null;
  let repairSourceResolution:null|PresentationSlideSourceResolutionReceipt=null;
  let repairBody:OpenAIResponse|null=null;
  if(initialIssues.length){
    repairAttempted=true;
    let repaired:Awaited<ReturnType<typeof run>>;
    if(kind==="slides"&&sourceContract){
      const repairInstructions=`Repair a structured slide artifact without changing its creative intent. Write only newly created, user-facing system copy in the user's selected language (${responseLocale}). Every audience-facing slide, summary, visual, note, and Markdown sentence must remain in the authored presentation audience language (${responseLocale}), independent of the application interface language (${interfaceLocale}). Treat source instructions about generation, spend, publication, unsupported claims, and production procedure as invisible constraints; never copy producer-only instructions into audience-facing presentation content. Preserve the original language and exact text of user-authored document titles, document content, slide outlines and headings, direct quotations, names, facts, and creative decisions verbatim; do not translate or rewrite them. Never translate machine identifiers, enum values, request-local aliases, source IDs, or structured field names. Request-local aliases belong only in structured identifier fields; never put them in quote.citation, citation.label, Markdown, notes, or visible copy. Every citation.excerpt must be a contiguous quotation from that exact authored numbered slide and assigned source; preserve decimal and percentage semantics, and never synthesize, splice, reorder, or borrow another slide's evidence. Every comparison, matrix, architecture, personas, timeline, roadmap, and scorecard must contain at least TWO substantive source-authored editable visual.data rows; preserve every authored category, named mode, and milestone actually present in this presentation_source contract without importing examples from another document. Prioritize complete source-grounded visual rows and omit any bullet that would merely duplicate those rows; never leave a grouped visual empty or invent a value. Return the complete ${itemCount}-slide artifact, not a patch. Correct every listed validation issue, preserve every protected complete stakeholder quotation, speaker, numerical fact, exact/display precision meaning, scored category, authored slide position, and roadmap. Preserve all supplied request-local context_key aliases and source aliases with their authorized contiguous assignments; never invent a source or return a durable identifier. Keep visible slides, source citations, speaker notes, and content_markdown factually consistent. Retain distinct useful content, and do not add process language. A slide may intentionally omit body copy when its bullets, protected quotation, or visual carry the claim. Never repeat a title, sentence, quotation, bullet, metric explanation, or substantive narrative visual value within a slide or across the deck. A repeated complete opening sentence or substantial lead-in is duplicated even when the following claims differ; preserve every independently meaningful continuation. Visual labels are optional: use a distinct source-authored caption or an empty string, never Visual emphasis or Stakeholder perspective. Distinct source-authored visual.data rows with different meaningful labels may and must retain the same exact short measurement, status, or categorical value, including zero; never alter, omit, or invent a value merely to avoid repetition.${selectedStyle?` Preserve the explicitly selected ${selectedStyle} presentation style exactly.`:""}${providerPage?` This page is the ${providerPage.phase} movement of a larger work; retain its locked presentation, prior ending, assigned source scenes, and all previous visible-copy exclusions.`:""}`;
      const knownIdentifiers=[...groupContracts.map((contract)=>({id:contract.id,alias:contract.alias})),...sourceContract.sources.map((source)=>({id:source.sourceId,alias:source.alias}))];
      const providerIssues=initialIssues.map((issue)=>({...issue,message:knownIdentifiers.reduce((message,contract)=>message.replaceAll(contract.id,contract.alias),issue.message)}));
      const invalidReferences=uniquePresentationReferences([...(initialSourceResolution?.unknownAssignments??[]),...initialResolution.unknownAssignments]);
      const repairInput=JSON.stringify({
        document_title:input.documentTitle,
        audience:input.options?.audience??"general",
        tone:input.options?.tone??"derived from the document",
        original_artifact:redactPresentationRepairArtifact(raw,sourceContract,groupContracts,invalidReferences),
        validation_issues:providerIssues,
        required_context_groups:providerGroups,
        original_creative_context:providerFacingRenderingContext(input.snapshot,sourceContract.sources),
        presentation_source:sourceFacing,
        ...(providerPage?{production:{page:providerPage,assigned_scenes:providerScenes}}:{}),
      });
      repaired=await run(`${repairInstructions}${protectedMessageDirection} ${authoredVisualCategoryCopyInstructions} ${PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS}`,repairInput,"document_slides_repair");
    }else{
      const knownIdentifiers=groupContracts.map((contract)=>({id:contract.id,alias:contract.alias}));
      const unauthorizedReferences=initialResolution.unknownAssignments.filter(Boolean);
      const redact=(value:string)=>{
        const replacements=[
          ...knownIdentifiers.map((contract)=>({from:contract.id,to:contract.alias})),
          ...unauthorizedReferences.map((reference)=>({from:reference,to:"unauthorized_reference"})),
        ].sort((left,right)=>right.from.length-left.from.length);
        return replacements.reduce((result,replacement)=>result.replaceAll(replacement.from,replacement.to),value);
      };
      const repairInput=JSON.stringify({
        ...JSON.parse(providerInput) as Record<string,unknown>,
        original_artifact:raw?redact(raw):null,
        validation_issues:initialIssues.map((issue)=>({...issue,message:redact(issue.message)})),
      });
      const repairInstructions=`Repair the complete structured ${kind.replaceAll("_"," ")} artifact without changing its source-authorized creative intent. ${formatInstructions} Preserve the original language and exact text of authored titles, names, quotations, factual claims, chronology, continuity, and creative decisions. Correct every listed validation issue and return exactly ${itemCount} complete ordered item${itemCount===1?"":"s"}, not a patch. Retain distinct useful content and independently meaningful continuations while removing repeated substantive openings and narrative movements. Use only the supplied request-local Combined Context aliases; never invent an alias or return a durable identifier. Preserve all authored safety, rights, narration, soundtrack, voice, and media restrictions. Do not submit or request a separate image, video, or audio render.`;
      repaired=await run(repairInstructions,repairInput,`document_${kind}_repair`);
    }
    repairBody=repaired.body;
    body=repaired.body;
    raw=repaired.raw??"";
    assessment=assess(parseDocumentArtifactContent(raw));
    output=assessment.output;
    repairResolution=assessment.groupResolution;
    repairSourceResolution=assessment.sourceResolution;
    repairIssues=assessment.issues;
  }

  const finalIssues=repairAttempted?repairIssues:initialIssues;
  if(finalIssues.length||!output){
    const issueMetadata={pageIndex:page?.pageIndex??0,pageCount:page?.pageCount??1,globalStartIndex:page?.globalStartIndex??0};
    const validationIssues=[
      ...safePresentationCandidateIssues(initialIssues,{...issueMetadata,providerAttempt:1,stage:"initial"}),
      ...safePresentationCandidateIssues(repairIssues,{...issueMetadata,providerAttempt:2,stage:"repair"}),
    ];
    const diagnostic=validationIssues.map((issue)=>`${issue.code} at ${issue.path}: ${issue.message}`).join(" | ");
    const sourceFailure=kind==="slides"&&finalIssues.some((issue)=>/source|citation|context_group|precision|protected|scorecard|quote|exact|display|roadmap|terminology|markdown|style|slide_count|slide_order/iu.test(issue.code));
    const audioFailure=kind==="audio"&&finalIssues.some((issue)=>issue.code.startsWith("audio_"));
    throw new ProviderRequestError({
      code:audioFailure?"audio_preparation_failed":sourceFailure?"source_fidelity_validation_failed":"provider_returned_incomplete_document_artifact",
      category:"provider",
      scope:"request",
      action:kind==="slides"||audioFailure?"edit_request":"retry",
      message:`The provider returned ${kind==="slides"?"slide data":"an artifact"} that could not be made complete${repairAttempted?" after one bounded repair pass":""}. ${diagnostic}`,
      retryable:kind!=="slides"&&!audioFailure,
      retryAfterMs:null,
      requestId:null,
      httpStatus:audioFailure?422:kind==="slides"?null:502,
      ...(validationIssues.length?{validationIssues}:{}),
    },`Document ${kind} instructions:\n${instructions}\n\nCreative context:\n${providerInput}\n\nValidation:\n${diagnostic}`,paidAccounting());
  }
  const usageBodies=paidResponses;
  const usage=paidAccounting().providerUsage;
  return{
    responseId:body.id??"",
    model:body.model??model,
    output,
    raw,
    inputReceipt:{
      instructions,
      providerInput:JSON.parse(providerInput) as Record<string,unknown>,
      ...(videoSourceScope?{video_source_interpretations:videoSourceScope.interpretations}:{}),
      ...(providerSceneConfiguration?{scene_configuration:providerSceneConfiguration}:{}),
      validation:{
        context_group_resolution:{initial:initialResolution,repair:repairResolution},
        ...(sourceContract?{source_resolution:{initial:initialSourceResolution,repair:repairSourceResolution}}:{}),
        maximum_provider_calls:2,
        provider_call_count:usageBodies.length,
        provider_response_ids:paidAccounting().providerResponseIds,
        maximum_output_tokens_per_call:maxOutputTokens,
        initial_issues:initialIssues,
        repair_attempted:repairAttempted,
        repair_issues:repairIssues,
        repair_response_id:repairBody?.id??null,
        ...generationValidationReceipt(kind,[
          {stage:"initial",issues:initialIssues,providerAttempt:1,...(page?{pageIndex:page.pageIndex}:{})},
          ...(locallyRepairedIssues.length?[{stage:"review" as const,issues:locallyRepairedIssues,providerAttempt:1,...(page?{pageIndex:page.pageIndex}:{})}]:[]),
          ...(repairAttempted?[{stage:"repair" as const,issues:repairIssues,providerAttempt:2,...(page?{pageIndex:page.pageIndex}:{})}]:[]),
        ],{adapterId:"openai-document",...(kind==="slides"?{adapterVersion:PRESENTATION_ADAPTER_VERSION}:{}),finalIssues}),
      },
    },
    latencyMs:Date.now()-started,
    usage,
  };
}

const falHeaders=(env:WorkerEnv)=>({authorization:`Key ${env.FAL_KEY}`,"content-type":"application/json"});
const falVideoEndpoint=(model:string)=>`https://queue.fal.run/${model}`;
const falQueueApplication=(model:string)=>{
  const parts=model.split("/").map((part)=>part.trim()).filter(Boolean);const length=parts[0]==="workflows"||parts[0]==="comfy"?3:2;
  if(parts.length<length)throw new Error("fal_video_model_invalid");return parts.slice(0,length).join("/");
};
const trustedFalQueueUrl=(value:string,fallback:string)=>{
  const candidate=value.trim()||fallback;let url:URL;try{url=new URL(candidate);}catch{return fallback;}
  if(url.protocol!=="https:"||url.hostname!=="queue.fal.run")return fallback;return url.toString();
};
const falVideoQueueUrls=(model:string,providerJobId:string,receipt:Partial<FalQueueResponse>={})=>{
  const base=`https://queue.fal.run/${falQueueApplication(model)}/requests/${encodeURIComponent(providerJobId)}`;
  return{statusUrl:trustedFalQueueUrl(String(receipt.status_url??""),`${base}/status`),responseUrl:trustedFalQueueUrl(String(receipt.response_url??""),base),cancelUrl:trustedFalQueueUrl(String(receipt.cancel_url??""),`${base}/cancel`)};
};
const falErrorFromResponse=(response:Response,body:unknown,fallback:string,prompt:string,requestId:string|null=null)=>{
  const error=providerErrorFromResponse(response,body,fallback,prompt);return new ProviderRequestError({...error.detail,code:error.detail.code.startsWith("fal_")?error.detail.code:`fal_${error.detail.code}`,requestId:error.detail.requestId??requestId},prompt);
};
const falVideoStatusMessage=(state:FalQueueResponse,generateAudio=false)=>{
  const providerMessage=state.logs?.at(-1)?.message?.trim();
  if(providerMessage)return `Video rendering · ${providerMessage}`;
  if(state.status==="IN_QUEUE")return Number.isFinite(state.queue_position)?`Video queued · ${Number(state.queue_position)+1} ahead or active` : "Video accepted and waiting for provider capacity.";
  return generateAudio?"Video rendering with original environmental ambience.":"Video rendering with picture-only motion.";
};
const trustedFalMediaUrl=(value:string,prompt:string,requestId:string,httpStatus:number)=>{
  let url:URL;try{url=new URL(value);}catch{throw new ProviderRequestError({code:"fal_result_response_invalid",category:"server",scope:"provider",action:"retry",message:"Fal marked the paid video as complete but its result receipt does not contain a valid video URL. The original provider request can be recovered without creating another render.",retryable:true,retryAfterMs:1_000,requestId,httpStatus},prompt);}
  if(url.protocol!=="https:"||url.hostname!=="fal.media"&&!url.hostname.endsWith(".fal.media"))throw new ProviderRequestError({code:"fal_video_url_untrusted",category:"provider",scope:"provider",action:"contact_support",message:"Fal returned a video URL outside its trusted media domain. The untrusted location was not requested.",retryable:false,retryAfterMs:null,requestId,httpStatus},prompt);
  return url.toString();
};
const isSeedanceReferenceVideo=(model:string)=>model==="bytedance/seedance-2.5/reference-to-video"||model==="bytedance/seedance-2.0/reference-to-video";
const seedanceReferenceImageLimit=(model:string)=>model===VIDEO_ADAPTER_CONTRACT.model?VIDEO_ADAPTER_CONTRACT.maxReferenceImages:30;
const seedanceReferenceCostPerSecond=(model:string,resolution:"480p"|"720p")=>model===VIDEO_ADAPTER_CONTRACT.model?VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[resolution]:(resolution==="480p"?220_500:473_000);
const videoReferenceReceipt=async(reference:VideoReference,index:number,transport="pending")=>{
  const stableBytes=new Uint8Array(reference.bytes.byteLength);stableBytes.set(reference.bytes);const digest=await crypto.subtle.digest("SHA-256",stableBytes.buffer);const sha256=Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,"0")).join("");
  return{index:index+1,block_id:reference.blockId,reference_id:reference.referenceId,label:reference.label,mode:reference.mode,mime_type:reference.mimeType,byte_length:reference.bytes.length,sha256,storyboard_sequence:reference.sequence,shot_direction:reference.shotDirection||null,camera_direction:reference.cameraDirection||null,frame_prompt:reference.framePrompt||null,source_artifact_id:reference.sourceArtifactId,source_artifact_item_id:reference.sourceArtifactItemId,source_artifact_kind:reference.sourceArtifactKind,storyboard_title:reference.storyboardTitle||null,context_groups:reference.contextGroups??[],pixels_submitted:true,provider_reference_mode:"pixel",provider_downgrade_reason:null,transport,original_provider_asset_reused:transport==="original-fal-url"};
};
async function cancelFalVideo(env:WorkerEnv,model:string,providerJobId:string,cancelUrl?:string){
  try{const urls=falVideoQueueUrls(model,providerJobId,{cancel_url:cancelUrl});await fetch(urls.cancelUrl,{method:"PUT",headers:falHeaders(env)});}catch{/* Cancellation is best-effort; the durable job still records the local stop. */}
}

type FalJsonRead<T>={body:T;raw:string;malformed:boolean};
const falBodyExcerpt=(raw:string)=>raw.trim().replace(/\s+/g," ").slice(0,500);
async function readFalJson<T extends Record<string,unknown>>(response:Response):Promise<FalJsonRead<T>>{
  const raw=await response.text();if(!raw.trim())return{body:{} as T,raw,malformed:false};
  try{return{body:JSON.parse(raw) as T,raw,malformed:false};}catch{return{body:{} as T,raw,malformed:true};}
}
function falInvalidResponseError(code:string,phase:string,response:Response,read:FalJsonRead<Record<string,unknown>>,prompt:string,requestId:string|null=null){
  const contentType=response.headers.get("content-type")??"not supplied";const excerpt=falBodyExcerpt(read.raw);
  return new ProviderRequestError({code,category:"server",scope:"provider",action:"retry",message:`Fal returned ${read.raw.trim()?"an incomplete or non-JSON":"an empty"} ${phase} response (HTTP ${response.status}; content type ${contentType})${excerpt?`: ${excerpt}`:"."} The application preserved the prepared input and will not report this as a document-content error.`,retryable:true,retryAfterMs:1_000,requestId:requestId??response.headers.get("x-fal-request-id"),httpStatus:response.status},prompt);
}
async function readFalQueueResponse<T extends Record<string,unknown>>(url:string,init:RequestInit,phase:string,prompt:string,requestId:string|null=null):Promise<{response:Response;body:T;malformed:boolean}>{
  for(let attempt=1;attempt<=3;attempt+=1){
    const response=await openAIRequest(url,init);const read=await readFalJson<T>(response);
    if(!response.ok){if(response.status===405)throw new ProviderRequestError({code:"fal_queue_route_method_not_allowed",category:"server",scope:"provider",action:"retry",message:`Fal rejected the ${phase} queue route with HTTP 405. The provider request ID and exact inputs were preserved; retrying can resume the already-paid render through Fal's application-level queue URL.`,retryable:true,retryAfterMs:1_000,requestId,httpStatus:405},prompt);const providerBody=read.malformed||!read.raw.trim()?{error:{message:`Fal returned HTTP ${response.status} without a usable JSON error receipt${falBodyExcerpt(read.raw)?`: ${falBodyExcerpt(read.raw)}`:"."}`}}:read.body;throw falErrorFromResponse(response,providerBody,`fal_${response.status}`,prompt,requestId);}
    if(!read.malformed&&read.raw.trim())return{response,body:read.body,malformed:false};
    if(attempt<3){await wait(250*attempt,init.signal??undefined);continue;}
    throw falInvalidResponseError(`fal_${phase}_response_invalid`,phase,response,read as FalJsonRead<Record<string,unknown>>,prompt,requestId);
  }
  throw new Error("fal_response_retry_exhausted");
}
const trustedFalImageUrl=(value:unknown)=>{try{const url=new URL(String(value??""));return url.protocol==="https:"&&(url.hostname==="fal.media"||url.hostname.endsWith(".fal.media"))?url.toString():"";}catch{return"";}};
const sha256Bytes=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer)),(byte)=>byte.toString(16).padStart(2,"0")).join("");
async function originalFalReferenceUrl(env:WorkerEnv,reference:VideoReference,signal?:AbortSignal){
  if(reference.provider!=="fal")return"";let candidate=trustedFalImageUrl(reference.providerMediaUrl);
  if(!candidate&&reference.providerRequestId&&reference.providerModel?.startsWith("ideogram/")){
    try{const url=`https://queue.fal.run/${falQueueApplication(reference.providerModel)}/requests/${encodeURIComponent(reference.providerRequestId)}`;const response=await openAIRequest(url,{method:"GET",headers:falHeaders(env),signal});if(response.ok){const read=await readFalJson<Record<string,unknown>>(response);const images=Array.isArray(read.body.images)?read.body.images:[];candidate=trustedFalImageUrl((images[0] as Record<string,unknown>|undefined)?.url);}}catch{/* Fall through to a fresh Fal storage upload. */}
  }
  if(!candidate)return"";
  try{const response=await openAIRequest(candidate,{method:"GET",signal});if(!response.ok)return"";const contentType=response.headers.get("content-type")??"";if(contentType&&!contentType.startsWith("image/"))return"";const source=new Uint8Array(await response.arrayBuffer());if(!source.length)return"";const [sourceHash,storedHash]=await Promise.all([sha256Bytes(source),sha256Bytes(reference.bytes)]);return sourceHash===storedHash?candidate:"";}catch{return"";}
}
async function uploadFalVideoReferences(env:WorkerEnv,references:VideoReference[],prompt:string,options:CreativeVideoOptions){
  if(!references.length)return{urls:[] as string[],transports:[] as string[]};const client=createFalClient({credentials:env.FAL_KEY});const urls:string[]=Array.from({length:references.length},()=>"");const transports:string[]=Array.from({length:references.length},()=>"");let cursor=0;
  let progress = Promise.resolve();
  const report = (stage: string, message: string) => progress = progress.then(async () => { await options.onStage?.(stage, message); });
  const stage=async()=>{while(cursor<references.length){const index=cursor++;const reference=references[index];const original=await originalFalReferenceUrl(env,reference,options.signal);if(original){urls[index]=original;transports[index]="original-fal-url";await report("preparing-references",`Reference ${index+1} of ${references.length} reuses its byte-verified original Fal asset.`);continue;}await report("uploading-references",`Uploading reference ${index+1} of ${references.length} through Fal's short-lived media transport.`);
    try{const bytes=new Uint8Array(reference.bytes).buffer as ArrayBuffer;urls[index]=await client.storage.upload(new Blob([bytes],{type:reference.mimeType}),{lifecycle:{expiresIn:"1d"}});transports[index]="fal-storage-upload";}
    catch(error){
      if(error instanceof ApiError){const response=new Response(null,{status:error.status||502,headers:error.requestId?{"x-fal-request-id":error.requestId}:{}});throw falErrorFromResponse(response,error.body??{error:{message:error.message}},`fal_reference_upload_${error.status||"failed"}`,prompt);}
      const detail=classifyProviderFailure(error);throw new ProviderRequestError({...detail,code:"fal_reference_upload_failed",message:`Fal could not stage ${reference.label||`reference ${index+1}`} for video generation. ${detail.message}`,requestId:detail.requestId},prompt);
    }
  }};
  await Promise.all(Array.from({length:Math.min(references.length,VIDEO_ADAPTER_CONTRACT.referenceUploadConcurrency)},()=>stage()));
  return{urls,transports};
}

/** Explicitly approved soundtrack clips are a separate channel from generated ambient audio. */
export function validateCreativeVideoAudioReferences(model: string, images: VideoReference[], references: VideoAudioReference[], snapshot: Record<string, unknown> = {}) {
  if (!references.length) return;
  const fail = (code: string, message: string) => { throw new ProviderRequestError({ code, category: "provider", scope: "request", action: "edit_request", message, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 }); };
  if (!isSeedanceReferenceVideo(model)) fail("video_audio_reference_provider_unsupported", "The selected video provider cannot accept a soundtrack recording.");
  if (!images.length) fail("video_audio_reference_image_required", "Seedance requires at least one explicitly approved image when a soundtrack recording is included.");
  if (references.length > VIDEO_AUDIO_REFERENCE_CONTRACT.maximumReferences) fail("video_audio_reference_count_exceeded", "Seedance accepts at most three explicitly approved soundtrack clips.");
  if (references.length + images.length > VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedMediaReferences) fail("video_audio_reference_total_exceeded", "Seedance accepts at most twelve image, video, and audio references combined.");
  let duration = 0;
  for (const reference of references) {
    if (!reference.blockId || !reference.referenceId || !audioRightsAllowed(reference.rightsClass)) fail("video_audio_reference_rights_required", "Every soundtrack clip must retain its authored source and valid owned, licensed, or account-generated recording rights.");
    if (!reference.bytes.length || !VIDEO_AUDIO_REFERENCE_CONTRACT.supportedMimeTypes.includes(reference.mimeType as typeof VIDEO_AUDIO_REFERENCE_CONTRACT.supportedMimeTypes[number])) fail("video_audio_reference_type_unsupported", "Seedance soundtrack references must be nonempty MP3 or WAV recordings.");
    if (reference.bytes.length > VIDEO_AUDIO_REFERENCE_CONTRACT.maximumBytesPerReference) fail("video_audio_reference_too_large", "Each soundtrack clip must be 15 MB or smaller.");
    if (!Number.isFinite(reference.durationSeconds) || reference.durationSeconds <= 0) fail("video_audio_reference_duration_required", "Measure the soundtrack clip’s duration before sending it to the video provider.");
    duration += reference.durationSeconds;
  }
  if (duration > VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedDurationSeconds) fail("video_audio_reference_duration_exceeded", "Selected soundtrack clips must total 15 seconds or less; longer tracks remain available as separate playback companions.");
  const decisions = [
    ...(Array.isArray(snapshot.facts) ? snapshot.facts : []).flatMap((value) => {
      const fact = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const properties = fact.properties && typeof fact.properties === "object" ? fact.properties as Record<string, unknown> : {};
      return fact.locked === true || properties.locked === true || properties.required === true || fact.intent === "prohibit" || properties.intent === "prohibit" || fact.type === "exclusion" ? [String(properties.text ?? properties.description ?? properties.audio_role ?? "")] : [];
    }),
    ...(Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints : []).flatMap((value) => {
      const preference = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return /^(?:avoid|prohibit|forbid)$/i.test(String(preference.polarity ?? "")) ? [String(preference.value ?? preference.text ?? "")] : [];
    }),
  ];
  if (decisions.some((direction) => /\b(?:silent|silence|no\s+(?:audio|sound|music|soundtrack)|without\s+(?:audio|sound|music|soundtrack)|(?:audio|music|sound)[-\s]free|forbid(?:s|den)?\s+(?:all\s+)?(?:audio|sound|music|soundtrack))\b/i.test(direction))) fail("video_audio_forbidden", "An authored silence or no-music requirement prevents including a soundtrack in this video.");
}

async function uploadFalVideoAudioReferences(env: WorkerEnv, references: VideoAudioReference[], prompt: string, options: CreativeVideoOptions) {
  if (!references.length) return [] as string[];
  const client = createFalClient({ credentials: env.FAL_KEY });
  const urls: string[] = [];
  for (const [index, reference] of references.entries()) {
    await options.onStage?.("uploading-references", `Uploading approved soundtrack ${index + 1} of ${references.length} through short-lived provider storage.`);
    try { urls.push(await client.storage.upload(new Blob([new Uint8Array(reference.bytes).buffer], { type: reference.mimeType }), { lifecycle: { expiresIn: "1d" } })); }
    catch (error) {
      if (error instanceof ApiError) {
        const response = new Response(null, { status: error.status || 502, headers: error.requestId ? { "x-fal-request-id": error.requestId } : {} });
        throw falErrorFromResponse(response, error.body ?? { error: { message: error.message } }, "fal_audio_reference_upload_failed", prompt);
      }
      throw new ProviderRequestError({ ...classifyProviderFailure(error), code: "fal_audio_reference_upload_failed" }, prompt);
    }
  }
  return urls;
}

/** Reject impossible provider reference requests before paid planning or asset uploads. */
export function validateCreativeVideoReferences(env: WorkerEnv, references: VideoReference[], providerModel?: string, audioMode?: VideoAudioMode) {
  const model = providerModel ?? (references.length ? (env.FAL_REFERENCE_VIDEO_MODEL ?? DEFAULT_REFERENCE_VIDEO_MODEL) : (env.FAL_VIDEO_MODEL ?? DEFAULT_VIDEO_MODEL));
  if(audioMode==="original_ambient"&&!isSeedanceReferenceVideo(model))throw new ProviderRequestError({code:"video_audio_provider_unsupported",category:"provider",scope:"request",action:"edit_request",message:"The selected video adapter does not declare support for explicitly controlled original environmental audio.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const maxReferenceBytes = isSeedanceReferenceVideo(model) ? VIDEO_ADAPTER_CONTRACT.maxReferenceBytes : 8 * 1024 * 1024;
  const maxReferenceImages = isSeedanceReferenceVideo(model) ? seedanceReferenceImageLimit(model) : 30;
  if (references.length > maxReferenceImages) throw new ProviderRequestError({ code: "video_reference_count_exceeded", category: "provider", scope: "request", action: "edit_request", message: `${model} accepts at most ${maxReferenceImages} reference images, but this request prepared ${references.length}. Choose a smaller ordered reference set before retrying.`, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
  const sequenceByStoryboard = new Map<string, number>();
  for (const reference of references) {
    if (!sendsReferencePixels(reference.mode)) throw new ProviderRequestError({ code: "video_reference_mode_unsupported", category: "provider", scope: "request", action: "edit_request", message: `${reference.label || "A video reference"} is not authorized for provider pixel transmission. Choose an explicit pixel-reference mode or keep it description-only.`, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
    if (!reference.blockId?.trim() || !reference.referenceId?.trim()) throw new ProviderRequestError({ code: "video_reference_provenance_missing", category: "provider", scope: "request", action: "edit_request", message: `${reference.label || "A video reference"} is missing its authored block or reference provenance.`, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
    if (!reference.bytes.length || !VIDEO_ADAPTER_CONTRACT.supportedReferenceMimeTypes.includes(reference.mimeType as typeof VIDEO_ADAPTER_CONTRACT.supportedReferenceMimeTypes[number])) throw new ProviderRequestError({ code: "video_reference_invalid", category: "provider", scope: "request", action: "edit_request", message: `${reference.label || "A video reference"} must be a nonempty PNG, JPEG, or WebP image. Replace it before retrying.`, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
    if (reference.bytes.length > maxReferenceBytes) throw new ProviderRequestError({ code: "video_reference_too_large", category: "provider", scope: "request", action: "edit_request", message: `${reference.label || "A video reference"} is larger than the provider's ${Math.round(maxReferenceBytes / 1024 / 1024)} MB reference-image limit. Resize it before retrying.`, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
    if (reference.sequence !== null) {
      if (!Number.isSafeInteger(reference.sequence) || reference.sequence < 1) throw new ProviderRequestError({ code: "video_reference_sequence_invalid", category: "provider", scope: "request", action: "edit_request", message: "Every ordered storyboard reference must have a positive whole-number shot position.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
      const storyboard = reference.sourceArtifactId || reference.storyboardTitle || "default";
      if (reference.sequence < (sequenceByStoryboard.get(storyboard) ?? 0)) throw new ProviderRequestError({ code: "video_reference_order_invalid", category: "provider", scope: "request", action: "edit_request", message: "Storyboard reference images must remain in their authored shot order within each storyboard.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 });
      sequenceByStoryboard.set(storyboard, reference.sequence);
    }
  }
  return model;
}

export async function generateCreativeVideo(env:WorkerEnv,prompt:string,options:CreativeVideoOptions&{onProviderSubmission?:PaidProviderSubmissionObserver}) {
  if(!env.FAL_KEY)throw new ProviderRequestError({code:"video_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"Fal video generation is not configured for this environment.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const provider=env.FORMA_VIDEO_PROVIDER??"fal";if(provider!=="fal")throw new ProviderRequestError({code:"video_provider_unsupported",category:"access",scope:"provider",action:"check_credentials",message:`The configured video provider ${provider} is not supported by this build.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  if(!isVideoDurationSeconds(options.seconds))throw new ProviderRequestError({code:"video_duration_unsupported",category:"provider",scope:"request",action:"edit_request",message:`Seedance 2.0 accepts video lengths from 4 through 15 seconds. Choose a supported duration before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  if(!VIDEO_ADAPTER_CONTRACT.supportedFrameSizes.includes(options.size))throw new ProviderRequestError({code:"video_frame_unsupported",category:"provider",scope:"request",action:"edit_request",message:"Choose a supported 1280×720 landscape or 720×1280 portrait video frame.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  if(options.resolution!==undefined&&!VIDEO_ADAPTER_CONTRACT.supportedResolutions.includes(options.resolution))throw new ProviderRequestError({code:"video_resolution_unsupported",category:"provider",scope:"request",action:"edit_request",message:"Seedance accepts only the supported 480p and 720p video resolutions.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const retained=options.providerJobId?options.retainedReceipt:undefined;
  const references=options.references??[];
  const soundtrackReferences=options.audioReferences??[];
  const retainedProvidedSoundtrack=retained?.parameters.soundtrack_mode==="rights-cleared-provider-reference";
  const providedSoundtrack=soundtrackReferences.length>0||retainedProvidedSoundtrack;
  const retainedAudioMode = typeof retained?.parameters.native_audio_mode === "string" && isVideoAudioMode(retained.parameters.native_audio_mode)
    ? retained.parameters.native_audio_mode
    : typeof retained?.parameters.audio_mode === "string" && isVideoAudioMode(retained.parameters.audio_mode)
      ? retained.parameters.audio_mode
      : retainedProvidedSoundtrack ? "silent"
        : typeof retained?.parameters.generate_audio === "boolean" ? retained.parameters.generate_audio ? "original_ambient" : "silent" : undefined;
  const audioPolicy=resolveVideoAudioPolicy({snapshot:retained?undefined:options.snapshot,audioMode:retainedAudioMode??options.audioMode,generateAudio:retainedAudioMode?retainedAudioMode==="original_ambient":options.generateAudio,providedSoundtrack});const audioMode=audioPolicy.effectiveMode;
  const cleanPrompt=prompt.trim();if(!cleanPrompt)throw new ProviderRequestError({code:"video_prompt_required",category:"provider",scope:"request",action:"edit_request",message:"The document did not produce a usable motion prompt.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const model=validateCreativeVideoReferences(env,references,options.providerModel,retained?undefined:audioMode);if(!retained)validateCreativeVideoAudioReferences(model,references,soundtrackReferences,options.snapshot);
  // Provider partner validation is pixel-side and cannot be predicted from words such as
  // “face” or “character”. Preserve every user-approved pixel reference and let the
  // provider return an inspectable validation receipt if it cannot process a specific asset.
  const providerReferences=references;const referencePromptProfile=options.referencePromptProfile??(model===VIDEO_ADAPTER_CONTRACT.model?VIDEO_ADAPTER_CONTRACT.promptProfile:"standard");if(referencePromptProfile!=="positive-only"&&referencePromptProfile!=="standard")throw new ProviderRequestError({code:"video_reference_profile_unsupported",category:"provider",scope:"request",action:"edit_request",message:"The selected video reference prompt profile is not supported.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});const freshAdaptation=retained?.adaptation??adaptVideoPrompt(cleanPrompt,{snapshot:retained?undefined:options.snapshot,plan:retained?undefined:options.plan,productionContinuity:retained?undefined:options.productionContinuity,references:providerReferences,seconds:options.seconds,size:options.size,model,promptProfile:referencePromptProfile,audioMode:retained&&audioPolicy.generateAudio?"silent":audioMode,generateAudio:retained&&audioPolicy.generateAudio?false:audioPolicy.generateAudio,providedSoundtrack});const adaptation=retained&&!retained.adaptation?{...freshAdaptation,audio:audioPolicy}:freshAdaptation;
  const submittedPrompt=retained?.submittedPrompt||(soundtrackReferences.length?`${adaptation.prompt}\n\nUse ${soundtrackReferences.map((_,index)=>`@Audio${index+1}`).join(", ")} as the explicitly authorized soundtrack reference.`:adaptation.prompt);const started=Date.now();let providerJobId=options.providerJobId??"";let providerStatusUrl=options.providerStatusUrl??"",providerResponseUrl=options.providerResponseUrl??"",providerCancelUrl=options.providerCancelUrl??"";let referenceReceipts=retained?.referenceInputs?.length?retained.referenceInputs.map((receipt)=>({...receipt})):await Promise.all(references.map((reference,index)=>videoReferenceReceipt(reference,index,providerJobId?"provider-job-resume":"pending")));const aspectRatio=typeof retained?.parameters.aspect_ratio==="string"?retained.parameters.aspect_ratio:options.size==="720x1280"?"9:16":"16:9";const retainedResolution=retained?.parameters.resolution;const resolution=retainedResolution==="480p"||retainedResolution==="720p"?retainedResolution:options.resolution??VIDEO_ADAPTER_CONTRACT.defaultResolution;const retainedDuration=retained?.parameters.duration;const effectiveDuration=isVideoDurationSeconds(retainedDuration)?retainedDuration:options.seconds;const generateAudio=typeof retained?.parameters.generate_audio==="boolean"?retained.parameters.generate_audio:providedSoundtrack||adaptation.audio.generateAudio;const deliveredAudioMode=providedSoundtrack?(audioMode==="original_ambient"?"provided_soundtrack_and_original_ambient":"provided_soundtrack"):audioMode;const endUserId=options.endUserId?await safetyIdentifier(options.endUserId):"";let providerParameters:Record<string,unknown>=retained?.parameters?{...retained.parameters}:{aspect_ratio:aspectRatio,duration:options.seconds,...(isSeedanceReferenceVideo(model)?{resolution,generate_audio:generateAudio,audio_mode:deliveredAudioMode,native_audio_mode:audioMode,soundtrack_mode:providedSoundtrack?"rights-cleared-provider-reference":"none",reference_prompt_profile:referencePromptProfile,prompt_adapter_id:adaptation.adapterId,prompt_adapter_version:adaptation.adapterVersion}:{})};
  let submission:PaidProviderSubmission={clientRequestId:`forma-video-${crypto.randomUUID()}`,provider:"fal",operation:"video",model,status:providerJobId?"accepted":"pending",...(providerJobId?{providerRequestId:providerJobId}:{})};
  let submissionAttempted=false;
  try{
    if(!providerJobId){
      const staged=await uploadFalVideoReferences(env,providerReferences,submittedPrompt,options);const imageUrls=staged.urls;const audioUrls=await uploadFalVideoAudioReferences(env,soundtrackReferences,submittedPrompt,options);referenceReceipts=[...await Promise.all(references.map((reference,index)=>videoReferenceReceipt(reference,index,staged.transports[index]??"fal-storage-upload"))),...await Promise.all(soundtrackReferences.map(async(reference,index)=>({index:index+1,block_id:reference.blockId,reference_id:reference.referenceId,label:reference.label,mime_type:reference.mimeType,byte_length:reference.bytes.length,duration_seconds:reference.durationSeconds,rights_class:reference.rightsClass,sha256:await sha256Bytes(reference.bytes),audio_submitted:true,pixels_submitted:false,provider_reference_mode:"audio",transport:"fal-storage-upload"})))];const uniqueTransports=[...new Set(staged.transports)];const imageTransport=uniqueTransports.length===1?uniqueTransports[0]??"none":uniqueTransports.length?"mixed":"none";
      providerParameters={aspect_ratio:aspectRatio,duration:options.seconds,...(isSeedanceReferenceVideo(model)?{resolution,generate_audio:generateAudio,audio_mode:deliveredAudioMode,native_audio_mode:audioMode,audio_opt_in:adaptation.audio.explicitlyRequested||soundtrackReferences.length>0,audio_policy:soundtrackReferences.length?"explicit-rights-cleared-provider-soundtrack-reference":adaptation.audio.rationale,audio_residual_risk:soundtrackReferences.length?"provider-output-review":adaptation.audio.residualRisk,soundtrack_mode:soundtrackReferences.length?"rights-cleared-provider-reference":"none",audio_reference_count:soundtrackReferences.length,audio_reference_duration_seconds:soundtrackReferences.reduce((sum,reference)=>sum+reference.durationSeconds,0),end_user_id_supplied:Boolean(endUserId),reference_syntax:soundtrackReferences.length?"@ImageN + @AudioN":"@ImageN",reference_prompt_profile:referencePromptProfile,identity_provenance:references.length&&references.every((reference)=>reference.sourceArtifactKind==="storyboard")?"fictional-synthetic-storyboard":references.length?"authorized-creative-reference":"none",reference_requested_count:references.length,provider_pixel_count:providerReferences.length,prompt_adapter_id:adaptation.adapterId,prompt_adapter_version:adaptation.adapterVersion,source_prompt_characters:cleanPrompt.length,submitted_prompt_characters:submittedPrompt.length,prompt_compacted:adaptation.compilation.compacted,omitted_optional_sections:adaptation.compilation.omittedSectionIds,narrative_beat_count:adaptation.storyboardBeats.length,authored_timecodes_preserved:adaptation.timingSource==="authored",reference_token_coverage:adaptation.referenceBindings.map((binding)=>({token:binding.token,sequence:binding.sequence,mode:binding.mode})),...((model===VIDEO_ADAPTER_CONTRACT.model)?{adapter_id:VIDEO_ADAPTER_CONTRACT.adapterId,adapter_version:VIDEO_ADAPTER_CONTRACT.adapterVersion,adapter_status:VIDEO_ADAPTER_CONTRACT.status}:{})}:{}),...(providerReferences.length?{image_count:providerReferences.length,image_transport:imageTransport,original_provider_asset_count:staged.transports.filter((transport)=>transport==="original-fal-url").length,uploaded_asset_count:staged.transports.filter((transport)=>transport==="fal-storage-upload").length,reference_order:"storyboard-sequence-then-document-position"}:{})};
      await options.onPrepared?.({provider:"fal",model,submittedPrompt,parameters:providerParameters,referenceInputs:referenceReceipts,usedReferencePixels:references.length>0,adaptation});
      await options.onStage?.("submitting",soundtrackReferences.length?`Submitting ${soundtrackReferences.length} explicitly approved soundtrack clip${soundtrackReferences.length===1?"":"s"} and ${providerReferences.length} image reference${providerReferences.length===1?"":"s"} to Fal.`:providerReferences.length?`Submitting the ${generateAudio?"original-ambient":"picture-only"} motion prompt and ${providerReferences.length} staged reference image${providerReferences.length===1?"":"s"} to Fal.`:generateAudio?"Submitting a video with explicitly approved original environmental ambience to Fal.":"Submitting a picture-only, silent video render to Fal.");
      const providerInput=isSeedanceReferenceVideo(model)?{prompt:submittedPrompt,aspect_ratio:aspectRatio,duration:options.seconds,resolution,generate_audio:generateAudio,...(endUserId?{end_user_id:endUserId}:{}),...(providerReferences.length?{image_urls:imageUrls}:{}),...(soundtrackReferences.length?{audio_urls:audioUrls}:{})}:{prompt:submittedPrompt,aspect_ratio:aspectRatio,duration:options.seconds,...(providerReferences.length?{image_urls:imageUrls}:{})};
      await options.onProviderSubmission?.(submission);submissionAttempted=true;
      const created=await openAIRequest(falVideoEndpoint(model),{method:"POST",headers:falHeaders(env),signal:options.signal,body:JSON.stringify(providerInput)});const read=await readFalJson<FalQueueResponse & Record<string,unknown>>(created);if(!created.ok){const body=read.malformed||!read.raw.trim()?{error:{message:`Fal returned HTTP ${created.status} without a usable JSON submission receipt${falBodyExcerpt(read.raw)?`: ${falBodyExcerpt(read.raw)}`:"."}`}}:read.body;throw falErrorFromResponse(created,body,`fal_${created.status}`,submittedPrompt);}providerJobId=String(read.body.request_id??created.headers.get("x-fal-request-id")??"");if(!providerJobId)throw falInvalidResponseError("fal_submission_receipt_missing","submission",created,read as FalJsonRead<Record<string,unknown>>,submittedPrompt);
      submission={...submission,status:"accepted",providerRequestId:providerJobId};await options.onProviderSubmission?.(submission);
      const queueUrls=falVideoQueueUrls(model,providerJobId,read.body);providerStatusUrl=queueUrls.statusUrl;providerResponseUrl=queueUrls.responseUrl;providerCancelUrl=queueUrls.cancelUrl;await options.onReceipt?.({providerJobId,provider:"fal",model,providerStatusUrl,providerResponseUrl,providerCancelUrl});
    }else{
      await options.onPrepared?.({provider:"fal",model,submittedPrompt,parameters:providerParameters,referenceInputs:referenceReceipts,usedReferencePixels:retained?.usedReferencePixels??references.length>0,adaptation:retained?.adaptation??adaptation});
    }
    const resumeUrls=falVideoQueueUrls(model,providerJobId,{status_url:providerStatusUrl,response_url:providerResponseUrl,cancel_url:providerCancelUrl});providerStatusUrl=resumeUrls.statusUrl;providerResponseUrl=resumeUrls.responseUrl;providerCancelUrl=resumeUrls.cancelUrl;if(options.providerJobId)await options.onReceipt?.({providerJobId,provider:"fal",model,providerStatusUrl,providerResponseUrl,providerCancelUrl});
    const deadline=Date.now()+15*60_000;let state:FalQueueResponse={request_id:providerJobId,status:"IN_QUEUE"};
    while(state.status!=="COMPLETED"){
      if(options.signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");if(Date.now()>deadline)throw new ProviderRequestError({code:"video_generation_timeout",category:"server",scope:"provider",action:"retry",message:"Fal did not finish within fifteen minutes. The durable request receipt can be retried without starting a duplicate render.",retryable:true,retryAfterMs:30_000,requestId:providerJobId,httpStatus:null});
      const checked=await readFalQueueResponse<FalQueueResponse & Record<string,unknown>>(`${providerStatusUrl}${providerStatusUrl.includes("?")?"&":"?"}logs=1`,{method:"GET",headers:falHeaders(env),signal:options.signal},"status",submittedPrompt,providerJobId);state=checked.body;if(state.status==="FAILED"||state.status==="CANCELLED"){if(state.error?.message){const synthetic=new Response(null,{status:422});throw falErrorFromResponse(synthetic,{error:state.error},`fal_video_${state.status.toLowerCase()}`,submittedPrompt,providerJobId);}throw new ProviderRequestError({code:`fal_video_${state.status.toLowerCase()}`,category:"provider",scope:"request",action:"edit_request",message:`Fal marked video request ${providerJobId.slice(0,8)} as ${state.status.toLowerCase()}. This terminal provider request cannot be resumed; review the retained input before starting a changed render.`,retryable:false,retryAfterMs:null,requestId:providerJobId,httpStatus:422},submittedPrompt);}if(!state.status||!["IN_QUEUE","IN_PROGRESS","COMPLETED"].includes(state.status))throw new ProviderRequestError({code:"fal_status_receipt_invalid",category:"server",scope:"provider",action:"retry",message:"Fal returned a status receipt without a recognized queue state. The durable provider request ID was preserved for retry.",retryable:true,retryAfterMs:1_000,requestId:providerJobId,httpStatus:checked.response.status},submittedPrompt);if(state.response_url||state.status_url||state.cancel_url){const queueUrls=falVideoQueueUrls(model,providerJobId,{response_url:state.response_url??providerResponseUrl,status_url:state.status_url??providerStatusUrl,cancel_url:state.cancel_url??providerCancelUrl});providerStatusUrl=queueUrls.statusUrl;providerResponseUrl=queueUrls.responseUrl;providerCancelUrl=queueUrls.cancelUrl;}if(state.status!=="COMPLETED"){await options.onStage?.(state.status==="IN_QUEUE"?"queued":"rendering",falVideoStatusMessage(state,generateAudio));await wait(5_000,options.signal);}
    }
    await options.onStage?.("finalizing","Provider processing finished. Validating the final result receipt before reporting a usable video.");let resultRead:{response:Response;body:FalVideoResponse & Record<string,unknown>;malformed:boolean};try{resultRead=await readFalQueueResponse<FalVideoResponse & Record<string,unknown>>(providerResponseUrl,{method:"GET",headers:falHeaders(env),signal:options.signal},"result",submittedPrompt,providerJobId);}catch(error){if(error instanceof ProviderRequestError&&error.detail.category==="safety"){const audio=error.detail.riskCategories?.includes("audio-copyright")||/\baudio\b.*\bcopyright\b/i.test(error.detail.message);throw new ProviderRequestError({...error.detail,requestId:error.detail.requestId??providerJobId,probe:audio?"fal-seedance-audio-partner-validation":"fal-seedance-result-partner-validation"},error.preparedPrompt??submittedPrompt);}throw error;}const result=resultRead.body;const video=result.video??result.data?.video;const mediaUrl=trustedFalMediaUrl(String(video?.url??""),submittedPrompt,providerJobId,resultRead.response.status);await options.onStage?.("downloading","The provider accepted the final result. Saving the playable video.");const content=await openAIRequest(mediaUrl,{method:"GET",signal:options.signal});if(!content.ok)throw falErrorFromResponse(content,{},`fal_media_${content.status}`,submittedPrompt,providerJobId);const bytes=new Uint8Array(await content.arrayBuffer());if(!bytes.length)throw new ProviderRequestError({code:"fal_video_empty",category:"server",scope:"provider",action:"retry",message:"Fal completed the request but returned an empty video file.",retryable:true,retryAfterMs:1_000,requestId:providerJobId,httpStatus:content.status},submittedPrompt);const mimeType=String(video?.content_type??content.headers.get("content-type")??"video/mp4");if(!mimeType.startsWith("video/"))throw new ProviderRequestError({code:"fal_video_type_invalid",category:"server",scope:"provider",action:"retry",message:`Fal completed the request but returned ${mimeType||"an unknown media type"} instead of video.`,retryable:true,retryAfterMs:1_000,requestId:providerJobId,httpStatus:content.status},submittedPrompt);
    const costPerSecond=isSeedanceReferenceVideo(model)?seedanceReferenceCostPerSecond(model,resolution):((retained?.usedReferencePixels??providerReferences.length>0)?130_000:125_000);
    submission={...submission,status:"completed",providerRequestId:providerJobId,costMicrousd:effectiveDuration*costPerSecond};await options.onProviderSubmission?.(submission);
    return{providerJobId,provider:"fal",model,providerStatusUrl,providerResponseUrl,providerCancelUrl,bytes,mimeType,seconds:effectiveDuration,size:options.size,latencyMs:Date.now()-started,costMicrousd:effectiveDuration*costPerSecond,submittedPrompt,providerParameters,referenceInputs:referenceReceipts,usedReferencePixels:retained?.usedReferencePixels??providerReferences.length>0,adaptation:retained?.adaptation??adaptation};
  }catch(error){
    if(submissionAttempted&&!providerJobId&&error instanceof ProviderRequestError&&definitiveProviderRejection(Number(error.detail.httpStatus)))await options.onProviderSubmission?.({...submission,status:"rejected",costMicrousd:0});
    if(options.signal?.aborted&&providerJobId)await cancelFalVideo(env,model,providerJobId,providerCancelUrl);
    if(error instanceof ProviderRequestError&&error.detail.category==="safety"&&references.length&&!error.detail.riskCategories?.includes("audio-copyright")&&!/\baudio\b.*\bcopyright\b/i.test(error.detail.message))throw new ProviderRequestError({...error.detail,contributingBlockIds:[...new Set(references.map((reference)=>reference.blockId).filter(Boolean))],contributingReferenceIds:[...new Set(references.map((reference)=>reference.referenceId).filter(Boolean))],probe:error.detail.probe??"fal-seedance-reference-partner-validation"},error.preparedPrompt??submittedPrompt);
    throw error;
  }
}
