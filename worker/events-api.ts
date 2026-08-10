import { generateCreativeDirection } from "./openai-adapter";
import { loadPrivateContent, releaseBudget, requireConsent, requireUser, reserveBudget, settleBudget, storePrivateContent } from "./pilot-policy";
import { ensureSchema, insertEvent, makeEvent, readEvents, streamHead, uuidV7, type EventRow, type WorkerEnv } from "./runtime";
import { analyzeImageSample, runExtractorEvaluation, type ImageSample } from "../src/model/extractors";
import { briefEligibility, composeReentryBrief } from "../src/model/brief";
import { foldEvents } from "../src/model/events";
import { buildPhase7Index } from "../src/model/indexing";

export type { WorkerEnv } from "./runtime";

type EventInput = { type?: string; payload?: Record<string, unknown>; compensatesEventId?: string | null };

const USER_EVENTS = new Set([
  "ProjectCreated","ProjectRenamed","ProjectStateChanged","DocumentCreated","DocumentRenamed","DocumentForked","BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","ReferenceIngested","RegionPromoted","ExtractionRequested","ChipEdited","GenerationRequested","ObjectViewed","ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectRegenerated","ObjectCritiqued","ObjectExported","SessionOpened","SessionClosed","BriefItemPresented","BriefItemAccepted","BriefItemIgnored","BriefDismissed","EmptyCanvasChosen","PhaseGateReviewed","ComparisonOpened","ProposalAccepted","ProposalRejected","ProposalDeclined","AnnotationAdded","AnnotationRetracted","PreferenceAuthored","PreferenceRevoked","ObservationJudged","IntentDeclared","Deferred","ConditionSet","ConditionFired","Resurfaced","AddedToLibrary","RemovedFromLibrary","CollectionCreated","CollectionRenamed","CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved","FactRetracted","ClaimSuperseded","RightsAsserted",
]);
const PRODUCER_EVENTS: Record<string, Set<string>> = {
  "worker:compiler": new Set(["ContextCompiled"]),
  "worker:generator": new Set(["GenerationCompleted","GenerationFailed"]),
  "worker:extractor": new Set(["ExtractionCompleted","ExtractionFailed","ExtractionSuperseded","ExtractorEvaluationCompleted"]),
  "worker:brief": new Set(["BriefComposed"]),
  "worker:taste": new Set(["TasteModelVersioned"]),
  "worker:validator": new Set(["ValidationFailed"]),
  "worker:registry": new Set(["ModelRegistered","AdapterVersioned","CapabilityDeclared"]),
  "worker:indexer": new Set(["FamilyDeclared","FamilyAnchorSet","FamilyMembershipAsserted"]),
  "worker:scheduler": new Set(["BranchAbandoned"]),
  "worker:attribution": new Set(["AttributionComputed"]),
  "worker:annotator": new Set(["AnnotationAdded","AnnotationRetracted"]),
  "worker:policy": new Set(["BudgetReserved","BudgetReleased","BudgetExceeded","GenerationUsageRecorded","RetentionSweepCompleted"]),
  "worker:scout": new Set(["ScoutRunStarted","ScoutObserved","ScoutRunCompleted","ScoutBudgetExhausted","GenerationRequested","GenerationCompleted","GenerationFailed"]),
  "model:forma-chat": new Set(["MutationProposed","AssistantReasoned"]),
};
const COMMUTATIVE = new Set(["AnnotationAdded","AnnotationRetracted","ComparisonOpened","ObjectViewed","ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectRegenerated","ObjectCritiqued","ObjectExported","AddedToLibrary","RemovedFromLibrary","ScoutObserved","FamilyMembershipAsserted"]);
const HOT_EVENTS = new Set(["AnnotationAdded","ComparisonOpened","ObjectViewed","ObjectPinned"]);
const PERMISSION_SCHEMA_VERSION = 1;

const canAppend = (actor: string, type: string) => actor === "user" ? USER_EVENTS.has(type) : PRODUCER_EVENTS[actor]?.has(type) ?? false;
async function seedIfEmpty(env:WorkerEnv,streamId:string) {
  if(await streamHead(env,streamId)>0)return; const corr=uuidV7(); const client="seed:lit-studio";
  const specs:Array<[string,string,Record<string,unknown>]> = [
    ["user","ProjectCreated",{project_id:"project-atmosphere",name:"Studio launch",state:"active"}],
    ["user","DocumentCreated",{document_id:"doc-atmosphere",handle:"atmosphere-studies",title:"Atmosphere studies"}],
    ["worker:registry","ModelRegistered",{model_id:"adapter-neutral",provider:"simulation",status:"human-gated"}],
    ["worker:registry","AdapterVersioned",{adapter_id:"adapter-neutral",version:"v0.2",contract_version:1}],
    ["worker:registry","CapabilityDeclared",{model_id:"adapter-neutral",capabilities:["text-to-image-simulation","context-snapshot"]}],
    ["user","SessionOpened",{session_id:"session-today",snapshot_ref:null}],
    ["user","BlockCreated",{block_id:"block-direction",type:"direction",handle:"direction/nocturne",properties:{text:"A quiet interior that feels held between dusk and night.",weight:.92,authority:"authored"},position:"a0"}],
    ["user","ReferenceIngested",{reference_id:"ref-window-light",source_type:"upload",source_ref:"seed://window-light",content_hash:"seed-window-light",rights_class:"owned"}],
    ["user","BlockCreated",{block_id:"block-reference",type:"reference",handle:"reference/window-light",properties:{reference_id:"ref-window-light",label:"Window light",weight:.78,authority:"authored"},position:"a1"}],
    ["user","BlockCreated",{block_id:"block-palette",type:"palette",handle:"palette/dusk-warm",properties:{colors:["#27252B","#E9A073","#E8D7BD","#8A6571"],weight:.84,authority:"inferred",confidence:.86},position:"a2"}],
    ["worker:extractor","ExtractionCompleted",{block_id:"block-palette",extractor_name:"palette-kmeans-v1",chips:[{chip_id:"chip-palette",property:"colors",value:["#27252B","#E9A073","#E8D7BD","#8A6571"],confidence:.86}]}],
    ["user","CollectionCreated",{collection_id:"collection-studio",handle:"studio-launch",parent_collection_id:null,source_claim_ref:null,position:"a0"}],
    ["user","CollectionCreated",{collection_id:"collection-client",handle:"client-work",parent_collection_id:null,source_claim_ref:null,position:"a1"}],
    ["user","CollectionCreated",{collection_id:"collection-acme",handle:"acme",parent_collection_id:"collection-client",source_claim_ref:null,position:"a0"}],
    ["user","CollectionItemAdded",{collection_id:"collection-studio",item_ref:{document_id:"doc-atmosphere"},position:"a0"}],
    ["worker:indexer","FamilyDeclared",{family_id:"family-warm-nocturnes",label:"Warm nocturnes",confidence:.81,evidence_refs:["event:11"]}],
    ["worker:compiler","ContextCompiled",{generation_id:"generation-01",model_id:"adapter-neutral",adapter_version:"v0.2",compiled_snapshot:{facts:["direction/nocturne","reference/window-light","palette/dusk-warm"],pins:["block-direction"],tail:[],as_of:{head:16,lag:0}},source_block_versions:[{block_id:"block-direction",version:1},{block_id:"block-reference",version:1},{block_id:"block-palette",version:1}]}],
    ["worker:generator","GenerationCompleted",{generation_id:"generation-01",model_id:"adapter-neutral",object_ids:["object-nocturne-01"],latency_ms:1820,variant:0}],
    ["worker:compiler","ContextCompiled",{generation_id:"generation-02",model_id:"adapter-neutral",adapter_version:"v0.2",compiled_snapshot:{facts:["direction/nocturne","reference/window-light","palette/dusk-warm"],pins:["block-direction"],tail:[],as_of:{head:18,lag:0}},source_block_versions:[{block_id:"block-direction",version:1},{block_id:"block-reference",version:1},{block_id:"block-palette",version:1}]}],
    ["worker:generator","GenerationCompleted",{generation_id:"generation-02",model_id:"adapter-neutral",object_ids:["object-nocturne-02"],latency_ms:1450,variant:1}],
    ["user","ObjectPinned",{object_id:"object-nocturne-01",scope:"project"}],
    ["user","ComparisonOpened",{object_ids:["object-nocturne-01","object-nocturne-02"],source_surface:"studio"}],
    ["user","ConditionSet",{condition_id:"condition-palette-3",condition_ref:"three-new-generations",scope:"project"}],
  ];
  const rows=specs.map(([actor,type,payload],i)=>makeEvent(streamId,i+1,actor,client,corr,type,payload)); await env.DB.batch(rows.map(e=>insertEvent(env,e)));
}

type CollectionState={parents:Map<string,string|null>;handles:Map<string,{handle:string;removed:boolean}>;membership:Map<string,string>};
function collectionState(events:EventRow[]):CollectionState{const parents=new Map<string,string|null>(),handles=new Map<string,{handle:string;removed:boolean}>(),membership=new Map<string,string>();for(const e of events){const p=e.payload;if(e.type==="CollectionCreated"){const id=String(p.collection_id);parents.set(id,p.parent_collection_id?String(p.parent_collection_id):null);handles.set(id,{handle:String(p.handle??""),removed:false});}else if(e.type==="CollectionRenamed"){const c=handles.get(String(p.collection_id));if(c)c.handle=String(p.new_handle??c.handle);}else if(e.type==="CollectionRemoved"||e.type==="CollectionRestored"){const c=handles.get(String(p.collection_id));if(c)c.removed=e.type==="CollectionRemoved";}else if(e.type==="CollectionItemAdded"||e.type==="CollectionItemMoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.collection_id??"");const target=String(e.type==="CollectionItemMoved"?p.to_collection_id:p.collection_id);if(id)membership.set(id,target);if(ref.collection_id)parents.set(String(ref.collection_id),target);}else if(e.type==="CollectionItemRemoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.collection_id??"");membership.delete(id);if(ref.collection_id)parents.set(String(ref.collection_id),null);}}return{parents,handles,membership};}
function cycle(id:string,target:string,parents:Map<string,string|null>){let cursor:string|null|undefined=target;const seen=new Set<string>();while(cursor){if(cursor===id||seen.has(cursor))return true;seen.add(cursor);cursor=parents.get(cursor);}return false;}
function validateCollection(item:EventInput,state:CollectionState){const p=item.payload??{};if(item.type==="CollectionCreated"){const id=String(p.collection_id??""),handle=String(p.handle??"").trim(),parent=p.parent_collection_id?String(p.parent_collection_id):null;if(!id||!handle)return"collection_id_and_handle_required";if(state.handles.has(id))return"collection_id_exists";if(parent&&!state.handles.has(parent))return"parent_not_found";if([...state.handles].some(([eid,v])=>eid!==id&&!v.removed&&v.handle===handle&&state.parents.get(eid)===parent))return"sibling_handle_collision";state.parents.set(id,parent);state.handles.set(id,{handle,removed:false});}if(item.type==="CollectionItemAdded"||item.type==="CollectionItemMoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.collection_id??""),target=String(item.type==="CollectionItemMoved"?p.to_collection_id:p.collection_id);if(!id||!target||!state.handles.has(target))return"valid_item_and_target_required";if(item.type==="CollectionItemAdded"&&state.membership.has(id))return"item_already_filed";if(ref.collection_id&&cycle(id,target,state.parents))return"collection_cycle";state.membership.set(id,target);if(ref.collection_id)state.parents.set(id,target);}return null;}

export async function handleEvents(request:Request,env:WorkerEnv,hot=false):Promise<Response>{
  try{
    await ensureSchema(env);const auth=await requireUser(request,env,request.method==="GET"?"viewer":"creator");if(auth.response||!auth.user)return auth.response!;const {userId:ownerId,streamId}=auth.user;await seedIfEmpty(env,streamId);
    if(request.method==="GET"){const events=await readEvents(env,streamId);return Response.json({events,content:await loadPrivateContent(env,ownerId),head:events.at(-1)?.sequence??0,permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});}
    if(request.method!=="POST")return new Response("Method not allowed",{status:405});
    const consent=requireConsent(auth.user);if(consent)return consent;
    const body=await request.json() as {action?:"append"|"batch"|"propose"|"generate"|"hot"|"evaluate_extractors"|"rebuild_index"|"extract_reference"|"open_session"|"close_session"|"compose_brief"|"declare_intent";event?:EventInput;events?:EventInput[];expectedSequence?:number;clientId?:string;correlationId?:string;prompt?:string;exemplarRefs?:Array<Record<string,unknown>>;snapshot?:Record<string,unknown>;sourceBlockVersions?:Array<Record<string,unknown>>;blockId?:string;referenceId?:string;sample?:ImageSample;statement?:string;deadline?:string|null};
    const current=await streamHead(env,streamId),client=body.clientId||"web:lit",corr=body.correlationId||uuidV7();const requested=body.action==="batch"||hot?body.events??(body.event?[body.event]:[]):body.event?[body.event]:[];
    if(hot&&!requested.every(e=>HOT_EVENTS.has(e.type??"")))return Response.json({error:"hot_path_accepts_commutative_engagement_only"},{status:400});
    const commutative=requested.length>0&&requested.every(e=>COMMUTATIVE.has(e.type??""));
    if(typeof body.expectedSequence==="number"&&body.expectedSequence!==current&&body.action!=="propose"&&!commutative)return Response.json({error:"stale_sequence",expected:body.expectedSequence,head:current},{status:409});
    if(body.action==="propose"){
      const stored=await storePrivateContent(env,ownerId,"prompt",body.prompt??"");
      const proposal=makeEvent(streamId,current+1,"model:forma-chat",client,corr,"MutationProposed",{content_ref:stored.contentId,content_expires_at:stored.expiresAt,proposed_events:body.events??[],exemplar_refs:body.exemplarRefs??[],expected_sequence:current});await insertEvent(env,proposal).run();return Response.json({appended:[proposal],rejected:[],head:proposal.sequence});
    }
    if(body.action==="generate"){
      if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
      const reserved=32_000;const reservation=await reserveBudget(env,ownerId,reserved);if(!reservation.ok){const denied=makeEvent(streamId,current+1,"worker:policy",client,corr,"BudgetExceeded",{reason:"hard_cap_reached",scope:reservation.scope,reserved_tokens:0});await insertEvent(env,denied).run();return Response.json({error:"budget_hard_cap_reached",scope:reservation.scope},{status:429});}
      const id=uuidV7();const model=env.OPENAI_MODEL??"gpt-5.6-terra";
      const requestedAt=makeEvent(streamId,current+1,"user",client,corr,"GenerationRequested",{generation_id:id,stream_id:streamId,model_ids:[model],document_version:current});
      const compiled=makeEvent(streamId,current+2,"worker:compiler",client,corr,"ContextCompiled",{generation_id:id,model_id:model,adapter_version:"openai-responses-v1",compiled_snapshot:body.snapshot??{},source_block_versions:body.sourceBlockVersions??[]},{causationId:requestedAt.eventId});
      const budgeted=makeEvent(streamId,current+3,"worker:policy",client,corr,"BudgetReserved",{generation_id:id,reservation_id:reservation.reservationId,reserved_tokens:reserved,period:new Date().toISOString().slice(0,7)},{causationId:requestedAt.eventId});
      await env.DB.batch([requestedAt,compiled,budgeted].map(e=>insertEvent(env,e)));
      try{
        const generated=await generateCreativeDirection(env,ownerId,body.snapshot??{});const stored=await storePrivateContent(env,ownerId,"provider-output",generated.raw);await settleBudget(env,ownerId,reserved,generated.usage.totalTokens);
        const next=await streamHead(env,streamId);const complete=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationCompleted",{generation_id:id,model_id:generated.model,provider:"openai",provider_response_id:generated.responseId,object_ids:[`object-${id.slice(-8)}`],output_ref:stored.contentId,content_expires_at:stored.expiresAt,latency_ms:generated.latencyMs,variant:(current+1)%4,simulation:false},{causationId:compiled.eventId});
        const usage=makeEvent(streamId,next+2,"worker:policy",client,corr,"GenerationUsageRecorded",{generation_id:id,reservation_id:reservation.reservationId,input_tokens:generated.usage.inputTokens,output_tokens:generated.usage.outputTokens,total_tokens:generated.usage.totalTokens,reserved_tokens:reserved,model_id:generated.model},{causationId:complete.eventId});await env.DB.batch([complete,usage].map(e=>insertEvent(env,e)));return Response.json({appended:[requestedAt,compiled,budgeted,complete,usage],content:{[stored.contentId]:generated.raw},rejected:[],head:usage.sequence,simulation:false});
      }catch(error){await releaseBudget(env,ownerId,reserved);const next=await streamHead(env,streamId);const failed=makeEvent(streamId,next+1,"worker:generator",client,corr,"GenerationFailed",{generation_id:id,model_id:model,error_class:error instanceof Error?error.message:"provider_failed"},{causationId:compiled.eventId});const released=makeEvent(streamId,next+2,"worker:policy",client,corr,"BudgetReleased",{generation_id:id,reservation_id:reservation.reservationId,reserved_tokens:reserved,reason:"generation_failed"},{causationId:failed.eventId});await env.DB.batch([failed,released].map(e=>insertEvent(env,e)));return Response.json({error:error instanceof Error?error.message:"generation_failed",appended:[requestedAt,compiled,budgeted,failed,released],head:released.sequence},{status:502});}
    }
    if(body.action==="evaluate_extractors"){
      if(auth.user.role!=="admin")return Response.json({error:"admin_required"},{status:403});
      const report=runExtractorEvaluation();
      const completed=makeEvent(streamId,current+1,"worker:extractor",client,corr,"ExtractorEvaluationCompleted",{...report,evaluated_at:new Date().toISOString(),gate:"phase-3-a5"});
      await insertEvent(env,completed).run();return Response.json({appended:[completed],rejected:[],head:completed.sequence,report});
    }
    if(body.action==="rebuild_index"){
      if(auth.user.role!=="admin")return Response.json({error:"admin_required"},{status:403});
      const events=await readEvents(env,streamId);const report=buildPhase7Index(events,await loadPrivateContent(env,ownerId));
      const signatures=new Set(events.filter(event=>event.type==="FamilyDeclared").map(event=>String(event.payload.index_signature??"")));
      const corrected=new Set(events.filter(event=>event.type==="ClaimSuperseded").map(event=>String(event.payload.claim_ref??"")));
      const appended:EventRow[]=[];let sequence=current;
      for(const family of report.families.filter(item=>!signatures.has(item.indexSignature))){
        const declared=makeEvent(streamId,++sequence,"worker:indexer",client,corr,"FamilyDeclared",{family_id:family.familyId,label:family.label,confidence:family.confidence,evidence_refs:family.evidenceRefs,embedding_model_id:report.embeddingModelId,embedding_version:report.embeddingVersion,source_head:family.sourceHead,index_signature:family.indexSignature});appended.push(declared);
        appended.push(makeEvent(streamId,++sequence,"worker:indexer",client,corr,"FamilyAnchorSet",{family_id:family.familyId,object_id:family.anchorObjectId,evidence_refs:family.evidenceRefs.slice(0,4),index_signature:family.indexSignature},{causationId:declared.eventId}));
        for(const member of family.members.filter(item=>!corrected.has(item.claimRef)))appended.push(makeEvent(streamId,++sequence,"worker:indexer",client,corr,"FamilyMembershipAsserted",{family_id:family.familyId,object_id:member.objectId,confidence:member.confidence,evidence_refs:member.evidenceRefs,claim_ref:member.claimRef,index_signature:family.indexSignature},{causationId:declared.eventId}));
      }
      if(appended.length)await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:sequence,report:{embeddingModelId:report.embeddingModelId,embeddingVersion:report.embeddingVersion,sourceHead:report.sourceHead,indexedItems:report.items.length,exemplars:report.exemplars.length,families:report.families.length}});
    }
    if(body.action==="extract_reference"){
      if(!body.blockId||!body.referenceId||!body.sample)return Response.json({error:"block_reference_and_sample_required"},{status:400});
      const facts=analyzeImageSample(body.sample);
      const requestedAt=makeEvent(streamId,current+1,"user",client,corr,"ExtractionRequested",{block_id:body.blockId,reference_id:body.referenceId,extractors:["dimensions-v1","palette-kmeans-v1","dominant-edges-v1"]});
      const completed=makeEvent(streamId,current+2,"worker:extractor",client,corr,"ExtractionCompleted",{block_id:body.blockId,reference_id:body.referenceId,extractor_name:"deterministic-image-suite-v1",extractor_versions:["dimensions-v1","palette-kmeans-v1","dominant-edges-v1"],chips:[{chip_id:`chip-${body.blockId}-dimensions`,property:"dimensions",value:facts.dimensions,confidence:facts.confidence.dimensions},{chip_id:`chip-${body.blockId}-palette`,property:"colors",value:facts.palette,confidence:facts.confidence.palette},{chip_id:`chip-${body.blockId}-edges`,property:"dominant_edges",value:facts.dominantEdges,confidence:facts.confidence.dominantEdges}],overall_confidence:facts.confidence.overall,sample_grid:{width:body.sample.gridWidth,height:body.sample.gridHeight}},{causationId:requestedAt.eventId});
      await env.DB.batch([requestedAt,completed].map(event=>insertEvent(env,event)));return Response.json({appended:[requestedAt,completed],rejected:[],head:completed.sequence});
    }
    if(body.action==="close_session"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);
      if(!projection.sessionOpen)return Response.json({error:"no_open_session"},{status:409});
      const closed=makeEvent(streamId,current+1,"user",client,corr,"SessionClosed",{session_id:projection.currentSessionId,snapshot_ref:{head:current,project_id:projection.projectId,document_id:projection.documentId,block_versions:projection.blocks.map(block=>({block_id:block.id,version:block.sourceEvents.length})),output_ids:projection.outputs.map(output=>output.id),collection_ids:projection.collections.map(collection=>collection.id)}});
      await insertEvent(env,closed).run();return Response.json({appended:[closed],rejected:[],head:closed.sequence,eligibility:briefEligibility([...events,closed])});
    }
    if(body.action==="open_session"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);
      if(projection.sessionOpen)return Response.json({error:"session_already_open"},{status:409});
      const sessionId=uuidV7();const opened=makeEvent(streamId,current+1,"user",client,corr,"SessionOpened",{session_id:sessionId,snapshot_ref:projection.lastSession?.snapshot_ref??null});const streamWithOpen=[...events,opened];const briefId=uuidV7();const composition=composeReentryBrief(streamWithOpen,briefId);const appended:EventRow[]=[opened];
      if(composition.eligible&&composition.payload){const brief=makeEvent(streamId,current+2,"worker:brief",client,corr,"BriefComposed",composition.payload,{causationId:opened.eventId});appended.push(brief);for(const item of composition.payload.items){appended.push(makeEvent(streamId,current+appended.length+1,"user",client,corr,"BriefItemPresented",{brief_id:briefId,item_id:item.item_id,rank:item.rank,brief_size:composition.payload.items.length,presentation_mode:"rendered-or-reading-order"},{causationId:brief.eventId}));}}
      await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:appended.at(-1)?.sequence??current,eligibility:composition.eligibility,briefComposed:composition.eligible});
    }
    if(body.action==="compose_brief"){
      const events=await readEvents(env,streamId);const projection=foldEvents(events);if(!projection.sessionOpen)return Response.json({error:"open_session_required"},{status:409});const briefId=uuidV7();const composition=composeReentryBrief(events,briefId);if(!composition.eligible||!composition.payload)return Response.json({error:"brief_not_eligible",eligibility:composition.eligibility},{status:409});
      const brief=makeEvent(streamId,current+1,"worker:brief",client,corr,"BriefComposed",composition.payload);const appended:EventRow[]=[brief];for(const item of composition.payload.items)appended.push(makeEvent(streamId,current+appended.length+1,"user",client,corr,"BriefItemPresented",{brief_id:briefId,item_id:item.item_id,rank:item.rank,brief_size:composition.payload.items.length,presentation_mode:"rendered-or-reading-order"},{causationId:brief.eventId}));await env.DB.batch(appended.map(event=>insertEvent(env,event)));return Response.json({appended,rejected:[],head:appended.at(-1)?.sequence??current,eligibility:composition.eligibility,briefComposed:true});
    }
    if(body.action==="declare_intent"){
      const statement=body.statement?.trim();if(!statement||statement.length>500)return Response.json({error:"intent_statement_required"},{status:400});const stored=await storePrivateContent(env,ownerId,"intent",statement);const intent=makeEvent(streamId,current+1,"user",client,corr,"IntentDeclared",{scope_ref:foldEvents(await readEvents(env,streamId)).documentId,statement_ref:stored.contentId,content_expires_at:stored.expiresAt,deadline:body.deadline??null});await insertEvent(env,intent).run();return Response.json({appended:[intent],rejected:[],head:intent.sequence});
    }
    if(body.action!=="append"&&body.action!=="batch"&&body.action!=="hot"&&!hot)return Response.json({error:"unsupported_action"},{status:400});
    const rejected:Array<{index:number;type:string;reason:string}>=[];const state=collectionState(await readEvents(env,streamId));const valid=requested.filter((item,index)=>{const type=item.type??"";if(!type||!canAppend("user",type)){rejected.push({index,type,reason:"event_not_permitted_for_user"});return false;}if(!item.payload||typeof item.payload!=="object"){rejected.push({index,type,reason:"payload_must_be_object"});return false;}if(type.startsWith("Collection")){const reason=validateCollection(item,state);if(reason){rejected.push({index,type,reason});return false;}}return true;});
    let sequence=current;const appended=valid.map(item=>makeEvent(streamId,++sequence,"user",client,corr,item.type!,item.payload!,{compensatesEventId:item.compensatesEventId}));if(rejected.length)appended.push(makeEvent(streamId,++sequence,"worker:validator",client,corr,"ValidationFailed",{attempted_type:"emit_events",attempted_by:"user",permission_schema_version:PERMISSION_SCHEMA_VERSION,errors:rejected}));if(appended.length)await env.DB.batch(appended.map(e=>insertEvent(env,e)));return Response.json({appended,rejected,head:sequence});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"event_api_failed"},{status:500});}
}
