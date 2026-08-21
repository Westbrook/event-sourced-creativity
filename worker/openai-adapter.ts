import type { WorkerEnv } from "./runtime.ts";
import { ApiError, createFalClient } from "@fal-ai/client";
import { BLOCK_TYPES, type AdaptiveStructure, type BlockKind, type ReferencePixelMode } from "../src/model/block-types.ts";
import type { LiveReplayPlan } from "../src/model/live-replay.ts";
import { buildBoundedPromptRepresentation, buildReferencePromptDirectives, buildSpatialPromptDirectives, normalizePromptTechnique, type PromptReferenceDescriptor, type PromptTechnique } from "../src/model/prompt-structures.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse, type ProviderFailureDetail } from "./provider-errors.ts";
import { normalizeImageFormat, validateProviderImageSize } from "../src/model/image-format.ts";
import { buildReplayDevelopmentStages, type CreativeStudyKind, type ReplayDevelopmentStage } from "../src/model/replay-development.ts";
import { moderateExactImagePrompt } from "./openai-moderation.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent, resolveDocumentArtifactContextGroups, SLIDE_LAYOUTS, SLIDE_STYLE_PRESET_IDS, SLIDE_VISUAL_KINDS, type DocumentArtifactContextGroupContract, type DocumentArtifactDraft, type DocumentArtifactKind, type DocumentArtifactValidationIssue } from "../src/model/document-artifacts.ts";
import { combinedContextGroups, combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { REPLAY_EXPERIENCE_PROFILES, replayExperienceDefinition, type ReplayExperienceId } from "../src/model/replay-experiences.ts";
import { DEFAULT_REFERENCE_VIDEO_MODEL, DEFAULT_VIDEO_MODEL, isVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, type VideoDurationSeconds } from "../src/model/video-adapter.ts";

type OpenAIError = { message?: string; type?: string; code?: string | null; param?: string | null };
type OpenAIResponse = { id?: string; model?: string; output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: OpenAIError };
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
export type DocumentArtifactOptions = { itemCount?:number; audience?:string; tone?:string; videoSeconds?:VideoDurationSeconds; videoSize?:"1280x720"|"720x1280"; signal?:AbortSignal };
export type VideoReference = { bytes:Uint8Array; mimeType:string; blockId:string; referenceId:string; label:string; mode:ReferencePixelMode; sequence:number|null; shotDirection:string; cameraDirection:string; framePrompt:string; sourceArtifactId:string|null; sourceArtifactItemId:string|null; sourceArtifactKind:string|null; storyboardTitle:string; contextGroups?:Array<{id:string;name:string;target:string;role:string;application:string;relativity:number}>; provider?:string|null; providerModel?:string|null; providerRequestId?:string|null; providerMediaUrl?:string|null };
export type CreativeVideoPreparedReceipt = { provider:string; model:string; submittedPrompt:string; parameters:Record<string,unknown>; referenceInputs:Array<Record<string,unknown>>; usedReferencePixels:boolean };
export type CreativeVideoOptions = { seconds:VideoDurationSeconds; size:"1280x720"|"720x1280"; resolution?:"480p"|"720p"; generateAudio?:boolean; endUserId?:string; referencePromptProfile?:"standard"|"positive-only"; providerJobId?:string; providerModel?:string; providerStatusUrl?:string; providerResponseUrl?:string; providerCancelUrl?:string; references?:VideoReference[]; signal?:AbortSignal; onStage?:(stage:string,message:string)=>void|Promise<void>; onPrepared?:(receipt:CreativeVideoPreparedReceipt)=>void|Promise<void>; onReceipt?:(receipt:{providerJobId:string;provider:string;model:string;providerStatusUrl:string;providerResponseUrl:string;providerCancelUrl:string})=>void|Promise<void> };

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
  type:"object",additionalProperties:false,required:["layout","kicker","bullets","visual"],
  properties:{
    layout:{type:"string",enum:SLIDE_LAYOUTS},
    kicker:{type:"string",minLength:1,maxLength:80},
    bullets:{type:"array",maxItems:5,items:{type:"string",minLength:1,maxLength:160}},
    visual:{
      type:"object",additionalProperties:false,required:["kind","label","value","data"],
      properties:{
        kind:{type:"string",enum:SLIDE_VISUAL_KINDS},
        label:{type:"string",minLength:1,maxLength:100},
        value:{type:"string",minLength:1,maxLength:120},
        data:{
          type:"array",minItems:1,maxItems:5,
          items:{
            type:"object",additionalProperties:false,required:["label","value","weight"],
            properties:{label:{type:"string",minLength:1,maxLength:80},value:{type:"string",minLength:1,maxLength:100},weight:{type:"number",minimum:0,maximum:1}},
          },
        },
      },
    },
  },
};
const documentArtifactSchema=(kind:DocumentArtifactKind)=>{
  const itemProperties:Record<string,unknown>={title:{type:"string"},body:{type:"string"},notes:{type:"string"},image_prompt:{type:"string"},context_group_ids:{type:"array",maxItems:24,items:{type:"string"}}};
  const itemRequired=["title","body","notes","image_prompt","context_group_ids"];
  if(kind==="slides"){itemProperties.slide=slideVisualSchema;itemRequired.push("slide");}
  const properties:Record<string,unknown>={title:{type:"string"},summary:{type:"string"},content_markdown:{type:"string"},items:{type:"array",minItems:1,maxItems:12,items:{type:"object",additionalProperties:false,required:itemRequired,properties:itemProperties}}};
  const required=["title","summary","content_markdown","items"];
  if(kind==="slides"){properties.presentation=slidePresentationSchema;required.push("presentation");}
  return{type:"object",additionalProperties:false,required,properties};
};

const replayDirectionSchema={type:"object",additionalProperties:false,required:["title","rationale","scene","palette","next_moves"],properties:{title:{type:"string"},rationale:{type:"string"},scene:{type:"string"},palette:{type:"array",minItems:3,maxItems:6,items:{type:"string"}},next_moves:{type:"array",minItems:2,maxItems:4,items:{type:"string"}}}};
const replayOutputBriefSchema={type:"object",additionalProperties:false,required:["title","purpose","audience","content_direction","success_signal","beats"],properties:{title:{type:"string",minLength:1,maxLength:120},purpose:{type:"string",minLength:1,maxLength:500},audience:{type:"string",minLength:1,maxLength:160},content_direction:{type:"string",minLength:1,maxLength:1200},success_signal:{type:"string",minLength:1,maxLength:500},beats:{type:"array",minItems:3,maxItems:8,items:{type:"string",minLength:1,maxLength:500}}}};
const replayExperienceSchema={type:"object",additionalProperties:false,required:["profile","value_proposition","creative_arc","library","canvas","outputs","slides_style_preset"],properties:{
  profile:{type:"string",enum:REPLAY_EXPERIENCE_PROFILES.map((profile)=>profile.id)},value_proposition:{type:"string",minLength:1,maxLength:800},creative_arc:{type:"array",minItems:5,maxItems:9,items:{type:"string",minLength:1,maxLength:320}},
  library:{type:"object",additionalProperties:false,required:["goal","reusable_context","search_intent","reuse_decision"],properties:{goal:{type:"string"},reusable_context:{type:"array",minItems:4,maxItems:8,items:{type:"string"}},search_intent:{type:"string"},reuse_decision:{type:"string"}}},
  canvas:{type:"object",additionalProperties:false,required:["goal","synthesis","arrangement","suggested_next_move"],properties:{goal:{type:"string"},synthesis:{type:"string"},arrangement:{type:"string"},suggested_next_move:{type:"string"}}},
  outputs:{type:"object",additionalProperties:false,required:["image","short_story","scene","slides","storyboard","video"],properties:{image:replayOutputBriefSchema,short_story:replayOutputBriefSchema,scene:replayOutputBriefSchema,slides:replayOutputBriefSchema,storyboard:replayOutputBriefSchema,video:replayOutputBriefSchema}},
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
    if (!shouldAutomaticallyRetryProviderFailure(detail) || attempt === OPENAI_REQUEST_MAX_ATTEMPTS) return response;
    await wait(providerRetryDelay(detail, attempt), init.signal ?? undefined);
  }
  throw new Error("openai_request_failed");
}

const responseText=(body:OpenAIResponse)=>body.output_text||body.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==="output_text")?.text||"";

export async function generateLiveReplayPlan(env:WorkerEnv,userId:string,seed:string,planningContext?:LiveReplayPlanningContext){
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");const started=Date.now();
  const stage=planningContext?.stage??buildReplayDevelopmentStages([],1)[0];const lockedStudies=planningContext?.lockedStudies??[];
  const experience=replayExperienceDefinition(planningContext?.experienceProfile);
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"Create a realistic, coherent, fully populated creative-workflow mock for an event-sourced creative system. This is synthetic evaluation data, not a description of implementation. Make every field specific, natural, and user-readable. The requested experience profile is a narrative contract: demonstrate its value through believable choices and consequences, not a feature checklist. Give the Library reusable, searchable context with meaningful relationships. Give the project Canvas a distinct synthesis goal, spatial organization rationale, assistant suggestion, selected composite context, and document handoff. Make every output brief purpose-built: the image, short story, screen scene, visual presentation, storyboard, and video treatment must serve distinct audiences or decisions while sharing one durable creative world. Give each output three to eight concrete, ordered beats written for that form: narrative turns for story, playable action for scene, presentation arguments for slides, shots for storyboard, and motion or audio progression for video. Do not reuse the same beats across forms. Creative arc beats must be concrete enough to structure re-entry and the user-like replay without replacing the output-specific beats. You are planning exactly the supplied development stage. For a study, isolate that subject and define concrete decisions that can be accepted and locked before composition; do not prematurely turn it into the final composed campaign image. For a composition, explicitly preserve and combine every supplied locked study rather than redesigning those accepted parts. Echo the supplied stage kind exactly in development.stage_kind, explain its focus and success criteria, and populate locked_decisions with concise, visually testable decisions. Choose one deliberate target image aspect ratio and pixel size in image_format; make the Format block explain that production choice and ensure its instruction agrees with the structured values. The reference must be a real image before the simulated upload occurs. Choose source_strategy licensed-web when an existing, freely reusable documentary or factual image would strengthen the workflow; otherwise choose generated. Always provide both a concise Wikimedia Commons search query and a self-contained low-quality fallback generation prompt, and explain the choice. Supply exactly one block for every provided block type, with no duplicates; choose a useful supported subtype. Across the blocks use every spatial_method at least once. Include positive direction, role-specific avoid/prohibit constraints, and several local targets that genuinely matter. Write three to five conversational turns that show the stage becoming more precise; Live preview must be true on at least one turn and false on at least one turn so decisions can be batched. The assistant should acknowledge uncertainty and resolve only the requested change. The draft should be fast and exploratory. The final direction should refine that draft. Compare prose, bullets, JSON, and XML handoffs with a distinct, specific reason for each; choose a preferred technique and outputs worth promoting. Include a plausible moment where the user gets stuck in one document view and a concrete recovery. Use valid CSS hex colors. Avoid repeated output copy, generic tour language, placeholders, and mentions of events, schemas, APIs, tests, or internal metadata.",
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

export async function generateCreativeDirection(env: WorkerEnv, userId: string, snapshot: Record<string, unknown>, signal?: AbortSignal) {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const started = Date.now();
  const instructions = "You are Forma's creative-direction adapter. Interpret every field of the supplied authored and cited context. Return a concrete visual direction, not hidden reasoning. Treat inferred material as suggestive and never claim it was authored. Each fact has an independent semantic role and intent. Ignore facts whose active field is false; they remain present only for provenance. Every active fact whose intent is avoid or prohibit, whose effect is must_not_include, or whose legacy type is exclusion is a negative constraint: apply the prohibition to its named role, and never let the named content become a positive focus in the title, scene, rationale, palette, or next moves. Prohibit is a hard boundary; avoid is a strong negative preference. Weight expresses the constraint's influence, not creative prominence. Prefer facts are positive preferences, while include facts are ordinary positive instructions. A fact's properties.spatial_scope limits where that fact applies. Preserve its named region, rectangle, subject relationship, or custom path in the scene and rationale; do not silently promote a local decision into a whole-image instruction. Combined-context memberships are binding semantic isolation boundaries: their members jointly define only the named character, location, object, sequence, scene, message, slide chapter, or visual system. Respect group relativity and never spread a member's wardrobe, palette, material, behavior, or reference identity to an unrelated target.";
  const plannerInput = JSON.stringify(snapshot);
  const response = await openAIRequest("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    signal,
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? "gpt-5.6-terra",
      instructions,
      input: plannerInput,
      text: { verbosity: "low", format: { type: "json_schema", name: "forma_creative_direction", strict: true, schema: outputSchema } },
      reasoning: { effort: "low" }, max_output_tokens: 1200, store: false,
      safety_identifier: await safetyIdentifier(userId),
    }),
  });
  const body = await response.json() as OpenAIResponse;
  if (!response.ok) throw providerErrorFromResponse(response, body, `openai_${response.status}`, `Creative-direction planner instructions:\n${instructions}\n\nPlanner input:\n${plannerInput}`);
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
    try{response=await openAIRequest("https://api.openai.com/v1/images/edits",{method:"POST",headers:openAIAuthHeaders(env),body:form,signal:options.signal});}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  }else{
    try{response=await openAIRequest("https://api.openai.com/v1/images/generations",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({model,prompt,n:1,size,quality,output_format:outputFormat,...(outputFormat!=="png"?{output_compression:outputCompression}:{}),...(partialImages?{stream:true,partial_images:partialImages}:{}),user}),signal:options.signal});}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  }
  if(!response.ok){let error:OpenAIImageResponse={};try{error=await response.json() as OpenAIImageResponse;}catch{/* Preserve the provider status when no JSON error body is available. */}throw providerErrorFromResponse(response,error,`openai_image_${response.status}`,prompt);}
  const [requestedWidth,requestedHeight]=size.split("x").map(Number);let encoded="";let revisedPrompt:string|null=null;let createdAt:number|null=null;let usage:OpenAIImageUsage={};let completedSize:string=size;let completedFormat=outputFormat;let partialCount=0;
  if(partialImages){
    try{await readImageStream(response,async(event)=>{if(event.error?.message)throw new ProviderRequestError(classifyProviderFailure(new Error(event.error.message)),prompt);if(event.type?.endsWith(".partial_image")&&event.b64_json){partialCount+=1;const eventSize=event.size??size;const [width,height]=eventSize.split("x").map(Number);await options.onPartial?.({bytes:decodeBase64Image(event.b64_json),index:Number(event.partial_image_index??partialCount-1),mimeType:imageMimeType(event.output_format??outputFormat),width,height});}if(event.type?.endsWith(".completed")&&event.b64_json){encoded=event.b64_json;createdAt=event.created_at??null;usage=event.usage??{};completedSize=event.size??size;completedFormat=event.output_format??outputFormat;}});}catch(error){if(error instanceof ProviderRequestError)throw error;throw new ProviderRequestError(classifyProviderFailure(error),prompt);}
  }else{
    const body=await response.json() as OpenAIImageResponse;encoded=body.data?.[0]?.b64_json??"";revisedPrompt=body.data?.[0]?.revised_prompt??null;createdAt=body.created??null;usage=body.usage??{};
  }
  if(!encoded)throw new Error("provider_returned_no_image");const bytes=decodeBase64Image(encoded);const [width,height]=completedSize.split("x").map(Number);
  return{model,prompt,promptTechnique,bytes,revisedPrompt,createdAt,latencyMs:Date.now()-started,usage:{inputTokens:Number(usage.input_tokens??0),outputTokens:Number(usage.output_tokens??0),totalTokens:Number(usage.total_tokens??0),textInputTokens:Number(usage.input_tokens_details?.text_tokens??0),imageInputTokens:Number(usage.input_tokens_details?.image_tokens??0)},width:Number.isFinite(width)?width:requestedWidth,height:Number.isFinite(height)?height:requestedHeight,mimeType:imageMimeType(completedFormat),quality,usedReference:references.length>0,referenceCount:references.length,referenceInputs:references.map((reference)=>({source:reference.source,blockId:reference.blockId??null,referenceId:reference.referenceId??null,label:reference.label??null,mode:reference.mode??null})),safetyProbeCount:moderation.probeCount,safetyCoverage:moderation.coverage,safetyRequestIds:moderation.requestIds,partialCount,outputFormat:completedFormat,outputCompression:completedFormat==="png"?null:outputCompression};
}

export async function respondToCreativeChat(env:WorkerEnv,userId:string,input:{documentTitle:string;blocks:Array<Record<string,unknown>>;history:Array<{role:"user"|"assistant";text:string}>;message:string}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"You are Forma, a concise creative collaborator inside a chat-only document view. Speak about the user's creative plan and intended image, never about blocks, events, schemas, metadata, adapters, or hidden machinery. Interpret the newest message against the existing plan and recent conversation. Return a helpful reply plus the smallest accurate set of plan mutations. Create adds a new durable decision; edit changes one existing decision and must name its target_block_id; remove deletes one existing decision and must name its target_block_id. Never target a missing item. For create, target_block_id is null. Never create a reference item through chat because an actual uploaded image is required. The reference_pixel_mode field is unchanged for ordinary mutations. When the user says to use a named existing reference image, edit the matching reference and choose inspiration unless they explicitly ask to preserve its composition, subject, or visual style. Choose context_only when they say not to send or use its pixels. Never change reference_pixel_mode on a non-reference item. When the user asks for an image size, resolution, dimensions, orientation, or aspect ratio, create or edit a format item and provide image_format with coherent pixel dimensions and their reduced aspect ratio; otherwise image_format is null. For unused mutation fields return sensible empty strings, but type must always be a valid vocabulary value. If the creative image meaningfully changes, preview_worthy is true and preview_direction is a standalone visual instruction incorporating the whole current intention after your proposed changes. If the user is only asking a question or chatting without changing visual intent, do not mutate and set preview_worthy false.",
    input:JSON.stringify({...input,block_vocabulary:BLOCK_TYPES.map((item)=>({type:item.type,subtypes:item.subtypes})),mutation_rules:{create:"target_block_id must be null",edit:"target_block_id must match an existing id",remove:"target_block_id must match an existing id"}}),
    text:{verbosity:"low",format:{type:"json_schema",name:"forma_creative_chat",strict:true,schema:creativeChatSchema}},reasoning:{effort:"low"},max_output_tokens:1600,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`);
  const text=responseText(body);if(!text)throw new Error("provider_returned_no_output");
  let parsed:CreativeChatResponse;try{parsed=JSON.parse(text) as CreativeChatResponse;}catch{throw new Error("provider_returned_invalid_json");}
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output:parsed,raw:text,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

export async function structureAdaptiveContext(env:WorkerEnv,userId:string,input:{intent:string;documentTitle:string;blocks:Array<Record<string,unknown>>}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"You structure an adaptive creative-context interface. Interpret the user's broad intent together with the currently authored blocks. Propose the next useful decision and 2–6 concise context blocks across intent, scene, craft, evidence, or constraints. Use only the supplied block type vocabulary. Subtypes should match the system suggestions when practical. Explain product-facing reasons, never hidden chain-of-thought. Do not claim proposals were authored and do not mutate anything.",
    input:JSON.stringify({...input,block_vocabulary:BLOCK_TYPES.map((item)=>({type:item.type,description:item.description,subtypes:item.subtypes}))}),
    text:{verbosity:"low",format:{type:"json_schema",name:"forma_adaptive_structure",strict:true,schema:adaptiveStructureSchema}},reasoning:{effort:"low"},max_output_tokens:1400,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`);
  const text=responseText(body);if(!text)throw new Error("provider_returned_no_output");
  let parsed:AdaptiveStructure;try{parsed=JSON.parse(text) as AdaptiveStructure;}catch{throw new Error("provider_returned_invalid_json");}
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output:parsed,raw:text,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

const artifactInstructions:Record<DocumentArtifactKind,string>={
  short_story:"Write a polished short story, not a treatment. Preserve the document's named subjects, setting, tone, constraints, and spatial relationships. content_markdown is the complete story. Items are titled narrative movements with their prose in body; notes briefly explain continuity, and image_prompt describes an optional illustration.",
  scene:"Write one production-readable scene for film or television. content_markdown must use clear screenplay conventions: scene heading, action, character names, dialogue, and parentheticals only when useful. Items are playable beats in order; body contains the beat's action/dialogue and image_prompt describes its strongest frame.",
  slides:"Create an informative visual presentation, not an essay split at arbitrary points and not a request for raster slide images. presentation defines one accessible 16:9 CSS theme for the deck. Choose the style_preset that best represents the document: gallery for quiet, warm, image-led work; editorial for assertive narrative hierarchy; nocturne for cinematic or atmospheric work; field-notes for research, evidence, and plans. Make mode and palette coherent with that choice while deriving the specific colors from the document. presentation.theme is internal styling metadata; presentation.footer_label is optional-on-screen deck copy and must be a concise name derived from this document, its subject, or the deck title. Never put process language, model names, provider names, system status, or phrases such as Document-derived editorial in footer_label. Each item is one slide: title and body are concise on-slide copy, notes are speaker notes, and slide is reusable visual data. Choose a purposeful layout and semantic visual primitive for every slide. Use visual.data labels, values, and normalized weights to express the actual idea rather than decoration. Editorially review every slide before returning it: every visible field must add new information. Do not repeat or closely restate the same sentence, quotation, claim, or phrase across its title, body, kicker, bullets, visual label, visual value, or data points. Treat punctuation, quotation marks, line breaks, capitalization, contractions, and minor word-order changes as irrelevant when checking for repetition. Never split one quotation between body copy and a bullet, and never use a bullet as a shortened echo of the body. Then review every slide against every other slide: each slide must advance the deck with a distinct title and distinct visible claims. Do not reuse body copy, bullets, quotations, conclusions, hero statements, metric explanations, or visual values on later slides. Repeated structural axes or short section labels are acceptable only when they make a direct comparison easier to read. Never emit empty bullets or scaffolding such as Point 2, Item 3, TBD, placeholder, or lorem ipsum. Every visual group must be complete and specific: bars and timelines need at least two meaningful label/value pairs; diagrams and color fields need at least two meaningfully named points. If the content supports only one fact, use hero-type or metric instead of pretending it is a multi-point group. Vary layouts with a coherent opening, progression, and closing; keep all copy short enough to fit a 16:9 slide. image_prompt is a brief visual rationale only—the client renders the slide from structured data. content_markdown is a readable slide-by-slide textual version of the same deck.",
  storyboard:"Create a coherent previz storyboard that can be rendered frame by frame. Each item is one camera shot: title names the shot, body describes action and composition, notes specify camera/lens/movement/continuity, and image_prompt is a self-contained frame prompt that preserves recurring subjects and visual continuity. content_markdown is the ordered shot list.",
  video:"Create a concise, production-ready video prompt. content_markdown is the exact motion prompt: subject, action, environment, camera, timing, composition, visual style, and audio intent. Use one item to summarize the shot, with technical direction in notes and the same self-contained prompt in image_prompt.",
};

const INTERNAL_CONTEXT_GROUP_KEYS=new Set(["combined_context","combined_context_memberships","context_group_ids","contextGroupIds","context_groups","context_set_id","contextSetId"]);
const providerFacingCreativeContext=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(providerFacingCreativeContext);
  if(!value||typeof value!=="object")return value;
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!INTERNAL_CONTEXT_GROUP_KEYS.has(key)).map(([key,item])=>[key,providerFacingCreativeContext(item)]));
};

export async function generateDocumentArtifact(env:WorkerEnv,userId:string,kind:DocumentArtifactKind,input:{documentTitle:string;snapshot:Record<string,unknown>;options?:DocumentArtifactOptions}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");const started=Date.now();const itemCount=Math.max(1,Math.min(12,Math.floor(Number(input.options?.itemCount??(kind==="slides"?7:kind==="storyboard"?6:kind==="short_story"?3:1)))));
  const groups=combinedContextGroups(input.snapshot);const groupDirectives=combinedContextPromptDirectives(input.snapshot,kind);const groupContracts:DocumentArtifactContextGroupContract[]=groups.map((group,index)=>({id:group.id,alias:`context_group_${index+1}`}));
  const providerGroups=groups.map((group,index)=>({context_key:groupContracts[index]!.alias,name:group.name,role:group.role,target:group.target,application:group.application,relativity:group.relativity,members:group.members.map(({label,role,relativity,order})=>({label,role,relativity,order})),instruction:groupDirectives[index]}));
  const videoContract=kind==="video"?` The requested output is exactly ${input.options?.videoSeconds??4} seconds in ${input.options?.videoSize==="720x1280"?"9:16 portrait":"16:9 landscape"}. The motion prompt must fit that duration; do not claim or imply a different runtime. Preserve ordered storyboard shots as chronology, compressing their beats into the available runtime without dropping named continuity.`:"";
  const instructions=`You transform a durable creative document into a ${kind.replaceAll("_"," ")} for an end user. ${artifactInstructions[kind]}${videoContract} Treat include and prefer blocks as positive direction; treat avoid and prohibit blocks as negative constraints, never as subjects to feature. Respect every block's spatial scope and authority. Combined contexts are binding authorial units, not tags: keep their members isolated to the named target, co-located or ordered as requested, and weighted by group relativity. For stories and scenes, place a group's members at the same narrative moments or aspects. For slides, assign each group to one slide or contiguous chapter rather than applying it deck-wide. For storyboards and video, bind each group to the same subject, location, or shot range. Every item must return context_group_ids containing only the supplied context_key aliases that shaped that item; use an empty array when no group applies, never invent a key, cover every supplied key at least once, and keep repeated slide assignments contiguous. Context keys are request-local references, not end-user content. Do not mention blocks, events, schemas, context keys, or internal implementation in end-user copy. Return exactly ${itemCount} ordered item${itemCount===1?"":"s"}.`;
  const providerInput=JSON.stringify({document_title:input.documentTitle,creative_context:providerFacingCreativeContext(input.snapshot),combined_context_plan:providerGroups,audience:input.options?.audience??"general",tone:input.options?.tone??"derived from the document",...(kind==="video"?{video:{duration_seconds:input.options?.videoSeconds??4,frame:input.options?.videoSize??"1280x720",aspect_ratio:input.options?.videoSize==="720x1280"?"9:16":"16:9"}}:{})});
  const model=env.OPENAI_MODEL??"gpt-5.6-terra",identifier=await safetyIdentifier(userId),maxOutputTokens=kind==="short_story"?6000:kind==="slides"?6500:kind==="storyboard"?4000:3000;
  const run=async(requestInstructions:string,requestInput:string,name:string)=>{const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),signal:input.options?.signal,body:JSON.stringify({model,instructions:requestInstructions,input:requestInput,text:{verbosity:"medium",format:{type:"json_schema",name,strict:true,schema:documentArtifactSchema(kind)}},reasoning:{effort:"low"},max_output_tokens:maxOutputTokens,store:false,safety_identifier:identifier})});const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`,`Document ${kind} instructions:\n${requestInstructions}\n\nCreative context:\n${requestInput}`);return{body,raw:responseText(body)};};
  const groupIds=groups.map((group)=>group.id);const first=await run(instructions,providerInput,`document_${kind}`);let body=first.body,raw=first.raw??"",parsed=parseDocumentArtifactContent(raw) as DocumentArtifactDraft|null;let resolved=resolveDocumentArtifactContextGroups(parsed,groupContracts),output=resolved.output;const initialResolution=resolved.receipt;const initialIssues=documentArtifactValidationIssues(kind,output,{itemCount,contextGroupIds:groupIds});let repairIssues:DocumentArtifactValidationIssue[]=[],repairAttempted=false,repairResolution=null as typeof initialResolution|null;let repairBody:OpenAIResponse|null=null;
  if(initialIssues.length&&kind==="slides"){
    repairAttempted=true;const repairInstructions=`Repair a structured slide artifact without changing its creative intent. Return the complete ${itemCount}-slide artifact, not a patch. Correct every listed validation issue, preserve all supplied request-local context_key aliases and their contiguous assignments, retain distinct useful content, and do not add process language. A slide may intentionally omit body copy when its bullets or visual carry the claim. Never repeat a title, sentence, quotation, bullet, metric, or visual value within a slide or across the deck.`;
    const providerIssues=initialIssues.map((issue)=>({...issue,message:groupContracts.reduce((message,contract)=>message.replaceAll(contract.id,contract.alias),issue.message)}));
    const repairInput=JSON.stringify({document_title:input.documentTitle,original_artifact:raw||null,validation_issues:providerIssues,required_context_groups:providerGroups,original_creative_context:providerFacingCreativeContext(input.snapshot)});const repaired=await run(repairInstructions,repairInput,"document_slides_repair");repairBody=repaired.body;body=repaired.body;raw=repaired.raw??"";parsed=parseDocumentArtifactContent(raw) as DocumentArtifactDraft|null;resolved=resolveDocumentArtifactContextGroups(parsed,groupContracts);output=resolved.output;repairResolution=resolved.receipt;repairIssues=documentArtifactValidationIssues(kind,output,{itemCount,contextGroupIds:groupIds});
  }
  const finalIssues=repairAttempted?repairIssues:initialIssues;if(finalIssues.length||!output){const diagnostic=finalIssues.map((issue)=>`${issue.code} at ${issue.path}: ${issue.message}`).join(" | ");throw new ProviderRequestError({code:"provider_returned_incomplete_document_artifact",category:"provider",scope:"request",action:"retry",message:`The provider returned ${kind==="slides"?"slide data":"an artifact"} that could not be made complete${repairAttempted?" after one bounded repair pass":""}. ${diagnostic}`,retryable:true,retryAfterMs:null,requestId:null,httpStatus:502},`Document ${kind} instructions:\n${instructions}\n\nCreative context:\n${providerInput}\n\nValidation:\n${diagnostic}`);}
  const usageBodies=[first.body,...(repairBody?[repairBody]:[])];const usage={inputTokens:usageBodies.reduce((sum,item)=>sum+Number(item.usage?.input_tokens??0),0),outputTokens:usageBodies.reduce((sum,item)=>sum+Number(item.usage?.output_tokens??0),0),totalTokens:usageBodies.reduce((sum,item)=>sum+Number(item.usage?.total_tokens??0),0)};
  return{responseId:body.id??"",model:body.model??model,output,raw,inputReceipt:{instructions,providerInput:JSON.parse(providerInput) as Record<string,unknown>,validation:{context_group_resolution:{initial:initialResolution,repair:repairResolution},initial_issues:initialIssues,repair_attempted:repairAttempted,repair_issues:repairIssues,repair_response_id:repairBody?.id??null}},latencyMs:Date.now()-started,usage};
}

const falHeaders=(env:WorkerEnv)=>({authorization:`Key ${env.FAL_KEY}`,"content-type":"application/json"});
const falVideoEndpoint=(model:string)=>`https://queue.fal.run/${model}`;
const falQueueApplication=(model:string)=>{
  const parts=model.split("/").map((part)=>part.trim()).filter(Boolean);const length=parts[0]==="workflows"||parts[0]==="comfy"?3:2;
  if(parts.length<length)throw new Error("fal_video_model_invalid");return parts.slice(0,length).join("/");
};
const trustedFalQueueUrl=(value:string,fallback:string)=>{
  const candidate=value.trim()||fallback;let url:URL;try{url=new URL(candidate);}catch{throw new Error("fal_queue_url_invalid");}
  if(url.protocol!=="https:"||url.hostname!=="queue.fal.run")throw new Error("fal_queue_url_untrusted");return url.toString();
};
const falVideoQueueUrls=(model:string,providerJobId:string,receipt:Partial<FalQueueResponse>={})=>{
  const base=`https://queue.fal.run/${falQueueApplication(model)}/requests/${encodeURIComponent(providerJobId)}`;
  return{statusUrl:trustedFalQueueUrl(String(receipt.status_url??""),`${base}/status`),responseUrl:trustedFalQueueUrl(String(receipt.response_url??""),base),cancelUrl:trustedFalQueueUrl(String(receipt.cancel_url??""),`${base}/cancel`)};
};
const falErrorFromResponse=(response:Response,body:unknown,fallback:string,prompt:string)=>{
  const error=providerErrorFromResponse(response,body,fallback,prompt);return new ProviderRequestError({...error.detail,code:error.detail.code.startsWith("fal_")?error.detail.code:`fal_${error.detail.code}`},prompt);
};
const falVideoStatusMessage=(state:FalQueueResponse)=>{
  const providerMessage=state.logs?.at(-1)?.message?.trim();
  if(providerMessage)return `Video rendering · ${providerMessage}`;
  if(state.status==="IN_QUEUE")return Number.isFinite(state.queue_position)?`Video queued · ${Number(state.queue_position)+1} ahead or active` : "Video accepted and waiting for provider capacity.";
  return "Video rendering with synchronized motion and audio.";
};
const trustedFalMediaUrl=(value:string)=>{
  let url:URL;try{url=new URL(value);}catch{throw new Error("provider_returned_invalid_video_url");}
  if(url.protocol!=="https:"||url.hostname!=="fal.media"&&!url.hostname.endsWith(".fal.media"))throw new Error("provider_returned_untrusted_video_url");
  return url.toString();
};
const isSeedanceReferenceVideo=(model:string)=>model==="bytedance/seedance-2.5/reference-to-video"||model==="bytedance/seedance-2.0/reference-to-video";
const seedanceReferenceImageLimit=(model:string)=>model===VIDEO_ADAPTER_CONTRACT.model?VIDEO_ADAPTER_CONTRACT.maxReferenceImages:30;
const seedanceReferenceCostPerSecond=(model:string,resolution:"480p"|"720p")=>model==="bytedance/seedance-2.0/reference-to-video"?(resolution==="480p"?134_505:302_400):(resolution==="480p"?220_500:473_000);
const videoReferenceToken=(model:string,index:number)=>isSeedanceReferenceVideo(model)?`@Image${index+1}`:`<IMAGE_REF_${index}>`;
const videoReferenceProvenance=(references:VideoReference[],model:string,profile:"standard"|"positive-only")=>{
  if(!references.length)return"";
  if(profile==="positive-only"){
    const generated=references.filter((reference)=>reference.sourceArtifactKind==="storyboard"||Boolean(reference.provider));
    const provenance=generated.length===references.length
      ? "Every attached image is an authorized, generated creative reference for this project. Any intentionally depicted person is an adult fictional character."
      : "Every attached image is an authorized creative reference for this project.";
    return `REFERENCE PROVENANCE\n${provenance} Use each numbered image only for its assigned creative role and preserve the established subject, continuity, and art direction.\nReference syntax for this provider: ${references.map((_,index)=>videoReferenceToken(model,index)).join(", ")}.`;
  }
  const syntheticStoryboard=references.every((reference)=>reference.sourceArtifactKind==="storyboard"&&Boolean(reference.sourceArtifactId));
  const provenance=syntheticStoryboard
    ? "Every attached image is a system-generated storyboard frame for this fictional production. Every depicted person and face is a fictional, synthetic character—not a photograph of, or biometric reference to, a real person or public figure. Do not identify, infer, or introduce a real person."
    : "These images are authorized creative references for this project. Do not identify, infer, or introduce a real person or public figure from a depicted face; use each image only for the explicitly assigned fictional creative role.";
  return `IDENTITY AND REFERENCE PROVENANCE\n${provenance}\nPreserve fictional character continuity without converting any face into a real-world identity. This provenance statement describes the source material; it does not override any provider safety policy.\nReference syntax for this provider: ${references.map((_,index)=>videoReferenceToken(model,index)).join(", ")}.`;
};
const videoReferencePrompt=(references:VideoReference[],model:string,profile:"standard"|"positive-only")=>{
  if(!references.length)return"";
  const lines=references.map((reference,index)=>{
    const shot=reference.sequence?`Storyboard shot ${reference.sequence}`:`Reference image ${index+1}`;
    const direction=[reference.shotDirection,reference.cameraDirection,reference.framePrompt].map((value)=>value.trim()).filter(Boolean).join(" Camera and continuity: ");
    const role=reference.sequence
      ? "controls the fictional character appearance, wardrobe, environment state, composition, and action continuity for this point in the ordered storyboard"
      : "controls only the explicitly described subject, environment, composition, palette, or style";
    const groupBoundary=(reference.contextGroups??[]).map((group)=>`Combined Context “${group.name}” applies this image only to ${group.role.replaceAll("_"," ")} “${group.target}” at ${Math.round(group.relativity*100)}% relativity; ${group.application.replaceAll("_"," ")}.`).join(" ");
    return `${videoReferenceToken(model,index)} — ${shot}${reference.storyboardTitle?` from “${reference.storyboardTitle}”`:""} — ${reference.label}. This reference ${role}${profile==="standard"?"; do not copy incidental text, artifacts, or unintended identities":""}.${groupBoundary?` ${groupBoundary} Do not transfer its attributes to another character, place, prop, or shot.`:""}${direction?` ${direction}`:""}`;
  });
  return `REFERENCE ROLES AND ORDER\nThe provider receives the actual pixels in this exact order. Preserve recognizable fictional subjects, locations, props, palette, and continuity from them. When entries are storyboard frames, treat their order as shot chronology and follow each shot direction. Do not interchange the ${profile==="standard"?"role or identity":"creative role"} assigned to one numbered reference with another.\n${lines.join("\n")}`;
};
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
    if(!response.ok){if(response.status===405)throw new ProviderRequestError({code:"fal_queue_route_method_not_allowed",category:"server",scope:"provider",action:"retry",message:`Fal rejected the ${phase} queue route with HTTP 405. The provider request ID and exact inputs were preserved; retrying can resume the already-paid render through Fal's application-level queue URL.`,retryable:true,retryAfterMs:1_000,requestId,httpStatus:405},prompt);const providerBody=read.malformed||!read.raw.trim()?{error:{message:`Fal returned HTTP ${response.status} without a usable JSON error receipt${falBodyExcerpt(read.raw)?`: ${falBodyExcerpt(read.raw)}`:"."}`}}:read.body;throw falErrorFromResponse(response,providerBody,`fal_${response.status}`,prompt);}
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
  if(!references.length)return{urls:[] as string[],transports:[] as string[]};const client=createFalClient({credentials:env.FAL_KEY});const urls:string[]=[];const transports:string[]=[];
  for(let index=0;index<references.length;index+=1){
    const reference=references[index];const original=await originalFalReferenceUrl(env,reference,options.signal);if(original){urls.push(original);transports.push("original-fal-url");await options.onStage?.("preparing-references",`Reference ${index+1} of ${references.length} reuses its byte-verified original Fal asset.`);continue;}await options.onStage?.("uploading-references",`Uploading reference ${index+1} of ${references.length} through Fal's short-lived media transport.`);
    try{const bytes=new Uint8Array(reference.bytes).buffer as ArrayBuffer;urls.push(await client.storage.upload(new Blob([bytes],{type:reference.mimeType}),{lifecycle:{expiresIn:"1d"}}));transports.push("fal-storage-upload");}
    catch(error){
      if(error instanceof ApiError){const response=new Response(null,{status:error.status||502,headers:error.requestId?{"x-fal-request-id":error.requestId}:{}});throw falErrorFromResponse(response,error.body??{error:{message:error.message}},`fal_reference_upload_${error.status||"failed"}`,prompt);}
      const detail=classifyProviderFailure(error);throw new ProviderRequestError({...detail,code:"fal_reference_upload_failed",message:`Fal could not stage ${reference.label||`reference ${index+1}`} for video generation. ${detail.message}`,requestId:detail.requestId},prompt);
    }
  }
  return{urls,transports};
}

export async function generateCreativeVideo(env:WorkerEnv,prompt:string,options:CreativeVideoOptions) {
  if(!env.FAL_KEY)throw new ProviderRequestError({code:"video_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"Fal video generation is not configured for this environment.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const provider=env.FORMA_VIDEO_PROVIDER??"fal";if(provider!=="fal")throw new ProviderRequestError({code:"video_provider_unsupported",category:"access",scope:"provider",action:"check_credentials",message:`The configured video provider ${provider} is not supported by this build.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  if(!isVideoDurationSeconds(options.seconds))throw new ProviderRequestError({code:"video_duration_unsupported",category:"provider",scope:"request",action:"edit_request",message:`Seedance 2.0 accepts video lengths from 4 through 15 seconds. Choose a supported duration before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const cleanPrompt=prompt.trim();if(!cleanPrompt)throw new ProviderRequestError({code:"video_prompt_required",category:"provider",scope:"request",action:"edit_request",message:"The document did not produce a usable motion prompt.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const references=options.references??[];const model=options.providerModel??(references.length?(env.FAL_REFERENCE_VIDEO_MODEL??DEFAULT_REFERENCE_VIDEO_MODEL):(env.FAL_VIDEO_MODEL??DEFAULT_VIDEO_MODEL));const maxReferenceBytes=isSeedanceReferenceVideo(model)?VIDEO_ADAPTER_CONTRACT.maxReferenceBytes:8*1024*1024;const maxReferenceImages=isSeedanceReferenceVideo(model)?seedanceReferenceImageLimit(model):30;if(references.length>maxReferenceImages)throw new ProviderRequestError({code:"video_reference_count_exceeded",category:"provider",scope:"request",action:"edit_request",message:`${model} accepts at most ${maxReferenceImages} reference images, but this request prepared ${references.length}. Choose a smaller ordered reference set before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});for(const reference of references){if(!reference.bytes.length||!reference.mimeType.startsWith("image/"))throw new ProviderRequestError({code:"video_reference_invalid",category:"provider",scope:"request",action:"edit_request",message:`${reference.label||"A video reference"} is not a usable image. Replace it before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});if(reference.bytes.length>maxReferenceBytes)throw new ProviderRequestError({code:"video_reference_too_large",category:"provider",scope:"request",action:"edit_request",message:`${reference.label||"A video reference"} is larger than the provider's ${Math.round(maxReferenceBytes/1024/1024)} MB reference-image limit. Resize it before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});}
  // Provider partner validation is pixel-side and cannot be predicted from words such as
  // “face” or “character”. Preserve every user-approved pixel reference and let the
  // provider return an inspectable validation receipt if it cannot process a specific asset.
  const providerReferences=references;const referencePromptProfile=options.referencePromptProfile??(model===VIDEO_ADAPTER_CONTRACT.model?VIDEO_ADAPTER_CONTRACT.promptProfile:"standard");const referenceDirective=videoReferencePrompt(providerReferences,model,referencePromptProfile);const provenanceDirective=videoReferenceProvenance(references,model,referencePromptProfile);const runtimeDirective=`OUTPUT CONTRACT\nCreate exactly ${options.seconds} seconds of ${options.size==="720x1280"?"9:16 portrait":"16:9 landscape"} video. Fit every described beat within that runtime; do not follow any conflicting duration written elsewhere in the creative context.`;const submittedPrompt=[runtimeDirective,provenanceDirective,referenceDirective,"MOTION AND STORY DIRECTION\n"+cleanPrompt].filter(Boolean).join("\n\n");
  if(submittedPrompt.length>20_000)throw new ProviderRequestError({code:"video_prompt_too_long",category:"provider",scope:"request",action:"edit_request",message:`The prepared motion prompt is ${submittedPrompt.length.toLocaleString()} characters; the video provider accepts at most 20,000. Shorten unusually long document instructions before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400},submittedPrompt);
  const started=Date.now();let providerJobId=options.providerJobId??"";let providerStatusUrl=options.providerStatusUrl??"",providerResponseUrl=options.providerResponseUrl??"",providerCancelUrl=options.providerCancelUrl??"";let referenceReceipts=await Promise.all(references.map((reference,index)=>videoReferenceReceipt(reference,index,providerJobId?"provider-job-resume":"pending")));const aspectRatio=options.size==="720x1280"?"9:16":"16:9";const resolution=options.resolution??VIDEO_ADAPTER_CONTRACT.defaultResolution;const generateAudio=options.generateAudio??true;const endUserId=options.endUserId?await safetyIdentifier(options.endUserId):"";let providerParameters:Record<string,unknown>={aspect_ratio:aspectRatio,duration:options.seconds};
  try{
    if(!providerJobId){
      const staged=await uploadFalVideoReferences(env,providerReferences,submittedPrompt,options);const imageUrls=staged.urls;referenceReceipts=await Promise.all(references.map((reference,index)=>videoReferenceReceipt(reference,index,staged.transports[index]??"fal-storage-upload")));const uniqueTransports=[...new Set(staged.transports)];const imageTransport=uniqueTransports.length===1?uniqueTransports[0]??"none":uniqueTransports.length?"mixed":"none";
      providerParameters={aspect_ratio:aspectRatio,duration:options.seconds,...(isSeedanceReferenceVideo(model)?{resolution,generate_audio:generateAudio,end_user_id_supplied:Boolean(endUserId),reference_syntax:"@ImageN",reference_prompt_profile:referencePromptProfile,identity_provenance:references.length&&references.every((reference)=>reference.sourceArtifactKind==="storyboard")?"fictional-synthetic-storyboard":references.length?"authorized-creative-reference":"none",reference_requested_count:references.length,provider_pixel_count:providerReferences.length,...(model===VIDEO_ADAPTER_CONTRACT.model?{adapter_id:VIDEO_ADAPTER_CONTRACT.adapterId,adapter_version:VIDEO_ADAPTER_CONTRACT.adapterVersion,adapter_status:VIDEO_ADAPTER_CONTRACT.status}:{})}:{}),...(providerReferences.length?{image_count:providerReferences.length,image_transport:imageTransport,original_provider_asset_count:staged.transports.filter((transport)=>transport==="original-fal-url").length,uploaded_asset_count:staged.transports.filter((transport)=>transport==="fal-storage-upload").length,reference_order:"storyboard-sequence-then-document-position"}:{})};
      await options.onPrepared?.({provider:"fal",model,submittedPrompt,parameters:providerParameters,referenceInputs:referenceReceipts,usedReferencePixels:references.length>0});
      await options.onStage?.("submitting",providerReferences.length?`Submitting the motion prompt and ${providerReferences.length} staged reference image${providerReferences.length===1?"":"s"} to Fal.`:"Submitting the motion prompt to Fal for a synchronized video and audio render.");
      const providerInput=isSeedanceReferenceVideo(model)?{prompt:submittedPrompt,aspect_ratio:aspectRatio,duration:options.seconds,resolution,generate_audio:generateAudio,...(endUserId?{end_user_id:endUserId}:{}),...(providerReferences.length?{image_urls:imageUrls}:{})}:{prompt:submittedPrompt,aspect_ratio:aspectRatio,duration:options.seconds,...(providerReferences.length?{image_urls:imageUrls}:{})};
      const created=await openAIRequest(falVideoEndpoint(model),{method:"POST",headers:falHeaders(env),signal:options.signal,body:JSON.stringify(providerInput)});const read=await readFalJson<FalQueueResponse & Record<string,unknown>>(created);if(!created.ok){const body=read.malformed||!read.raw.trim()?{error:{message:`Fal returned HTTP ${created.status} without a usable JSON submission receipt${falBodyExcerpt(read.raw)?`: ${falBodyExcerpt(read.raw)}`:"."}`}}:read.body;throw falErrorFromResponse(created,body,`fal_${created.status}`,submittedPrompt);}providerJobId=String(read.body.request_id??created.headers.get("x-fal-request-id")??"");if(!providerJobId)throw falInvalidResponseError("fal_submission_receipt_missing","submission",created,read as FalJsonRead<Record<string,unknown>>,submittedPrompt);const queueUrls=falVideoQueueUrls(model,providerJobId,read.body);providerStatusUrl=queueUrls.statusUrl;providerResponseUrl=queueUrls.responseUrl;providerCancelUrl=queueUrls.cancelUrl;await options.onReceipt?.({providerJobId,provider:"fal",model,providerStatusUrl,providerResponseUrl,providerCancelUrl});
    }else{
      await options.onPrepared?.({provider:"fal",model,submittedPrompt,parameters:providerParameters,referenceInputs:referenceReceipts,usedReferencePixels:references.length>0});
    }
    const resumeUrls=falVideoQueueUrls(model,providerJobId,{status_url:providerStatusUrl,response_url:providerResponseUrl,cancel_url:providerCancelUrl});providerStatusUrl=resumeUrls.statusUrl;providerResponseUrl=resumeUrls.responseUrl;providerCancelUrl=resumeUrls.cancelUrl;if(options.providerJobId)await options.onReceipt?.({providerJobId,provider:"fal",model,providerStatusUrl,providerResponseUrl,providerCancelUrl});
    const deadline=Date.now()+15*60_000;let state:FalQueueResponse={request_id:providerJobId,status:"IN_QUEUE"};
    while(state.status!=="COMPLETED"){
      if(options.signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");if(Date.now()>deadline)throw new ProviderRequestError({code:"video_generation_timeout",category:"server",scope:"provider",action:"retry",message:"Fal did not finish within fifteen minutes. The durable request receipt can be retried without starting a duplicate render.",retryable:true,retryAfterMs:30_000,requestId:providerJobId,httpStatus:null});
      const checked=await readFalQueueResponse<FalQueueResponse & Record<string,unknown>>(`${providerStatusUrl}${providerStatusUrl.includes("?")?"&":"?"}logs=1`,{method:"GET",headers:falHeaders(env),signal:options.signal},"status",submittedPrompt,providerJobId);state=checked.body;if(state.status==="FAILED"||state.status==="CANCELLED")throw new ProviderRequestError({code:`fal_video_${state.status.toLowerCase()}`,category:"provider",scope:"request",action:state.status==="FAILED"?"edit_request":"retry",message:`Fal marked video request ${providerJobId.slice(0,8)} as ${state.status.toLowerCase()}. Review the retained input receipt before retrying.`,retryable:state.status==="CANCELLED",retryAfterMs:state.status==="CANCELLED"?1_000:null,requestId:providerJobId,httpStatus:422},submittedPrompt);if(!state.status||!["IN_QUEUE","IN_PROGRESS","COMPLETED"].includes(state.status))throw new ProviderRequestError({code:"fal_status_receipt_invalid",category:"server",scope:"provider",action:"retry",message:"Fal returned a status receipt without a recognized queue state. The durable provider request ID was preserved for retry.",retryable:true,retryAfterMs:1_000,requestId:providerJobId,httpStatus:checked.response.status},submittedPrompt);if(state.response_url||state.status_url||state.cancel_url){const queueUrls=falVideoQueueUrls(model,providerJobId,{response_url:state.response_url??providerResponseUrl,status_url:state.status_url??providerStatusUrl,cancel_url:state.cancel_url??providerCancelUrl});providerStatusUrl=queueUrls.statusUrl;providerResponseUrl=queueUrls.responseUrl;providerCancelUrl=queueUrls.cancelUrl;}if(state.status!=="COMPLETED"){await options.onStage?.(state.status==="IN_QUEUE"?"queued":"rendering",falVideoStatusMessage(state));await wait(5_000,options.signal);}
    }
    await options.onStage?.("finalizing","Provider processing finished. Validating the final result receipt before reporting a usable video.");let resultRead:{response:Response;body:FalVideoResponse & Record<string,unknown>;malformed:boolean};try{resultRead=await readFalQueueResponse<FalVideoResponse & Record<string,unknown>>(providerResponseUrl,{method:"GET",headers:falHeaders(env),signal:options.signal},"result",submittedPrompt,providerJobId);}catch(error){if(error instanceof ProviderRequestError&&error.detail.category==="safety")throw new ProviderRequestError({...error.detail,probe:"fal-seedance-result-partner-validation"},error.preparedPrompt??submittedPrompt);throw error;}const result=resultRead.body;const video=result.video??result.data?.video;const mediaUrl=trustedFalMediaUrl(String(video?.url??""));await options.onStage?.("downloading","The provider accepted the final result. Saving the playable video.");const content=await openAIRequest(mediaUrl,{method:"GET",signal:options.signal});if(!content.ok)throw falErrorFromResponse(content,{},`fal_media_${content.status}`,submittedPrompt);const bytes=new Uint8Array(await content.arrayBuffer());if(!bytes.length)throw new ProviderRequestError({code:"fal_video_empty",category:"server",scope:"provider",action:"retry",message:"Fal completed the request but returned an empty video file.",retryable:true,retryAfterMs:1_000,requestId:providerJobId,httpStatus:content.status},submittedPrompt);const mimeType=String(video?.content_type??content.headers.get("content-type")??"video/mp4");if(!mimeType.startsWith("video/"))throw new ProviderRequestError({code:"fal_video_type_invalid",category:"server",scope:"provider",action:"retry",message:`Fal completed the request but returned ${mimeType||"an unknown media type"} instead of video.`,retryable:true,retryAfterMs:1_000,requestId:providerJobId,httpStatus:content.status},submittedPrompt);
    const costPerSecond=isSeedanceReferenceVideo(model)?seedanceReferenceCostPerSecond(model,resolution):(providerReferences.length?130_000:125_000);return{providerJobId,provider:"fal",model,providerStatusUrl,providerResponseUrl,providerCancelUrl,bytes,mimeType,seconds:options.seconds,size:options.size,latencyMs:Date.now()-started,costMicrousd:options.seconds*costPerSecond,submittedPrompt,providerParameters,referenceInputs:referenceReceipts,usedReferencePixels:providerReferences.length>0};
  }catch(error){
    if(options.signal?.aborted&&providerJobId)await cancelFalVideo(env,model,providerJobId,providerCancelUrl);
    if(error instanceof ProviderRequestError&&error.detail.category==="safety"&&references.length)throw new ProviderRequestError({...error.detail,contributingBlockIds:[...new Set(references.map((reference)=>reference.blockId).filter(Boolean))],contributingReferenceIds:[...new Set(references.map((reference)=>reference.referenceId).filter(Boolean))],probe:error.detail.probe??"fal-seedance-reference-partner-validation"},error.preparedPrompt??submittedPrompt);
    throw error;
  }
}
