import type { WorkerEnv } from "./runtime.ts";
import { BLOCK_TYPES, type AdaptiveStructure, type BlockKind, type ReferencePixelMode } from "../src/model/block-types.ts";
import type { LiveReplayPlan } from "../src/model/live-replay.ts";
import { buildPromptRepresentation, buildReferencePromptDirectives, buildSpatialPromptDirectives, normalizePromptTechnique, type PromptReferenceDescriptor, type PromptTechnique } from "../src/model/prompt-structures.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse, type ProviderFailureDetail } from "./provider-errors.ts";

type OpenAIError = { message?: string; type?: string; code?: string | null; param?: string | null };
type OpenAIResponse = { id?: string; model?: string; output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: OpenAIError };
type OpenAIImageUsage = { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
type OpenAIImageResponse = { created?: number; data?: Array<{ b64_json?: string; revised_prompt?: string }>; usage?: OpenAIImageUsage; error?: OpenAIError };
type OpenAIImageStreamEvent = { type?: string; b64_json?: string; created_at?: number; size?: string; output_format?: ImageOutputFormat; partial_image_index?: number; usage?: OpenAIImageUsage; error?: { message?: string } };
export type CreativeChatMutation = { operation: "create" | "edit" | "remove"; target_block_id: string | null; type: BlockKind; subtype: string; instruction: string; handle: string; reference_pixel_mode: ReferencePixelMode | "unchanged" };
export type CreativeChatResponse = { reply: string; mutations: CreativeChatMutation[]; preview_direction: string; preview_worthy: boolean };
export type ImageReference = { bytes: Uint8Array; mimeType: string; blockId?: string; referenceId?: string; label?: string; mode?: ReferencePixelMode; source: "uploaded-reference" | "ideation-preview" };
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
};

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
    mutations:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["operation","target_block_id","type","subtype","instruction","handle","reference_pixel_mode"],properties:{
      operation:{type:"string",enum:["create","edit","remove"]},
      target_block_id:{type:["string","null"]},
      type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},
      subtype:{type:"string"},instruction:{type:"string"},handle:{type:"string"},reference_pixel_mode:{type:"string",enum:["unchanged","context_only","inspiration","preserve_composition","preserve_subject","preserve_style"]},
    }}},
    preview_direction:{type:"string"},preview_worthy:{type:"boolean"},
  },
};

const replayDirectionSchema={type:"object",additionalProperties:false,required:["title","rationale","scene","palette","next_moves"],properties:{title:{type:"string"},rationale:{type:"string"},scene:{type:"string"},palette:{type:"array",minItems:3,maxItems:6,items:{type:"string"}},next_moves:{type:"array",minItems:2,maxItems:4,items:{type:"string"}}}};
const liveReplayPlanSchema={
  type:"object",additionalProperties:false,required:["title","summary","user_goal","project_name","document_title","reference","chat_turns","blocks","draft","final","critique","collection","memory","fan_review","friction"],properties:{
    title:{type:"string"},summary:{type:"string"},user_goal:{type:"string"},project_name:{type:"string"},document_title:{type:"string"},
    reference:{type:"object",additionalProperties:false,required:["label","description","mood","composition","materials","lighting","spatial","palette"],properties:{label:{type:"string"},description:{type:"string"},mood:{type:"string"},composition:{type:"string"},materials:{type:"string"},lighting:{type:"string"},spatial:{type:"string"},palette:{type:"array",minItems:4,maxItems:6,items:{type:"string"}}}},
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
const wait = (delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay));

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
    await wait(providerRetryDelay(detail, attempt));
  }
  throw new Error("openai_request_failed");
}

const responseText=(body:OpenAIResponse)=>body.output_text||body.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==="output_text")?.text||"";

export async function generateLiveReplayPlan(env:WorkerEnv,userId:string,seed:string){
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");const started=Date.now();
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"Create a realistic, coherent, fully populated creative-workflow mock for an event-sourced image application. This is synthetic evaluation data, not a description of implementation. Make every field specific, natural, and user-readable. Supply exactly one block for every provided block type, with no duplicates; choose a useful supported subtype. Across the blocks use every spatial_method at least once. Include positive direction, role-specific avoid/prohibit constraints, and several local targets that genuinely matter to the pictured scene. Write three to five conversational turns that show an idea becoming more precise; Live preview must be true on at least one turn and false on at least one turn so the user can batch decisions. The assistant should acknowledge uncertainty and resolve only the requested change. The draft should be fast and exploratory. The final direction should refine that draft. Compare the likely strengths of prose, bullets, JSON, and XML handoffs with a distinct, specific reason for each; choose a preferred technique and one or more outputs worth promoting. Include a plausible moment where the user gets stuck in one document view and a concrete recovery. Use valid CSS hex colors. Do not mention events, schemas, APIs, tests, or internal metadata.",
    input:JSON.stringify({seed:seed.trim()||"Develop a richly art-directed editorial image through conversation, reference analysis, local constraints, iteration, memory, and re-entry.",required_block_types:BLOCK_TYPES.map((item)=>({type:item.type,subtypes:item.subtypes,description:item.description}))}),
    text:{verbosity:"medium",format:{type:"json_schema",name:"live_replay_plan",strict:true,schema:liveReplayPlanSchema}},reasoning:{effort:"medium"},max_output_tokens:6000,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw providerErrorFromResponse(response,body,`openai_${response.status}`);const raw=responseText(body);if(!raw)throw new Error("provider_returned_no_output");
  let output:LiveReplayPlan;try{output=JSON.parse(raw) as LiveReplayPlan;}catch{throw new Error("provider_returned_invalid_json");}
  const supplied=new Set(output.blocks.map((block)=>block.type));const spatialMethods=new Set(output.blocks.map((block)=>block.spatial_method));if(output.blocks.length!==BLOCK_TYPES.length||BLOCK_TYPES.some((definition)=>!supplied.has(definition.type))||["document","region","aabb","subject","path"].some((method)=>!spatialMethods.has(method as LiveReplayPlan["blocks"][number]["spatial_method"])))throw new Error("provider_returned_incomplete_replay_plan");
  if(output.chat_turns.length<3||!output.chat_turns.some((turn)=>turn.live_preview)||!output.chat_turns.some((turn)=>!turn.live_preview))throw new Error("provider_returned_incomplete_chat_rehearsal");
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output,raw,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

export async function generateCreativeDirection(env: WorkerEnv, userId: string, snapshot: Record<string, unknown>) {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const started = Date.now();
  const instructions = "You are Forma's creative-direction adapter. Interpret every field of the supplied authored and cited context. Return a concrete visual direction, not hidden reasoning. Treat inferred material as suggestive and never claim it was authored. Each fact has an independent semantic role and intent. Ignore facts whose active field is false; they remain present only for provenance. Every active fact whose intent is avoid or prohibit, whose effect is must_not_include, or whose legacy type is exclusion is a negative constraint: apply the prohibition to its named role, and never let the named content become a positive focus in the title, scene, rationale, palette, or next moves. Prohibit is a hard boundary; avoid is a strong negative preference. Weight expresses the constraint's influence, not creative prominence. Prefer facts are positive preferences, while include facts are ordinary positive instructions. A fact's properties.spatial_scope limits where that fact applies. Preserve its named region, rectangle, subject relationship, or custom path in the scene and rationale; do not silently promote a local decision into a whole-image instruction.";
  const plannerInput = JSON.stringify(snapshot);
  const response = await openAIRequest("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
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
export const buildCreativeImagePrompt=(snapshot:Record<string,unknown>,direction:Record<string,unknown>,references:ImageReference[] = [],technique:PromptTechnique="prose",options:Pick<CreativeImageOptions,"size"|"quality"|"partialImages">={})=>
  buildPromptRepresentation(normalizePromptTechnique(technique),snapshot,direction,referenceDescriptors(references),options);

const imageMimeType=(format:ImageOutputFormat)=>format==="jpeg"?"image/jpeg":format==="webp"?"image/webp":"image/png";
const decodeBase64Image=(encoded:string)=>{try{const binary=atob(encoded);return Uint8Array.from(binary,(character)=>character.charCodeAt(0));}catch{throw new Error("provider_returned_invalid_image");}};

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
  const model=env.OPENAI_IMAGE_MODEL??"gpt-image-2";const references=(options.references??[]).filter((reference)=>reference.bytes.byteLength>0);const promptTechnique=normalizePromptTechnique(options.promptTechnique);const prompt=buildCreativeImagePrompt(snapshot,direction,references,promptTechnique,{size:options.size,quality:options.quality,partialImages:options.partialImages});const started=Date.now();
  const quality=options.quality??"high";const size=options.size??"1536x1024";const outputFormat=options.outputFormat??"png";const outputCompression=Math.max(0,Math.min(100,Math.round(options.outputCompression??100)));const partialImages=options.partialImages??0;const user=await safetyIdentifier(userId);
  let response:Response;
  if(references.length){
    const form=new FormData();form.set("model",model);form.set("prompt",prompt);form.set("n","1");form.set("size",size);form.set("quality",quality);form.set("output_format",outputFormat);if(outputFormat!=="png")form.set("output_compression",String(outputCompression));if(partialImages){form.set("stream","true");form.set("partial_images",String(partialImages));}form.set("user",user);
    references.forEach((reference,index)=>{const buffer=reference.bytes.buffer.slice(reference.bytes.byteOffset,reference.bytes.byteOffset+reference.bytes.byteLength) as ArrayBuffer;const extension=reference.mimeType==="image/jpeg"?"jpg":reference.mimeType==="image/webp"?"webp":"png";form.append("image[]",new Blob([buffer],{type:reference.mimeType}),`${reference.source}-${index+1}.${extension}`);});
    try{response=await openAIRequest("https://api.openai.com/v1/images/edits",{method:"POST",headers:openAIAuthHeaders(env),body:form});}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  }else{
    try{response=await openAIRequest("https://api.openai.com/v1/images/generations",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({model,prompt,n:1,size,quality,output_format:outputFormat,...(outputFormat!=="png"?{output_compression:outputCompression}:{}),...(partialImages?{stream:true,partial_images:partialImages}:{}),user})});}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  }
  if(!response.ok){let error:OpenAIImageResponse={};try{error=await response.json() as OpenAIImageResponse;}catch{/* Preserve the provider status when no JSON error body is available. */}throw providerErrorFromResponse(response,error,`openai_image_${response.status}`,prompt);}
  const [requestedWidth,requestedHeight]=size.split("x").map(Number);let encoded="";let revisedPrompt:string|null=null;let createdAt:number|null=null;let usage:OpenAIImageUsage={};let completedSize:string=size;let completedFormat=outputFormat;let partialCount=0;
  if(partialImages){
    try{await readImageStream(response,async(event)=>{if(event.error?.message)throw new ProviderRequestError(classifyProviderFailure(new Error(event.error.message)),prompt);if(event.type?.endsWith(".partial_image")&&event.b64_json){partialCount+=1;const eventSize=event.size??size;const [width,height]=eventSize.split("x").map(Number);await options.onPartial?.({bytes:decodeBase64Image(event.b64_json),index:Number(event.partial_image_index??partialCount-1),mimeType:imageMimeType(event.output_format??outputFormat),width,height});}if(event.type?.endsWith(".completed")&&event.b64_json){encoded=event.b64_json;createdAt=event.created_at??null;usage=event.usage??{};completedSize=event.size??size;completedFormat=event.output_format??outputFormat;}});}catch(error){if(error instanceof ProviderRequestError)throw error;throw new ProviderRequestError(classifyProviderFailure(error),prompt);}
  }else{
    const body=await response.json() as OpenAIImageResponse;encoded=body.data?.[0]?.b64_json??"";revisedPrompt=body.data?.[0]?.revised_prompt??null;createdAt=body.created??null;usage=body.usage??{};
  }
  if(!encoded)throw new Error("provider_returned_no_image");const bytes=decodeBase64Image(encoded);const [width,height]=completedSize.split("x").map(Number);
  return{model,prompt,promptTechnique,bytes,revisedPrompt,createdAt,latencyMs:Date.now()-started,usage:{inputTokens:Number(usage.input_tokens??0),outputTokens:Number(usage.output_tokens??0),totalTokens:Number(usage.total_tokens??0),textInputTokens:Number(usage.input_tokens_details?.text_tokens??0),imageInputTokens:Number(usage.input_tokens_details?.image_tokens??0)},width:Number.isFinite(width)?width:requestedWidth,height:Number.isFinite(height)?height:requestedHeight,mimeType:imageMimeType(completedFormat),quality,usedReference:references.length>0,referenceCount:references.length,referenceInputs:references.map((reference)=>({source:reference.source,blockId:reference.blockId??null,referenceId:reference.referenceId??null,label:reference.label??null,mode:reference.mode??null})),partialCount,outputFormat:completedFormat,outputCompression:completedFormat==="png"?null:outputCompression};
}

export async function respondToCreativeChat(env:WorkerEnv,userId:string,input:{documentTitle:string;blocks:Array<Record<string,unknown>>;history:Array<{role:"user"|"assistant";text:string}>;message:string}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const response=await openAIRequest("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"You are Forma, a concise creative collaborator inside a chat-only document view. Speak about the user's creative plan and intended image, never about blocks, events, schemas, metadata, adapters, or hidden machinery. Interpret the newest message against the existing plan and recent conversation. Return a helpful reply plus the smallest accurate set of plan mutations. Create adds a new durable decision; edit changes one existing decision and must name its target_block_id; remove deletes one existing decision and must name its target_block_id. Never target a missing item. For create, target_block_id is null. Never create a reference item through chat because an actual uploaded image is required. The reference_pixel_mode field is unchanged for ordinary mutations. When the user says to use a named existing reference image, edit the matching reference and choose inspiration unless they explicitly ask to preserve its composition, subject, or visual style. Choose context_only when they say not to send or use its pixels. Never change reference_pixel_mode on a non-reference item. For unused mutation fields return sensible empty strings, but type must always be a valid vocabulary value. If the creative image meaningfully changes, preview_worthy is true and preview_direction is a standalone visual instruction incorporating the whole current intention after your proposed changes. If the user is only asking a question or chatting without changing visual intent, do not mutate and set preview_worthy false.",
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
