import { BLOCK_TYPES } from "../src/model/block-types.ts";
import { parseProfileSynthesisProposals,type ProfileSynthesisProposal } from '../src/model/memory-profile-synthesis.ts';
import { ASSISTANT_MODELS, type AssistantModel } from "../src/model/assistant-model-policy.ts";
import { isContextCompositionRelation } from "../src/model/combined-context.ts";
import type { AssistantContextAction } from "../src/model/assistant-proposals.ts";
import { ASSISTANT_CONTEXT_LIMITS, type AssistantContext } from "../src/model/conversation-context.ts";
import { creativePromptGuardrails, promptFactIsActive, providerFacingCreativeContext, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { providerFacingCombinedContextPlan } from "./openai-adapter.ts";
import type { WorkerEnv } from "./runtime.ts";

export type ProviderAction = {
  kind: AssistantContextAction["kind"];
  block_type: string;
  target_block_id: string | null;
  from_block_id: string | null;
  to_block_id: string | null;
  relation_kind: string;
  intent: "include" | "avoid" | "prohibit";
  text: string;
};

export type AssistantProviderResult = {
  profileSynthesis?:ProfileSynthesisProposal[];
  responseId: string;
  model: string;
  reply: string;
  actions: ProviderAction[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number; cacheWriteInputTokens?: number };
};

/** Legacy transport marker only, never proof of zero usage. New consent callers retain and account for the raw receipt first. */
export class AssistantProviderRejectedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`assistant_provider_http_${status}`);
    this.name = "AssistantProviderRejectedError";
    this.status = status;
  }
}

const assistantResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "actions"],
  properties: {
    reply: { type: "string", maxLength: 2400 },
    actions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "block_type", "target_block_id", "from_block_id", "to_block_id", "relation_kind", "intent", "text"],
        properties: {
          kind: { type: "string", enum: ["context.create", "context.edit", "context.remove", "context.relation.add", "context.relation.remove"] },
          block_type: { type: "string", enum: BLOCK_TYPES.map((item) => item.type) },
          target_block_id: { type: ["string", "null"] },
          from_block_id: { type: ["string", "null"] },
          to_block_id: { type: ["string", "null"] },
          relation_kind: { type: "string" },
          intent: { type: "string", enum: ["include", "avoid", "prohibit"] },
          text: { type: "string", maxLength: 600 },
        },
      },
    },
  },
};
const profileSynthesisSchema={...assistantResponseSchema,required:[...assistantResponseSchema.required,'profile_synthesis'],properties:{...assistantResponseSchema.properties,
 profile_synthesis:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['text','category','references'],properties:{
  text:{type:'string',maxLength:600},category:{type:'string',enum:['preference-hypothesis','workflow-hypothesis']},references:{type:'array',minItems:2,maxItems:8,items:{type:'string'}}}}}}};

/** Explicitly select safe, current, event-derived views; never stream arbitrary histories or media. */
function providerDecisionAliases(context:AssistantContext){
  const eligible=context.decisionAtoms.filter((item)=>item.providerEligible&&(!item.immutable||item.providerVisibility==="governed")
    &&item.type!=="reference"&&item.providerVisibility!=="restricted");
  return new Map(eligible.map((item,index)=>[item.id,`decision_${index+1}`]));
}

function assistantProviderView(context: AssistantContext, message: string, aliases:ReadonlyMap<string,string>, recentTurns:AssistantContext["recentTurns"]) {
  const blocks=context.decisionAtoms.filter((item)=>aliases.has(item.id))
    .map((item)=>({id:aliases.get(item.id)!,type:item.type,text:item.text,intent:item.intent,locked:item.locked||item.immutable||Boolean(item.protected),read_only:item.immutable||Boolean(item.protected),...(item.memoryAssisted?{authorship:"accepted-memory-assisted",independent_evidence:false}:{})}));
  return providerFacingCreativeContext({
    page: context.surface.page,
    page_family: context.surface.canonicalFamily,
    page_playbook: context.playbook,
    document_title: context.documentTitle,
    selected_items: context.selectedItems.map((item) => ({ kind: item.kind, title: item.title })),
    recent_actions: context.recentActions.map((action) => ({ type: action.type })),
    recent_conversation: recentTurns.map((turn) => ({ role: turn.role, text: turn.text })),
    blocks,
    relationships: context.relationships.filter((relation) => aliases.has(relation.from) && aliases.has(relation.to))
      .map((relation) => ({ from: aliases.get(relation.from)!, to: aliases.get(relation.to)!, kind: relation.kind })),
    context_coverage:{included_decisions:blocks.length,total_decisions:context.totals?.decisions??context.decisionAtoms.length,truncated:Boolean(context.truncated)},
    unfinished_work: context.unfinishedIntents.map((intent) => ({ kind: intent.kind, status: intent.status, next_action: intent.nextAction })),
    available_formats: context.availableOutputKinds,
    available_results: context.availableOutputs.map((output) => ({ kind: output.kind, title: output.title, status: output.status })),
    message,
  }) as Record<string, unknown>;
}


export const MAX_ASSISTANT_PROVIDER_REQUEST_BYTES=128*1024;
export const MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES=256*1024;
export const MAX_ASSISTANT_PROVIDER_OUTPUT_BYTES=64*1024;

/** Bound bytes while reading, not after Response.text() has buffered arbitrary
 * data. This retains exact UTF-8 text for receipt verification, never truncates
 * a paid answer, and makes no claim that an interrupted call was uncharged. */
export async function readBoundedAssistantProviderResponse(response:Response,signal:AbortSignal):Promise<string>{
  const unavailable=()=>new Error('assistant_provider_response_unconfirmed');
  const body=response.body,length=response.headers.get('content-length');
  if(!body)throw unavailable();
  if(signal.aborted||length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES)){
    void body.cancel().catch(()=>{});throw unavailable();
  }
  const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let bytes=0,text='';
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    if(signal.aborted)throw unavailable();
    for(;;){
      const next=await reader.read();if(signal.aborted)throw unavailable();if(next.done)break;
      bytes+=next.value.byteLength;if(bytes>MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES)throw unavailable();
      text+=decoder.decode(next.value,{stream:true});
    }
    return text+decoder.decode();
  }catch{throw unavailable();}
  finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}

export type AssistantProviderAliases=Readonly<Record<string,string>>;
export type AssistantProviderSource={
  blocks:readonly {id:string;type:string;properties:Record<string,unknown>;locked:boolean;intent:string;document_id?:string;canvas_id?:string|null;scope?:string}[];
  relationships:readonly {id?:string;from_block_id:string;to_block_id:string;kind:string;properties:Record<string,unknown>}[];
};
export type AssistantProviderUsage={inputTokens:number;outputTokens:number;totalTokens:number;cachedInputTokens:number;cacheWriteInputTokens:number};
export type AssistantProviderUsageReceipt={responseId:string;model:string;usage:AssistantProviderUsage};
const assistantObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const assistantInteger=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
const assistantKeys=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>assistantObject(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));
const assistantIdentity=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=160&&!/\s/u.test(value);
function assistantFailure(code:string):never{throw new Error(code);}

/** Fail before serialization can omit an undefined field, coerce a number, or shorten a source. */
function exactAssistantJson(value:unknown,maximumBytes:number,code:string){
  const ancestors=new Set<object>();
  const visit=(item:unknown):void=>{
    if(item===null||typeof item==="string"||typeof item==="boolean")return;
    if(typeof item==="number"){if(!Number.isFinite(item))assistantFailure("assistant_provider_invalid_input");return;}
    if(typeof item!=="object"||ancestors.has(item))assistantFailure("assistant_provider_invalid_input");
    if(!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)assistantFailure("assistant_provider_invalid_input");
    if(Object.getOwnPropertySymbols(item).length)assistantFailure("assistant_provider_invalid_input");
    ancestors.add(item);for(const child of Array.isArray(item)?item:Object.values(item))visit(child);ancestors.delete(item);
  };
  let serialized:string;try{visit(value);serialized=JSON.stringify(value);}catch(error){if(error instanceof Error&&error.message.startsWith("assistant_provider_"))throw error;assistantFailure("assistant_provider_invalid_input");}
  if(new TextEncoder().encode(serialized).byteLength>maximumBytes)assistantFailure(code);
  return serialized;
}

/** The legacy bounded UI view remains available while its callers migrate to exact consent. */
export function providerFacingAssistantViews(context:AssistantContext,message:string){
  return assistantProviderView(context,message.slice(0,ASSISTANT_CONTEXT_LIMITS.turnChars),providerDecisionAliases(context),context.recentTurns.slice(-ASSISTANT_CONTEXT_LIMITS.turns));
}

/** Capture one complete authorized source and its private reverse aliases. This never fetches or trims to fit. */
export function snapshotAssistantProviderInput(context:AssistantContext,message:string,source?:AssistantProviderSource):{view:Record<string,unknown>;aliases:AssistantProviderAliases}{
  if(typeof message!=="string"||!message.trim()||context.truncated!==false
    ||!assistantInteger(context.totals?.decisions)||context.totals.decisions!==context.decisionAtoms.length)assistantFailure("assistant_provider_source_incomplete");
  const ids=context.decisionAtoms.map((atom)=>atom.id);if(ids.some((id)=>!assistantIdentity(id))||new Set(ids).size!==ids.length)assistantFailure("assistant_provider_source_invalid");
  const forward=providerDecisionAliases(context),eligible=context.decisionAtoms.filter((atom)=>forward.has(atom.id)),aliases=Object.fromEntries([...forward].map(([id,alias])=>[alias,id]));
  if(!source&&eligible.some((atom)=>atom.locked||atom.protected||atom.immutable))assistantFailure("assistant_provider_source_incomplete");
  if(source&&(!Array.isArray(source.blocks)||!Array.isArray(source.relationships)||source.blocks.some((block)=>!assistantObject(block)||!assistantIdentity(block.id)||!assistantObject(block.properties))
    ||source.relationships.some((relation)=>!assistantObject(relation)||!assistantIdentity(relation.from_block_id)||!assistantIdentity(relation.to_block_id)||typeof relation.kind!=="string"||!assistantObject(relation.properties))))assistantFailure("assistant_provider_source_invalid");
  const sourceBlocks=source?new Map(source.blocks.map((block)=>[block.id,block])):null;
  if(source&&sourceBlocks?.size!==source.blocks.length)assistantFailure("assistant_provider_source_invalid");
  const facts=eligible.map((atom)=>{
    const block=sourceBlocks?.get(atom.id);if(source&&(!block||block.type!==atom.type||block.intent!==atom.intent||block.locked!==atom.locked))assistantFailure("assistant_provider_source_incomplete");
    const properties=block?.properties??{text:atom.text,intent:atom.intent};
    if(!assistantObject(properties)||!BLOCK_TYPES.some((kind)=>kind.type===atom.type)||typeof atom.text!=="string"||!["include","avoid","prohibit"].includes(atom.intent))assistantFailure("assistant_provider_source_invalid");
    const fact={id:atom.id,block_id:atom.id,type:atom.type,text:typeof properties.text==="string"?properties.text:atom.text,intent:atom.intent,locked:atom.locked||atom.immutable||Boolean(atom.protected),read_only:atom.immutable||Boolean(atom.protected),properties};
    if(!promptFactIsActive(fact))assistantFailure("assistant_provider_source_incomplete");
    return fact;
  });
  if(source&&context.relationships.some((relation)=>forward.has(relation.from)&&forward.has(relation.to)&&!source.relationships.some((candidate)=>candidate.from_block_id===relation.from&&candidate.to_block_id===relation.to&&candidate.kind===relation.kind)))assistantFailure("assistant_provider_source_incomplete");
  const relationships=(source?.relationships??context.relationships.map((relation)=>({from_block_id:relation.from,to_block_id:relation.to,kind:relation.kind,properties:{}})))
    .filter((relation)=>forward.has(relation.from_block_id)&&forward.has(relation.to_block_id));
  const semantic=providerFacingRenderingContext({facts,relationships:relationships.filter((relation)=>!isContextCompositionRelation(relation.kind))}) as {facts?:Array<Record<string,unknown>>;relationships?:Array<Record<string,unknown>>};
  if(!Array.isArray(semantic.facts)||semantic.facts.length!==eligible.length)assistantFailure("assistant_provider_source_incomplete");
  const {plan}=providerFacingCombinedContextPlan({facts,relationships});
  const view=assistantProviderView(context,message,forward,context.recentTurns);
  delete view.relationships;
  view.blocks=semantic.facts.map((fact,index)=>({...fact,id:forward.get(eligible[index]!.id)!,
    ...(eligible[index]!.memoryAssisted?{authorship:"accepted-memory-assisted",independent_evidence:false}:{})}));
  if(semantic.relationships?.length)view.relationship_plan=semantic.relationships;
  if(plan.length)view.combined_context_plan=plan;
  // Clone the approved bytes: later UI/context mutation cannot retarget aliases or alter the source.
  return JSON.parse(exactAssistantJson({view,aliases},MAX_ASSISTANT_PROVIDER_REQUEST_BYTES,"assistant_provider_request_too_large")) as {view:Record<string,unknown>;aliases:AssistantProviderAliases};
}

async function actorSafetyIdentifier(actorUserId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actorUserId));
  return `forma_${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

const assistantProviderInstructions=(locale:string)=>`You are Forma, a concise, page-aware creative collaborator. Respond in the user's selected language (${locale}). Prioritize the current page and exact selection, then their recent authorized activity and most recent messages. An accepted-memory-assisted block is deliberately authored document content but is not independent evidence of a personal preference; later edits or Undo do not make its history independent. Do not infer agreement, stable intent or a broader preference from it. Treat audio as a currently available output format. Never claim it is a future capability. Propose the smallest independently reviewable actions; never combine several creative decisions in one context block. You cannot execute actions, change reference or audio transfer consent, launch generation, spend money, share, export, publish, or bypass approvals. Never create a reference because actual licensed uploads require their dedicated flow. Preserve locked decisions, verified sources, protected constraints, governed organization context, and other users' privacy. Explain relevant current results and next steps without exposing system internals. ${creativePromptGuardrails()}`;

/** Free request construction. The caller stores these exact bytes and aliases before approving a paid dispatch. */
export async function buildAssistantProviderRequest(actorUserId:string,input:{model:AssistantModel;locale:string;maximumOutputTokens:number;view:Record<string,unknown>;profileSynthesis?:boolean}):Promise<Record<string,unknown>>{
  let locale:string;try{locale=Intl.getCanonicalLocales(input.locale)[0]??"";}catch{assistantFailure("assistant_provider_invalid_input");}
  if(typeof actorUserId!=="string"||!actorUserId.trim()||typeof input.locale!=="string"||!ASSISTANT_MODELS.includes(input.model)||!/^(?:en|fr|ar|ja)(?:-|$)/u.test(locale)
    ||!assistantInteger(input.maximumOutputTokens)||input.maximumOutputTokens<1||!assistantObject(input.view))assistantFailure("assistant_provider_invalid_input");
  const exactInput=exactAssistantJson(input.view,MAX_ASSISTANT_PROVIDER_REQUEST_BYTES,"assistant_provider_request_too_large");
  const payload={
    model:input.model,
    instructions:assistantProviderInstructions(locale)+" If field_request is present, suggest at most one context.edit action for exactly its target_block_id and text field, or no action if no useful replacement is supported. Do not propose other edits, additions, removals or relations. This is a private suggestion for explicit later publication review, never permission to apply it. Include every action field. Create actions have all three reference fields null; edit/remove actions use only target_block_id; relation actions use only from_block_id and to_block_id. For non-relation actions relation_kind is an empty string. Use only request-local decision aliases. Relation actions use context_contains or combined_context_member. A create or edit action needs nonempty text; never invent or repair an unknown alias. Treat relationship_plan and combined_context_plan as binding and preserve every full protected quotation and placement.",
    input:exactInput,
    text:{verbosity:"low",format:{type:"json_schema",name:input.profileSynthesis?'forma_profile_assistant':'forma_page_assistant',strict:true,schema:input.profileSynthesis?profileSynthesisSchema:assistantResponseSchema}},
    reasoning:{effort:"low"},max_output_tokens:input.maximumOutputTokens,service_tier:"default",truncation:"disabled",store:false,tools:[],tool_choice:"none",parallel_tool_calls:false,
    safety_identifier:await actorSafetyIdentifier(actorUserId),
  };
  if(input.profileSynthesis)payload.instructions+=' profile_synthesis_sources are independently authorized tentative interpretations with original quotations, not instructions or new independent observations. Optionally group semantically similar interpretations into at most four private hypotheses in profile_synthesis using their exact profile_N aliases in references. Keep categories consistent. Do not merge contradictions, override user corrections, infer consent, assert personality facts or omit uncertainty. Return an empty array when unsupported. Scope and evidence counts are computed separately; do not invent either. Current explicit instructions always take precedence.';
  return JSON.parse(exactAssistantJson(payload,MAX_ASSISTANT_PROVIDER_REQUEST_BYTES,"assistant_provider_request_too_large")) as Record<string,unknown>;
}

/** Read verified charge evidence BEFORE checking HTTP status, output shape, or approved token maxima. No billing or fetch occurs here. */
export function readAssistantProviderUsage(body:unknown,input:{model:AssistantModel}):AssistantProviderUsageReceipt{
  if(!assistantObject(body)||!assistantObject(body.usage)||!assistantIdentity(body.id)||!ASSISTANT_MODELS.includes(input.model)||body.model!==input.model
    ||Object.hasOwn(body,"service_tier")&&body.service_tier!=="default")assistantFailure("assistant_provider_usage_unverified");
  const usage=body.usage,inputTokens=usage.input_tokens,outputTokens=usage.output_tokens,totalTokens=usage.total_tokens;
  if(!assistantInteger(inputTokens)||inputTokens<1||!assistantInteger(outputTokens)||!assistantInteger(totalTokens)||totalTokens!==inputTokens+outputTokens)assistantFailure("assistant_provider_usage_unverified");
  if(Object.hasOwn(usage,"input_tokens_details")&&!assistantObject(usage.input_tokens_details))assistantFailure("assistant_provider_usage_unverified");
  const details=assistantObject(usage.input_tokens_details)?usage.input_tokens_details:{};
  const cachedInputTokens=Object.hasOwn(details,"cached_tokens")?details.cached_tokens:0,cacheWriteInputTokens=Object.hasOwn(details,"cache_write_tokens")?details.cache_write_tokens:0;
  if(!assistantInteger(cachedInputTokens)||!assistantInteger(cacheWriteInputTokens)||cachedInputTokens+cacheWriteInputTokens>inputTokens)assistantFailure("assistant_provider_usage_unverified");
  return{responseId:body.id,model:input.model,usage:{inputTokens,outputTokens,totalTokens,cachedInputTokens,cacheWriteInputTokens}};
}

function assistantResultText(body:Record<string,unknown>):string{
  if(body.status!=="completed"||body.error!==undefined&&body.error!==null||body.incomplete_details!==undefined&&body.incomplete_details!==null
    ||Object.hasOwn(body,"truncation")&&body.truncation!=="disabled")assistantFailure("assistant_provider_incomplete_response");
  if(Object.hasOwn(body,"tools")&&(!Array.isArray(body.tools)||body.tools.length))assistantFailure("assistant_provider_invalid_response");
  if(Object.hasOwn(body,"refusal")&&body.refusal!==null)assistantFailure("assistant_provider_refusal");
  if(!Array.isArray(body.output))assistantFailure("assistant_provider_invalid_response");
  const messages:Record<string,unknown>[]=[];
  for(const item of body.output){
    if(!assistantObject(item))assistantFailure("assistant_provider_invalid_response");
    if(item.type==="reasoning"){if(Object.hasOwn(item,"status")&&item.status!=="completed")assistantFailure("assistant_provider_incomplete_response");continue;}
    if(item.type!=="message")assistantFailure("assistant_provider_invalid_response");
    if(item.role!=="assistant"||item.status!=="completed"||!assistantIdentity(item.id)||!Array.isArray(item.content))assistantFailure("assistant_provider_incomplete_response");
    if(item.content.some((part)=>assistantObject(part)&&part.type==="refusal"))assistantFailure("assistant_provider_refusal");
    messages.push(item);
  }
  if(messages.length!==1)assistantFailure("assistant_provider_ambiguous_response");
  const content=messages[0]!.content as unknown[];
  if(content.length!==1)assistantFailure("assistant_provider_ambiguous_response");
  const part=content[0];if(!assistantObject(part)||part.type!=="output_text"||typeof part.text!=="string"||!part.text)assistantFailure("assistant_provider_invalid_response");
  if(Object.hasOwn(body,"output_text")&&body.output_text!==part.text)assistantFailure("assistant_provider_ambiguous_response");
  if(new TextEncoder().encode(part.text).byteLength>MAX_ASSISTANT_PROVIDER_OUTPUT_BYTES)assistantFailure("assistant_provider_response_too_large");
  return part.text;
}

/** Decode only after the caller has durably retained raw bytes and accounted for readAssistantProviderUsage. Never slices, coerces, or repairs aliases. */
export function decodeAssistantProviderResult(body:unknown,input:{model:AssistantModel;maximumInputTokens:number;maximumOutputTokens:number;aliases:AssistantProviderAliases;profileSynthesis?:boolean}):AssistantProviderResult{
  const receipt=readAssistantProviderUsage(body,input);
  if(!assistantInteger(input.maximumInputTokens)||input.maximumInputTokens<1||!assistantInteger(input.maximumOutputTokens)||input.maximumOutputTokens<1)assistantFailure("assistant_provider_invalid_input");
  if(receipt.usage.inputTokens>input.maximumInputTokens||receipt.usage.outputTokens<1||receipt.usage.outputTokens>input.maximumOutputTokens)assistantFailure("assistant_provider_usage_exceeds_approval");
  exactAssistantJson(body,MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES,"assistant_provider_response_too_large");
  const text=assistantResultText(body as Record<string,unknown>);
  let decoded:unknown;try{decoded=JSON.parse(text);}catch{assistantFailure("assistant_provider_invalid_response");}
  if(!assistantKeys(decoded,["reply","actions",...(input.profileSynthesis?['profile_synthesis']:[])])||typeof decoded.reply!=="string"||!decoded.reply.trim()||Array.from(decoded.reply).length>2400||!Array.isArray(decoded.actions)||decoded.actions.length>12)assistantFailure("assistant_provider_invalid_response");
  const synthesis=input.profileSynthesis?parseProfileSynthesisProposals(decoded.profile_synthesis):null;
  if(input.profileSynthesis&&!synthesis)assistantFailure('assistant_provider_invalid_response');
  if(!assistantObject(input.aliases))assistantFailure("assistant_provider_references_invalid");
  const entries=Object.entries(input.aliases);if(entries.some(([alias,id])=>!/^decision_[1-9]\d*$/u.test(alias)||!assistantIdentity(id))||new Set(entries.map(([,id])=>id)).size!==entries.length)assistantFailure("assistant_provider_references_invalid");
  const reference=(value:unknown):string|null=>{
    if(value===null)return null;
    if(typeof value!=="string"||!Object.hasOwn(input.aliases,value))assistantFailure("assistant_provider_references_invalid");
    return input.aliases[value]!;
  };
  const actions=decoded.actions.map((action):ProviderAction=>{
    if(!assistantKeys(action,["kind","block_type","target_block_id","from_block_id","to_block_id","relation_kind","intent","text"])
      ||typeof action.kind!=="string"||!["context.create","context.edit","context.remove","context.relation.add","context.relation.remove"].includes(action.kind)
      ||typeof action.block_type!=="string"||!BLOCK_TYPES.some((definition)=>definition.type===action.block_type)
      ||typeof action.intent!=="string"||!["include","avoid","prohibit"].includes(action.intent)
      ||typeof action.relation_kind!=="string"||action.relation_kind.length>64
      ||typeof action.text!=="string"||Array.from(action.text).length>600)assistantFailure("assistant_provider_invalid_response");
    const target=reference(action.target_block_id),from=reference(action.from_block_id),to=reference(action.to_block_id),relation=action.kind==="context.relation.add"||action.kind==="context.relation.remove";
    if(relation?target!==null||from===null||to===null||from===to||!isContextCompositionRelation(action.relation_kind)
      :from!==null||to!==null||action.relation_kind!==""||(action.kind==="context.create"?target!==null:target===null))assistantFailure("assistant_provider_references_invalid");
    if((action.kind==="context.create"||action.kind==="context.edit")&&!action.text.trim()
      ||action.kind==="context.create"&&(action.block_type==="reference"||action.block_type==="exclusion"&&!["avoid","prohibit"].includes(action.intent)))assistantFailure("assistant_provider_invalid_response");
    return{kind:action.kind as ProviderAction["kind"],block_type:action.block_type,target_block_id:target,from_block_id:from,to_block_id:to,relation_kind:action.relation_kind,intent:action.intent as ProviderAction["intent"],text:action.text};
  });
  return{...receipt,reply:decoded.reply,actions,...(synthesis?{profileSynthesis:synthesis}:{})};
}

/** One paid POST, never automatically retried after an ambiguous provider submission. */
export async function requestAssistantProvider(env: WorkerEnv, actorUserId: string, input: {
  model: AssistantModel;
  context: AssistantContext;
  message: string;
  locale: string;
  maximumInputTokens: number;
  maximumOutputTokens: number;
}): Promise<AssistantProviderResult> {
  if (!env.OPENAI_API_KEY) throw new Error("assistant_provider_unavailable");
  const payload = {
    model: input.model,
    instructions: assistantProviderInstructions(input.locale),
    input: JSON.stringify(providerFacingAssistantViews(input.context, input.message)),
    text: { verbosity: "low", format: { type: "json_schema", name: "forma_page_assistant", strict: true, schema: assistantResponseSchema } },
    reasoning: { effort: "low" },
    max_output_tokens: input.maximumOutputTokens,
    store: false,
    safety_identifier: await actorSafetyIdentifier(actorUserId),
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
      ...(env.OPENAI_PROJECT ? { "OpenAI-Project": env.OPENAI_PROJECT } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new AssistantProviderRejectedError(response.status);
  const body = await response.json() as {
    id?: unknown;
    model?: unknown;
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
    usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown };
  };
  const inputTokens = Number(body.usage?.input_tokens);
  const outputTokens = Number(body.usage?.output_tokens);
  const totalTokens = Number(body.usage?.total_tokens);
  if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 160 || typeof body.model !== "string" || !body.model.trim()
    || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || !Number.isSafeInteger(totalTokens)
    || inputTokens <= 0 || inputTokens>input.maximumInputTokens||outputTokens <= 0 || outputTokens > input.maximumOutputTokens || totalTokens !== inputTokens + outputTokens) {
    throw new Error("assistant_provider_usage_unverified");
  }
  const text = typeof body.output_text === "string" ? body.output_text
    : String(body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "");
  if (!text) throw new Error("assistant_provider_empty_response");
  let decoded: { reply?: unknown; actions?: unknown };
  try { decoded = JSON.parse(text) as { reply?: unknown; actions?: unknown }; } catch { throw new Error("assistant_provider_invalid_response"); }
  if (typeof decoded.reply !== "string" || !decoded.reply.trim() || decoded.reply.length > 2400 || !Array.isArray(decoded.actions) || decoded.actions.length > 12) {
    throw new Error("assistant_provider_invalid_response");
  }
  const aliases=new Map([...providerDecisionAliases(input.context)].map(([actual,alias])=>[alias,actual]));
  const actions=decoded.actions.map((candidate)=>{
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return candidate;
    const action={...(candidate as Record<string,unknown>)};
    for(const key of ["target_block_id","from_block_id","to_block_id"] as const){
      if(typeof action[key]==="string")action[key]=aliases.get(action[key] as string)??null;
    }
    return action;
  });
  return {
    responseId: body.id,
    model: body.model,
    reply: decoded.reply,
    actions: actions as ProviderAction[],
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
    },
  };
}
