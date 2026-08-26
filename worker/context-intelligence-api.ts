import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";
import { ASSISTANT_MODELS, assistantModelCostMicrousd, selectAssistantModel, type AssistantModel } from "../src/model/assistant-model-policy.ts";
import { BLOCK_TYPES, isBlockKind } from "../src/model/block-types.ts";
import { ACTION_PARTICIPANT_RELATION, ACTION_REFERENCE_ROLES, isContextCompositionRelation } from "../src/model/combined-context.ts";
import { contextResearchCandidates, createDecompositionPlan, existingResearchSuggestion, newLearnedSuggestion, researchBlockText, type ContextResearchReport } from "../src/model/context-intelligence.ts";
import { creativeContextRightsIssue } from "../src/model/context-health.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { creativePromptGuardrails, promptFactIsActive } from "../src/model/prompt-policy.ts";
import { claimCostBudgetReservation, hasCapability, pilotExecutionAllowance, readAccountBudgets, releaseBudget, releaseCostBudget, requireConsent, requireUser, reserveBudget, reserveCostBudget, settleBudget, settleCostBudget } from "./pilot-policy.ts";
import { readProjectEventPage, readProjectRequestContext } from "./project-access.ts";
import { serializeEvent, uuidV7, type WorkerEnv } from "./runtime.ts";

const PRIVATE_HEADERS={"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"};
/** https://developers.openai.com/api/docs/pricing — $10 / 1,000 web-search calls. */
export const CONTEXT_WEB_SEARCH_CALL_MICROUSD=10_000;
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:PRIVATE_HEADERS});
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clean=(value:unknown,limit=1200)=>String(value??"").trim().slice(0,limit);

const participantSchema={type:"object",additionalProperties:false,required:["handle","role"],properties:{handle:{type:"string",maxLength:96},role:{type:"string",enum:[...ACTION_REFERENCE_ROLES]}}};
const decompositionSchema={type:"object",additionalProperties:false,required:["proposals"],properties:{proposals:{type:"array",maxItems:12,items:{type:"object",additionalProperties:false,required:["type","subtype","label","text","source_excerpt","participants"],properties:{type:{type:"string",enum:BLOCK_TYPES.filter((item)=>item.type!=="reference").map((item)=>item.type)},subtype:{type:"string",maxLength:80},label:{type:"string",maxLength:160},text:{type:"string",maxLength:500},source_excerpt:{type:"string",maxLength:500},participants:{type:"array",maxItems:8,items:participantSchema}}}}}};
const existingSchema={type:"array",maxItems:5,items:{type:"object",additionalProperties:false,required:["existing_alias","reason"],properties:{existing_alias:{type:"string",maxLength:48},reason:{type:"string",maxLength:320}}}};
const researchSchema={type:"object",additionalProperties:false,required:["inferred","related","learned","image_query"],properties:{inferred:existingSchema,related:existingSchema,learned:{type:"array",maxItems:5,items:{type:"object",additionalProperties:false,required:["type","subtype","text","reason","source_url"],properties:{type:{type:"string",enum:BLOCK_TYPES.map((item)=>item.type)},subtype:{type:"string",maxLength:80},text:{type:"string",maxLength:500},reason:{type:"string",maxLength:320},source_url:{type:["string","null"]}}}},image_query:{type:"string",maxLength:160}}};

type CommonsValue={value?:string};
type CommonsPage={title?:string;imageinfo?:Array<{url?:string;thumburl?:string;descriptionurl?:string;mime?:string;extmetadata?:Record<string,CommonsValue>}>};
const plain=(value:unknown)=>String(value??"").replace(/<[^>]*>/gu," ").replace(/&(?:nbsp|amp|quot);|&#0*39;|&apos;/giu," ").replace(/\s+/gu," ").trim();
const trusted=(value:unknown,hostname:string)=>{try{const url=new URL(String(value??""));return url.protocol==="https:"&&url.hostname===hostname&&!url.username&&!url.password?url.toString():null;}catch{return null;}};

/** Image bytes are never imported: users review provenance and explicitly use the existing licensed uploader. */
export async function searchLicensedContextReferences(query:string,fetcher:typeof fetch=fetch){
  const phrase=clean(query,140);if(!phrase)return[];
  const search=new URL("https://commons.wikimedia.org/w/api.php");
  search.search=new URLSearchParams({action:"query",format:"json",origin:"*",generator:"search",gsrnamespace:"6",gsrlimit:"8",gsrsearch:`file:${phrase}`,prop:"imageinfo",iiprop:"url|mime|extmetadata",iiurlwidth:"640",iiextmetadatafilter:"LicenseShortName|LicenseUrl|Artist|Credit|Attribution|UsageTerms"}).toString();
  try{
    const result=await fetcher(search,{headers:{accept:"application/json"}});if(!result.ok)return[];
    const pages=Object.values(record(record(await result.json()).query).pages??{}) as CommonsPage[];
    return pages.flatMap((page)=>{
      const info=page.imageinfo?.[0],image=trusted(info?.thumburl??info?.url,"upload.wikimedia.org"),source=trusted(info?.descriptionurl,"commons.wikimedia.org"),metadata=info?.extmetadata??{};
      const license=plain(metadata.LicenseShortName?.value??metadata.UsageTerms?.value),mime=String(info?.mime??"").toLowerCase();
      if(!image||!source||!license||!["image/jpeg","image/png","image/webp"].includes(mime))return[];
      return[{title:plain(page.title??phrase),imageUrl:image,sourceUrl:source,license,attribution:plain(metadata.Attribution?.value??metadata.Artist?.value??metadata.Credit?.value??"Wikimedia Commons")}];
    }).slice(0,3);
  }catch{return[];}
}

function publicImageQuery(value:unknown,privateTerms:string[]){
  const proposed=clean(value,160);
  if(!proposed||/@|:\/\/|\b(?:sk-|api[_-]?key|bearer)\b/iu.test(proposed))return"";
  const blocked=new Set(privateTerms.flatMap((term)=>term.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[]));
  return(proposed.toLocaleLowerCase().match(/[\p{L}]{2,32}/gu)??[]).filter((term)=>!blocked.has(term)).slice(0,8).join(" ");
}

async function safetyIdentifier(userId:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(userId));
  return`forma_${Array.from(new Uint8Array(digest),(value)=>value.toString(16).padStart(2,"0")).join("").slice(0,32)}`;
}

function safeBlock(block:CreativeBlock,alias:string,distance:number,connected=false){
  return{alias,type:block.type,subtype:clean(block.properties.subtype,80),text:researchBlockText(block).slice(0,650),handle:clean(block.handle,96),intent:clean(block.properties.intent,32),locked:block.locked,distance,already_related:connected};
}

function citations(output:unknown[]){
  const urls=new Set<string>();
  for(const value of output){const item=record(value);for(const content of Array.isArray(item.content)?item.content:[])for(const annotation of Array.isArray(record(content).annotations)?record(content).annotations as unknown[]:[]){const entry=record(annotation);if(entry.type==="url_citation"&&typeof entry.url==="string")urls.add(entry.url);}for(const source of Array.isArray(record(item.action).sources)?record(item.action).sources as unknown[]:[]){const url=record(source).url;if(typeof url==="string")urls.add(url);}}
  return urls;
}

function resolveResearch(input:{target:CreativeBlock;documentId:string;decoded:Record<string,unknown>;aliases:Map<string,CreativeBlock>;existing:CreativeBlock[];alreadyRelated:Set<string>;searchedWeb:boolean;citedUrls:Set<string>;images:Awaited<ReturnType<typeof searchLicensedContextReferences>>}):ContextResearchReport{
  const consumed=new Set<string>();
  const resolve=(area:"inferred"|"related")=>(Array.isArray(input.decoded[area])?input.decoded[area] as unknown[]:[]).flatMap((candidate)=>{
    const row=record(candidate),block=input.aliases.get(clean(row.existing_alias,48));
    if(!block||block.id===input.target.id||input.alreadyRelated.has(block.id)||consumed.has(block.id))return[];
    const suggestion=existingResearchSuggestion({area,block,reason:clean(row.reason,320),documentId:input.documentId});
    if(!suggestion||area==="related"&&suggestion.scope!=="project")return[];
    consumed.add(block.id);return[suggestion];
  }).slice(0,5);
  const inferred=resolve("inferred"),related=resolve("related");
  const learned=(Array.isArray(input.decoded.learned)?input.decoded.learned as unknown[]:[]).flatMap((candidate,index)=>{
    const row=record(candidate),claimed=clean(row.source_url,1000);
    if(!claimed||!input.citedUrls.has(claimed))return[];
    const suggestion=newLearnedSuggestion({id:`learned-${index+1}`,type:row.type,subtype:row.subtype,text:row.text,reason:row.reason,sourceUrl:claimed},input.existing);
    return suggestion?.sourceUrl?[suggestion]:[];
  }).filter((suggestion,index,items)=>items.findIndex((candidate)=>candidate.text.toLocaleLowerCase()===suggestion.text.toLocaleLowerCase())===index);
  const seen=new Set(learned.map((suggestion)=>suggestion.text.toLocaleLowerCase()));
  for(const image of input.images){
    if(learned.length>=5)break;
    const text=image.title.replace(/^File:/iu,"").replace(/\.[a-z0-9]+$/iu,"").replaceAll("_"," ");if(seen.has(text.toLocaleLowerCase()))continue;
    const suggestion=newLearnedSuggestion({id:`learned-image-${learned.length+1}`,type:"reference",subtype:"Pixel",text,reason:clean(input.decoded.image_query,160),sourceUrl:image.sourceUrl,imageUrl:image.imageUrl,license:image.license,attribution:image.attribution},input.existing);
    if(suggestion){learned.push(suggestion);seen.add(text.toLocaleLowerCase());}
  }
  return{blockId:input.target.id,inferred,related,learned:learned.slice(0,5),searchedWeb:input.searchedWeb,query:clean(input.decoded.image_query,160)};
}

export async function handleContextIntelligence(request:Request,env:WorkerEnv,operation:"decompose"|"research"):Promise<Response>{
  if(request.method!=="POST")return response({error:"method_not_allowed"},405);
  const auth=await requireUser(request,env,"viewer",{account:"principal"});if(auth.response||!auth.user)return auth.response??response({error:"authentication_required"},401);
  const principal=auth.user,consent=requireConsent(principal);if(consent)return consent;
  if(!env.OPENAI_API_KEY)return response({error:"provider_not_configured"},503);
  if(!(env.FORMA_ASSISTANT_PROVIDER_USER_IDS??"").split(",").map((value)=>value.trim()).includes(principal.userId))return response({error:"context_provider_denied"},403);
  let body:Record<string,unknown>;try{body=record(await request.json());}catch{return response({error:"invalid_request"},400);}
  const projectId=clean(body.projectId,120),documentId=clean(body.documentId,120),blockId=clean(body.blockId,120);if(!projectId||!documentId||!blockId)return response({error:"context_scope_required"},400);
  const selected=await readProjectRequestContext(request,env,principal);if(selected.response)return selected.response;
  const shared=selected.context,scope=shared?{organizationId:shared.organizationId,projectAccessId:shared.projectAccessId,actorUserId:principal.userId}:undefined;
  const authorized=(user:typeof principal)=>shared?hasCapability(user,"project.author",scope)&&hasCapability(user,"project.output.request",scope):user.access.capabilities.includes("project.author")&&user.access.capabilities.includes("project.output.request");
  if(shared&&projectId!==shared.projectId||!authorized(principal))return response({error:"context_project_denied"},403);
  let events:CreativeEvent[];
  if(shared){
    events=[];let after=0;
    for(;;){
      const page=await readProjectEventPage(env,shared,after,5_000,false);
      events.push(...page.events.filter((event)=>event.type!=="ProjectResourceRestricted"));
      if(!page.hasMore)break;
      if(page.nextAfter<=after)return response({error:"context_project_history_unavailable"},503);
      after=page.nextAfter;
    }
  }else events=(await env.DB.prepare(`SELECT event.*,secret.private_json FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL WHERE event.stream_id=? AND event.type IN(${ASSISTANT_STATE_EVENT_SQL}) ORDER BY event.sequence`).bind(principal.userId,principal.streamId).all<Record<string,unknown>>()).results.map(serializeEvent);
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,documentId,projectId);
  if(projection.projectId!==projectId||!projection.documents.some((document)=>document.id===documentId&&document.projectId===projectId))return response({error:"context_document_denied"},403);
  const target=projection.libraryBlocks.find((block)=>block.id===blockId&&block.projectId===projectId&&!block.removed&&(block.scope==="library"||block.scope==="canvas"||block.documentId===documentId));
  if(!target)return response({error:"context_block_not_found"},404);
  const providerEligible=(block:CreativeBlock)=>{
    if(!promptFactIsActive(block)||creativeContextRightsIssue(block.properties))return false;
    const referenceId=String(block.properties.reference_id??"");if(!referenceId)return true;
    const latest=[...events].reverse().find((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)&&String(event.payload.reference_id??"")===referenceId);
    return Boolean(latest&&["owned","owned_or_licensed","account-generated"].includes(String(latest.payload.rights_class??"")));
  };
  if(target.locked&&operation==="decompose"||target.properties.organization_context_package_binding_id||target.properties.source_evidence_hash||!providerEligible(target))return response({error:"context_block_protected"},403);
  const protectedBlocks=operation==="research"?projection.libraryBlocks.filter((block)=>!block.removed&&block.projectId===projectId&&block.documentId===documentId&&(block.locked||block.type==="exclusion"||["avoid","prohibit"].includes(String(block.properties.intent??"")))):[];
  if(protectedBlocks.some((block)=>!providerEligible(block)||block.properties.source_evidence_hash||block.properties.organization_context_package_binding_id))return response({error:"context_protected_constraints_unavailable"},403);
  if(protectedBlocks.reduce((total,block)=>total+researchBlockText(block).length,0)>8_000)return response({error:"context_protected_constraints_too_large"},413);
  const addedText=clean(body.addedText,1800),addedType=clean(body.addedType,48),sourceText=operation==="decompose"&&addedText?addedText:researchBlockText(target);
  if(addedText&&(!isBlockKind(addedType)||addedType==="reference"))return response({error:"context_added_block_type_invalid"},400);
  if(!sourceText)return response({error:"context_source_empty"},400);
  if(sourceText.length>2_400||typeof body.addedText==="string"&&body.addedText.trim().length>1_800)return response({error:"context_source_too_large"},413);
  if(!(await pilotExecutionAllowance(env,principal.userId,scope)).allowed)return response({error:"pilot_execution_denied"},403);
  const budget=await readAccountBudgets(env,principal.userId,scope?.organizationId),searchCost=operation==="research"?CONTEXT_WEB_SEARCH_CALL_MICROUSD:0;
  const allowed=(env.FORMA_ASSISTANT_ALLOWED_MODELS??"gpt-5.6-luna,gpt-5.6-terra").split(",").map((value)=>value.trim()).filter((value):value is AssistantModel=>ASSISTANT_MODELS.includes(value as AssistantModel));
  const remaining=Math.min(budget.costBudgets.user.remainingMicrousd,budget.costBudgets.workspace.remainingMicrousd)-searchCost;
  const decision=selectAssistantModel("proposal",{allowedModels:allowed,remainingMicrousd:remaining,premiumApproved:false,inputTokens:operation==="research"?12_000:6_000,outputTokens:operation==="research"?2_400:1_800});
  if(decision.blocked||!decision.model)return response({error:"context_budget_unavailable",reason:decision.reason},429);
  const estimate=decision.estimatedMicrousd+searchCost,streamId=shared?`creative:${shared.ownerUserId}`:principal.streamId,correlationId=`context-${operation}:${principal.userId}:${uuidV7()}`,budgetOperation=`context-${operation}:${decision.model}`;
  const token=await reserveBudget(env,principal.userId,decision.inputTokens+decision.outputTokens,{streamId,correlationId,operation:budgetOperation,...(scope?{projectScope:scope}:{})});if(!token.ok)return response({error:"context_token_budget_unavailable"},429);
  const cost=await reserveCostBudget(env,principal.userId,estimate,{maximumMicrousd:estimate,allowUserOverage:false,period:token.period,streamId,correlationId,operation:budgetOperation,...(scope?{projectScope:scope}:{})});
  if(!cost.ok){await releaseBudget(env,principal.userId,token.reservationId,{reason:"context_cost_budget_unavailable"});return response({error:"context_cost_budget_unavailable"},429);}
  if(!await claimCostBudgetReservation(env,principal.userId,cost.reservationId)){await releaseCostBudget(env,principal.userId,cost.reservationId);await releaseBudget(env,principal.userId,token.reservationId,{reason:"context_cost_claim_failed"});return response({error:"context_cost_claim_failed"},409);}
  let dispatched=false,settled=false,knownTokens:number|null=null,knownMicrousd:number|null=null;
  try{
    const ancestors=new Set<string>(),pending=[target.id];
    for(const id of pending)for(const relation of projection.libraryBlockRelations)if(!relation.removed&&isContextCompositionRelation(relation.kind)&&relation.toBlockId===id&&!ancestors.has(relation.fromBlockId)){ancestors.add(relation.fromBlockId);pending.push(relation.fromBlockId);}
    const currentChildren=new Set(projection.libraryBlockRelations.filter((relation)=>!relation.removed&&isContextCompositionRelation(relation.kind)&&relation.fromBlockId===target.id).map((relation)=>relation.toBlockId));
    const alreadyRelated=new Set(projection.libraryBlockRelations.filter((relation)=>!relation.removed&&(relation.fromBlockId===target.id||relation.toBlockId===target.id)).flatMap((relation)=>[relation.fromBlockId,relation.toBlockId]));
    const candidates=contextResearchCandidates(target,projection.libraryBlocks.filter((block)=>!ancestors.has(block.id)&&!currentChildren.has(block.id)&&providerEligible(block)&&!block.locked&&!block.properties.source_evidence_hash),projection.libraryBlockRelations,documentId);
    const ranked=[...candidates.filter((candidate)=>candidate.distance===0).slice(0,25),...candidates.filter((candidate)=>candidate.distance>0).slice(0,5)],aliases=new Map<string,CreativeBlock>([["target",target],...ranked.map((candidate,index)=>[`decision_${index+1}`,candidate.block] as [string,CreativeBlock])]);
    const vocabulary=BLOCK_TYPES.map((item)=>({type:item.type,subtypes:item.subtypes}));
    const payload=operation==="decompose"?{source:{type:addedText&&isBlockKind(addedType)?addedType:target.type,subtype:addedText?"":clean(target.properties.subtype,80),text:sourceText},block_vocabulary:vocabulary}:{target:safeBlock(target,"target",target.scope==="library"?1:0),document_blocks:ranked.filter((candidate)=>candidate.distance===0).map((candidate)=>safeBlock(candidate.block,[...aliases].find(([,block])=>block.id===candidate.block.id)![0],candidate.distance,candidate.connected)),project_blocks:ranked.filter((candidate)=>candidate.distance>0).map((candidate)=>safeBlock(candidate.block,[...aliases].find(([,block])=>block.id===candidate.block.id)![0],candidate.distance,candidate.connected)),protected_constraints:protectedBlocks.map((block)=>({type:block.type,subtype:clean(block.properties.subtype,80),text:researchBlockText(block),intent:clean(block.properties.intent,32),locked:block.locked})),relationships:projection.libraryBlockRelations.flatMap((relation)=>{const from=[...aliases].find(([,block])=>block.id===relation.fromBlockId)?.[0],to=[...aliases].find(([,block])=>block.id===relation.toBlockId)?.[0],role=relation.properties.participant_role;return from&&to?[{from,to,kind:relation.kind,...(relation.kind===ACTION_PARTICIPANT_RELATION&&ACTION_REFERENCE_ROLES.includes(role as typeof ACTION_REFERENCE_ROLES[number])?{participant_role:role}:{})}]:[];}).slice(0,60),block_vocabulary:vocabulary};
    const instructions=operation==="decompose"
      ?`Separate the supplied source text into the smallest independently reusable creative realities. Every source_excerpt MUST be an exact contiguous substring of the source; every substantive word in text and label MUST appear in that source_excerpt. Never infer, embellish, fill gaps, reassign attributes, or add context. Preserve quoted wording and negation. Separate people, objects, locations, emotions, actions, and other explicitly present facets. Action text may reference only people, places, and objects explicitly named in the source as @handle; each participant handle must itself occur in the source. Choose only supplied block types and subtypes. Return no proposal when no honest decomposition exists. ${creativePromptGuardrails()}`
      :`Research this one creative context decision. You MUST use the web search tool exactly once. Search generic public subject descriptors only; never put project names, user names, private prose, internal identifiers, or confidential details into a search query. Inferred proposals MUST choose only existing_alias entries from document_blocks that complete the most expected clearly absent relationship. Related proposals MUST choose only existing_alias entries from project_blocks that the current document is not using. Never invent existing_alias values or rewrite existing decisions. Aim for 2–5 in each area when enough eligible decisions exist; empty categories are valid when they do not. Learned proposals MUST be net-new, specific, creatively useful, grounded in actual web-search evidence, and closely connected to the target or its document relationships. Use exact cited web URLs for source_url; never invent citations. Return a short generic public image_query for freely licensed reference imagery. ${creativePromptGuardrails()}`;
    const providerPayload={model:decision.model,instructions,input:JSON.stringify(payload),text:{verbosity:"low",format:{type:"json_schema",name:operation==="decompose"?"forma_context_decomposition":"forma_context_research",strict:true,schema:operation==="decompose"?decompositionSchema:researchSchema}},reasoning:{effort:"low"},max_output_tokens:decision.outputTokens,store:false,safety_identifier:await safetyIdentifier(principal.userId),...(operation==="research"?{tools:[{type:"web_search",search_context_size:"low"}],tool_choice:"required",max_tool_calls:1,include:["web_search_call.action.sources"]}:{})};
    dispatched=true;
    const result=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,"content-type":"application/json",...(env.OPENAI_PROJECT?{"OpenAI-Project":env.OPENAI_PROJECT}:{})},body:JSON.stringify(providerPayload)});
    if(!result.ok){await releaseCostBudget(env,principal.userId,cost.reservationId);await releaseBudget(env,principal.userId,token.reservationId,{reason:`context_provider_rejected_${result.status}`});settled=true;return response({error:"context_provider_rejected",status:result.status},502);}
    const provider=record(await result.json()),usage=record(provider.usage),inputTokens=Number(usage.input_tokens),outputTokens=Number(usage.output_tokens),totalTokens=Number(usage.total_tokens),output=Array.isArray(provider.output)?provider.output as unknown[]:[];
    const searchCalls=output.filter((item)=>record(item).type==="web_search_call").length;
    if(!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens)||!Number.isSafeInteger(totalTokens)||inputTokens<=0||outputTokens<=0||totalTokens!==inputTokens+outputTokens||!ASSISTANT_MODELS.includes(provider.model as AssistantModel))throw new Error("context_provider_usage_unverified");
    knownTokens=totalTokens;knownMicrousd=assistantModelCostMicrousd(provider.model as AssistantModel,inputTokens,outputTokens)+searchCalls*CONTEXT_WEB_SEARCH_CALL_MICROUSD;
    await settleBudget(env,principal.userId,token.reservationId,knownTokens);await settleCostBudget(env,principal.userId,cost.reservationId,knownMicrousd);settled=true;
    if(inputTokens>decision.inputTokens||outputTokens>decision.outputTokens||knownMicrousd>estimate)return response({error:"context_provider_budget_exceeded"},502);
    if(provider.model!==decision.model||searchCalls!==Number(operation==="research"))return response({error:"context_provider_usage_unverified"},502);
    const text=typeof provider.output_text==="string"?provider.output_text:String(output.flatMap((item)=>Array.isArray(record(item).content)?record(item).content as unknown[]:[]).find((item)=>record(item).type==="output_text")?record(output.flatMap((item)=>Array.isArray(record(item).content)?record(item).content as unknown[]:[]).find((item)=>record(item).type==="output_text")).text??"":"");
    if(!text)throw new Error("context_provider_empty_response");
    let decoded:Record<string,unknown>;try{decoded=record(JSON.parse(text));}catch{throw new Error("context_provider_invalid_response");}
    const stillAuthorized=async()=>{
      const latest=await requireUser(request,env,"viewer",{account:"principal"});
      if(latest.response||!latest.user||latest.user.userId!==principal.userId||latest.user.access.permissionEpoch!==principal.access.permissionEpoch||!authorized(latest.user))return false;
      const latestProject=await readProjectRequestContext(request,env,latest.user);
      return!latestProject.response&&latestProject.context?.projectAccessId===shared?.projectAccessId;
    };
    if(!await stillAuthorized())return response({error:"context_authorization_changed"},403);
    if(operation==="decompose")return response({plan:createDecompositionPlan(target.id,sourceText,decoded.proposals),model:decision.model});
    const query=publicImageQuery(decoded.image_query,[principal.userId,principal.email,principal.displayName,projectId,documentId]),images=query?await searchLicensedContextReferences(query):[];
    if(!await stillAuthorized())return response({error:"context_authorization_changed"},403);
    return response({report:resolveResearch({target,documentId,decoded,aliases,existing:projection.libraryBlocks,alreadyRelated,searchedWeb:true,citedUrls:citations(output),images}),model:decision.model});
  }catch(error){
    if(!settled){if(dispatched){await settleBudget(env,principal.userId,token.reservationId,knownTokens??token.reservedTokens,knownTokens===null?"context_provider_submission_uncertain":"provider_usage_recorded");await settleCostBudget(env,principal.userId,cost.reservationId,knownMicrousd??estimate);}else{await releaseCostBudget(env,principal.userId,cost.reservationId);await releaseBudget(env,principal.userId,token.reservationId,{reason:"context_provider_not_submitted"});}}
    return response({error:error instanceof Error&&/^context_[a-z_]+$/u.test(error.message)?error.message:"context_intelligence_failed"},502);
  }
}
