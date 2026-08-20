import type { WorkerEnv } from "./runtime.ts";
import { BLOCK_TYPES, type AdaptiveStructure, type BlockKind, type ReferencePixelMode } from "../src/model/block-types.ts";
import type { LiveReplayPlan } from "../src/model/live-replay.ts";
import { buildBoundedPromptRepresentation, buildReferencePromptDirectives, buildSpatialPromptDirectives, normalizePromptTechnique, type PromptReferenceDescriptor, type PromptTechnique } from "../src/model/prompt-structures.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse, type ProviderFailureDetail } from "./provider-errors.ts";
import { normalizeImageFormat, validateProviderImageSize } from "../src/model/image-format.ts";
import { buildReplayDevelopmentStages, type CreativeStudyKind, type ReplayDevelopmentStage } from "../src/model/replay-development.ts";
import { moderateExactImagePrompt } from "./openai-moderation.ts";
import { parseDocumentArtifactContent, slideCopyIsDistinct, slideDeckCopyIsDistinct, slideVisualIsComplete, SLIDE_LAYOUTS, SLIDE_STYLE_PRESET_IDS, SLIDE_VISUAL_KINDS, type DocumentArtifactDraft, type DocumentArtifactKind } from "../src/model/document-artifacts.ts";
import { REPLAY_EXPERIENCE_PROFILES, replayExperienceDefinition, type ReplayExperienceId } from "../src/model/replay-experiences.ts";

type OpenAIError = { message?: string; type?: string; code?: string | null; param?: string | null };
type OpenAIResponse = { id?: string; model?: string; output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: OpenAIError };
type OpenAIImageUsage = { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
type OpenAIImageResponse = { created?: number; data?: Array<{ b64_json?: string; revised_prompt?: string }>; usage?: OpenAIImageUsage; error?: OpenAIError };
type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
type FalQueueResponse = { status?: FalQueueStatus; request_id?: string; queue_position?: number; logs?: Array<{ message?: string; timestamp?: string }>; metrics?: { inference_time?: number }; error?: OpenAIError };
type FalVideoFile = { url?: string; content_type?: string; file_name?: string; file_size?: number };
type FalVideoResponse = { video?: FalVideoFile; data?: { video?: FalVideoFile }; error?: OpenAIError };
type OpenAIImageStreamEvent = { type?: string; b64_json?: string; created_at?: number; size?: string; output_format?: ImageOutputFormat; partial_image_index?: number; usage?: OpenAIImageUsage; error?: { message?: string } };
export type CreativeChatMutation = { operation: "create" | "edit" | "remove"; target_block_id: string | null; type: BlockKind; subtype: string; instruction: string; handle: string; reference_pixel_mode: ReferencePixelMode | "unchanged"; image_format: { aspect_ratio:string; width:number; height:number } | null };
export type CreativeChatResponse = { reply: string; mutations: CreativeChatMutation[]; preview_direction: string; preview_worthy: boolean };
export type ImageReference = { bytes: Uint8Array; mimeType: string; blockId?: string; referenceId?: string; label?: string; mode?: ReferencePixelMode; source: "uploaded-reference" | "ideation-preview" | "locked-study" };
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
  signal?: AbortSignal;
  onStage?: (stage:string,message:string) => void | Promise<void>;
};
export type LiveReplayPlanningContext = { stage: ReplayDevelopmentStage; lockedStudies: Array<{ kind: CreativeStudyKind; label: string; lockSummary: string; lockedDecisions: LiveReplayPlan["development"]["locked_decisions"] }>; experienceProfile?:ReplayExperienceId };
export type DocumentArtifactOptions = { itemCount?:number; audience?:string; tone?:string; signal?:AbortSignal };
export type CreativeVideoOptions = { seconds:4|8|10; size:"1280x720"|"720x1280"; providerJobId?:string; signal?:AbortSignal; onStage?:(stage:string,message:string)=>void|Promise<void>; onReceipt?:(receipt:{providerJobId:string;provider:string;model:string})=>void|Promise<void> };

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
  const itemProperties:Record<string,unknown>={title:{type:"string"},body:{type:"string"},notes:{type:"string"},image_prompt:{type:"string"}};
  const itemRequired=["title","body","notes","image_prompt"];
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
  const instructions = "You are Forma's creative-direction adapter. Interpret every field of the supplied authored and cited context. Return a concrete visual direction, not hidden reasoning. Treat inferred material as suggestive and never claim it was authored. Each fact has an independent semantic role and intent. Ignore facts whose active field is false; they remain present only for provenance. Every active fact whose intent is avoid or prohibit, whose effect is must_not_include, or whose legacy type is exclusion is a negative constraint: apply the prohibition to its named role, and never let the named content become a positive focus in the title, scene, rationale, palette, or next moves. Prohibit is a hard boundary; avoid is a strong negative preference. Weight expresses the constraint's influence, not creative prominence. Prefer facts are positive preferences, while include facts are ordinary positive instructions. A fact's properties.spatial_scope limits where that fact applies. Preserve its named region, rectangle, subject relationship, or custom path in the scene and rationale; do not silently promote a local decision into a whole-image instruction.";
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
  const references=validateImageReferences(options.references??[]);const promptTechnique=normalizePromptTechnique(options.promptTechnique);const prompt=buildCreativeImagePrompt(snapshot,direction,references,promptTechnique,{size,quality,partialImages:options.partialImages});const started=Date.now();
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

export async function generateDocumentArtifact(env:WorkerEnv,userId:string,kind:DocumentArtifactKind,input:{documentTitle:string;snapshot:Record<string,unknown>;options?:DocumentArtifactOptions}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");const started=Date.now();const itemCount=Math.max(1,Math.min(12,Math.floor(Number(input.options?.itemCount??(kind==="slides"?7:kind==="storyboard"?6:kind==="short_story"?3:1)))));
  const instructions=`You transform a durable creative document into a ${kind.replaceAll("_"," ")} for an end user. ${artifactInstructions[kind]} Treat include and prefer blocks as positive direction; treat avoid and prohibit blocks as negative constraints, never as subjects to feature. Respect every block's spatial scope and authority. Do not mention blocks, events, schemas, or internal implementation. Return exactly ${itemCount} ordered item${itemCount===1?"":"s"}.`;
  const providerInput=JSON.stringify({document_title:input.documentTitle,creative_context:input.snapshot,audience:input.options?.audience??"general",tone:input.options?.tone??"derived from the document"});
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),signal:input.options?.signal,body:JSON.stringify({model:env.OPENAI_MODEL??"gpt-5.6-terra",instructions,input:providerInput,text:{verbosity:"medium",format:{type:"json_schema",name:`document_${kind}`,strict:true,schema:documentArtifactSchema(kind)}},reasoning:{effort:"low"},max_output_tokens:kind==="short_story"?6000:kind==="slides"?6500:kind==="storyboard"?4000:3000,store:false,safety_identifier:await safetyIdentifier(userId)})});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`,`Document ${kind} instructions:\n${instructions}\n\nCreative context:\n${providerInput}`);const raw=responseText(body);if(!raw)throw new Error("provider_returned_no_output");const output=parseDocumentArtifactContent(raw) as DocumentArtifactDraft|null;if(!output)throw new Error("provider_returned_invalid_json");const rawItems=(JSON.parse(raw) as {items?:unknown[]}).items??[];if(!output.content_markdown.trim()||output.items.length!==itemCount||kind==="slides"&&(!output.presentation?.footerLabel||!slideDeckCopyIsDistinct(rawItems)||rawItems.some((item)=>!slideCopyIsDistinct(item))||output.items.some((item)=>!item.title.trim()||!item.body.trim()||!item.slide||!slideVisualIsComplete(item.slide))))throw new Error("provider_returned_incomplete_document_artifact");
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output,raw,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

const falHeaders=(env:WorkerEnv)=>({authorization:`Key ${env.FAL_KEY}`,"content-type":"application/json"});
const falVideoEndpoint=(model:string)=>`https://queue.fal.run/${model}`;
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
async function cancelFalVideo(env:WorkerEnv,model:string,providerJobId:string){
  try{await fetch(`${falVideoEndpoint(model)}/requests/${encodeURIComponent(providerJobId)}/cancel`,{method:"PUT",headers:falHeaders(env)});}catch{/* Cancellation is best-effort; the durable job still records the local stop. */}
}

export async function generateCreativeVideo(env:WorkerEnv,prompt:string,options:CreativeVideoOptions) {
  if(!env.FAL_KEY)throw new ProviderRequestError({code:"video_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"Fal video generation is not configured for this environment.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const provider=env.FORMA_VIDEO_PROVIDER??"fal";if(provider!=="fal")throw new ProviderRequestError({code:"video_provider_unsupported",category:"access",scope:"provider",action:"check_credentials",message:`The configured video provider ${provider} is not supported by this build.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const cleanPrompt=prompt.trim();if(!cleanPrompt)throw new ProviderRequestError({code:"video_prompt_required",category:"provider",scope:"request",action:"edit_request",message:"The document did not produce a usable motion prompt.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  if(cleanPrompt.length>20_000)throw new ProviderRequestError({code:"video_prompt_too_long",category:"provider",scope:"request",action:"edit_request",message:`The prepared motion prompt is ${cleanPrompt.length.toLocaleString()} characters; Gemini Omni Flash accepts at most 20,000. Shorten unusually long document instructions before retrying.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400},cleanPrompt);
  const started=Date.now();const model=env.FAL_VIDEO_MODEL??"google/gemini-omni-flash";let providerJobId=options.providerJobId??"";
  try{
    if(!providerJobId){
      await options.onStage?.("submitting","Submitting the motion prompt to Fal for a synchronized video and audio render.");
      const created=await openAIRequest(falVideoEndpoint(model),{method:"POST",headers:falHeaders(env),signal:options.signal,body:JSON.stringify({prompt:cleanPrompt,aspect_ratio:options.size==="720x1280"?"9:16":"16:9",duration:options.seconds})});const receipt=await created.json() as FalQueueResponse;if(!created.ok)throw falErrorFromResponse(created,receipt,`fal_${created.status}`,cleanPrompt);providerJobId=String(receipt.request_id??"");if(!providerJobId)throw new Error("provider_returned_no_video_job");await options.onReceipt?.({providerJobId,provider:"fal",model});
    }
    const deadline=Date.now()+15*60_000;let state:FalQueueResponse={request_id:providerJobId,status:"IN_QUEUE"};
    while(state.status!=="COMPLETED"){
      if(options.signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");if(Date.now()>deadline)throw new ProviderRequestError({code:"video_generation_timeout",category:"server",scope:"provider",action:"retry",message:"Fal did not finish within fifteen minutes. The durable request receipt can be retried without starting a duplicate render.",retryable:true,retryAfterMs:30_000,requestId:providerJobId,httpStatus:null});
      const checked=await openAIRequest(`${falVideoEndpoint(model)}/requests/${encodeURIComponent(providerJobId)}/status?logs=1`,{method:"GET",headers:falHeaders(env),signal:options.signal});state=await checked.json() as FalQueueResponse;if(!checked.ok)throw falErrorFromResponse(checked,state,`fal_${checked.status}`,cleanPrompt);if(state.status!=="COMPLETED"){await options.onStage?.(state.status==="IN_QUEUE"?"queued":"rendering",falVideoStatusMessage(state));await wait(5_000,options.signal);}
    }
    await options.onStage?.("downloading","Video rendered. Saving the playable result.");const resultResponse=await openAIRequest(`${falVideoEndpoint(model)}/requests/${encodeURIComponent(providerJobId)}`,{method:"GET",headers:falHeaders(env),signal:options.signal});const result=await resultResponse.json() as FalVideoResponse;if(!resultResponse.ok)throw falErrorFromResponse(resultResponse,result,`fal_${resultResponse.status}`,cleanPrompt);const video=result.video??result.data?.video;const mediaUrl=trustedFalMediaUrl(String(video?.url??""));const content=await openAIRequest(mediaUrl,{method:"GET",signal:options.signal});if(!content.ok)throw falErrorFromResponse(content,{},`fal_media_${content.status}`,cleanPrompt);const bytes=new Uint8Array(await content.arrayBuffer());if(!bytes.length)throw new Error("provider_returned_empty_video");const mimeType=String(video?.content_type??content.headers.get("content-type")??"video/mp4");if(!mimeType.startsWith("video/"))throw new Error("provider_returned_invalid_video_type");
    return{providerJobId,provider:"fal",model,bytes,mimeType,seconds:options.seconds,size:options.size,latencyMs:Date.now()-started,costMicrousd:options.seconds*125_000};
  }catch(error){if(options.signal?.aborted&&providerJobId)await cancelFalVideo(env,model,providerJobId);throw error;}
}
