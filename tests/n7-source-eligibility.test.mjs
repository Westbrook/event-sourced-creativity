import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/n6-inspector-fixture.mjs';
import {ordinaryHistory} from './helpers/n6-ordinary-history.mjs';
for(const runtime of ['source',...(process.env.N7_SOURCE_ONLY?[]:['production bundle'])]){
 test(`${runtime}: N7 qualified source metadata without witness or provider`,async t=>{
  const f=await fixture(t,runtime);const r=await f.inspect('/api/source-advisory-eligibility?documentId=document');
  const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.status,'eligible',JSON.stringify(body));assert.equal(body.metadata.count,5);assert.equal(body.sourceQualified,true);assert.equal(body.observationReady,false);assert.equal(body.executionAuthorized,false);
  assert.equal(body.source.manifest.length,2);assert.equal(body.source.manifest[0].sha256,body.source.sourceSha256);assert.equal(body.configuration.credentialIdentity,'unknown');assert.match(r.headers.get('cache-control'),/private, no-store/);
  assert.ok(!JSON.stringify(body).includes('Synthetic'));assert.ok(!JSON.stringify(body).includes('direction'));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM generation_preflights').get().n,0);
 });
}
const path='/api/source-advisory-eligibility?documentId=document';
const runtimes=['source',...(process.env.N7_SOURCE_ONLY?[]:['production bundle'])];
function instrument(f){
 const observations={metadata:[],hydration:0,otherContent:0};const prepare=f.db.prepare;
 f.db.prepare=sql=>{
  if(/FROM private_content\b/.test(sql))observations.otherContent++;
  if(sql.includes('custody_owner')&&sql.includes('events.*'))observations.hydration++;
  const wrap=statement=>{
   const bind=statement.bind.bind(statement),all=statement.all.bind(statement);
   statement.bind=(...args)=>wrap(bind(...args));
   statement.all=async()=>{const result=await all();if(sql.includes('bounded AS MATERIALIZED'))observations.metadata.push(result.results);return result;};return statement;
  };return wrap(prepare(sql));
 };return observations;
}
for(const runtime of runtimes){
 for(const outcome of ['completed','failed'])test(`${runtime}: N7 ordinary ${outcome} history positive`,async t=>{
  const f=await fixture(t,runtime);await ordinaryHistory(f,{outcome});const o=instrument(f);
  const b=await(await f.inspect(path)).json();assert.equal(b.status,'eligible',JSON.stringify(b));assert.ok(b.metadata.count>5);assert.equal(o.otherContent,0);assert.ok(o.hydration>0);
 });
 for(const fault of ['over128','oversized-cell','oversized-total','missing','redacted','foreign','binding','resource-scope','event-scope','unknown-kind','unsupported-kind','memory','rights','snapshot-cap','wrong-document','impersonation','delegation','wrong-principal','pilot','invalid-selector','post'])test(`${runtime}: N7 ${fault} denies without effects`,async t=>{
  const f=await fixture(t,runtime),target=f.block.eventId;let selected=path,headers=f.headers,method='GET';
  if(fault==='over128')for(let i=0;i<124;i++)await f.append('ProjectOpened',{project_id:'project'});
  if(fault==='oversized-cell')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('x'.repeat(65537),target);
  if(fault==='oversized-total')for(let i=0;i<9;i++)await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:'x'.repeat(60000)});
  if(fault==='missing')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(target);
  if(fault==='redacted')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='now' WHERE private_event_id=?").run(target);
  if(fault==='foreign')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='PRIVATE_OWNER_SENTINEL' WHERE private_event_id=?").run(target);
  if(fault==='binding')f.sqlite.prepare("UPDATE event_private_payloads SET document_id='PRIVATE_DOCUMENT_SENTINEL' WHERE private_event_id=?").run(target);
  if(fault==='resource-scope')f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES('access','document','document','org','project',?,?,'now')").run(f.owner,f.owner);
  if(fault==='event-scope')f.sqlite.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,'access','org','project',?,?,1,1,?,'now')").run(target,f.owner,f.user.streamId,f.owner);
  if(fault==='unknown-kind')await f.append('PRIVATE_EVENT_KIND_SENTINEL',{document_id:'document'},'PRIVATE_ACTOR_SENTINEL');
  if(fault==='unsupported-kind')await f.append('ObjectPinned',{object_id:'unbound'});
  if(['memory','rights'].includes(fault))await f.append('BlockPropertyEdited',{block_id:'direction',property_path:fault==='memory'?'memory_origin_version':'rights_class',new_value:'excluded'});
  if(fault==='snapshot-cap')await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:'x'.repeat(28000)});
  if(fault==='wrong-document')selected=path.replace('=document','=foreign');
  if(fault==='impersonation'||fault==='delegation')headers={...headers,cookie:(fault==='impersonation'?'forma_impersonation':'forma_project_context')+'=anything'};
  if(fault==='wrong-principal')headers={...headers,'oai-authenticated-user-id':'foreign'};
  if(fault==='pilot')f.env.FORMA_PILOT_COHORT_ID='pilot';
  if(fault==='invalid-selector')selected+='&ownerId=someone';if(fault==='post')method='POST';
  const o=instrument(f);const b=await(await f.inspect(selected,method,headers)).json();assert.notEqual(b.status,'eligible',JSON.stringify(b));assert.equal(b.sourceQualified??false,false);assert.equal(b.observationReady,false);assert.ok(!JSON.stringify(b).includes('SENTINEL'));assert.equal(o.otherContent,0);
  if(['over128','oversized-cell','oversized-total','missing','redacted','foreign','binding','resource-scope','event-scope'].includes(fault))assert.equal(o.hydration,0,'Stage1 rejects before any body hydration');
  if(fault==='over128'){assert.equal(b.metadata.count,129);assert.ok(b.reasons.includes('source_census_capacity'));}
  if(fault==='unknown-kind'){assert.ok(b.metadata.histogram.some(x=>x.kind==='unknown'&&x.actorClass==='other'));assert.ok(b.source.unsupportedKinds.some(x=>x.kind==='unknown'));}
  if(fault==='unsupported-kind')assert.ok(b.source.unsupportedKinds.some(x=>x.kind==='ObjectPinned'));
 });
 for(const fault of ['metadata-same-count','body-same-length','principal','database','configuration','credential','incomplete-hydration','incomplete-metadata','scan-cap'])test(`${runtime}: N7 rechecks ${fault}`,async t=>{
  const f=await fixture(t,runtime);let changed=false;
  const prepare=f.db.prepare;f.db.prepare=sql=>{
   const wrap=s=>{const bind=s.bind.bind(s),all=s.all.bind(s);s.bind=(...a)=>wrap(bind(...a));s.all=async()=>{const result=await all();if(sql.includes('bounded AS MATERIALIZED')){
    if(fault==='incomplete-metadata')result.results=[];
    if(fault==='scan-cap')result.results[0].scanned=100001;
   }return result;};return s;};return wrap(prepare(sql));
  };
  const batch=f.db.batch;f.db.batch=async ss=>{
   if(fault==='incomplete-hydration'){const r=await batch(ss);if(ss[0].sql.includes('events.*'))r[0].results.pop();return r;}
   const r=await batch(ss);if(fault==='scan-cap')for(let i=0;i<ss.length;i++)if(ss[i].sql.includes('bounded AS MATERIALIZED'))r[i].results[0].scanned=100001;return r;
  };
  f.control.beforeBatch=ss=>{
   if(changed||!ss.some(s=>s.sql.includes('native_principal AS')))return;changed=true;const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
   if(fault==='metadata-same-count'||fault==='body-same-length'){
    const row=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(f.block.eventId);
    let body=row.private_json.replace('Synthetic harbor','Different harbor');
    if(fault==='metadata-same-count')body+=' ';
    f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(body,f.block.eventId);
   }
   if(fault==='principal'){f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.owner);}
   if(fault==='database')f.env.DB={...f.db};
   if(fault==='configuration')f.env.OPENAI_PROJECT='PRIVATE_PROJECT_SENTINEL';
   if(fault==='credential')f.env.OPENAI_API_KEY='PRIVATE_CREDENTIAL_SENTINEL';
   f.control.externalChanges+=f.sqlite.prepare('SELECT total_changes() n').get().n-before;
  };
  const b=await(await f.inspect(path)).json();assert.notEqual(b.status,'eligible',JSON.stringify(b));assert.equal(b.sourceQualified,false);assert.ok(!JSON.stringify(b).includes('SENTINEL'));
  if(fault==='scan-cap'){assert.equal(b.metadata.complete,false);assert.equal(b.metadata.count,null);}
 });
 test(`${runtime}: N7 projection never transports payload sentinels; bounded source stage separate`,async t=>{
  const f=await fixture(t,runtime);await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:'PRIVATE_PAYLOAD_SENTINEL'});
  const o=instrument(f),logs=[],old=console.log;console.log=(...x)=>logs.push(x);
  try{const b=await(await f.inspect(path)).json();assert.equal(b.status,'eligible',JSON.stringify(b));assert.ok(o.hydration>0);assert.ok(o.metadata.length>0);assert.ok(!JSON.stringify([o.metadata,b,logs]).includes('PRIVATE_PAYLOAD_SENTINEL'));assert.ok(o.metadata.every(rows=>Object.keys(rows[0]).every(k=>!['payload','private_json','event_id','actor','owner_id'].includes(k))));assert.equal(o.otherContent,0);}finally{console.log=old;}
 });
}
for(const runtime of runtimes){
 test(`${runtime}: N7 exact128 and excluded telemetry use canonical profile`,async t=>{
  const f=await fixture(t,runtime);for(let i=0;i<123;i++)await f.append('ProjectOpened',{project_id:'project'});
  await f.append('AttentionEpisodeObserved',{capture_version:'attention-v2',terminal_type:'idle_timeout',terminal_ref:'',active_ms:30000,idle_ms:30000,surface:'document',context:'document-overview',visible_refs:[]},'worker:attention');
  const b=await(await f.inspect(path)).json();assert.equal(b.status,'eligible',JSON.stringify(b));assert.equal(b.metadata.count,128);assert.equal(b.source.dependencyCount,128);assert.ok(!b.metadata.histogram.some(x=>x.kind==='AttentionEpisodeObserved'));
 });
 test(`${runtime}: N7 census growing over128 after metadata transports no bodies`,async t=>{
  const f=await fixture(t,runtime);let changed=false,hydrated=-1;
  const prepare=f.db.prepare;f.db.prepare=sql=>{const wrap=s=>{const bind=s.bind.bind(s),all=s.all.bind(s);s.bind=(...a)=>wrap(bind(...a));s.all=async()=>{const result=await all();if(sql.includes('bounded AS MATERIALIZED')&&!changed){changed=true;const before=f.sqlite.prepare('SELECT total_changes() n').get().n;for(let i=0;i<124;i++)await f.append('ProjectOpened',{project_id:'project'});f.control.externalChanges+=f.sqlite.prepare('SELECT total_changes() n').get().n-before;}return result;};return s;};return wrap(prepare(sql));};
  const batch=f.db.batch;f.db.batch=async ss=>{const result=await batch(ss);if(ss[0].sql.includes('events.*'))hydrated=result[0].results.length;return result;};
  // Concurrent writes are fixture injection, not route effects; distinguish the
  // writer SQL from the diagnostic's own read-only statements.
  const b=await f.worker.fetch(new Request('https://forma.test'+path,{headers:f.headers}),f.env,{waitUntil:()=>assert.fail('background effect')}).then(r=>r.json());
  assert.equal(hydrated,0);assert.equal(b.status,'unavailable');assert.equal(b.reason,'metadata_changed');
 });
}
for(const runtime of runtimes)test(`${runtime}: N7 actual bounded scan saturates with excluded telemetry`,async t=>{
 const f=await fixture(t,runtime),head=f.sqlite.prepare('SELECT max(sequence) n FROM events WHERE stream_id=?').get(f.user.streamId).n;
 f.sqlite.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100001)
 INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload)
 SELECT 'n7-scan-'||x,?,?+x,'2026-01-01','2026-01-01','worker:telemetry','test','test',1,'ApplicationViewVisited','{}' FROM n`).run(f.user.streamId,head);
 const o=instrument(f),b=await(await f.inspect(path)).json();assert.equal(b.status,'ineligible',JSON.stringify(b));assert.equal(b.metadata.complete,false);assert.equal(b.metadata.count,null);assert.equal(b.metadata.scannedStreamRows,100001);assert.equal(o.hydration,0);
});
