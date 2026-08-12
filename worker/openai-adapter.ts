import type { WorkerEnv } from "./runtime.ts";
import { BLOCK_TYPES, type AdaptiveStructure, type BlockKind } from "../src/model/block-types.ts";
import { normalizeSpatialScope } from "../src/model/spatial-scope.ts";

type OpenAIResponse = { id?: string; model?: string; output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: { message?: string } };
type OpenAIImageResponse = { created?: number; data?: Array<{ b64_json?: string; revised_prompt?: string }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: { message?: string } };
export type CreativeChatMutation = { operation: "create" | "edit" | "remove"; target_block_id: string | null; type: BlockKind; subtype: string; instruction: string; handle: string };
export type CreativeChatResponse = { reply: string; mutations: CreativeChatMutation[]; preview_direction: string; preview_worthy: boolean };
export type ImageReference = { bytes: Uint8Array; mimeType: string };
export type CreativeImageOptions = { quality?: "low" | "medium" | "high"; size?: "1024x1024" | "1536x1024" | "1024x1536"; reference?: ImageReference };

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
    mutations:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["operation","target_block_id","type","subtype","instruction","handle"],properties:{
      operation:{type:"string",enum:["create","edit","remove"]},
      target_block_id:{type:["string","null"]},
      type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},
      subtype:{type:"string"},instruction:{type:"string"},handle:{type:"string"},
    }}},
    preview_direction:{type:"string"},preview_worthy:{type:"boolean"},
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

const responseText=(body:OpenAIResponse)=>body.output_text||body.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==="output_text")?.text||"";

export async function generateCreativeDirection(env: WorkerEnv, userId: string, snapshot: Record<string, unknown>) {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? "gpt-5.6-terra",
      instructions: "You are Forma's creative-direction adapter. Interpret every field of the supplied authored and cited context. Return a concrete visual direction, not hidden reasoning. Treat inferred material as suggestive and never claim it was authored. Each fact has an independent semantic role and intent. Ignore facts whose active field is false; they remain present only for provenance. Every active fact whose intent is avoid or prohibit, whose effect is must_not_include, or whose legacy type is exclusion is a negative constraint: apply the prohibition to its named role, and never let the named content become a positive focus in the title, scene, rationale, palette, or next moves. Prohibit is a hard boundary; avoid is a strong negative preference. Weight expresses the constraint's influence, not creative prominence. Prefer facts are positive preferences, while include facts are ordinary positive instructions. A fact's properties.spatial_scope limits where that fact applies. Preserve its named region, rectangle, subject relationship, or custom path in the scene and rationale; do not silently promote a local decision into a whole-image instruction.",
      input: JSON.stringify(snapshot),
      text: { verbosity: "low", format: { type: "json_schema", name: "forma_creative_direction", strict: true, schema: outputSchema } },
      reasoning: { effort: "low" }, max_output_tokens: 1200, store: false,
      safety_identifier: await safetyIdentifier(userId),
    }),
  });
  const body = await response.json() as OpenAIResponse;
  if (!response.ok) throw new Error(body.error?.message ?? `openai_${response.status}`);
  const text = responseText(body);
  if (!text) throw new Error("provider_returned_no_output");
  let parsed: Record<string, unknown>; try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("provider_returned_invalid_json"); }
  return { responseId: body.id ?? "", model: body.model ?? env.OPENAI_MODEL ?? "gpt-5.6-terra", output: parsed, raw: text, latencyMs: Date.now() - started, usage: { inputTokens: Number(body.usage?.input_tokens ?? 0), outputTokens: Number(body.usage?.output_tokens ?? 0), totalTokens: Number(body.usage?.total_tokens ?? 0) } };
}

const record=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const percent=(value:number)=>`${Math.round(value*100)}%`;

export function buildSpatialDirectives(snapshot:Record<string,unknown>){
  const facts=Array.isArray(snapshot.facts)?snapshot.facts.map(record):[];
  const labelFor=(fact:Record<string,unknown>)=>{const properties=record(fact.properties);return String(properties.text??properties.label??fact.handle??fact.type??"decision");};
  const subjectFor=(id:string)=>labelFor(facts.find((fact)=>String(fact.block_id??"")===id)??{});
  return facts.map((fact)=>{
    const properties=record(fact.properties);const scope=normalizeSpatialScope(properties.spatial_scope);const decision=`${String(fact.role??fact.type??"decision")} “${labelFor(fact)}”`;
    if(fact.active===false)return `- Do not apply ${decision}; this block is inactive and is included only for provenance.`;
    let target="across the entire image";
    if(scope.kind==="region")target=scope.region==="custom"?`in the implied area described as “${scope.instruction||"custom area"}”`:`in the ${scope.region} area`;
    if(scope.kind==="aabb"&&scope.aabb)target=`inside the document-relative rectangle at left ${percent(scope.aabb.x)}, top ${percent(scope.aabb.y)}, width ${percent(scope.aabb.width)}, height ${percent(scope.aabb.height)}`;
    if(scope.kind==="subject")target=`${scope.subject_relation?.replaceAll("-"," ")} the subject “${subjectFor(scope.subject_block_id??"")}”`;
    if(scope.kind==="path")target=`inside the document-relative clipping path ${JSON.stringify(scope.path??[])}`;
    if(scope.polarity==="outside"&&scope.kind!=="document")target=`everywhere outside ${target.replace(/^inside /,"").replace(/^in /,"")}`;
    return `- Apply ${decision} ${target}; use a ${scope.falloff} transition with ${percent(scope.feather)} feather. Intent: ${String(fact.intent??"include")}; influence: ${percent(Number(properties.weight??.5))}.`;
  });
}

export function buildCreativeImagePrompt(snapshot:Record<string,unknown>,direction:Record<string,unknown>) {
  const spatialDirectives=buildSpatialDirectives(snapshot);
  return [
    "Create one polished landscape image that realizes the supplied creative direction.",
    "Use every active block field in the document context as binding art direction, including subtype, influence, intent, reference-derived findings, and spatial scope. Ignore blocks marked active false. Preserve the intended subject, environment, composition, lighting, style, material, mood, and palette relationships.",
    "Any fact with intent avoid or prohibit, effect must_not_include, or role exclusion is a negative constraint. Never promote that content into a subject, theme, focal point, text, or visual motif.",
    "Spatial scopes are document-normalized. Apply each decision only to its stated target. Inside/outside polarity, hard/soft/contextual falloff, feather, subject relationships, rectangles, and custom paths are requirements—not metadata or suggestions.",
    "Do not add typography, logos, watermarks, UI chrome, captions, borders, contact sheets, or explanatory annotations unless the authored context explicitly requires them.",
    `Spatial application map:\n${spatialDirectives.length?spatialDirectives.join("\n"):"- No active block decisions were supplied."}`,
    `Creative direction:\n${JSON.stringify(direction)}`,
    `Durable document context:\n${JSON.stringify(snapshot)}`,
  ].join("\n\n");
}

export async function generateCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:CreativeImageOptions={}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const model=env.OPENAI_IMAGE_MODEL??"gpt-image-2";const prompt=buildCreativeImagePrompt(snapshot,direction);const started=Date.now();
  const quality=options.quality??"high";const size=options.size??"1536x1024";const user=await safetyIdentifier(userId);
  let response:Response;
  if(options.reference){
    const form=new FormData();const buffer=options.reference.bytes.buffer.slice(options.reference.bytes.byteOffset,options.reference.bytes.byteOffset+options.reference.bytes.byteLength) as ArrayBuffer;form.set("model",model);form.set("prompt",prompt);form.set("n","1");form.set("size",size);form.set("quality",quality);form.set("user",user);form.append("image[]",new Blob([buffer],{type:options.reference.mimeType}),"latest-ideation-preview.png");
    response=await fetch("https://api.openai.com/v1/images/edits",{method:"POST",headers:openAIAuthHeaders(env),body:form});
  }else{
    response=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({model,prompt,n:1,size,quality,user})});
  }
  const body=await response.json() as OpenAIImageResponse;if(!response.ok)throw new Error(body.error?.message??`openai_image_${response.status}`);
  const encoded=body.data?.[0]?.b64_json;if(!encoded)throw new Error("provider_returned_no_image");
  let bytes:Uint8Array;try{const binary=atob(encoded);bytes=Uint8Array.from(binary,(character)=>character.charCodeAt(0));}catch{throw new Error("provider_returned_invalid_image");}
  const [width,height]=size.split("x").map(Number);
  return{model,prompt,bytes,revisedPrompt:body.data?.[0]?.revised_prompt??null,createdAt:body.created??null,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)},width,height,mimeType:"image/png",quality,usedReference:Boolean(options.reference)};
}

export async function respondToCreativeChat(env:WorkerEnv,userId:string,input:{documentTitle:string;blocks:Array<Record<string,unknown>>;history:Array<{role:"user"|"assistant";text:string}>;message:string}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"You are Forma, a concise creative collaborator inside a chat-only document view. Speak about the user's creative plan and intended image, never about blocks, events, schemas, metadata, adapters, or hidden machinery. Interpret the newest message against the existing plan and recent conversation. Return a helpful reply plus the smallest accurate set of plan mutations. Create adds a new durable decision; edit changes one existing decision and must name its target_block_id; remove deletes one existing decision and must name its target_block_id. Never target a missing item. For create, target_block_id is null. For unused mutation fields return sensible empty strings, but type must always be a valid vocabulary value. If the creative image meaningfully changes, preview_worthy is true and preview_direction is a standalone visual instruction incorporating the whole current intention after your proposed changes. If the user is only asking a question or chatting without changing visual intent, do not mutate and set preview_worthy false.",
    input:JSON.stringify({...input,block_vocabulary:BLOCK_TYPES.map((item)=>({type:item.type,subtypes:item.subtypes})),mutation_rules:{create:"target_block_id must be null",edit:"target_block_id must match an existing id",remove:"target_block_id must match an existing id"}}),
    text:{verbosity:"low",format:{type:"json_schema",name:"forma_creative_chat",strict:true,schema:creativeChatSchema}},reasoning:{effort:"low"},max_output_tokens:1600,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw new Error(body.error?.message??`openai_${response.status}`);
  const text=responseText(body);if(!text)throw new Error("provider_returned_no_output");
  let parsed:CreativeChatResponse;try{parsed=JSON.parse(text) as CreativeChatResponse;}catch{throw new Error("provider_returned_invalid_json");}
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output:parsed,raw:text,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}

export async function structureAdaptiveContext(env:WorkerEnv,userId:string,input:{intent:string;documentTitle:string;blocks:Array<Record<string,unknown>>}) {
  if(!env.OPENAI_API_KEY)throw new Error("provider_not_configured");
  const started=Date.now();
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:openAIHeaders(env),body:JSON.stringify({
    model:env.OPENAI_MODEL??"gpt-5.6-terra",
    instructions:"You structure an adaptive creative-context interface. Interpret the user's broad intent together with the currently authored blocks. Propose the next useful decision and 2–6 concise context blocks across intent, scene, craft, evidence, or constraints. Use only the supplied block type vocabulary. Subtypes should match the system suggestions when practical. Explain product-facing reasons, never hidden chain-of-thought. Do not claim proposals were authored and do not mutate anything.",
    input:JSON.stringify({...input,block_vocabulary:BLOCK_TYPES.map((item)=>({type:item.type,description:item.description,subtypes:item.subtypes}))}),
    text:{verbosity:"low",format:{type:"json_schema",name:"forma_adaptive_structure",strict:true,schema:adaptiveStructureSchema}},reasoning:{effort:"low"},max_output_tokens:1400,store:false,safety_identifier:await safetyIdentifier(userId),
  })});
  const body=await response.json() as OpenAIResponse;if(!response.ok)throw new Error(body.error?.message??`openai_${response.status}`);
  const text=responseText(body);if(!text)throw new Error("provider_returned_no_output");
  let parsed:AdaptiveStructure;try{parsed=JSON.parse(text) as AdaptiveStructure;}catch{throw new Error("provider_returned_invalid_json");}
  return{responseId:body.id??"",model:body.model??env.OPENAI_MODEL??"gpt-5.6-terra",output:parsed,raw:text,latencyMs:Date.now()-started,usage:{inputTokens:Number(body.usage?.input_tokens??0),outputTokens:Number(body.usage?.output_tokens??0),totalTokens:Number(body.usage?.total_tokens??0)}};
}
