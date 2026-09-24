import {PLATFORM_PRINCIPAL_WITH_ACCESS_SQL,principalAccessFromRow} from './access-policy.ts';
import { validCreationSearchRequest, type CreationSearchPartition } from '../src/model/creation-search.ts';
import type { WorkerEnv, WorkerExecutionContext } from './runtime.ts';
import { requireUser, requireConsent, type PilotUser } from './pilot-policy.ts';
import { hasCapability } from './principal-request-core.ts';
import { D1CreationSearchIndex, ensureCreationSearchSchema, searchPartitionKey } from './creation-search-index.ts';
import { searchCreationContent, type HydratedCreationCandidate, type CreationSearchAuthority } from './creation-search.ts';
import { configuredCreationLearnedSearch, configuredCreationReranker, creationProviderPermitted, indexCreationLearnedSource, deleteCreationLearnedSources } from './creation-search-providers.ts';
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
    if(p.ownerId!==user.userId||!user.access.capabilities.includes('project.read'))return false;
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
export async function refreshCreationSearchPartition(request:Request,env:WorkerEnv,user:PilotUser,p:Partition,resolveUser=async()=>{const auth=await requireUser(request,env,'viewer',{account:'principal'});return auth.user;}) {
  let active=maintenance.get(env.DB);if(!active){active=new Set();maintenance.set(env.DB,active);}const key=searchPartitionKey(p);if(active.has(key))return;active.add(key);
  try {
    const fresh={user:await resolveUser()};if(!fresh.user||requireConsent(fresh.user)||!await livePartitionAllowed(env,fresh.user,p))return;
    const checkpoint=await env.DB.prepare('SELECT content_version,backfill_cursor,index_version,backfill_complete FROM creation_search_partitions WHERE partition_key=?').bind(key).first<{content_version:string;backfill_cursor:string;index_version:number;backfill_complete:number}>();
    if(!checkpoint)return;
    const before=checkpoint.index_version;
    const sourceVersion=await decisionHash({partition:key,indexVersion:checkpoint.index_version}),context=asContext(p,fresh.user);
    const cursor=checkpoint.content_version===sourceVersion?checkpoint.backfill_cursor:'';
    const lexicalComplete=checkpoint.content_version===sourceVersion&&checkpoint.backfill_complete===1;
    const pendingSemantic=lexicalComplete?await env.DB.prepare("SELECT r.source_id FROM creation_search_records r LEFT JOIN private_content c ON c.content_id=r.content_id WHERE partition_key=? AND tombstone=0 AND (c.content_id IS NULL OR c.redacted_at IS NOT NULL OR c.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day') OR (? IS NOT NULL AND (semantic_revision IS NULL OR semantic_revision<>revision OR semantic_model<>?))) ORDER BY r.source_id LIMIT 32").bind(key,env.STILL_CREATION_SEARCH_MODEL??null,env.STILL_CREATION_SEARCH_MODEL??null).all<{source_id:string}>():null;
    const pendingIds=new Set(pendingSemantic?.results.map(r=>r.source_id)??[]);
    const ready=await env.DB.prepare("SELECT ready.expected FROM creation_search_build_ready ready WHERE ready.partition_key=? AND ready.index_version=? AND NOT EXISTS(SELECT 1 FROM creation_search_builds b LEFT JOIN private_content c ON c.content_id=b.content_id WHERE b.partition_key=ready.partition_key AND b.index_version=ready.index_version AND (c.content_id IS NULL OR c.redacted_at IS NOT NULL OR c.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')))").bind(key,checkpoint.index_version).first<{expected:number}>();
    let records:HydratedCreationCandidate[]=[],expected=ready?.expected??0,hasMore=false;
    if(ready){
      const pages=await env.DB.prepare(`SELECT DISTINCT c.content,b.page_end FROM creation_search_builds b JOIN private_content c ON c.content_id=b.content_id AND c.owner_id=? AND c.kind='creation-search-source' AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE b.partition_key=? AND b.index_version=? AND ${lexicalComplete?"EXISTS(SELECT 1 FROM creation_search_build_members m WHERE m.content_id=b.content_id AND m.source_id IN(SELECT value FROM json_each(?)))":"b.page_end>?"} ORDER BY b.page_end LIMIT ${lexicalComplete?32:1}`).bind(p.ownerId,key,checkpoint.index_version,lexicalComplete?JSON.stringify([...pendingIds]):cursor).all<{content:string;page_end:string}>();
      records=pages.results.flatMap(row=>JSON.parse(row.content) as HydratedCreationCandidate[]);
      if(!lexicalComplete&&pages.results.length)hasMore=!!await env.DB.prepare('SELECT 1 FROM creation_search_builds WHERE partition_key=? AND index_version=? AND page_end>? LIMIT 1').bind(key,checkpoint.index_version,pages.results.at(-1)!.page_end).first();
    }else{
    const history=await readStillHistory(request,env,context?fresh.user:{...fresh.user,streamId:'creative:'+p.ownerId},'creation-index:'+key,context);
    const projection=foldEvents(history.events,Infinity,'',p.projectId);
    const project=projection.projects.find(v=>v.id===p.projectId);if(!project)return;
    const resources=p.projectAccessId?await env.DB.prepare("SELECT resource_kind,resource_id FROM project_resource_scopes WHERE project_access_id=? AND visibility='collaborative_output'").bind(p.projectAccessId).all<{resource_kind:string;resource_id:string}>():undefined;
    const eligible=(kind:string,id:string)=>!resources||resources.results.some(r=>r.resource_kind===kind&&r.resource_id===id);
    const docs=projection.documents.filter(d=>d.projectId===p.projectId&&!d.removed&&eligible('document',d.id));
    const blocks=[...new Map([...projection.blocks,...projection.libraryBlocks].filter(b=>b.projectId===p.projectId&&!b.removed&&eligible('block',b.id)).map(b=>[b.id,b])).values()];
    records=[];
    const add=async(id:string,kind:HydratedCreationCandidate['kind'],title:string,text:string,locations:HydratedCreationCandidate['locations'],version:unknown)=>{const contentHash=await decisionHash({title,text,locations});records.push({id,kind,projectId:p.projectId,custody:p.custody,title,text,locations,contentHash,revision:await decisionHash({version,contentHash})});};
    for(const block of blocks)await add(block.id,'idea',String(block.properties.label??block.handle??''),String(block.properties.text??block.properties.description??''),docs.filter(d=>block.documentId===d.id||block.documentUses?.some(u=>u.documentId===d.id)).map(d=>({documentId:d.id,title:d.title})),block.sourceEvents);
    for(const doc of docs){const content=records.filter(b=>b.kind==='idea'&&b.locations.some(l=>l.documentId===doc.id));await add(doc.id,'document',doc.title,content.map(b=>b.text).join('\n').slice(0,24000),[{documentId:doc.id,title:doc.title}],doc.sourceEvents);}
    await add(project.id,'project',project.name,[project.name,...records.filter(r=>r.kind==='document').map(r=>r.text)].join('\n').slice(0,24000),[{title:project.name}],project.lastSequence);
    records.sort((a,b)=>a.id.localeCompare(b.id));

      expected=records.length;
      const buildScope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
      for(let offset=0;offset<records.length;){
        const chunk:HydratedCreationCandidate[]=[];let bytes=2;while(offset<records.length&&chunk.length<32){const record=records[offset],size=new TextEncoder().encode(JSON.stringify(record)).length+1;if(chunk.length&&bytes+size>750000)break;chunk.push(record);bytes+=size;offset++;}const stored=await preparePrivateContent(env,p.ownerId,'creation-search-source',JSON.stringify(chunk),buildScope);
        await env.DB.batch([...stored.statements,env.DB.prepare('INSERT OR REPLACE INTO creation_search_builds(partition_key,index_version,page_end,content_id) VALUES(?,?,?,?)').bind(key,checkpoint.index_version,chunk.at(-1)!.id,stored.contentId),env.DB.prepare('INSERT OR REPLACE INTO creation_search_build_members(partition_key,index_version,source_id,content_id) SELECT ?,?,value,? FROM json_each(?)').bind(key,checkpoint.index_version,stored.contentId,JSON.stringify(chunk.map(r=>r.id)))]);
      }
      await env.DB.prepare('INSERT OR REPLACE INTO creation_search_build_ready(partition_key,index_version,expected) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?)').bind(key,checkpoint.index_version,expected,key,checkpoint.index_version).run();
      hasMore=records.filter(r=>r.id>cursor).length>32;
    }
    const page=lexicalComplete?records.filter(r=>pendingIds.has(r.id)):records.filter(r=>r.id>cursor).slice(0,32),index=new D1CreationSearchIndex(env.DB,env.STILL_CREATION_SEARCH_MODEL),versioned={...p,contentVersion:sourceVersion,indexVersion:String(checkpoint.index_version)};
    const projectScope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
    for(const record of page){
      const protectedSource=await preparePrivateContent(env,p.ownerId,'creation-search-source',JSON.stringify(record),projectScope);
      await env.DB.batch([...protectedSource.statements,...await index.recordStatements(versioned,record,protectedSource.contentId)]);
      const currentAuth={user:await resolveUser()};
      if(!currentAuth.user||requireConsent(currentAuth.user)||!await livePartitionAllowed(env,currentAuth.user,p))return;
      const providerIndex=await env.DB.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').bind(key).first<{index_version:number}>();if(providerIndex?.index_version!==checkpoint.index_version)return;
      if(providerIndex.index_version!==before)return;
      try{if(await indexCreationLearnedSource(env,versioned,record,AbortSignal.timeout(2500),protectedSource.expiresAt))await env.DB.prepare('UPDATE creation_search_records SET semantic_model=?,semantic_revision=? WHERE partition_key=? AND source_id=? AND revision=?').bind(env.STILL_CREATION_SEARCH_MODEL,record.revision,key,record.id,record.revision).run();}catch{/* Coverage remains lexical-only; Save is unaffected. */}
    }
    const after=await env.DB.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').bind(key).first<{index_version:number}>();
    if(after?.index_version!==before)return;
    const done=lexicalComplete||!hasMore;
    await env.DB.batch([
      env.DB.prepare('UPDATE creation_search_records SET tombstone=1 WHERE partition_key=? AND source_version<>?').bind(key,sourceVersion),
      env.DB.prepare(`UPDATE creation_search_partitions SET content_version=?,expected=?,backfill_cursor=?,backfill_complete=?,invalidated=?,updated_at=? WHERE partition_key=? AND index_version=?`).bind(sourceVersion,expected,lexicalComplete?cursor:page.at(-1)?.id??cursor,Number(done),Number(!done),new Date().toISOString(),key,checkpoint.index_version),
    ]);
    const removed=await env.DB.prepare('SELECT source_id FROM creation_search_records WHERE partition_key=? AND tombstone=1 AND semantic_revision IS NOT NULL LIMIT 64').bind(key).all<{source_id:string}>();
    if(await deleteCreationLearnedSources(env,versioned,removed.results.map(r=>r.source_id)))await env.DB.prepare('UPDATE creation_search_records SET semantic_revision=NULL,semantic_model=NULL WHERE partition_key=? AND tombstone=1 AND source_id IN(SELECT value FROM json_each(?))').bind(key,JSON.stringify(removed.results.map(r=>r.source_id))).run();
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
  await env.DB.batch(partitions.map(p=>env.DB.prepare("INSERT INTO creation_search_jobs(partition_key,actor_user_id,permission_epoch,next_run) VALUES(?,?,?,?) ON CONFLICT(partition_key) DO UPDATE SET actor_user_id=excluded.actor_user_id,permission_epoch=excluded.permission_epoch").bind(searchPartitionKey(p),user.userId,String(user.access.permissionEpoch),new Date().toISOString())));
  // A typing request never awaits a history read or model indexing call.
  for(const p of partitions.filter(v=>v.invalidated||!v.backfillComplete||result.coverage.some(c=>c.projectId===v.projectId&&c.custody===v.custody&&c.expected!==null&&c.lexical<c.expected)||!!env.STILL_CREATION_SEARCH&&creationProviderPermitted(env,v)&&result.coverage.some(c=>c.projectId===v.projectId&&c.custody===v.custody&&c.expected!==null&&c.semantic<c.expected)).slice(0,2))execution?.waitUntil(maintainCreationSearchPartition(request,env,user,p).catch(()=>undefined));
  console.info(JSON.stringify({event:'creation-search',mode:result.mode,partial:result.partial,partitions:result.coverage.length,expected:result.coverage.reduce((n,c)=>n+(c.expected??0),0),lexical:result.coverage.reduce((n,c)=>n+c.lexical,0),semantic:result.coverage.reduce((n,c)=>n+c.semantic,0)}));
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

/** Native scheduled continuation uses canonical principals, never retained request credentials. */
export async function maintainCreationSearchJobs(env:WorkerEnv){
 if(!['1','true'].includes(String(env.STILL_UNIFIED_CREATION_ENABLED??'')))return;
 await ensureCreationSearchSchema(env.DB);
 const now=new Date().toISOString(),lease=new Date(Date.now()+60000).toISOString();
 const jobs=await env.DB.prepare('SELECT * FROM creation_search_jobs WHERE next_run<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_run,partition_key LIMIT 2').bind(now,now).all<{partition_key:string;actor_user_id:string;permission_epoch:string}>();
 for(const job of jobs.results){
  const result=await env.DB.prepare('UPDATE creation_search_jobs SET lease_until=?,attempts=attempts+1 WHERE partition_key=? AND (lease_until IS NULL OR lease_until<?)').bind(lease,job.partition_key,now).run();if(result.meta.changes!==1)continue;
  const resolve=async()=>{const row=await env.DB.prepare(PLATFORM_PRINCIPAL_WITH_ACCESS_SQL).bind(job.actor_user_id).first<Record<string,unknown>>();if(!row)return null;const access=await principalAccessFromRow(row,String(row.role));if(access.identityPolicyDeniedCustody||String(access.permissionEpoch)!==job.permission_epoch)return null;return {userId:String(row.user_id),email:String(row.email),displayName:String(row.display_name),role:row.role,consentVersion:row.consent_version,consentedAt:row.consented_at,streamId:'creative:'+row.user_id,access} as PilotUser;};
  try{
   const user=await resolve();if(!user||requireConsent(user)){await env.DB.prepare('DELETE FROM creation_search_jobs WHERE partition_key=? AND lease_until=?').bind(job.partition_key,lease).run();continue;}
   const {partitions}=await discoverPartitions(env,user);const partition=partitions.find(p=>searchPartitionKey(p)===job.partition_key);
   if(!partition){await env.DB.prepare('DELETE FROM creation_search_jobs WHERE partition_key=? AND lease_until=?').bind(job.partition_key,lease).run();continue;}
   await refreshCreationSearchPartition(new Request('https://creation-maintenance.internal'),env,user,partition,resolve);
   const row=await env.DB.prepare('SELECT invalidated,backfill_complete FROM creation_search_partitions WHERE partition_key=?').bind(job.partition_key).first<{invalidated:number;backfill_complete:number}>();
   await env.DB.prepare('UPDATE creation_search_jobs SET lease_until=NULL,next_run=?,last_error=NULL WHERE partition_key=? AND lease_until=?').bind(new Date(Date.now()+(row?.backfill_complete&&!row.invalidated?600000:0)).toISOString(),job.partition_key,lease).run();
  }catch{await env.DB.prepare("UPDATE creation_search_jobs SET lease_until=NULL,next_run=?,last_error='maintenance_failed' WHERE partition_key=? AND lease_until=?").bind(new Date(Date.now()+60000).toISOString(),job.partition_key,lease).run();}
 }
 await env.DB.batch([
  env.DB.prepare('DELETE FROM creation_search_build_members WHERE NOT EXISTS(SELECT 1 FROM creation_search_partitions p WHERE p.partition_key=creation_search_build_members.partition_key AND p.index_version=creation_search_build_members.index_version)'),
  env.DB.prepare('DELETE FROM creation_search_builds WHERE NOT EXISTS(SELECT 1 FROM creation_search_partitions p WHERE p.partition_key=creation_search_builds.partition_key AND p.index_version=creation_search_builds.index_version)'),
 ]);
 // Erase old derived bodies even when replaced before their retention deadline.
 const obsolete=await env.DB.prepare("SELECT c.content_id FROM private_content c WHERE c.kind='creation-search-source' AND (c.expires_at<=? OR c.redacted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM creation_search_records r WHERE r.content_id=c.content_id AND r.tombstone=0) AND NOT EXISTS(SELECT 1 FROM creation_search_builds b WHERE b.content_id=c.content_id)) LIMIT 64").bind(now).all<{content_id:string}>();
 for(const {content_id:id} of obsolete.results)await env.DB.batch([env.DB.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").bind(id),env.DB.prepare('DELETE FROM private_content_retention_scopes WHERE content_id=?').bind(id),env.DB.prepare('DELETE FROM private_content WHERE content_id=?').bind(id)]);
 console.info(JSON.stringify({event:'creation-search-maintenance',jobs:jobs.results.length,erased:obsolete.results.length,oldestQueuedMs:jobs.results.length?Math.max(0,Date.now()-Date.parse((await env.DB.prepare('SELECT MIN(next_run) AS at FROM creation_search_jobs').first<{at:string}>())?.at??now)):0}));
}
