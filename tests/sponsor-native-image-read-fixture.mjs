import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sponsorReadFixture} from './sponsor-read-fixture.mjs';
import {outputTestDatabase} from './output-execution-test-helpers.mjs';
import {png} from './sponsor-native-fixture.mjs';

const [{handleGeneratedImageEdit},{getMedia},runtime,{handleSession,POLICY_VERSION},{foldEvents},{imageOutputContextEvents},composition,
  {ownerMediaNamespace},{captureSceneSourceVersion},{SCENE_SOURCE_GENERATION_TABLES},{SCENE_SOURCE_GENERATION_TRIGGERS},
  {SPONSOR_NATIVE_IMAGE_READ_INDEXES},{synchronizeProjectScope}]=await Promise.all([
  import('../worker/generated-image-api.ts'),import('../worker/media-api.ts'),import('../worker/runtime.ts'),
  import('../worker/pilot-policy.ts'),import('../src/model/events.ts'),import('../src/model/output-context.ts'),
  import('../src/model/reference-composition.ts'),import('../src/model/media-ownership.ts'),import('../worker/scene-source-generation.ts'),
  import('../db/scene-source-generation-tables.ts'),import('../db/scene-source-generations.ts'),import('../worker/experience-sponsor-native-image-read.ts'),
  import('../worker/project-access.ts'),
]);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const readPolicy=()=>({version:1,windowMs:60_000,
  operations:Object.fromEntries(['image-status','image-result','image-media'].map(operation=>[operation,{maximumBytes:32_000_000,deadlineMs:10_000}])),
  actor:{maximumRequestsPerWindow:100,maximumBytesPerWindow:3_200_000_000},
  campaign:{maximumRequestsPerWindow:200,maximumBytesPerWindow:6_400_000_000}});
export async function responseJson(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const snapshot=f=>({tables:Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .filter(row=>!['experience_sponsor_read_policies','experience_sponsor_read_attempts'].includes(row.name))
  .map(({name})=>[name,f.sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()])),
media:[...f.media].map(([key,item])=>({key,hash:hash(item.bytes),metadata:item.metadata,contentType:item.contentType})).sort((a,b)=>a.key.localeCompare(b.key))});

async function witness(f){
  for(const definition of [...SCENE_SOURCE_GENERATION_TABLES,...SCENE_SOURCE_GENERATION_TRIGGERS]){
    const row=f.sqlite.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(definition.name);
    if(row)assert.equal(row.sql,definition.sql);else f.sqlite.exec(definition.sql);
  }
  await captureSceneSourceVersion(f.env,{streamId:f.stream});
}
async function ordinaryFixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  Object.assign(f,{actor:'native-read-ordinary',documentId:'native-read-ordinary-document',projectId:'native-read-ordinary-project'});
  f.stream='creative:'+f.actor;f.actorHeaders={'oai-authenticated-user-id':f.actor,'oai-authenticated-user-email':f.actor+'@example.invalid'};
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:f.actorHeaders}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,f.actor);
  await runtime.appendAuditEvent(f.env,f.stream,'user','ProjectCreated',{project_id:f.projectId,name:'Declared local ordinary image'});
  await runtime.appendAuditEvent(f.env,f.stream,'user','DocumentCreated',{project_id:f.projectId,document_id:f.documentId,title:'Declared local ordinary image'});
  return f;
}
async function seedOrdinary(f,{legacyOutputJob=false,legacyCompletionSurface='outputs'}={}){
  const generationId='ordinary-fixture-generation',outputId='ordinary-fixture-output',contentId='ordinary-fixture-content';
  const jobId='ordinary-fixture-job',correlationId='ordinary-fixture-correlation',now=new Date().toISOString();
  const queued=legacyOutputJob?await runtime.appendAuditEvent(f.env,f.stream,'user:'+f.actor,'DocumentJobQueued',{
    project_id:f.projectId,document_id:f.documentId,job_id:jobId,kind:'generate',source_surface:'outputs'},correlationId):null;
  const bytes=png(1024,1024,82),key=ownerMediaNamespace(f.actor)+'/generated/'+generationId+'.png',url='/api/media/'+encodeURIComponent(key);
  await f.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{ownerId:f.actor,sha256:hash(bytes),mimeType:'image/png'}});
  f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'provider-output',?,?,?,NULL)")
    .run(contentId,f.actor,JSON.stringify({title:'Declared synthetic ordinary record',scene:'This fixture is not a provider acceptance claim.'}),new Date().toISOString(),'2099-01-01T00:00:00.000Z');
  const completed=await runtime.appendAuditEvent(f.env,f.stream,'worker:generator','GenerationCompleted',{project_id:f.projectId,document_id:f.documentId,
    object_id:outputId,object_ids:[outputId],generation_id:generationId,output_ref:contentId,media_url:url,media_type:'image/png',
    // Preserve legacy absence of source_surface: native Image custody already
    // accepts this ordinary record, including when the owner also has sponsors.
    source_content_hash:hash(bytes),image_width:1024,image_height:1024,quality:'high',purpose:'final',simulation:false,
    ...(legacyOutputJob&&legacyCompletionSurface!==null?{source_surface:legacyCompletionSurface}:{}),content_expires_at:'2099-01-01T00:00:00.000Z'},correlationId);
  if(legacyOutputJob){
    const row={job_id:jobId,owner_id:f.actor,stream_id:f.stream,document_id:f.documentId,kind:'generate',status:'completed',source_surface:'outputs',
      correlation_id:correlationId,requested_sequence:queued.sequence,request_json:JSON.stringify({documentId:f.documentId,sourceSurface:'outputs'}),
      result_json:JSON.stringify({appendedEventIds:[completed.eventId]}),attempt_count:1,requested_at:now,started_at:now,expires_at:'2099-01-01T00:00:00.000Z',updated_at:now};
    f.sqlite.prepare(`INSERT INTO document_jobs(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  const uploadKey=ownerMediaNamespace(f.actor)+'/ordinary-upload.png';
  await f.env.MEDIA.put(uploadKey,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{ownerId:f.actor,originalName:'ordinary-upload.png'}});
  return {outputId,key,url,bytes,uploadKey,jobId:legacyOutputJob?jobId:null};
}

/** Declared completed ordinary project receipt. The editor owns the job while
 * actual shared-media custody and its namespace belong to the project owner.
 * This prepares no provider work and exercises the real access resolver. */
async function seedOrdinaryProject(f){
  const now=new Date().toISOString(),future=new Date(Date.now()+3_600_000).toISOString(),editor='native-read-project-editor';
  const headers={'oai-authenticated-user-id':editor,'oai-authenticated-user-email':editor+'@example.invalid'};
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,editor);
  const scope={organizationId:'native-read-organization',projectAccessId:'native-read-project-access',projectId:'native-read-shared-project',ownerUserId:f.actor};
  const documentId='native-read-shared-document',scopeKey='native-read-project-scope',planId='native-read-project-plan',grantId='native-read-project-grant',slotId='native-read-project-slot',jobId='native-read-project-job';
  const contextId='native-read-project-context',preflightId='native-read-project-preflight',targetId='native-read-project-target',correlation='native-read-project-correlation';
  const insert=(table,row)=>f.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  insert('organizations',{organization_id:scope.organizationId,name:'Declared ordinary project',owner_user_id:f.actor,status:'active',created_at:now,updated_at:now});
  for(const userId of [f.actor,editor])insert('organization_memberships',{membership_id:'native-read-org-'+userId,organization_id:scope.organizationId,user_id:userId,role:'member',status:'active',invited_by_user_id:f.actor,accepted_at:now,created_at:now,updated_at:now});
  insert('organization_projects',{project_access_id:scope.projectAccessId,organization_id:scope.organizationId,project_id:scope.projectId,owner_user_id:f.actor,status:'active',created_at:now,updated_at:now});
  insert('project_migration_states',{project_access_id:scope.projectAccessId,organization_id:scope.organizationId,owner_user_id:f.actor,status:'active',last_owner_sequence:0,updated_at:now});
  insert('project_memberships',{membership_id:'native-read-project-editor-membership',project_access_id:scope.projectAccessId,organization_id:scope.organizationId,project_id:scope.projectId,user_id:editor,role:'editor',status:'active',granted_by_user_id:f.actor,created_at:now,updated_at:now});
  insert('project_context_sessions',{context_id:contextId,principal_user_id:editor,organization_id:scope.organizationId,project_access_id:scope.projectAccessId,created_at:now,expires_at:future});
  const append=(type,payload)=>runtime.appendAuditEvent(f.env,f.stream,'user:'+editor,type,{project_id:scope.projectId,document_id:documentId,...payload},correlation);
  await append('ProjectCreated',{name:'Declared ordinary project'});await append('DocumentCreated',{title:'Shared ordinary image'});
  const plan=await append('OutputPlanConfirmed',{plan_revision_id:planId}),preflight=await append('OutputPlanPreflighted',{preflight_id:preflightId});
  const authorization=await append('OutputExecutionAuthorized',{grant_id:grantId}),queued=await append('ProjectDocumentJobQueued',{job_id:jobId,kind:'generate',organization_id:scope.organizationId,project_access_id:scope.projectAccessId,actor_user_id:editor,output_slot_id:slotId,output_grant_id:grantId});
  const digest='a'.repeat(64);
  insert('output_plan_revisions',{scope_key:scopeKey,scope_kind:'project',owner_user_id:f.actor,project_id:scope.projectId,document_id:documentId,organization_id:scope.organizationId,project_access_id:scope.projectAccessId,plan_revision_id:planId,plan_id:documentId,revision:1,confirmed_event_id:plan.eventId,requirements_digest:digest,source_digest:digest,resolver_version:'declared-fixture',source_head:plan.sequence,target_count:1,created_at:now});
  insert('output_plan_targets',{scope_key:scopeKey,plan_revision_id:planId,target_id:targetId,target_contract_digest:digest,media_kind:'image',required:1,selected:1,ordinal:0});
  insert('output_preflights',{scope_key:scopeKey,preflight_id:preflightId,plan_revision_id:planId,actor_user_id:editor,terms_digest:digest,event_id:preflight.eventId,expires_at:future,created_at:now});
  insert('output_execution_grants',{scope_key:scopeKey,grant_id:grantId,plan_revision_id:planId,actor_user_id:editor,payer_user_id:editor,context_id:contextId,preflight_id:preflightId,authorization_event_id:authorization.eventId,maximum_microusd:1000,maximum_calls:2,status:'completed',expires_at:future,created_at:now});
  insert('document_jobs',{job_id:jobId,owner_id:editor,stream_id:f.stream,document_id:documentId,kind:'generate',status:'completed',source_surface:'outputs',correlation_id:correlation,requested_sequence:queued.sequence,request_json:'{}',result_json:'{}',attempt_count:1,requested_at:now,started_at:now,expires_at:future,updated_at:now});
  insert('output_operation_slots',{scope_key:scopeKey,slot_id:slotId,grant_id:grantId,plan_revision_id:planId,target_id:targetId,target_contract_digest:digest,source_digest:digest,provider:'openai',model:'gpt-image-2',route_digest:digest,job_id:jobId,cost_reservation_id:'native-read-project-cost',token_reservation_id:'native-read-project-tokens',maximum_microusd:1000,maximum_calls:2,maximum_tokens:1000,status:'succeeded',created_at:now,updated_at:now});
  const generationId='native-read-project-generation',outputId='native-read-project-output',bytes=png(1024,1024,93),key=ownerMediaNamespace(f.actor)+'/generated/'+generationId+'.png',url='/api/media/'+encodeURIComponent(key);
  await f.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{ownerId:f.actor,sha256:hash(bytes),mimeType:'image/png',projectAccessId:scope.projectAccessId}});
  const completed=await runtime.appendAuditEvent(f.env,f.stream,'worker:generator','GenerationCompleted',{project_id:scope.projectId,document_id:documentId,object_id:outputId,object_ids:[outputId],generation_id:generationId,media_url:url,media_type:'image/png',image_width:1024,image_height:1024,source_content_hash:hash(bytes),quality:'high',purpose:'final',source_surface:'outputs',simulation:false},correlation);
  insert('output_native_storage_writes',{scope_key:scopeKey,slot_id:slotId,storage_key:key,content_sha256:hash(bytes),status:'written',write_acknowledged:1,publication_event_id:completed.eventId,created_at:now,updated_at:now});
  await synchronizeProjectScope(f.env,scope);
  assert.ok(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='media' AND resource_id=? AND owner_user_id=?").get(key,f.actor));
  return {...scope,editor,headers,key,bytes,jobId};
}

/** Real native HTTP handlers over disposable SQLite and owned RAM bytes. Native
 * sponsor setup uses only the intercepted Image transport; authored revisions
 * use the actual context-adoption and PATCH path. Read assertions start after
 * that declared fixture preparation. Schema installation is confined to the
 * disposable in-memory fixture database. */
export async function nativeImageReadFixture(t,{policy=readPolicy(),indexes=true,edits=0,ordinary=false,ordinaryOnly=false,ordinaryProject=false,legacyOutputJob=false,legacyCompletionSurface='outputs',...nativeOptions}={}){
  const f=ordinaryOnly?await ordinaryFixture(t):await sponsorReadFixture(t,nativeOptions);
  if(!ordinaryOnly){
    f.projectId=f.confirmed.snapshot.projectId;
    for(const operation of ['get','head','put'])f.env.MEDIA[operation].mock.restore();
    if(indexes)for(const index of SPONSOR_NATIVE_IMAGE_READ_INDEXES)f.sqlite.exec(index.sql);
    if(policy)await f.installReadPolicy(policy);
    f.outputId=f.completedPayload.object_id;f.originalKey=decodeURIComponent(f.completedPayload.media_url.slice('/api/media/'.length));
    f.originalBytes=f.media.get(f.originalKey).bytes.slice();
  }
  if(ordinary||ordinaryOnly)f.ordinary=await seedOrdinary(f,{legacyOutputJob,legacyCompletionSurface});
  if(ordinaryProject)f.projectMedia=await seedOrdinaryProject(f);
  if(ordinaryOnly){f.outputId=f.ordinary.outputId;f.originalKey=f.ordinary.key;f.originalBytes=f.ordinary.bytes.slice();await witness(f);}
  const imageRequest=(operation,options={})=>new Request('http://localhost/api/generated-images/'+encodeURIComponent(options.outputId??f.outputId)
    +(operation?'?operationSha256='+operation:''),{headers:{...f.actorHeaders,...options.headers},...(options.signal?{signal:options.signal}:{})});
  f.readImage=(operation,options={})=>handleGeneratedImageEdit(imageRequest(operation,options),f.env,options.outputId??f.outputId);
  f.readMedia=(key=f.originalKey,options={})=>getMedia(new Request('http://localhost/api/media/'+encodeURIComponent(key),
    {headers:{...f.actorHeaders,...options.headers},...(options.signal?{signal:options.signal}:{})}),key,f.env);
  f.edits=[];
  for(let index=0;index<edits;index++){
    const events=await runtime.readWorkspaceEvents(f.env,f.stream),output=foldEvents(events,Infinity,f.documentId,f.projectId).libraryOutputs.find(value=>value.id===f.outputId);assert.ok(output);
    const ids=[`native-read-reference-${index}`,`native-read-block-${index}`];
    const adopted=imageOutputContextEvents(output,{documentId:f.documentId,projectId:f.projectId,sourceSurface:'declared-local-read-fixture',contentHash:output.imageRevision?.mediaSha256??f.completedPayload.source_content_hash,idFactory:()=>ids.shift()});
    assert.equal(adopted.events.length,2);for(const event of adopted.events)await runtime.appendAuditEvent(f.env,f.stream,'user',event.type,event.payload);
    const current=await responseJson(await f.readImage()),source=current.sources.find(value=>current.sourceIds.includes(value.id));assert.ok(source);
    const recipe=composition.addReferenceCompositionLayer(composition.createReferenceComposition('1:1'),source,`native-read-layer-${index}`),bytes=png(recipe.width,recipe.height,110+index);
    const input={expectedRevision:current.revision,expectedEditEventId:current.editEventId,expectedContentSha256:current.contentSha256,
      generationId:current.generationId,sourceEventId:current.sourceEventId,contentRef:current.contentRef,sourceMediaUrl:current.media.url,
      sourceMediaSha256:current.media.sha256,sourceId:source.id,recipe,resultMediaSha256:hash(bytes),resultByteLength:bytes.length};
    const form=new FormData();form.append('request',JSON.stringify(input));form.append('png',new File([bytes],'declared-composition.png',{type:'image/png'}));
    const encoded=new Response(form),wire=await encoded.arrayBuffer(),batch=f.DB.batch;
    // The real event_write_stage trigger writes its durable event/private body.
    // Include those actual SQLite changes in the native D1 acknowledgment.
    f.DB.batch=async statements=>{
      const offset=statements.findIndex(statement=>statement.sql.includes('INSERT INTO event_write_stage')&&statement.sql.includes('private_content'));
      if(offset<0)return batch.call(f.DB,statements);
      const originals=statements.map(statement=>statement.execute);
      statements.forEach((statement,position)=>{statement.execute=function(kind){const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
        const result=originals[position].call(this,kind);return {...result,meta:{...result.meta,changes:f.sqlite.prepare('SELECT total_changes() n').get().n-before}};};});
      try{return await batch.call(f.DB,statements);}finally{statements.forEach((statement,position)=>{statement.execute=originals[position];});}
    };
    let saved;
    try{saved=await responseJson(await handleGeneratedImageEdit(new Request(imageRequest().url,{method:'PATCH',headers:{...f.actorHeaders,origin:'http://localhost','content-type':encoded.headers.get('content-type')},body:wire}),f.env,f.outputId));}
    finally{f.DB.batch=batch;}
    assert.equal(saved.status,'saved');assert.equal(saved.imageRevision.revision,index+1);
    f.edits.push({saved,bytes,key:decodeURIComponent(saved.imageRevision.media.url.slice('/api/media/'.length))});
  }

  const io={get:0,head:0,put:0,delete:0,list:0,fetch:0,history:0},get=f.env.MEDIA.get.bind(f.env.MEDIA),head=f.env.MEDIA.head.bind(f.env.MEDIA),prepare=f.DB.prepare.bind(f.DB);
  f.env.MEDIA.get=async key=>{io.get++;await f.beforeMediaGet?.(key);const object=await get(key);return f.transformMedia?f.transformMedia(object,key):object;};
  f.env.MEDIA.head=async key=>{io.head++;return head(key);};
  for(const operation of ['put','delete','list'])f.env.MEDIA[operation]=()=>{io[operation]++;throw Error('Native Image read cannot write/list media');};
  t.mock.method(globalThis,'fetch',()=>{io.fetch++;throw Error('Native Image HTTP fixture forbids network');});
  f.DB.prepare=sql=>{if(sql.includes('page AS MATERIALIZED')||sql.includes('AS witness FROM artifact_revisions')||sql.startsWith('SELECT content,expires_at FROM private_content'))io.history++;return prepare(sql);};
  Object.assign(f,{io,indexDefinitions:SPONSOR_NATIVE_IMAGE_READ_INDEXES,
    attempts:()=>ordinaryOnly?[]:f.sqlite.prepare('SELECT * FROM experience_sponsor_read_attempts ORDER BY admitted_at_ms,attempt_id').all(),
    snapshotNativeState:()=>snapshot(f),assertNoIoWrites:()=>{for(const name of ['put','delete','list','fetch'])assert.equal(io[name],0,name);},
  });
  f.assertReadOnly=(before)=>{f.assertNoIoWrites();assert.deepEqual(snapshot(f),before);};
  return f;
}
