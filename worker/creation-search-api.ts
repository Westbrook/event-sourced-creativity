import { validCreationSearchRequest, type CreationSearchPartition } from '../src/model/creation-search.ts';
import type { WorkerEnv, WorkerExecutionContext } from './runtime.ts';
import { requireUser, requireConsent, type PilotUser } from './pilot-policy.ts';
import { hasCapability } from './principal-request-core.ts';
import { D1CreationSearchIndex, ensureCreationSearchSchema, searchPartitionKey } from './creation-search-index.ts';
import { searchCreationContent, type HydratedCreationCandidate, type CreationSearchAuthority } from './creation-search.ts';
import { configuredCreationLearnedSearch, configuredCreationReranker, creationProviderPermitted, indexCreationLearnedSource } from './creation-search-providers.ts';
import { captureSceneSourceVersion } from './scene-source-generation.ts';
import { readStillHistory } from './still-history.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import { preparePrivateContent } from './private-content-storage.ts';
import { decisionHash } from './still-decision-store.ts';
import { foldEvents } from '../src/model/events.ts';

type Partition = CreationSearchPartition & {ownerId:string;projectAccessId?:string;organizationId?:string;invalidated:boolean;backfillComplete:boolean};
type PartitionRow={partition_key:string;custody:string;project_id:string;owner_id:string;project_access_id:string|null;content_version:string;index_version:number;invalidated:number;backfill_complete:number};
const privateHeaders={'cache-control':'private, no-store'};
function asContext(p:Partition,user:PilotUser):ProjectRequestContext|undefined {
  if(!p.projectAccessId||!p.organizationId)return;
  return {contextId:'creation-search',organizationId:p.organizationId,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,principalUserId:user.userId,role:'reader',permissions:['project.read'],expiresAt:new Date(Date.now()+60000).toISOString()};
}
async function livePartitionAllowed(env:WorkerEnv,user:PilotUser,p:Partition) {
  if(user.access.permissionEpoch!==p.permissionEpoch)return false;
  if(!p.projectAccessId){
    if(p.ownerId!==user.userId||!hasCapability(user,'project.read'))return false;
    const moved=await env.DB.prepare('SELECT 1 AS present FROM organization_projects WHERE project_id=? AND owner_user_id=? LIMIT 1').bind(p.projectId,user.userId).first();
    return !moved;
  }
  if(!user.access.projects.some(s=>s.projectAccessId===p.projectAccessId&&s.projectId===p.projectId&&s.organizationId===p.organizationId)||!hasCapability(user,'project.read',{organizationId:p.organizationId!,projectAccessId:p.projectAccessId}))return false;
  const row=await env.DB.prepare(`SELECT 1 AS allowed FROM organization_projects project JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active' JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active' JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL WHERE project.project_access_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active' AND(project.owner_user_id=? OR EXISTS(SELECT 1 FROM project_memberships pm WHERE pm.project_access_id=project.project_access_id AND pm.organization_id=project.organization_id AND pm.user_id=? AND pm.project_id=project.project_id AND pm.status='active' AND pm.revoked_at IS NULL))`).bind(user.userId,p.projectAccessId,p.projectId,p.ownerId,user.userId,user.userId).first();
  return !!row;
}
async function discoverPartitions(env:WorkerEnv,user:PilotUser,projectId?:string):Promise<{partitions:Partition[];complete:boolean}> {
  const personal=await env.DB.prepare(`SELECT DISTINCT json_extract(e.payload,'$.project_id') AS project_id FROM events e WHERE e.stream_id=? AND e.type='ProjectCreated' AND json_extract(e.payload,'$.project_id') IS NOT NULL AND (? IS NULL OR json_extract(e.payload,'$.project_id')=?) AND NOT EXISTS(SELECT 1 FROM organization_projects op WHERE op.project_id=json_extract(e.payload,'$.project_id') AND op.owner_user_id=?) ORDER BY project_id LIMIT 65`).bind(user.streamId,projectId??null,projectId??null,user.userId).all<{project_id:string}>();
  const authorizedShared=user.access.projects.filter(p=>!projectId||p.projectId===projectId);
  const sharedIds=authorizedShared.map(p=>p.projectAccessId).slice(0,65);
  const shared=sharedIds.length?await env.DB.prepare(`SELECT project_id,project_access_id,organization_id,owner_user_id FROM organization_projects WHERE project_access_id IN(SELECT value FROM json_each(?)) AND status='active' LIMIT 65`).bind(JSON.stringify(sharedIds)).all<{project_id:string;project_access_id:string;organization_id:string;owner_user_id:string}>():{results:[]};
  const seeds=[...personal.results.map(r=>({projectId:r.project_id,ownerId:user.userId,custody:'personal:'+user.userId})),...shared.results.map(r=>({projectId:r.project_id,ownerId:r.owner_user_id,custody:'project:'+r.organization_id+':'+r.project_access_id,projectAccessId:r.project_access_id,organizationId:r.organization_id}))];
  const partitions:Partition[]=[];
  for(const seed of seeds.slice(0,64)) {
    const p:Partition={...seed,permissionEpoch:user.access.permissionEpoch,contentVersion:'',indexVersion:'0',providerPolicy:creationProviderPermitted(env,seed)?'allowed':'local-only',invalidated:true,backfillComplete:false};
    if(!await livePartitionAllowed(env,user,p))continue;
    await env.DB.prepare(`INSERT OR IGNORE INTO creation_search_partitions(partition_key,custody,project_id,owner_id,project_access_id,updated_at) VALUES(?,?,?,?,?,?)`).bind(searchPartitionKey(p),p.custody,p.projectId,p.ownerId,p.projectAccessId??null,new Date().toISOString()).run();
    const row=await env.DB.prepare('SELECT * FROM creation_search_partitions WHERE partition_key=?').bind(searchPartitionKey(p)).first<PartitionRow>();
    if(row){p.contentVersion=row.content_version;p.indexVersion=String(row.index_version);p.invalidated=row.invalidated===1;p.backfillComplete=row.backfill_complete===1;}
    partitions.push(p);
  }
  return {partitions,complete:seeds.length<=64&&authorizedShared.length<=65};
}
const maintenance = new WeakMap<object,Set<string>>();
/** Resumable 32-record page outside foreground typing. A source change restarts its cursor. */
export async function refreshCreationSearchPartition(request:Request,env:WorkerEnv,user:PilotUser,p:Partition) {
  let active=maintenance.get(env.DB);if(!active){active=new Set();maintenance.set(env.DB,active);}const key=searchPartitionKey(p);if(active.has(key))return;active.add(key);
  try {
    const fresh=await requireUser(request,env,'viewer',{account:'principal'});if(!fresh.user||requireConsent(fresh.user)||!await livePartitionAllowed(env,fresh.user,p))return;
    const checkpoint=await env.DB.prepare('SELECT content_version,backfill_cursor,index_version,backfill_complete FROM creation_search_partitions WHERE partition_key=?').bind(key).first<{content_version:string;backfill_cursor:string;index_version:number;backfill_complete:number}>();
    if(!checkpoint)return;
    const before=await captureSceneSourceVersion(env,{streamId:'creative:'+p.ownerId,...(p.projectAccessId?{projectAccessId:p.projectAccessId}:{})});
    const sourceVersion=await decisionHash(before),context=asContext(p,fresh.user);
    const history=await readStillHistory(request,env,context?fresh.user:{...fresh.user,streamId:'creative:'+p.ownerId},'creation-index:'+key,context);
    const projection=foldEvents(history.events,Infinity,'',p.projectId);
    const project=projection.projects.find(v=>v.id===p.projectId);if(!project)return;
    const docs=projection.documents.filter(d=>d.projectId===p.projectId&&!d.removed);
    const blocks=[...new Map([...projection.blocks,...projection.libraryBlocks].filter(b=>b.projectId===p.projectId&&!b.removed).map(b=>[b.id,b])).values()];
    const records:HydratedCreationCandidate[]=[];
    const add=async(id:string,kind:HydratedCreationCandidate['kind'],title:string,text:string,locations:HydratedCreationCandidate['locations'],version:unknown)=>{const contentHash=await decisionHash({title,text,locations});records.push({id,kind,projectId:p.projectId,custody:p.custody,title,text,locations,contentHash,revision:await decisionHash({version,contentHash})});};
    for(const block of blocks)await add(block.id,'idea',String(block.properties.label??block.handle??''),String(block.properties.text??block.properties.description??''),docs.filter(d=>block.documentId===d.id||block.documentUses?.some(u=>u.documentId===d.id)).map(d=>({documentId:d.id,title:d.title})),block.sourceEvents);
    for(const doc of docs){const content=records.filter(b=>b.kind==='idea'&&b.locations.some(l=>l.documentId===doc.id));await add(doc.id,'document',doc.title,content.map(b=>b.text).join('\n').slice(0,24000),[{documentId:doc.id,title:doc.title}],doc.sourceEvents);}
    await add(project.id,'project',project.name,[project.name,...records.filter(r=>r.kind==='document').map(r=>r.text)].join('\n').slice(0,24000),[{title:project.name}],project.lastSequence);
    records.sort((a,b)=>a.id.localeCompare(b.id));
    const cursor=checkpoint.content_version===sourceVersion?checkpoint.backfill_cursor:'';
    const lexicalComplete=checkpoint.content_version===sourceVersion&&checkpoint.backfill_complete===1;
    const pendingSemantic=lexicalComplete&&env.STILL_CREATION_SEARCH_MODEL?await env.DB.prepare('SELECT source_id FROM creation_search_records WHERE partition_key=? AND tombstone=0 AND (semantic_revision IS NULL OR semantic_revision<>revision OR semantic_model<>?) ORDER BY source_id LIMIT 32').bind(key,env.STILL_CREATION_SEARCH_MODEL).all<{source_id:string}>():null;
    const pendingIds=new Set(pendingSemantic?.results.map(r=>r.source_id)??[]);
    const page=lexicalComplete?records.filter(r=>pendingIds.has(r.id)):records.filter(r=>r.id>cursor).slice(0,32),index=new D1CreationSearchIndex(env.DB,env.STILL_CREATION_SEARCH_MODEL),versioned={...p,contentVersion:sourceVersion,indexVersion:String(checkpoint.index_version)};
    const projectScope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
    for(const record of page){
      const protectedSource=await preparePrivateContent(env,p.ownerId,'creation-search-source',JSON.stringify(record),projectScope);
      await env.DB.batch([...protectedSource.statements,...await index.recordStatements(versioned,record,protectedSource.contentId)]);
      const currentAuth=await requireUser(request,env,'viewer',{account:'principal'});
      if(!currentAuth.user||requireConsent(currentAuth.user)||!await livePartitionAllowed(env,currentAuth.user,p))return;
      const providerIndex=await env.DB.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').bind(key).first<{index_version:number}>();if(providerIndex?.index_version!==checkpoint.index_version)return;
      const providerVersion=await captureSceneSourceVersion(env,{streamId:'creative:'+p.ownerId,...(p.projectAccessId?{projectAccessId:p.projectAccessId}:{})});if(await decisionHash(providerVersion)!==sourceVersion)return;
      try{if(await indexCreationLearnedSource(env,versioned,record,AbortSignal.timeout(2500),protectedSource.expiresAt))await env.DB.prepare('UPDATE creation_search_records SET semantic_model=?,semantic_revision=? WHERE partition_key=? AND source_id=? AND revision=?').bind(env.STILL_CREATION_SEARCH_MODEL,record.revision,key,record.id,record.revision).run();}catch{/* Coverage remains lexical-only; Save is unaffected. */}
    }
    const after=await captureSceneSourceVersion(env,{streamId:'creative:'+p.ownerId,...(p.projectAccessId?{projectAccessId:p.projectAccessId}:{})});
    if(await decisionHash(after)!==sourceVersion)return;
    const done=lexicalComplete||page.length<32||page.at(-1)?.id===records.at(-1)?.id;
    await env.DB.batch([
      env.DB.prepare('UPDATE creation_search_records SET tombstone=1 WHERE partition_key=? AND source_version<>?').bind(key,sourceVersion),
      env.DB.prepare(`UPDATE creation_search_partitions SET content_version=?,expected=?,backfill_cursor=?,backfill_complete=?,invalidated=?,updated_at=? WHERE partition_key=? AND index_version=?`).bind(sourceVersion,records.length,lexicalComplete?cursor:page.at(-1)?.id??cursor,Number(done),Number(!done),new Date().toISOString(),key,checkpoint.index_version),
    ]);
  }finally{active.delete(key);}
}
export async function handleCreationSearch(request:Request,env:WorkerEnv,execution?:WorkerExecutionContext):Promise<Response> {
  if(!['1','true'].includes(String(env.STILL_UNIFIED_CREATION_ENABLED??'')))return Response.json({error:'creation_disabled'},{status:404,headers:privateHeaders});
  if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405,headers:privateHeaders});
  const auth=await requireUser(request,env,'viewer',{account:'principal'});if(auth.response)return auth.response;const user=auth.user!;const consent=requireConsent(user);if(consent)return consent;
  let input:unknown;try{input=await request.json();}catch{return Response.json({error:'invalid_request'},{status:400,headers:privateHeaders});}
  if(!validCreationSearchRequest(input))return Response.json({error:'invalid_request'},{status:400,headers:privateHeaders});
  await ensureCreationSearchSchema(env.DB);
  const draft=await env.DB.prepare(`SELECT destination_json,revision,scope_key FROM creation_drafts WHERE draft_id=? AND actor_user_id=? AND state='active' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(input.draftId,user.userId).first<{destination_json:string;revision:number;scope_key:string}>();
  if(!draft)return Response.json({error:'creation_draft_unavailable'},{status:404,headers:privateHeaders});
  if(draft.revision!==input.draftRevision)return Response.json({error:'creation_revision_conflict',revision:draft.revision},{status:409,headers:privateHeaders});
  const destination=JSON.parse(draft.destination_json) as {entryKind:'project'|'document'|'idea';projectId?:string};
  const {partitions,complete}=await discoverPartitions(env,user,destination.entryKind==='project'?undefined:destination.projectId);
  if(destination.entryKind!=='project'&&!partitions.length)return Response.json({error:'creation_destination_unavailable'},{status:403,headers:privateHeaders});
  const authority:CreationSearchAuthority={
    async authorize(principal,partition){const p=partitions.find(v=>searchPartitionKey(v)===searchPartitionKey(partition));if(!p||principal!==user.userId)return false;const fresh=await requireUser(request,env,'viewer',{account:'principal'});if(!fresh.user||!await livePartitionAllowed(env,fresh.user,p))return false;const row=await env.DB.prepare('SELECT index_version,content_version FROM creation_search_partitions WHERE partition_key=?').bind(searchPartitionKey(p)).first<{index_version:number;content_version:string}>();return !!row&&String(row.index_version)===p.indexVersion&&row.content_version===p.contentVersion;},
    permitsProvider(partition){return creationProviderPermitted(env,partition);},
    async hydrate(principal,partition,hit){
      if(!await this.authorize(principal,partition))return;
      const p=partitions.find(v=>searchPartitionKey(v)===searchPartitionKey(partition))!;
      const row=await env.DB.prepare(`SELECT c.content FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key JOIN private_content c ON c.content_id=r.content_id AND c.owner_id=p.owner_id AND c.kind='creation-search-source' AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE r.partition_key=? AND r.source_id=? AND r.revision=? AND r.content_hash=? AND r.tombstone=0 AND r.source_version=p.content_version AND p.invalidated=0 AND ${p.projectAccessId?`EXISTS(SELECT 1 FROM project_resource_scopes scope JOIN private_content_retention_scopes retention ON retention.content_id=scope.resource_id AND retention.organization_id=scope.organization_id AND retention.project_access_id=scope.project_access_id AND retention.project_id=scope.project_id AND retention.actor_user_id=c.owner_id AND retention.created_at=c.created_at AND retention.assigned_expires_at=c.expires_at AND retention.classification='transient-private' WHERE scope.resource_kind='content' AND scope.resource_id=c.content_id AND scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=p.project_id AND scope.owner_user_id=p.owner_id AND scope.actor_user_id=c.owner_id AND scope.visibility='actor_private')`:`NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE scope.resource_kind='content' AND scope.resource_id=c.content_id) AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=c.content_id)`}`).bind(searchPartitionKey(p),hit.id,hit.revision,hit.contentHash,...(p.projectAccessId?[p.projectAccessId,p.organizationId]:[])).first<{content:string}>();
      if(!row)return;
      const value=JSON.parse(row.content) as HydratedCreationCandidate;
      if(value.id!==hit.id||value.projectId!==p.projectId||value.custody!==p.custody||value.revision!==hit.revision||value.contentHash!==hit.contentHash)return;
      return value;
    },
  };
  const result=await searchCreationContent({principal:user.userId,request:input,entryKind:destination.entryKind,projectId:destination.projectId,partitions,partitionsComplete:complete,index:new D1CreationSearchIndex(env.DB,env.STILL_CREATION_SEARCH_MODEL),authority,learned:configuredCreationLearnedSearch(env),reranker:configuredCreationReranker(env),signal:request.signal});
  // A typing request never awaits a history read or model indexing call.
  for(const p of partitions.filter(v=>v.invalidated||!v.backfillComplete||!!env.STILL_CREATION_SEARCH&&creationProviderPermitted(env,v)&&result.coverage.some(c=>c.projectId===v.projectId&&c.custody===v.custody&&c.expected!==null&&c.semantic<c.expected)).slice(0,2))execution?.waitUntil(maintainCreationSearchPartition(request,env,user,p).catch(()=>undefined));
  return Response.json(result,{headers:privateHeaders});
}

/** Bounded background continuation resumes its durable cursor; it never holds the response open. */
async function maintainCreationSearchPartition(request:Request,env:WorkerEnv,user:PilotUser,p:Partition){
  const started=Date.now();
  for(let pages=0;pages<8&&Date.now()-started<20000;pages++){
    const before=await env.DB.prepare('SELECT backfill_cursor,backfill_complete,index_version FROM creation_search_partitions WHERE partition_key=?').bind(searchPartitionKey(p)).first<{backfill_cursor:string;backfill_complete:number;index_version:number}>();
    await refreshCreationSearchPartition(request,env,user,p);
    const after=await env.DB.prepare('SELECT backfill_cursor,backfill_complete,index_version FROM creation_search_partitions WHERE partition_key=?').bind(searchPartitionKey(p)).first<{backfill_cursor:string;backfill_complete:number;index_version:number}>();
    if(!after||after.backfill_complete===1||JSON.stringify(before)===JSON.stringify(after))break;
  }
}
