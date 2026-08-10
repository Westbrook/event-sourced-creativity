export interface WorkerEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
}

type EventInput = { type?: string; payload?: Record<string, unknown>; compensatesEventId?: string | null };
type EventRow = {
  eventId: string; streamId: string; sequence: number; occurredAt: string; recordedAt: string;
  actor: string; clientId: string; correlationId: string; causationId: string | null;
  compensatesEventId: string | null; schemaVersion: number; type: string; payload: Record<string, unknown>;
};

const USER_EVENTS = new Set([
  "ProjectCreated","ProjectRenamed","ProjectStateChanged","DocumentCreated","DocumentForked","BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","ReferenceIngested","RegionPromoted","ExtractionRequested","ChipEdited","GenerationRequested","ObjectViewed","ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectRegenerated","ObjectCritiqued","ObjectExported","SessionOpened","SessionClosed","BriefItemPresented","BriefItemAccepted","BriefItemIgnored","BriefDismissed","EmptyCanvasChosen","ComparisonOpened","ProposalAccepted","ProposalRejected","ProposalDeclined","AnnotationAdded","AnnotationRetracted","PreferenceAuthored","PreferenceRevoked","ObservationJudged","IntentDeclared","Deferred","ConditionSet","ConditionFired","Resurfaced","AddedToLibrary","RemovedFromLibrary","FamilyDeclared","FamilyAnchorSet","FamilyMembershipAsserted","CollectionCreated","CollectionRenamed","CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved","FactRetracted","ClaimSuperseded","RightsAsserted",
]);
const PRODUCER_EVENTS: Record<string, Set<string>> = {
  "worker:compiler": new Set(["ContextCompiled"]),
  "worker:generator": new Set(["GenerationCompleted","GenerationFailed"]),
  "worker:extractor": new Set(["ExtractionCompleted","ExtractionFailed","ExtractionSuperseded"]),
  "worker:brief": new Set(["BriefComposed"]),
  "worker:taste": new Set(["TasteModelVersioned"]),
  "worker:validator": new Set(["ValidationFailed"]),
  "worker:registry": new Set(["ModelRegistered","AdapterVersioned","CapabilityDeclared"]),
  "worker:indexer": new Set(["FamilyDeclared","FamilyAnchorSet","FamilyMembershipAsserted"]),
  "worker:scheduler": new Set(["BranchAbandoned"]),
  "worker:attribution": new Set(["AttributionComputed"]),
  "worker:annotator": new Set(["AnnotationAdded","AnnotationRetracted"]),
  "worker:scout": new Set(["ScoutRunStarted","ScoutObserved","ScoutRunCompleted","ScoutBudgetExhausted","GenerationRequested","GenerationCompleted","GenerationFailed"]),
  "model:forma-chat": new Set(["MutationProposed","AssistantReasoned"]),
};
const COMMUTATIVE = new Set(["AnnotationAdded","AnnotationRetracted","ComparisonOpened","ObjectViewed","ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectRegenerated","ObjectCritiqued","ObjectExported","AddedToLibrary","RemovedFromLibrary","ScoutObserved","FamilyMembershipAsserted"]);
const HOT_EVENTS = new Set(["AnnotationAdded","ComparisonOpened","ObjectViewed","ObjectPinned"]);
const PERMISSION_SCHEMA_VERSION = 1;

const canAppend = (actor: string, type: string) => actor === "user" ? USER_EVENTS.has(type) : PRODUCER_EVENTS[actor]?.has(type) ?? false;
const uuidV7 = () => {
  const time = Date.now().toString(16).padStart(12,"0"); const bytes = crypto.getRandomValues(new Uint8Array(10)); const hex = Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""); const variant=((bytes[4]&0x3f)|0x80).toString(16).padStart(2,"0");
  return `${time.slice(0,8)}-${time.slice(8)}-7${hex.slice(0,3)}-${variant}${hex.slice(5,7)}-${hex.slice(7,19)}`;
};
const identity = (request: Request) => { const ownerId=request.headers.get("oai-authenticated-user-id")??"local-creative"; return {ownerId,streamId:`creative:${ownerId}`}; };

async function ensureSchema(env: WorkerEnv) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_stream_sequence ON events(stream_id, sequence)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_type ON events(stream_id, type)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_actor ON events(stream_id, actor)"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS external_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_external_content_owner ON external_content(owner_id)"),
  ]);
}

function makeEvent(streamId:string,sequence:number,actor:string,clientId:string,correlationId:string,type:string,payload:Record<string,unknown>,options:{causationId?:string|null;compensatesEventId?:string|null}={}):EventRow {
  const now=new Date().toISOString(); return {eventId:uuidV7(),streamId,sequence,occurredAt:now,recordedAt:now,actor,clientId,correlationId,causationId:options.causationId??null,compensatesEventId:options.compensatesEventId??null,schemaVersion:1,type,payload};
}
const insert = (env:WorkerEnv,e:EventRow) => env.DB.prepare(`INSERT INTO events (event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(e.eventId,e.streamId,e.sequence,e.occurredAt,e.recordedAt,e.actor,e.clientId,e.correlationId,e.causationId,e.compensatesEventId,e.schemaVersion,e.type,JSON.stringify(e.payload));
async function head(env:WorkerEnv,streamId:string){const row=await env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(streamId).first<{head:number}>();return Number(row?.head??0);}
function serialize(row:Record<string,unknown>):EventRow{return{eventId:String(row.event_id),streamId:String(row.stream_id),sequence:Number(row.sequence),occurredAt:String(row.occurred_at),recordedAt:String(row.recorded_at),actor:String(row.actor),clientId:String(row.client_id),correlationId:String(row.correlation_id),causationId:row.causation_id?String(row.causation_id):null,compensatesEventId:row.compensates_event_id?String(row.compensates_event_id):null,schemaVersion:Number(row.schema_version),type:String(row.type),payload:JSON.parse(String(row.payload)) as Record<string,unknown>};}
async function readEvents(env:WorkerEnv,streamId:string){const result=await env.DB.prepare("SELECT * FROM events WHERE stream_id=? ORDER BY sequence ASC LIMIT 2000").bind(streamId).all<Record<string,unknown>>();return result.results.map(serialize);}

async function seedIfEmpty(env:WorkerEnv,streamId:string) {
  if(await head(env,streamId)>0)return; const corr=uuidV7(); const client="seed:lit-studio";
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
    ["worker:brief","BriefComposed",{brief_id:"brief-today",session_id:"session-today",items:[{item_id:"item-comparison",item_type:"comparison",ref_id:"object-nocturne-01",rank:1,rationale_ref:"event:22"},{item_id:"item-palette",item_type:"thread",ref_id:"palette/dusk-warm",rank:2,rationale_ref:"event:11"}]}],
    ["user","BriefItemPresented",{brief_id:"brief-today",item_id:"item-comparison"}],
    ["user","ConditionSet",{condition_id:"condition-palette-3",condition_ref:"three-new-generations",scope:"project"}],
  ];
  const rows=specs.map(([actor,type,payload],i)=>makeEvent(streamId,i+1,actor,client,corr,type,payload)); await env.DB.batch(rows.map(e=>insert(env,e)));
}

type CollectionState={parents:Map<string,string|null>;handles:Map<string,{handle:string;removed:boolean}>;membership:Map<string,string>};
function collectionState(events:EventRow[]):CollectionState{const parents=new Map<string,string|null>(),handles=new Map<string,{handle:string;removed:boolean}>(),membership=new Map<string,string>();for(const e of events){const p=e.payload;if(e.type==="CollectionCreated"){const id=String(p.collection_id);parents.set(id,p.parent_collection_id?String(p.parent_collection_id):null);handles.set(id,{handle:String(p.handle??""),removed:false});}else if(e.type==="CollectionRenamed"){const c=handles.get(String(p.collection_id));if(c)c.handle=String(p.new_handle??c.handle);}else if(e.type==="CollectionRemoved"||e.type==="CollectionRestored"){const c=handles.get(String(p.collection_id));if(c)c.removed=e.type==="CollectionRemoved";}else if(e.type==="CollectionItemAdded"||e.type==="CollectionItemMoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.collection_id??"");const target=String(e.type==="CollectionItemMoved"?p.to_collection_id:p.collection_id);if(id)membership.set(id,target);if(ref.collection_id)parents.set(String(ref.collection_id),target);}else if(e.type==="CollectionItemRemoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.collection_id??"");membership.delete(id);if(ref.collection_id)parents.set(String(ref.collection_id),null);}}return{parents,handles,membership};}
function cycle(id:string,target:string,parents:Map<string,string|null>){let cursor:string|null|undefined=target;const seen=new Set<string>();while(cursor){if(cursor===id||seen.has(cursor))return true;seen.add(cursor);cursor=parents.get(cursor);}return false;}
function validateCollection(item:EventInput,state:CollectionState){const p=item.payload??{};if(item.type==="CollectionCreated"){const id=String(p.collection_id??""),handle=String(p.handle??"").trim(),parent=p.parent_collection_id?String(p.parent_collection_id):null;if(!id||!handle)return"collection_id_and_handle_required";if(state.handles.has(id))return"collection_id_exists";if(parent&&!state.handles.has(parent))return"parent_not_found";if([...state.handles].some(([eid,v])=>eid!==id&&!v.removed&&v.handle===handle&&state.parents.get(eid)===parent))return"sibling_handle_collision";state.parents.set(id,parent);state.handles.set(id,{handle,removed:false});}if(item.type==="CollectionItemAdded"||item.type==="CollectionItemMoved"){const ref=(p.item_ref??{}) as Record<string,unknown>;const id=String(ref.document_id??ref.collection_id??""),target=String(item.type==="CollectionItemMoved"?p.to_collection_id:p.collection_id);if(!id||!target||!state.handles.has(target))return"valid_item_and_target_required";if(item.type==="CollectionItemAdded"&&state.membership.has(id))return"item_already_filed";if(ref.collection_id&&cycle(id,target,state.parents))return"collection_cycle";state.membership.set(id,target);if(ref.collection_id)state.parents.set(id,target);}return null;}

export async function handleEvents(request:Request,env:WorkerEnv,hot=false):Promise<Response>{
  try{
    await ensureSchema(env);const {ownerId,streamId}=identity(request);await seedIfEmpty(env,streamId);
    if(request.method==="GET"){const events=await readEvents(env,streamId);return Response.json({events,head:events.at(-1)?.sequence??0,permissionSchemaVersion:PERMISSION_SCHEMA_VERSION});}
    if(request.method!=="POST")return new Response("Method not allowed",{status:405});
    const body=await request.json() as {action?:"append"|"batch"|"propose"|"generate"|"hot";event?:EventInput;events?:EventInput[];expectedSequence?:number;clientId?:string;correlationId?:string;prompt?:string;snapshot?:Record<string,unknown>;sourceBlockVersions?:Array<Record<string,unknown>>};
    const current=await head(env,streamId),client=body.clientId||"web:lit",corr=body.correlationId||uuidV7();const requested=body.action==="batch"||hot?body.events??(body.event?[body.event]:[]):body.event?[body.event]:[];
    if(hot&&!requested.every(e=>HOT_EVENTS.has(e.type??"")))return Response.json({error:"hot_path_accepts_commutative_engagement_only"},{status:400});
    const commutative=requested.length>0&&requested.every(e=>COMMUTATIVE.has(e.type??""));
    if(typeof body.expectedSequence==="number"&&body.expectedSequence!==current&&body.action!=="propose"&&!commutative)return Response.json({error:"stale_sequence",expected:body.expectedSequence,head:current},{status:409});
    if(body.action==="propose"){
      const contentId=uuidV7();await env.DB.prepare("INSERT INTO external_content (content_id,owner_id,content,created_at) VALUES (?,?,?,?)").bind(contentId,ownerId,body.prompt??"",new Date().toISOString()).run();
      const proposal=makeEvent(streamId,current+1,"model:forma-chat",client,corr,"MutationProposed",{content_ref:contentId,proposed_events:body.events??[],expected_sequence:current});await insert(env,proposal).run();return Response.json({appended:[proposal],rejected:[],head:proposal.sequence});
    }
    if(body.action==="generate"){
      const id=uuidV7();const requestedAt=makeEvent(streamId,current+1,"user",client,corr,"GenerationRequested",{generation_id:id,stream_id:streamId,model_ids:["adapter-neutral"],document_version:current});const compiled=makeEvent(streamId,current+2,"worker:compiler",client,corr,"ContextCompiled",{generation_id:id,model_id:"adapter-neutral",adapter_version:"v0.2",compiled_snapshot:body.snapshot??{},source_block_versions:body.sourceBlockVersions??[]},{causationId:requestedAt.eventId});const complete=makeEvent(streamId,current+3,"worker:generator",client,corr,"GenerationCompleted",{generation_id:id,model_id:"adapter-neutral",object_ids:[`object-${id.slice(-8)}`],latency_ms:900+((current*83)%1400),variant:(current+1)%4,simulation:true},{causationId:compiled.eventId});await env.DB.batch([requestedAt,compiled,complete].map(e=>insert(env,e)));return Response.json({appended:[requestedAt,compiled,complete],rejected:[],head:complete.sequence,simulation:true});
    }
    if(body.action!=="append"&&body.action!=="batch"&&body.action!=="hot"&&!hot)return Response.json({error:"unsupported_action"},{status:400});
    const rejected:Array<{index:number;type:string;reason:string}>=[];const state=collectionState(await readEvents(env,streamId));const valid=requested.filter((item,index)=>{const type=item.type??"";if(!type||!canAppend("user",type)){rejected.push({index,type,reason:"event_not_permitted_for_user"});return false;}if(!item.payload||typeof item.payload!=="object"){rejected.push({index,type,reason:"payload_must_be_object"});return false;}if(type.startsWith("Collection")){const reason=validateCollection(item,state);if(reason){rejected.push({index,type,reason});return false;}}return true;});
    let sequence=current;const appended=valid.map(item=>makeEvent(streamId,++sequence,"user",client,corr,item.type!,item.payload!,{compensatesEventId:item.compensatesEventId}));if(rejected.length)appended.push(makeEvent(streamId,++sequence,"worker:validator",client,corr,"ValidationFailed",{attempted_type:"emit_events",attempted_by:"user",permission_schema_version:PERMISSION_SCHEMA_VERSION,errors:rejected}));if(appended.length)await env.DB.batch(appended.map(e=>insert(env,e)));return Response.json({appended,rejected,head:sequence});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"event_api_failed"},{status:500});}
}
