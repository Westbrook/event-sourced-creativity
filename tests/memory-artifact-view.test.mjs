import './helpers/register-output-source-imports.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';

const { appendAuditEvent } = await import('../worker/runtime.ts');
const { liveMemorySourceQuery, LIVE_MEMORY_EVENT_TYPES } = await import('../worker/memory-live-sources.ts');
const { liveMemoryAuthority, liveMemoryPrincipal } = await import('../worker/memory-live-authority.ts');
const viewType = 'DocumentArtifactViewed';
const insert = statement => statement.sql.startsWith('INSERT INTO event_write_stage(') && statement.values.includes(viewType);

async function fixture(t, options = {}) {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No live provider/network in artifact observation tests'));
  const f = await createSceneCostFixture(1, 'visual', options);
  t.after(async () => { await f.drainBackground(); f.close(); });
  const payload = { artifact_id: 'saved-scene-story', artifact_kind: 'short_story', project_id: f.projectId, document_id: f.documentId,
    artifact_revision: 0, content_sha256: createHash('sha256').update(f.content).digest('hex'), source_surface: 'document-artifact-gallery' };
  const submit = (changes = {}, action = 'hot', extra = {}) => f.request(action === 'hot' ? '/api/events/hot' : '/api/events', f.json({
    action, event: { type: viewType, payload: { ...payload, ...changes } }, ...extra,
  }));
  const count = () => Number(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactViewed'").get().n);
  const original = f.sqlite.prepare("SELECT event_id FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.artifact_id')=?").get(payload.artifact_id).event_id;
  return Object.assign(f, { payload, submit, count, original });
}

async function memoryArtifactFixture(t,options={}) {
  const f=await fixture(t,{depth:true,...options});
  if(f.sharing)assert.equal((await f.request('/api/events?after=0&content=0')).status,200);
  for(const name of ['0020_assistant_runtime_tables.sql','0021_assistant_specialist_consent.sql','0025_memory_live_base.sql','0026_memory_live_conversation.sql'])
    f.sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  Object.assign(f.env,{FORMA_MEMORY_ENABLED:'true',FORMA_MEMORY_USER_IDS:f.owner,FORMA_MEMORY_SCHEDULING_ENABLED:'true'});
  const timeZone=Intl.supportedValuesOf('timeZone').find(zone=>{const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date()));return hour>=1&&hour<5;});
  const preferences={projectId:f.projectId,documentId:f.documentId,learn:true,recall:true,background:true,retentionDays:30,timeZone,
    expiresAt:new Date(Date.now()+30*86400000).toISOString(),revision:0,confirmation:'ENABLE_PERSONAL_MEMORY',policyVersion:'personal-memory-v2',
    reviewTiming:'daily-with-daytime-catch-up',expectedCustody:f.sharing?{kind:'organization',organizationId:f.sharing.organizationId,projectAccessId:f.sharing.projectAccessId,ownerUserId:f.owner}:{kind:'personal'}};
  const response=await f.request('/api/memory/settings',{...f.json(preferences),method:'PUT'}),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  const enrollment=()=>f.sqlite.prepare('SELECT * FROM memory_live_enrollments WHERE enrollment_id=?').get(body.enrollment.id);
  const {runLiveMemoryScheduled}=await import('../worker/memory-live-jobs.ts');
  const run=()=>runLiveMemoryScheduled(f.env);
  const inspect=(version='memory-consumption-episodes-v2')=>f.request('/api/memory/recall?id='+body.enrollment.id+(version?'&consumptionEpisodes='+version:''));
  return Object.assign(f,{enrollment,run,inspect});
}

test('personal artifact consumption v2 uses genuine enrollment, observation, scheduled source publication and certified inspector delivery',async t=>{
  const f=await memoryArtifactFixture(t),money=f.counts();
  const viewed=await f.submit();assert.equal(viewed.status,200,await viewed.clone().text());const event=(await viewed.json()).appended[0];
  const run=await f.run();assert.equal(run.status,'completed',JSON.stringify(run));
  assert.ok(f.sqlite.prepare('SELECT * FROM memory_live_sources WHERE event_id=?').get(event.eventId));
  const response=await f.inspect(),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.consumptionEpisodes.version,'memory-consumption-episodes-v2');
  assert.deepEqual(body.consumptionEpisodes.sources.map(source=>source.target),[{kind:'artifact',documentId:f.documentId,artifactId:f.payload.artifact_id,
    artifactKind:'short_story',revision:0,contentSha256:f.payload.content_sha256}]);
  assert.equal(body.consumptionEpisodes.episodes[0].observations[0].kind,'viewer-open');
  assert.equal(body.consumptionEpisodes.attention,'not-measured');assert.equal(body.sources.some(source=>source.eventId===event.eventId),false);
  for(const version of ['', 'memory-consumption-episodes-v1']){const legacy=await f.inspect(version);assert.equal(legacy.status,200,await legacy.clone().text());const value=await legacy.json();
    assert.equal(value.sources.some(source=>source.eventId===event.eventId),false);assert.equal(value.consumptionEpisodes?.episodes.length??0,0);}
  assert.deepEqual(f.counts(),money);
});

test('personal artifact consumption retains the original observation deadline when source retention is later extended',async t=>{
  const f=await memoryArtifactFixture(t),original=new Date(Date.now()+45_000).toISOString();
  f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(original,f.contentRef);
  const viewed=await f.submit();assert.equal(viewed.status,200,await viewed.clone().text());const event=(await viewed.json()).appended[0];
  f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()+86400000).toISOString(),f.contentRef);
  assert.equal((await f.run()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT expires_at FROM memory_live_sources WHERE event_id=?').get(event.eventId).expires_at,original);
  const response=await f.inspect(),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.ok(body.lifetime.validUntil<=original);assert.equal(body.consumptionEpisodes.sources[0].validUntil,original);
});

for(const fault of ['body','redaction','expiry','enrollment','custody','receipt-compensation','producer-compensation','ancestor-compensation','truncated-ack'])test('personal artifact consumption final replay refuses '+fault,async t=>{
  const f=await memoryArtifactFixture(t);assert.equal((await f.submit()).status,200);assert.equal((await f.run()).status,'completed');
  let injected=false;
  const selected=statements=>statements.some(statement=>statement.sql.includes('AS remembered_until')&&statement.values.includes('personal-artifact-view-v2'));
  if(fault==='truncated-ack')f.controls.afterBatch=async(statements,results)=>{if(!injected&&selected(statements)){injected=true;results.pop();}};
  else f.controls.beforeBatch=async statements=>{if(injected||!selected(statements))return;injected=true;
    if(fault==='body')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.contentRef);
    if(fault==='redaction')f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),f.contentRef);
    if(fault==='expiry')f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
    if(fault==='enrollment')f.sqlite.exec('UPDATE memory_live_enrollments SET recall_enabled=0');
    if(fault==='custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'content',?,'actor_private',?,?)").run(f.projectId,f.owner,f.contentRef,f.owner,new Date().toISOString());
    if(fault.endsWith('-compensation')){
      const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/runtime.ts');
      const target=fault==='producer-compensation'?f.original:fault==='receipt-compensation'
        ?f.sqlite.prepare("SELECT event_id FROM events WHERE type='DocumentArtifactViewed' ORDER BY sequence DESC LIMIT 1").get().event_id
        :f.sqlite.prepare("SELECT event_id FROM events WHERE type='DocumentCreated' AND json_extract(payload,'$.document_id')=? ORDER BY sequence DESC LIMIT 1").get(f.documentId).event_id;
      const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
      const event=makeEvent(f.streamId,head+1,'user:'+f.owner,'compensation-fixture',crypto.randomUUID(),'ObjectDiscarded',{project_id:f.projectId,document_id:f.documentId});
      event.compensatesEventId=target;const values=eventWriteBindings(event);
      await f.env.DB.prepare('INSERT INTO event_write_stage('+EVENT_WRITE_COLUMNS+') VALUES('+values.map(()=>'?').join(',')+')').bind(...values).run();
    }
  };
  const response=await f.inspect();assert.equal(response.status,403,await response.clone().text());assert.equal(injected,true);
  assert.equal((await response.text()).includes(f.payload.content_sha256),false);
});

test('personal artifact consumption publication rolls back its cursor if a source insertion is suppressed',async t=>{
  const f=await memoryArtifactFixture(t),cursor=f.enrollment().cursor_sequence;
  const viewed=await f.submit();assert.equal(viewed.status,200);const event=(await viewed.json()).appended[0];
  f.sqlite.exec("CREATE TRIGGER suppress_artifact_reference BEFORE INSERT ON memory_live_sources BEGIN SELECT RAISE(IGNORE); END");
  assert.equal((await f.run()).status,'partial');assert.equal(f.enrollment().cursor_sequence,cursor);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id=?').get(event.eventId).n,0);
});

test('personal artifact consumption resumes a bounded publication page without skipping view evidence',async t=>{
  const f=await memoryArtifactFixture(t),ids=[];
  for(let index=0;index<33;index++){
    const response=await f.submit({source_surface:['document','canvas','library','search','project'][index%5]+'-artifact-gallery'});
    assert.equal(response.status,200,await response.clone().text());ids.push((await response.json()).appended[0].eventId);
  }
  assert.equal((await f.run()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id IN(SELECT value FROM json_each(?))').get(JSON.stringify(ids)).n,32);
  assert.ok(f.enrollment().cutoff_sequence>f.enrollment().cursor_sequence,'unprocessed source frontier remains in the original job');
  f.sqlite.exec("UPDATE memory_live_enrollments SET next_due_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await f.run()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id IN(SELECT value FROM json_each(?))').get(JSON.stringify(ids)).n,33);
  assert.equal(f.enrollment().cutoff_sequence,null);
  const response=await f.inspect(),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.consumptionEpisodes.sources.length,32);assert.equal(body.consumptionEpisodes.coverage.truncated,true);
});

test('personal artifact consumption expires independently of a paused learning grant and Forget removes all references',async t=>{
  const f=await memoryArtifactFixture(t);const viewed=await f.submit();assert.equal(viewed.status,200);const event=(await viewed.json()).appended[0];
  assert.equal((await f.run()).status,'completed');
  f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
  f.sqlite.exec("UPDATE memory_live_enrollments SET learn_enabled=0,next_due_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await f.run()).status,'completed');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id=?').get(event.eventId).n,0);
  const response=await f.request('/api/memory/settings?id='+f.enrollment().enrollment_id,{...f.json({confirmation:'FORGET_MY_MEMORY',revision:f.enrollment().revision}),method:'DELETE'});
  assert.equal(response.status,200,await response.clone().text());assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources').get().n,0);
});

test('real personal hot append binds current revision-zero bytes, project, and erasable source identity', async t => {
  const f = await fixture(t), money = f.counts();
  const response = await f.submit(), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.appended.length, 1); assert.equal(f.count(), 1);
  const event = result.appended[0];
  assert.equal(event.actor, 'user:' + f.owner);
  assert.deepEqual(event.payload, { ...f.payload, artifact_source_event_id: f.original, capture_version: 'personal-artifact-view-v2', artifact_content_ref: f.contentRef, observed_source_expires_at: f.sqlite.prepare('SELECT expires_at FROM private_content WHERE content_id=?').get(f.contentRef).expires_at });
  const secret = f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(event.eventId);
  assert.equal(secret.owner_id, f.owner); assert.equal(secret.project_id, f.projectId); assert.equal(secret.document_id, f.documentId);
  assert.deepEqual(JSON.parse(secret.private_json), event.payload);
  assert.deepEqual(f.counts(), money); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('exact-view payload and alternate generic routes cannot forge or omit authoritative binding', async t => {
  const f = await fixture(t);
  for (const changes of [{ project_id: 'wrong-project' }, { document_id: 'wrong-document' }, { artifact_id: 'wrong-artifact' },
    { artifact_kind: 'slides' }, { artifact_revision: 1 }, { artifact_revision: -1 }, { artifact_revision: 0.5 }, { artifact_revision: '0' },
    { content_sha256: 'a'.repeat(64) }, { content_sha256: f.payload.content_sha256.toUpperCase() }, { content_sha256: 'bad' },
    { project_id: null }, { simulation: true }, { actor_user_id: f.owner }, { artifact_source_event_id: f.original },
    { source_surface: 'invented-inspection' }, { block_id: 'not-a-block-inspection' }]) {
    const response = await f.submit(changes); assert.ok([400, 409].includes(response.status), JSON.stringify(changes));
  }
  for (const action of ['append', 'batch', 'canvas_sync']) {
    const response = await f.submit({ artifact_revision: 99 }, action);
    assert.equal(response.status, 409, action);
  }
  assert.equal(f.count(), 0);
});

test('mixed batches do not append companion mutations when a view claim is present', async t => {
  const f = await fixture(t), before = f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const response = await f.submit({}, 'batch', { events: [{ type: viewType, payload: f.payload },
    { type: 'DocumentRenamed', payload: { document_id: f.documentId, new_title: 'Must not be written' } }] });
  assert.equal(response.status, 409); assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, before);
  assert.equal((await f.submit({}, 'append', { event: { type: viewType, payload: f.payload, compensatesEventId: f.original } })).status, 409);
});

test('removed documents, synthetic producer metadata, and expired retained bodies cannot produce view evidence', async t => {
  const f = await fixture(t);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2099-01-01T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.simulation',1) WHERE private_event_id=?").run(f.original);
  assert.equal((await f.submit()).status, 409);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_remove(private_json,'$.simulation') WHERE private_event_id=?").run(f.original);
  await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentRemoved', { project_id: f.projectId, document_id: f.documentId });
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

for (const mutation of ['project', 'document', 'public']) test('preexisting divergent producer envelope is not frozen as valid authority: ' + mutation, async t => {
  const f = await fixture(t);
  if (mutation === 'project') f.sqlite.prepare("UPDATE event_private_payloads SET project_id='wrong-project' WHERE private_event_id=?").run(f.original);
  if (mutation === 'document') f.sqlite.prepare("UPDATE event_private_payloads SET document_id='wrong-document' WHERE private_event_id=?").run(f.original);
  if (mutation === 'public') f.controls.afterRead = (statement, result) => {
    if (!statement.sql.startsWith('SELECT event.*,secret.owner_id')) return;
    const row = result.results.find(row => row.event_id === f.original);
    row.payload = JSON.stringify({ ...JSON.parse(row.payload), artifact_id: 'wrong-artifact' });
  };
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

for (const type of ['DocumentArtifactEdited', 'DocumentRemoved', 'DocumentCreated', 'DocumentRenderCompleted'])
  test('partial successful workspace page cannot hide current native source selection: ' + type, async t => {
    const f = await fixture(t);
    const hidden = await appendAuditEvent(f.env, f.streamId, type === 'DocumentRenderCompleted' ? 'worker:renderer' : 'user', type,
      { project_id: f.projectId, document_id: f.documentId, artifact_id: f.payload.artifact_id,
        artifact_kind: 'short_story', content_ref: f.contentRef, revision: 1 });
    f.controls.afterBatch = (statements, results) => {
      statements.forEach((statement, index) => {
        if (statement.sql.startsWith('SELECT * FROM events LEFT JOIN event_private_payloads') && statement.sql.includes('type NOT IN'))
          results[index].results = results[index].results.filter(event => event.event_id !== hidden.eventId);
      });
    };
    assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
  });

for (const malformed of ['duplicate', 'failed']) test('source proof requires a complete successful distinct row set: ' + malformed, async t => {
  const f = await fixture(t);
  f.controls.afterRead = (statement, result) => {
    if (!statement.sql.startsWith('SELECT event.*,secret.owner_id')) return;
    if (malformed === 'duplicate') result.results[1] = result.results[0];
    if (malformed === 'failed') result.success = false;
  };
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

test('actual current edited bytes can be observed but old or invented historical versions cannot', async t => {
  const f = await fixture(t), revised = f.content.replace('keeper', 'harbormaster');
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(revised, f.contentRef);
  await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentArtifactEdited', {
    project_id: f.projectId, document_id: f.documentId, artifact_id: f.payload.artifact_id, revision: 1,
    content_ref: f.contentRef, content_sha256: createHash('sha256').update(revised).digest('hex'),
  });
  assert.equal((await f.submit()).status, 409);
  assert.equal((await f.submit({ artifact_revision: 1 })).status, 409);
  const response = await f.submit({ artifact_revision: 1, content_sha256: createHash('sha256').update(revised).digest('hex') }, 'append');
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(f.count(), 1);
});

for (const mutation of ['body', 'body-redacted', 'body-owner', 'body-expiry', 'source-redacted', 'source-envelope', 'consent', 'permission-epoch', 'head', 'resource-custody', 'retention-custody'])
  test('final atomic view boundary rejects source or authority race: ' + mutation, async t => {
    const f = await fixture(t);
    let fired = false;
    f.controls.beforeBatch = async statements => {
      if (!statements.some(insert)) return; f.controls.beforeBatch = null; fired = true;
      if (mutation === 'body') f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(f.content + ' ', f.contentRef);
      if (mutation === 'body-redacted') f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-01-01' WHERE content_id=?").run(f.contentRef);
      if (mutation === 'body-owner') f.sqlite.prepare("UPDATE private_content SET owner_id='another-owner' WHERE content_id=?").run(f.contentRef);
      if (mutation === 'body-expiry') f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01' WHERE content_id=?").run(f.contentRef);
      if (mutation === 'source-redacted') f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.original);
      if (mutation === 'source-envelope') f.sqlite.prepare("UPDATE event_private_payloads SET project_id='other-project' WHERE private_event_id=?").run(f.original);
      if (mutation === 'consent') f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.owner);
      if (mutation === 'permission-epoch') f.sqlite.prepare("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z' WHERE user_id=?").run(f.owner);
      if (mutation === 'head') await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentArtifactEdited', { project_id: f.projectId, document_id: f.documentId, artifact_id: f.payload.artifact_id, revision: 1 });
      if (mutation === 'resource-custody') f.sqlite.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
        VALUES('other-access','artifact',?,'other-org','other-project','other-owner','collaborative_output',?,'other-owner',?)`).run(f.payload.artifact_id, f.original, new Date().toISOString());
      if (mutation === 'retention-custody') f.sqlite.prepare(`INSERT INTO private_content_retention_scopes VALUES(?,'other-org','other-access','other-project','other-owner','governed-evidence',1,'2099-01-01','2026-01-01')`).run(f.contentRef);
    };
    const response = await f.submit(); assert.ok(fired); assert.equal(response.status, 409, await response.clone().text()); assert.equal(f.count(), 0);
  });

for (const target of ['event', 'private']) test('post-write assertion rolls back suppressed ' + target + ' insertion', async t => {
  const f = await fixture(t);
  f.sqlite.exec(target === 'event'
    ? `CREATE TRIGGER suppress_view BEFORE INSERT ON events WHEN NEW.type='DocumentArtifactViewed' BEGIN SELECT RAISE(IGNORE); END`
    : `CREATE TRIGGER suppress_view BEFORE INSERT ON event_private_payloads WHEN json_extract(NEW.private_json,'$.capture_version')='personal-artifact-view-v2' BEGIN SELECT RAISE(IGNORE); END`);
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE json_extract(private_json,'$.capture_version')='personal-artifact-view-v2'").get().n, 0);
});

for (const fault of ['throw', 'missing', 'truncated', 'failed']) test('uncertain commit acknowledgment is never replayed: ' + fault, async t => {
  const f = await fixture(t); let writes = 0;
  f.controls.afterBatch = (statements, results) => {
    if (!statements.some(insert)) return; writes++;
    if (fault === 'throw') throw new Error('lost acknowledgement');
    if (fault === 'missing') results.length = 0;
    if (fault === 'truncated') results.length = 1;
    if (fault === 'failed') results[0].success = false;
  };
  const response = await f.submit(); assert.equal(response.status, 409); assert.equal((await response.json()).noAutomaticRetry, true);
  assert.equal(writes, 1); assert.equal(f.count(), 1, 'original committed receipt remains; no duplicate write');
});

test('project-governed custody is not accepted through the personal hot path', async t => {
  const f = await fixture(t, { shared: true });
  f.setScopedHeaders({});
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

test('a genuine exact receipt is retained but does not silently expand navigation-only Memory sources', async t => {
  const f = await fixture(t);
  for (const name of ['0020_assistant_runtime_tables.sql', '0021_assistant_specialist_consent.sql', '0025_memory_live_base.sql', '0026_memory_live_conversation.sql'])
    f.sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  const now = Date.now(), e = { enrollment_id: 'view-fixture-enrollment', actor_user_id: f.owner, owner_user_id: f.owner,
    project_id: f.projectId, document_id: f.documentId, organization_id: null, project_access_id: null,
    permission_epoch: '', policy_version: 'personal-memory-v2', retention_days: 30,
    enrolled_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 60_000).toISOString() };
  const principal = await liveMemoryPrincipal(f.env, f.owner); assert.ok(principal); e.permission_epoch = principal.access.permissionEpoch;
  const a = await liveMemoryAuthority(f.env, e); assert.ok(a, 'actual current authority, no fake grant');
  const response = await f.submit(); assert.equal(response.status, 200, await response.clone().text()); assert.equal(f.count(), 1);
  const q = liveMemorySourceQuery(e, a);
  const selected = f.sqlite.prepare(`SELECT event.event_id ${q.joins} WHERE ${q.condition} AND event.type='DocumentArtifactViewed'`).all(...q.bindings);
  assert.deepEqual(selected, []); assert.equal(LIVE_MEMORY_EVENT_TYPES.includes(viewType), false);
});

async function artifactDerivationFixture(t,options={}){
  const f=await memoryArtifactFixture(t,options);
  for(const name of ['0043_memory_derivation_purpose_grants','0044_memory_derivation_reference_jobs','0045_memory_derivation_finance',
    '0046_memory_derivation_recovery_cursor','0047_memory_derivation_results','0048_memory_derivation_user_controls','0049_memory_derivation_completion','0050_memory_derivation_lifecycle'])
    f.sqlite.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
  const policy=await import('../worker/memory-derivation-policy.ts'),store=await import('../worker/memory-derivation-store.ts'),e=f.enrollment();
  const hash=value=>createHash('sha256').update(value).digest('hex'),now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
  const terms={version:'memory-derivation-terms-v1',purpose:'rolling-summary',recipeVersion:'memory-derivation-candidates-v1',provider:'openai',model:'isolated-artifact-test',
    pricing:{inputMicroUsdPerMillion:1000000,cachedInputMicroUsdPerMillion:250000,outputMicroUsdPerMillion:2000000},maximumInputTokens:16384,maximumOutputTokens:100,
    monthlyCapMicroUsd:100000,payer:'self-ai-allowance',providerStore:false,retentionPolicyId:'isolated-only',providerRetentionDisclosure:'Synthetic fixture, not hosted qualification.',
    evidence:Object.fromEntries(policy.DERIVATION_EVIDENCE.map(key=>[key,hash('isolated:'+key)]))};
  const text=policy.derivationCanonical(terms),termsHash=hash(text),origin='https://memory-artifact.fixture.invalid';
  Object.assign(f.env,{FORMA_MEMORY_DERIVATION_ENABLED:'true',FORMA_MEMORY_DERIVATION_USER_IDS:f.owner,FORMA_MEMORY_DERIVATION_SOURCE_SHA256:'a'.repeat(64),
    FORMA_MEMORY_DERIVATION_ORIGIN:origin,FORMA_MEMORY_DERIVATION_DEPLOYMENT_ID:'isolated-artifacts',FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED:'true'});
  f.sqlite.prepare('INSERT INTO memory_derivation_qualifications VALUES(?,?,?,?,?,?,?,?,?)').run('artifact-test','a'.repeat(64),origin,'isolated-artifacts',text,termsHash,'qualified',now,expires);
  const grant={consent_id:crypto.randomUUID(),grant_id:await store.memoryDerivationGrantId(e,terms.purpose),revision:1,
    ...Object.fromEntries(['actor_user_id','owner_user_id','organization_id','project_access_id','project_id','document_id','permission_epoch'].map(key=>[key,e[key]])),
    enrollment_id:e.enrollment_id,enrollment_revision:e.revision,policy_version:policy.MEMORY_DERIVATION_POLICY,purpose:terms.purpose,qualification_id:'artifact-test',terms_sha256:termsHash,
    payer_user_id:f.owner,monthly_cap_microusd:terms.monthlyCapMicroUsd,source_after_sequence:e.cursor_sequence,retention_days:1,background_enabled:1,consented_at:now,expires_at:expires,revoked_at:null};
  f.sqlite.prepare(`INSERT INTO memory_derivation_grants(${store.DERIVATION_GRANT_COLUMNS.join(',')}) VALUES(${store.DERIVATION_GRANT_COLUMNS.map(()=>'?').join(',')})`).run(...store.DERIVATION_GRANT_COLUMNS.map(key=>grant[key]));
  return Object.assign(f,{grant});
}

test('artifact derivation: certified views enter bounded native capture without invented quotations or spending',async t=>{
  const f=await artifactDerivationFixture(t),money=f.counts();
  assert.equal((await f.submit()).status,200);assert.equal((await f.run()).status,'completed');
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get();assert.ok(job);
  const admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id);assert.ok(lease);
  const captured=await sources.captureNativeDerivationSources(f.env,lease);assert.equal(captured.status,'captured');
  const data=sources.nativeDerivationSourceInputs(f.env,captured.capture);
  assert.equal(data.originals.length,0);assert.equal(data.observations.length,1);assert.equal(data.observations[0].action,'inspect');
  assert.equal(data.observations[0].independentEvidence,false);assert.equal(data.coverage.queuedReferences,1);
  assert.equal(data.provenance.artifacts[0].contentRef,f.contentRef);assert.ok(data.provenance.artifacts[0].eventIds.includes(f.original));
  assert.equal(JSON.stringify(data).includes(f.content),false);
  assert.equal(await(await import('../worker/memory-derivation-completion.ts')).completeEmptyNativeDerivation(f.env,captured.capture),true);
  assert.equal(f.sqlite.prepare('SELECT outcome FROM memory_derivation_completions').get().outcome,'no-eligible-originals');
  assert.deepEqual(f.counts(),money);
});

for(const fault of ['body','custody','compensation','reference-delete'])test('artifact derivation: final capture replay rejects '+fault,async t=>{
  const f=await artifactDerivationFixture(t);assert.equal((await f.submit()).status,200);assert.equal((await f.run()).status,'completed');
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get(),admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id),captured=await sources.captureNativeDerivationSources(f.env,lease);assert.equal(captured.status,'captured');
  if(fault==='body')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.contentRef);
  if(fault==='custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'content',?,'actor_private',?,?)").run(f.projectId,f.owner,f.contentRef,f.owner,new Date().toISOString());
  if(fault==='compensation'){
    const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/runtime.ts');
    const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
    const event=makeEvent(f.streamId,head+1,'user:'+f.owner,'isolated-compensation',crypto.randomUUID(),'ObjectDiscarded',{project_id:f.projectId,document_id:f.documentId});
    event.compensatesEventId=f.original;const values=eventWriteBindings(event);
    await f.env.DB.prepare('INSERT INTO event_write_stage('+EVENT_WRITE_COLUMNS+') VALUES('+values.map(()=>'?').join(',')+')').bind(...values).run();
  }
  if(fault==='reference-delete')f.sqlite.exec('DELETE FROM memory_live_sources');
  assert.equal(await sources.replayNativeDerivationSources(f.env,captured.capture),false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_finance').get().n,0);
});

test('artifact derivation: five views continue into a second processing window without losing a reference',async t=>{
  const f=await artifactDerivationFixture(t);for(let i=0;i<5;i++)assert.equal((await f.submit()).status,200);
  assert.equal((await f.run()).status,'completed');
  const delivery=await import('../worker/memory-derivation-jobs.ts');
  await delivery.registerNativeDerivationBacklog(f.env,f.enrollment(),new Date().toISOString());
  assert.deepEqual(f.sqlite.prepare('SELECT source_count FROM memory_derivation_jobs ORDER BY after_sequence').all().map(row=>row.source_count),[4,1]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_job_sources').get().n,5);
  assert.equal(f.sqlite.prepare('SELECT registered_through_sequence FROM memory_derivation_cursors').get().registered_through_sequence,f.enrollment().cursor_sequence);
});

for(const fault of ['none','body-erasure','source-erasure','artifact-edited','document-custody','block-rehome','block-custody'])test('artifact derivation: mixed originals retain all artifact inverses '+fault,async t=>{
  const f=await artifactDerivationFixture(t);assert.equal((await f.submit()).status,200);
  const turn=await f.request('/api/assistant?route='+encodeURIComponent('/document/'+f.documentId)+'&projectId='+f.projectId,
    f.json({turnId:'artifact-observation-original',message:'I want to review this story.',locale:'en'}));
  assert.equal(turn.status,201,await turn.clone().text());
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'observed-native-block',type:'direction',scope:'document',properties:{text:'An authored direction'}});
  assert.equal((await f.run()).status,'completed');
  let calls=0;t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),input=JSON.parse(body.input);
    assert.equal(input.originals.length,2);assert.ok(input.observations.some(row=>row.action==='inspect'));
    assert.equal(JSON.stringify(input).includes(f.content),false,'Artifact body is certified locally, never a quoted original or provider input');
    return Response.json({id:'isolated-artifact-result',object:'response',model:'isolated-artifact-test',service_tier:'default',status:'completed',error:null,incomplete_details:null,
      usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0}},
      output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({version:'memory-derivation-candidates-v1',items:[]})}]}]});
  });
  const result=await(await import('../worker/memory-derivation-worker.ts')).runNativeDerivationScheduled(f.env);assert.equal(result.status,'stored',JSON.stringify(result));assert.equal(calls,1);
  const stored=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get();
  const dependencies=f.sqlite.prepare('SELECT * FROM memory_derivation_result_dependencies WHERE job_id=?').all(stored.job_id);
  assert.ok(dependencies.some(row=>row.kind==='content'&&row.resource_id===f.contentRef));assert.ok(dependencies.some(row=>row.kind==='event'&&row.resource_id===f.original));
  if(fault==='body-erasure')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(f.contentRef);
  if(fault==='source-erasure')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.original);
  if(fault==='artifact-edited')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentArtifactEdited',{artifact_id:f.payload.artifact_id,project_id:f.projectId,document_id:f.documentId});
  if(fault==='document-custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'document',?,'actor_private',?,?)").run(f.projectId,f.owner,f.documentId,f.owner,new Date().toISOString());
  if(fault==='block-rehome')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRehomed',{block_id:'observed-native-block',project_id:f.projectId,document_id:'different-document',scope:'document'});
  if(fault==='block-custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'block','observed-native-block','actor_private',?,?)").run(f.projectId,f.owner,f.owner,new Date().toISOString());
  const fresh=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get();
  if(fault==='none')assert.ok(await(await import('../worker/memory-derivation-results.ts')).readNativeDerivationResult(f.env,f.owner,stored.job_id));
  else{assert.equal(fresh.state,'withdrawn');assert.equal(fresh.raw_json,null);assert.equal(fresh.manifest_json,null);}
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_usage').get().n,1,'Privacy erasure never refunds recorded provider usage');
});

test('artifact derivation: missing lifecycle protection refuses capture without provider admission',async t=>{
  const f=await artifactDerivationFixture(t);f.sqlite.exec(readFileSync(new URL('../drizzle/0050_memory_derivation_lifecycle.sql',import.meta.url),'utf8').match(/CREATE TRIGGER [a-z_]+/g).map(value=>'DROP TRIGGER '+value.split(' ')[2]).join(';'));
  assert.equal((await f.submit()).status,200);assert.equal((await f.run()).status,'completed');
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get(),lease=await(await import('../worker/memory-derivation-admission.ts')).claimNativeDerivationJob(f.env,job.job_id);assert.ok(lease);
  assert.equal((await(await import('../worker/memory-derivation-sources.ts')).captureNativeDerivationSources(f.env,lease)).status,'unavailable');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_finance').get().n,0);
});

for(const after of ['edit','render'])test('historical artifact consumption: genuine viewed revision survives later '+after+' without widening the writer',async t=>{
  const f=await artifactDerivationFixture(t),money=f.counts();
  const viewed=await f.submit();assert.equal(viewed.status,200);const event=(await viewed.json()).appended[0];
  await appendAuditEvent(f.env,f.streamId,after==='render'?'worker:renderer':'user',after==='render'?'DocumentRenderCompleted':'DocumentArtifactEdited',{
    project_id:f.projectId,document_id:f.documentId,artifact_id:f.payload.artifact_id,artifact_kind:'short_story',content_ref:f.contentRef,revision:1});
  if(after==='edit')assert.equal((await f.submit()).status,409,'A browser cannot append a fresh view against revision zero');
  const {preparePersonalArtifactHistorySource}=await import('../worker/memory-artifact-view.ts');
  const actor=await liveMemoryPrincipal(f.env,f.owner),certified=await preparePersonalArtifactHistorySource(f.env,actor,event.eventId);
  assert.ok(!(certified instanceof Response),certified instanceof Response?await certified.text():'');
  assert.equal(certified.payload.artifact_revision,0);assert.equal(certified.payload.artifact_source_event_id,f.original);
  await f.env.DB.prepare(`SELECT CASE WHEN (${certified.source.sql}) THEN 1 ELSE json('history-invalid') END`).bind(...certified.source.bindings).all();
  assert.equal((await f.run()).status,'completed');assert.ok(f.sqlite.prepare('SELECT event_id FROM memory_live_sources WHERE event_id=?').get(event.eventId));
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get(),admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id);assert.ok(lease);
  const captured=await sources.captureNativeDerivationSources(f.env,lease);assert.equal(captured.status,'captured');
  const input=sources.nativeDerivationSourceInputs(f.env,captured.capture);assert.equal(input.observations.length,1);assert.equal(input.originals.length,0);assert.equal(input.observations[0].independentEvidence,false);
  assert.equal(await sources.replayNativeDerivationSources(f.env,captured.capture),true);
  const oldInspector=await f.inspect(),body=await oldInspector.json();assert.equal(oldInspector.status,200,JSON.stringify(body));
  assert.equal(body.consumptionEpisodes.sources.length,0,'The explicitly current-only v2 inspector does not silently become historical');
  assert.equal(body.consumptionEpisodes.coverage.unavailableArtifactSourceCount,1);
  const historical=await f.inspect('memory-consumption-episodes-v3'),history=await historical.json();assert.equal(historical.status,200,JSON.stringify(history));
  assert.equal(history.consumptionEpisodes.version,'memory-consumption-episodes-v3');assert.equal(history.consumptionEpisodes.sources.length,1);
  assert.equal(history.consumptionEpisodes.sources[0].target.revision,0);assert.equal(history.consumptionEpisodes.sources[0].eventId,event.eventId);
  assert.equal(history.consumptionEpisodes.coverage.unavailableArtifactSourceCount,0);assert.equal(history.consumptionEpisodes.inferredPreferences,false);
  assert.equal(history.consumptionEpisodes.validUntil,history.lifetime.validUntil);assert.deepEqual(f.counts(),money);
});
for(const fault of ['view-erased','source-erased','body-changed','document-removed','document-replaced','custody','expiry-extended','unknown-view'])test('historical artifact consumption: '+fault+' cannot renew old observation authority',async t=>{
  const f=await memoryArtifactFixture(t),oldExpiry=new Date(Date.now()+60000).toISOString();
  f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(oldExpiry,f.contentRef);
  const viewed=await f.submit();assert.equal(viewed.status,200);const event=(await viewed.json()).appended[0];
  await appendAuditEvent(f.env,f.streamId,'user','DocumentArtifactEdited',{project_id:f.projectId,document_id:f.documentId,artifact_id:f.payload.artifact_id,revision:1});
  const {preparePersonalArtifactHistorySource}=await import('../worker/memory-artifact-view.ts'),actor=await liveMemoryPrincipal(f.env,f.owner);
  const certified=await preparePersonalArtifactHistorySource(f.env,actor,event.eventId);assert.ok(!(certified instanceof Response));
  const replay=()=>f.env.DB.prepare(`SELECT CASE WHEN (${certified.source.sql}) THEN 1 ELSE json('history-invalid') END`).bind(...certified.source.bindings).all();await replay();
  if(fault==='view-erased')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(event.eventId);
  if(fault==='source-erased')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.original);
  if(fault==='body-changed')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.contentRef);
  if(fault==='document-removed')await appendAuditEvent(f.env,f.streamId,'user','DocumentRemoved',{project_id:f.projectId,document_id:f.documentId});
  if(fault==='document-replaced')await appendAuditEvent(f.env,f.streamId,'user','DocumentCreated',{project_id:f.projectId,document_id:f.documentId});
  if(fault==='custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'document',?,'actor_private',?,?)").run(f.projectId,f.owner,f.documentId,f.owner,new Date().toISOString());
  if(fault==='unknown-view'){assert.ok(await preparePersonalArtifactHistorySource(f.env,actor,'unknown') instanceof Response);return;}
  if(fault==='expiry-extended'){
    f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()+86400000).toISOString(),f.contentRef);
    const fresh=await preparePersonalArtifactHistorySource(f.env,actor,event.eventId);assert.ok(!(fresh instanceof Response));assert.equal(fresh.payload.observed_source_expires_at,oldExpiry);
    t.mock.timers.enable({apis:['Date'],now:Date.parse(oldExpiry)+1});assert.ok(await preparePersonalArtifactHistorySource(f.env,actor,event.eventId) instanceof Response);
  }
  await assert.rejects(replay);
});

test('historical artifact consumption: final database clock enforces the original view ceiling after retention extension',async t=>{
  const f=await fixture(t),expiry=new Date(Date.now()+60000).toISOString();f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(expiry,f.contentRef);
  const event=(await(await f.submit()).json()).appended[0];f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()+86400000).toISOString(),f.contentRef);
  const actor=await liveMemoryPrincipal(f.env,f.owner),{preparePersonalArtifactHistorySource}=await import('../worker/memory-artifact-view.ts'),certified=await preparePersonalArtifactHistorySource(f.env,actor,event.eventId);assert.ok(!(certified instanceof Response));
  const {DatabaseSync}=await import('node:sqlite'),clockDb=new DatabaseSync(':memory:');t.after(()=>clockDb.close());
  f.sqlite.function('strftime',{varargs:true},(format,...values)=>{if(values[0]==='now')values[0]=expiry;return clockDb.prepare('SELECT strftime('+[format,...values].map(()=>'?').join(',')+') AS value').get(format,...values).value;});
  await assert.rejects(()=>f.env.DB.prepare(`SELECT CASE WHEN (${certified.source.sql}) THEN 1 ELSE json('expired-original') END`).bind(...certified.source.bindings).all());
});

test('historical artifact consumption: isolated D1 retains old views but invalidates late native erasure',{timeout:180000},async t=>{
  const f=await memoryArtifactFixture(t),event=(await(await f.submit()).json()).appended[0];
  await appendAuditEvent(f.env,f.streamId,'user','DocumentArtifactEdited',{project_id:f.projectId,document_id:f.documentId,artifact_id:f.payload.artifact_id,revision:1});
  const {createRequire}=await import('node:module'),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare'),{exportSynthetic,install}=await import('./helpers/model3d-workerd-snapshot.mjs');let outbound=0;
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['ArtifactHistory'],script:"export default {fetch(){return new Response('Isolated',{status:404});}}",outboundService(){outbound++;throw Error('External fetch forbidden');}});
  t.after(async()=>{await mf.dispose();assert.equal(outbound,0);});const db=await mf.getD1Database('ArtifactHistory');await install(db,exportSynthetic(f.sqlite));f.env.DB=db;
  const actor=await liveMemoryPrincipal(f.env,f.owner),{preparePersonalArtifactHistorySource}=await import('../worker/memory-artifact-view.ts'),certified=await preparePersonalArtifactHistorySource(f.env,actor,event.eventId);assert.ok(!(certified instanceof Response));
  const replay=()=>db.prepare(`SELECT CASE WHEN (${certified.source.sql}) THEN 1 ELSE json('history-erased') END`).bind(...certified.source.bindings).all();await replay();
  assert.equal((await f.run()).status,'completed');assert.ok(await db.prepare('SELECT event_id FROM memory_live_sources WHERE event_id=?').bind(event.eventId).first());
  await db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').bind(event.eventId).run();await assert.rejects(replay);
  assert.ok(await preparePersonalArtifactHistorySource(f.env,actor,event.eventId) instanceof Response);
});

async function nativeBlockCaptureFixture(t){
  const f=await artifactDerivationFixture(t);
  const blockId='native-memory-block';
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:blockId,
    type:'direction',scope:'document',properties:{text:'Private native block fields, not a human quotation'}});
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockPropertyEdited',{project_id:f.projectId,document_id:f.documentId,block_id:blockId,
    property_path:'text',new_value:'Revised private native fields'});
  assert.equal((await f.run()).status,'completed');
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get();assert.ok(job);
  const admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id);assert.ok(lease);
  return Object.assign(f,{blockId,lease,sources,capture:()=>sources.captureNativeDerivationSources(f.env,lease)});
}

test('block memory: native field versions supplement document actions without promoting text or pointer authority',async t=>{
  const f=await nativeBlockCaptureFixture(t),result=await f.capture();assert.equal(result.status,'captured');
  const source=f.sources.nativeDerivationSourceInputs(f.env,result.capture),bindings=source.provenance.blockBindings;
  assert.equal(source.originals.length,0);assert.equal(bindings.version,1);assert.equal(bindings.unresolved,0);assert.equal(bindings.entries.length,2);
  assert.deepEqual(bindings.entries.map(row=>row.eventIds.length),[1,2]);assert.notEqual(bindings.entries[0].stateSha256,bindings.entries[1].stateSha256);
  assert.equal(bindings.entries[0].scopeKey,bindings.entries[1].scopeKey);assert.ok(bindings.entries[0].scopeKey.includes(f.blockId));
  assert.equal(JSON.stringify(source).includes('Private native block fields'),false);assert.equal(JSON.stringify(source).includes('Revised private native fields'),false);
  assert.ok(source.observations.every(row=>row.independentEvidence===false));
  const legacy=await f.sources.captureNativeDerivationSources(f.env,f.lease,{blockBindings:false});assert.equal(legacy.status,'captured');
  assert.equal(Object.hasOwn(f.sources.nativeDerivationSourceInputs(f.env,legacy.capture).provenance,'blockBindings'),false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_finance').get().n,0);
});

for(const fault of ['source-private-erasure','source-edit','compensation','rehome','custody','recreated','later-property-edit','unrelated'])test('block memory: exact replay handles '+fault,async t=>{
  const f=await nativeBlockCaptureFixture(t),result=await f.capture();assert.equal(result.status,'captured');
  const binding=f.sources.nativeDerivationSourceInputs(f.env,result.capture).provenance.blockBindings.entries[0];assert.ok(binding);
  if(fault==='source-private-erasure')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(binding.eventId);
  if(fault==='source-edit')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','altered') WHERE private_event_id=?").run(binding.eventId);
  if(fault==='rehome')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRehomed',{block_id:f.blockId,project_id:f.projectId,document_id:'foreign',scope:'document'});
  if(fault==='recreated')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockCreated',{block_id:f.blockId,project_id:f.projectId,document_id:f.documentId,scope:'document'});
  if(fault==='later-property-edit')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockPropertyEdited',{block_id:f.blockId,project_id:f.projectId,document_id:f.documentId,property_path:'text',new_value:'Later edit'});
  if(fault==='unrelated')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentOpened',{project_id:f.projectId,document_id:f.documentId});
  if(fault==='custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'block',?,'actor_private',?,?)").run(f.projectId,f.owner,f.blockId,f.owner,new Date().toISOString());
  if(fault==='compensation'){
    const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/runtime.ts');
    const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
    const event=makeEvent(f.streamId,head+1,'user:'+f.owner,'isolated-compensation',crypto.randomUUID(),'ObjectDiscarded',{project_id:f.projectId,document_id:f.documentId});
    event.compensatesEventId=binding.eventId;const values=eventWriteBindings(event);
    await f.env.DB.prepare('INSERT INTO event_write_stage('+EVENT_WRITE_COLUMNS+') VALUES('+values.map(()=>'?').join(',')+')').bind(...values).run();
  }
  assert.equal(await f.sources.replayNativeDerivationSources(f.env,result.capture),['later-property-edit','unrelated'].includes(fault));
});

for(const fault of ['none','source-erasure','source-custody'])test('block memory: pre-window source events retain complete publication inverses '+fault,async t=>{
  const f=await artifactDerivationFixture(t),blockId='scene-reuse-direction';
  const original=f.sqlite.prepare("SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')=?").get(blockId).event_id;
  const turn=await f.request('/api/assistant?route='+encodeURIComponent('/document/'+f.documentId)+'&projectId='+f.projectId,
    f.json({turnId:'block-observation-original',message:'I want to review this story.',locale:'en'}));assert.equal(turn.status,201,await turn.clone().text());
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockPropertyEdited',{project_id:f.projectId,document_id:f.documentId,block_id:blockId,property_path:'text',new_value:'An updated native direction'});
  assert.equal((await f.run()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_job_sources WHERE event_id=?').get(original).n,0);
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    assert.equal(options.body.includes('An updated native direction'),false);
    return Response.json({id:'isolated-block-result',object:'response',model:'isolated-artifact-test',service_tier:'default',status:'completed',error:null,incomplete_details:null,
      usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0}},
      output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({version:'memory-derivation-candidates-v1',items:[]})}]}]});
  });
  const result=await(await import('../worker/memory-derivation-worker.ts')).runNativeDerivationScheduled(f.env);assert.equal(result.status,'stored',JSON.stringify(result));
  const stored=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get(),manifest=JSON.parse(stored.manifest_json);
  assert.ok(manifest.provenance.blockBindings.entries.some(row=>row.eventIds.includes(original)));
  assert.ok(f.sqlite.prepare("SELECT * FROM memory_derivation_result_dependencies WHERE job_id=? AND kind='event' AND resource_id=?").get(stored.job_id,original));
  if(fault==='source-erasure')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(original);
  if(fault==='source-custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'block',?,'actor_private',?,?)").run(f.projectId,f.owner,blockId,f.owner,new Date().toISOString());
  if(fault==='none')assert.ok(await(await import('../worker/memory-derivation-results.ts')).readNativeDerivationResult(f.env,f.owner,stored.job_id));
  else{const retired=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get();assert.equal(retired.state,'withdrawn');assert.equal(retired.manifest_json,null);}
});

test('block memory: isolated D1 replays native revision and rejects erased supporting events',{timeout:180000},async t=>{
  const f=await nativeBlockCaptureFixture(t),{createRequire}=await import('node:module'),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare'),
    {exportSynthetic,install}=await import('./helpers/model3d-workerd-snapshot.mjs');let outbound=0;
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['BlockMemory'],
    script:"export default {fetch(){return new Response('Isolated',{status:404});}}",outboundService(){outbound++;throw Error('External fetch forbidden');}});
  t.after(async()=>{await mf.dispose();assert.equal(outbound,0);});const db=await mf.getD1Database('BlockMemory');await install(db,exportSynthetic(f.sqlite));f.env.DB=db;
  const {observeNativeMemoryBlockBindings}=await import('../worker/memory-native-blocks.ts'),{AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts');
  const observations=f.sqlite.prepare("SELECT event_id AS eventId,sequence,type AS eventType,json_extract(payload,'$.block_id') AS blockPointer FROM events WHERE json_extract(payload,'$.block_id')=? ORDER BY sequence").all(f.blockId);
  const witness=new AssistantContextReadWitness(f.env),binding=await observeNativeMemoryBlockBindings(f.env,f.enrollment(),observations,witness);
  assert.equal(binding.entries.length,2);witness.seal(binding);await db.batch(witness.precommitStatements());
  await db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').bind(binding.entries[0].eventId).run();
  await assert.rejects(()=>db.batch(witness.precommitStatements()));
});

for(const fault of ['unknown-pointer','duplicate-declaration','foreign-placement','missing-private','synthetic-source','conflicting-public','oversized-history'])test('block memory: unproved block interpretation stays unresolved '+fault,async t=>{
  const f=await nativeBlockCaptureFixture(t),{observeNativeMemoryBlockBindings}=await import('../worker/memory-native-blocks.ts'),
    {AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts');
  let observations=f.sqlite.prepare("SELECT event_id AS eventId,sequence,type AS eventType,json_extract(payload,'$.block_id') AS blockPointer FROM events WHERE json_extract(payload,'$.block_id')=? ORDER BY sequence").all(f.blockId);
  const created=observations[0].eventId;
  if(fault==='unknown-pointer')observations=observations.map(row=>({...row,blockPointer:'unknown'}));
  if(fault==='missing-private')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(created);
  if(fault==='synthetic-source')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.synthetic',1) WHERE private_event_id=?").run(created);
  if(fault==='conflicting-public')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.project_id','foreign') WHERE private_event_id=?").run(created);
  if(fault==='oversized-history')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text',?) WHERE private_event_id=?").run('x'.repeat(200000),created);
  if(fault==='duplicate-declaration')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:f.blockId,scope:'document'});
  if(fault==='foreign-placement')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRehomed',{project_id:f.projectId,document_id:'foreign',block_id:f.blockId,scope:'document'});
  const witness=new AssistantContextReadWitness(f.env),result=await observeNativeMemoryBlockBindings(f.env,f.enrollment(),observations,witness);
  assert.equal(result.entries.length,0);assert.equal(result.unresolved,observations.length);witness.seal(result);
  assert.ok(witness.precommitStatements().length>0,'Absence and rejected sources are part of the exact witness');
});

test('block memory: a source growing after measurement is not hydrated',async t=>{
  const f=await nativeBlockCaptureFixture(t),{observeNativeMemoryBlockBindings}=await import('../worker/memory-native-blocks.ts');
  const observations=f.sqlite.prepare("SELECT event_id AS eventId,sequence,type AS eventType,json_extract(payload,'$.block_id') AS blockPointer FROM events WHERE json_extract(payload,'$.block_id')=? ORDER BY sequence").all(f.blockId);
  const batch=f.env.DB.batch;let injected=false,hydrated=false;
  f.env.DB.batch=async statements=>{
    if(!injected&&statements.some(statement=>statement.sql.includes('AS compensated'))){injected=true;
      f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text',?) WHERE private_event_id=?").run('BLOCK_GROWTH_TAIL'.repeat(20000),observations[0].eventId);}
    const result=await batch.call(f.env.DB,statements);if(JSON.stringify(result).includes('BLOCK_GROWTH_TAIL'))hydrated=true;return result;
  };
  const result=await observeNativeMemoryBlockBindings(f.env,f.enrollment(),observations,{observe(){}});
  assert.equal(injected,true);assert.equal(hydrated,false);assert.equal(result.entries.length,0);assert.equal(result.unresolved,2);
});

async function nativeRelationResultFixture(t,options={}){
  const f=await artifactDerivationFixture(t);
  for(const name of ['0054_memory_derivation_index_intents','0055_memory_derivation_relation_lifecycle'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
  const relationId='memory-observed-relation',scope={project_id:f.projectId,document_id:f.documentId};
  for(const [type,payload]of [['BlockCreated',{...scope,block_id:'memory-relation-other',scope:'document',type:'direction',properties:{text:'A second context'}}],
    ['BlockRelationAdded',{...scope,relation_id:relationId,from_block_id:'scene-reuse-direction',to_block_id:'memory-relation-other',kind:'visual_evidence'}]]){
    const response=await f.request('/api/events',f.json({action:'append',event:{type,payload}}));assert.equal(response.status,200,await response.clone().text());}
  const turn=await f.request('/api/assistant?route='+encodeURIComponent('/document/'+f.documentId)+'&projectId='+f.projectId,
    f.json({turnId:'relation-observation-original',message:'I want to review this story.',locale:'en'}));assert.equal(turn.status,201,await turn.clone().text());
  assert.equal((await f.run()).status,'completed');
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'isolated-relation-result',object:'response',model:'isolated-artifact-test',service_tier:'default',status:'completed',error:null,incomplete_details:null,
    usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0}},
    output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({version:'memory-derivation-candidates-v1',items:[]})}]}]}));
  if(options.beforePublish)await options.beforePublish({...f,relationId});
  const result=await(await import('../worker/memory-derivation-worker.ts')).runNativeDerivationScheduled(f.env);assert.equal(result.status,'stored',JSON.stringify(result));
  const stored=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get();
  assert.ok(f.sqlite.prepare("SELECT d.resource_id FROM memory_derivation_result_dependencies d JOIN events e ON e.event_id=d.resource_id WHERE d.job_id=? AND d.kind='event' AND json_extract(e.payload,'$.relation_id')=?").get(stored.job_id,relationId));
  if(!options.beforePublish){const bindings=JSON.parse(stored.manifest_json).provenance.relationBindings;
    assert.equal(bindings.entries.length,1);assert.equal(bindings.unresolved,0);
    const relation=bindings.entries[0];assert.equal(relation.state,'linked');assert.equal(relation.from.blockId,'scene-reuse-direction');assert.equal(relation.to.blockId,'memory-relation-other');
    assert.ok(relation.eventIds.includes(relation.from.eventIds[0]));assert.ok(relation.eventIds.includes(relation.to.eventIds[0]));
  }
  return Object.assign(f,{relationId,stored});
}

for(const fault of ['remove','redeclare','custody-insert','custody-update','custody-delete','foreign-owner-custody','unrelated'])test('relation memory: native relationship change retires private result and queues deletion '+fault,async t=>{
  const installCustody=f=>f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'relation',?,'actor_private',?,?)").run(f.projectId,f.owner,f.relationId,f.owner,new Date().toISOString());
  const f=await nativeRelationResultFixture(t,{beforePublish:['custody-update','custody-delete'].includes(fault)?installCustody:undefined});
  if(fault==='remove')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRelationRemoved',{project_id:f.projectId,document_id:f.documentId,relation_id:f.relationId});
  if(fault==='redeclare'||fault==='unrelated')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRelationAdded',{project_id:f.projectId,document_id:f.documentId,
    relation_id:fault==='unrelated'?'different-relation':f.relationId,from_block_id:'scene-reuse-direction',to_block_id:'memory-relation-other',kind:'visual_evidence'});
  if(fault==='custody-insert')installCustody(f);
  if(fault==='custody-update')f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='changed-actor' WHERE resource_kind='relation' AND resource_id=?").run(f.relationId);
  if(fault==='custody-delete')f.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='relation' AND resource_id=?").run(f.relationId);
  if(fault==='foreign-owner-custody')installCustody({...f,owner:'foreign-owner'});
  const row=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get(),intent=f.sqlite.prepare('SELECT * FROM memory_derivation_index_intents WHERE job_id=?').get(row.job_id);
  assert.equal(row.state,['unrelated','foreign-owner-custody'].includes(fault)?'active':'withdrawn');assert.equal(intent.operation,['unrelated','foreign-owner-custody'].includes(fault)?'upsert':'delete');
  if(!['unrelated','foreign-owner-custody'].includes(fault)){assert.equal(row.manifest_json,null);assert.equal(row.raw_json,null);assert.equal(intent.generation,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_result_dependencies').get().n,0);}
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_usage').get().n,1);
});

test('relation memory: a rolled-back relation edit cannot partially retire private results',async t=>{
  const f=await nativeRelationResultFixture(t),before=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get();
  const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/runtime.ts');
  const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
  const event=makeEvent(f.streamId,head+1,'user:'+f.owner,'isolated-rollback',crypto.randomUUID(),'BlockRelationRemoved',{project_id:f.projectId,document_id:f.documentId,relation_id:f.relationId});
  const values=eventWriteBindings(event);
  await assert.rejects(()=>f.env.DB.batch([f.env.DB.prepare('INSERT INTO event_write_stage('+EVENT_WRITE_COLUMNS+') VALUES('+values.map(()=>'?').join(',')+')').bind(...values),f.env.DB.prepare("SELECT json('rollback-test')")]));
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM memory_derivation_results').get(),before);
  assert.equal(f.sqlite.prepare('SELECT operation FROM memory_derivation_index_intents').get().operation,'upsert');
});

test('relation memory: isolated D1 atomically retires results and preserves the deletion tombstone',{timeout:180000},async t=>{
  const f=await nativeRelationResultFixture(t),{createRequire}=await import('node:module'),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare'),
    {exportSynthetic,install}=await import('./helpers/model3d-workerd-snapshot.mjs');let outbound=0;
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['RelationMemory'],
    script:"export default {fetch(){return new Response('Isolated',{status:404});}}",outboundService(){outbound++;throw Error('External fetch forbidden');}});
  t.after(async()=>{await mf.dispose();assert.equal(outbound,0);});const db=await mf.getD1Database('RelationMemory');await install(db,exportSynthetic(f.sqlite));f.env.DB=db;
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRelationRemoved',{project_id:f.projectId,document_id:f.documentId,relation_id:f.relationId});
  const row=await db.prepare('SELECT state,manifest_json,raw_json FROM memory_derivation_results WHERE job_id=?').bind(f.stored.job_id).first();
  assert.deepEqual(row,{state:'withdrawn',manifest_json:null,raw_json:null});
  assert.deepEqual(await db.prepare('SELECT operation,generation FROM memory_derivation_index_intents WHERE job_id=?').bind(f.stored.job_id).first(),{operation:'delete',generation:2});
});

for(const fault of ['endpoint-erasure','endpoint-rehome','endpoint-custody','later-endpoint-edit','relation-body'])test('relation binding: supporting endpoint privacy inverse '+fault,async t=>{
  const f=await nativeRelationResultFixture(t),edge=JSON.parse(f.stored.manifest_json).provenance.relationBindings.entries[0];
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_job_sources WHERE event_id=?').get(edge.from.eventIds[0]).n,0);
  if(fault==='endpoint-erasure')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(edge.from.eventIds[0]);
  if(fault==='endpoint-rehome')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRehomed',{project_id:f.projectId,document_id:'foreign',block_id:edge.from.blockId,scope:'document'});
  if(fault==='endpoint-custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'block',?,'actor_private',?,?)").run(f.projectId,f.owner,edge.from.blockId,f.owner,new Date().toISOString());
  if(fault==='later-endpoint-edit')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockPropertyEdited',{project_id:f.projectId,document_id:f.documentId,block_id:edge.from.blockId,property_path:'text',new_value:'A later revision'});
  if(fault==='relation-body')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.kind','changed') WHERE private_event_id=?").run(edge.eventId);
  const row=f.sqlite.prepare('SELECT * FROM memory_derivation_results').get();assert.equal(row.state,fault==='later-endpoint-edit'?'active':'withdrawn');
  if(fault==='later-endpoint-edit')assert.ok(await(await import('../worker/memory-derivation-results.ts')).readNativeDerivationResult(f.env,f.owner,row.job_id));
  else{assert.equal(row.raw_json,null);assert.equal(row.manifest_json,null);assert.equal(f.sqlite.prepare('SELECT operation FROM memory_derivation_index_intents').get().operation,'delete');}
});

for(const fault of ['removed','unknown-endpoint','foreign-document','private-erasure','ambiguous-id','synthetic','oversized','cross-custody'])test('relation binding: exact endpoint interpretation '+fault,async t=>{
  const f=await nativeRelationResultFixture(t),edge=JSON.parse(f.stored.manifest_json).provenance.relationBindings.entries[0];
  if(fault==='removed')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRelationRemoved',{project_id:f.projectId,document_id:f.documentId,relation_id:f.relationId});
  if(fault==='unknown-endpoint')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.to_block_id','unknown') WHERE private_event_id=?").run(edge.eventId);
  if(fault==='foreign-document')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRehomed',{project_id:f.projectId,document_id:'foreign',block_id:edge.from.blockId,scope:'document'});
  if(fault==='private-erasure')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(edge.eventId);
  if(fault==='ambiguous-id')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRelationAdded',{project_id:f.projectId,document_id:f.documentId,relation_id:f.relationId,from_block_id:edge.from.blockId,to_block_id:edge.to.blockId,kind:'visual_evidence'});
  if(fault==='synthetic')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.synthetic',1) WHERE private_event_id=?").run(edge.eventId);
  if(fault==='oversized')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text',?) WHERE private_event_id=?").run('x'.repeat(65536),edge.eventId);
  if(fault==='cross-custody')f.sqlite.prepare("INSERT INTO project_resource_scopes(organization_id,project_access_id,project_id,owner_user_id,resource_kind,resource_id,visibility,actor_user_id,created_at) VALUES('org','access',?,?,'relation',?,'actor_private',?,?)").run(f.projectId,f.owner,f.relationId,f.owner,new Date().toISOString());
  const observations=f.sqlite.prepare("SELECT event_id AS eventId,sequence,type AS eventType,json_extract(payload,'$.relation_id') AS relationId FROM events WHERE json_extract(payload,'$.relation_id')=? ORDER BY sequence").all(f.relationId);
  const {observeNativeMemoryRelationBindings}=await import('../worker/memory-native-relations.ts'),{AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts');
  const witness=new AssistantContextReadWitness(f.env),captured=await observeNativeMemoryRelationBindings(f.env,f.enrollment(),observations,witness);witness.seal(captured);
  if(fault==='removed'){assert.equal(captured.entries.length,1);assert.equal(captured.entries[0].state,'unlinked');assert.equal(captured.unresolved,1);}
  else{assert.equal(captured.entries.length,0);assert.equal(captured.unresolved,observations.length);}
  await f.env.DB.batch(witness.precommitStatements());
});

test('relation binding: whole authenticated result inspection stays within the native request budget',async t=>{
  const f=await nativeRelationResultFixture(t),db=f.env.DB,prepare=db.prepare,batch=db.batch,originals=new WeakMap();let operations=0;
  const wrap=raw=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args));
    if(['all','first','run','raw'].includes(key))return(...args)=>{operations++;return target[key](...args);};return Reflect.get(target,key,target);}});originals.set(proxy,raw);return proxy;};
  db.prepare=function(sql){return wrap(prepare.call(this,sql));};db.batch=function(inputs){operations++;return batch.call(this,inputs.map(input=>originals.get(input)??input));};
  t.after(()=>{db.prepare=prepare;db.batch=batch;});
  const response=await f.request('/api/memory/derivation/result?jobId='+f.stored.job_id);assert.equal(response.status,200,await response.clone().text());
  t.diagnostic(JSON.stringify({operations}));assert.ok(operations<50,'Complete native HTTP inspection must stay below the conservative native limit');
});

for(const boundary of ['ids','bytes'])test('resource union: optimization preserves independent coverage at '+boundary+' limit',async t=>{
  const f=await memoryArtifactFixture(t),{observeNativeMemoryResourceBindings}=await import('../worker/memory-native-relations.ts'),
    {AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts'),scope={project_id:f.projectId,document_id:f.documentId,scope:'document'};
  const count=boundary==='ids'?34:4,ids=[];
  for(let index=0;index<count;index++){
    const id='resource-union-'+index;ids.push(id);
    await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockCreated',{...scope,block_id:id,type:'direction',properties:{text:boundary==='bytes'?'x'.repeat(50000):'Original native block'}});
  }
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockRelationAdded',{...scope,relation_id:'resource-union-link',from_block_id:ids[0],to_block_id:ids[1],kind:'visual_evidence'});
  const direct=f.sqlite.prepare("SELECT event_id AS eventId,sequence,type AS eventType,json_extract(payload,'$.block_id') AS blockPointer FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id') IN(SELECT value FROM json_each(?)) ORDER BY sequence").all(JSON.stringify(ids.slice(2)));
  const relations=f.sqlite.prepare("SELECT event_id AS eventId,sequence,type AS eventType,json_extract(payload,'$.relation_id') AS relationId FROM events WHERE type='BlockRelationAdded' AND json_extract(payload,'$.relation_id')='resource-union-link'").all();
  const witness=new AssistantContextReadWitness(f.env),result=await observeNativeMemoryResourceBindings(f.env,f.enrollment(),direct,relations,witness,{blocks:true,relations:true});
  assert.equal(result.blockBindings.entries.length,count-2);assert.equal(result.blockBindings.unresolved,0);
  assert.equal(result.relationBindings.entries.length,1);assert.equal(result.relationBindings.unresolved,0);
  assert.equal(result.relationBindings.entries[0].from.blockId,ids[0]);assert.equal(result.relationBindings.entries[0].to.blockId,ids[1]);
});

test('governed artifact view: actual selected-project hot writer certifies retained bytes and atomic custody',async t=>{
  const f=await fixture(t,{shared:true,depth:true});
  const refresh=await f.request('/api/events?after=0&content=0');assert.equal(refresh.status,200,await refresh.clone().text());
  const before=f.counts(),response=await f.submit();
  assert.equal(response.status,200,await response.clone().text());const body=await response.json();
  assert.equal(body.appended.length,1);assert.equal(body.appended[0].payload.capture_version,'governed-artifact-view-v1');
  const event=f.sqlite.prepare("SELECT * FROM events WHERE type='DocumentArtifactViewed'").get(),scope=f.sqlite.prepare('SELECT * FROM project_event_scopes WHERE event_id=?').get(event.event_id);
  assert.equal(scope.actor_user_id,f.owner);assert.equal(scope.project_access_id,f.sharing.projectAccessId);assert.equal(scope.source_sequence,event.sequence);
  assert.equal(f.sqlite.prepare('SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId).last_owner_sequence,event.sequence);
  assert.deepEqual(f.counts(),before);assert.equal(body.noAutomaticRetry,true);
});

test('governed artifact consumption: native delivery, v4 inspector and original-backed derivation remain actor-scoped',async t=>{
  const f=await artifactDerivationFixture(t,{shared:true}),view=await f.submit();assert.equal(view.status,200,await view.clone().text());
  const event=(await view.json()).appended[0];assert.equal((await f.run()).status,'completed');
  assert.ok(f.sqlite.prepare('SELECT 1 FROM memory_live_sources WHERE event_id=?').get(event.eventId));
  for(const version of ['memory-consumption-episodes-v2','memory-consumption-episodes-v3']){
    const response=await f.inspect(version),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(body.consumptionEpisodes.sources.filter(row=>row.type==='DocumentArtifactViewed').length,0,'Legacy negotiated contract remains personal-only');
  }
  const response=await f.inspect('memory-consumption-episodes-v4'),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.consumptionEpisodes.sources.length,1);assert.equal(body.consumptionEpisodes.version,'memory-consumption-episodes-v4');
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get(),admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id);assert.ok(lease);
  const captured=await sources.captureNativeDerivationSources(f.env,lease);assert.equal(captured.status,'captured');
  const data=sources.nativeDerivationSourceInputs(f.env,captured.capture);assert.equal(data.originals.length,0);assert.equal(data.observations.length,1);assert.equal(data.observations[0].independentEvidence,false);
  assert.equal(JSON.stringify(data).includes('The keeper checks'),false);
});

for(const fault of ['body','source','custody','event-custody','access','context','epoch','head'])test('governed artifact writer: final atomic boundary refuses '+fault,async t=>{
  const f=await fixture(t,{shared:true,depth:true});assert.equal((await f.request('/api/events?after=0&content=0')).status,200);
  const previous=f.sqlite.prepare('SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId).last_owner_sequence;
  let injected=false;f.controls.beforeBatch=async statements=>{if(injected||!statements.some(insert))return;injected=true;
    if(fault==='body')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.contentRef);
    if(fault==='source')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.original);
    if(fault==='custody')f.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='artifact' AND resource_id=?").run(f.payload.artifact_id);
    if(fault==='event-custody')f.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(f.original);
    if(fault==='access')f.sqlite.prepare("UPDATE organization_projects SET status='archived' WHERE project_access_id=?").run(f.sharing.projectAccessId);
    if(fault==='context')f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.sharing.contextId);
    if(fault==='epoch')f.sqlite.prepare("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z' WHERE user_id=?").run(f.owner);
    if(fault==='head')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentArtifactEdited',{project_id:f.projectId,document_id:f.documentId,artifact_id:f.payload.artifact_id,revision:1});
  };
  const response=await f.submit();assert.equal(response.status,409,await response.clone().text());assert.ok(injected);assert.equal(f.count(),0);
  assert.equal(f.sqlite.prepare('SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId).last_owner_sequence,previous);
});

for(const target of ['event','private','scope','head'])test('governed artifact writer: suppressed '+target+' rolls back the complete receipt',async t=>{
  const f=await fixture(t,{shared:true});assert.equal((await f.request('/api/events?after=0&content=0')).status,200);
  const previous=f.sqlite.prepare('SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId).last_owner_sequence;
  const trigger={event:"BEFORE INSERT ON events WHEN NEW.type='DocumentArtifactViewed'",private:"BEFORE INSERT ON event_private_payloads WHEN json_extract(NEW.private_json,'$.capture_version')='governed-artifact-view-v1'",
    scope:"BEFORE INSERT ON project_event_scopes WHEN EXISTS(SELECT 1 FROM events WHERE event_id=NEW.event_id AND type='DocumentArtifactViewed')",head:'BEFORE UPDATE ON project_migration_states'}[target];
  f.sqlite.exec('CREATE TRIGGER suppress_governed_view '+trigger+' BEGIN SELECT RAISE(IGNORE); END');
  assert.equal((await f.submit()).status,409);assert.equal(f.count(),0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE json_extract(private_json,'$.capture_version')='governed-artifact-view-v1'").get().n,0);
  assert.equal(f.sqlite.prepare('SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId).last_owner_sequence,previous);
});

for(const fault of ['throw','missing','truncated','failed'])test('governed artifact writer: uncertain '+fault+' acknowledgment is never retried',async t=>{
  const f=await fixture(t,{shared:true});assert.equal((await f.request('/api/events?after=0&content=0')).status,200);let writes=0;
  f.controls.afterBatch=(statements,results)=>{if(!statements.some(insert))return;writes++;
    if(fault==='throw')throw Error('Lost acknowledgment');if(fault==='missing')results.length=0;if(fault==='truncated')results.pop();if(fault==='failed')results[0].success=false;};
  const response=await f.submit();assert.equal(response.status,409);assert.equal((await response.json()).noAutomaticRetry,true);assert.equal(writes,1);assert.equal(f.count(),1);
});

test('governed artifact views stay actor-private across member, owner and unselected owner event feeds',async t=>{
  t.mock.method(globalThis,'fetch',async()=>assert.fail('No live providers in privacy qualification'));
  const {createPilotSceneFixture}=await import('./helpers/scene-pilot-fixture.mjs'),f=await createPilotSceneFixture({count:1,member:true,pilot:false});
  t.after(async()=>{await f.drainBackground();f.close();});
  const payload={artifact_id:'saved-scene-story',artifact_kind:'short_story',project_id:f.projectId,document_id:f.documentId,artifact_revision:0,
    content_sha256:createHash('sha256').update(f.content).digest('hex'),source_surface:'document-artifact-gallery'};
  const view=await f.request('/api/events/hot',f.json({action:'hot',event:{type:viewType,payload},clientId:'private-viewer-device',correlationId:'private-viewer-correlation'}));
  assert.equal(view.status,200,await view.clone().text());const event=(await view.json()).appended[0];assert.equal(event.actor,'user:'+f.actorUserId);
  const own=await f.request('/api/events?after=0&content=0');assert.equal(own.status,200);assert.equal((await own.json()).events.find(row=>row.eventId===event.eventId).type,viewType);
  const assertPrivate=async response=>{assert.equal(response.status,200,await response.clone().text());const body=await response.json(),row=body.events.find(row=>row.eventId===event.eventId);assert.ok(row);
    assert.equal(row.type,'ProjectResourceRestricted');assert.deepEqual(row.payload,{restricted:true});assert.equal(row.actor,'private');assert.equal(row.clientId,'private');assert.equal(row.correlationId,'');
    assert.equal(JSON.stringify(row).includes(f.payload.artifact_id??'saved-scene-story'),false);};
  await assertPrivate(await f.asOwner('/api/events?after=0&content=0'));
  f.setScopedHeaders(f.sharing.headers);await assertPrivate(await f.request('/api/events?after=0&content=0'));
  // A subsequent project synchronization must retain the native private receipt without publishing it to the owner.
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentRenamed',{project_id:f.projectId,document_id:f.documentId,new_title:'A later project edit'});
  await assertPrivate(await f.request('/api/events?after=0&content=0'));
  assert.equal(f.sqlite.prepare('SELECT actor_user_id FROM project_event_scopes WHERE event_id=?').get(event.eventId).actor_user_id,f.actorUserId);
  f.setScopedHeaders(f.selectedHeaders);const refreshed=await f.request('/api/events?after=0&content=0');assert.equal((await refreshed.json()).events.find(row=>row.eventId===event.eventId).type,viewType);
});

test('governed artifact history: exact retained view survives later edits and loses authority on source withdrawal',async t=>{
  const f=await memoryArtifactFixture(t,{shared:true}),view=await f.submit();assert.equal(view.status,200);const event=(await view.json()).appended[0];
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentArtifactEdited',{project_id:f.projectId,document_id:f.documentId,artifact_id:f.payload.artifact_id,revision:1});
  assert.equal((await f.request('/api/events?after=0&content=0')).status,200);assert.equal((await f.run()).status,'completed');
  const response=await f.inspect('memory-consumption-episodes-v4'),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.consumptionEpisodes.sources[0].eventId,event.eventId);assert.equal(body.consumptionEpisodes.sources[0].target.revision,0);
  f.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='artifact' AND resource_id=?").run(f.payload.artifact_id);
  const withdrawn=await f.inspect('memory-consumption-episodes-v4');assert.equal(withdrawn.status,200,await withdrawn.clone().text());assert.equal((await withdrawn.json()).consumptionEpisodes.sources.length,0);
});

for(const shared of [false,true])test('native artifact writer and consumption execute in isolated D1 without outbound services shared='+shared,{timeout:180000},async t=>{
  const f=await memoryArtifactFixture(t,{shared}),{createRequire}=await import('node:module'),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare'),
    {exportSynthetic,install}=await import('./helpers/model3d-workerd-snapshot.mjs');let outbound=0;
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['GovernedView'],
    script:"export default {fetch(){return new Response('Isolated',{status:404});}}",outboundService(){outbound++;throw Error('External fetch forbidden');}});
  t.after(async()=>{await mf.dispose();assert.equal(outbound,0);});const db=await mf.getD1Database('GovernedView');await install(db,exportSynthetic(f.sqlite));f.env.DB=db;
  const response=await f.submit();assert.equal(response.status,200,await response.clone().text());const event=(await response.json()).appended[0];
  assert.equal((await f.run()).status,'completed');const inspected=await f.inspect('memory-consumption-episodes-v4');assert.equal(inspected.status,200,await inspected.clone().text());
  assert.equal((await inspected.json()).consumptionEpisodes.sources[0].eventId,event.eventId);
  await db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').bind(event.eventId).run();
  const erased=await f.inspect('memory-consumption-episodes-v4');assert.equal(erased.status,200,await erased.clone().text());assert.equal((await erased.json()).consumptionEpisodes.sources.length,0);
});

for(const shared of [false,true])test('artifact inspector budget: four original sources through the complete HTTP route shared='+shared,async t=>{
  const f=await memoryArtifactFixture(t,{shared});
  for(let index=0;index<4;index++){
    const artifactId=index?'bounded-artifact-'+index:f.payload.artifact_id;
    if(index){await appendAuditEvent(f.env,f.streamId,'worker:renderer','DocumentRenderCompleted',{project_id:f.projectId,document_id:f.documentId,artifact_id:artifactId,
      artifact_kind:'short_story',title:'Bounded original '+index,content_ref:f.contentRef});if(shared)assert.equal((await f.request('/api/events?after=0&content=0')).status,200);}
    const response=await f.submit({artifact_id:artifactId});assert.equal(response.status,200,await response.clone().text());
  }
  assert.equal((await f.run()).status,'completed');
  const db=f.env.DB,prepare=db.prepare,batch=db.batch,originals=new WeakMap();let operations=0;
  const wrap=raw=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args));if(['all','first','run','raw'].includes(key))return(...args)=>{operations++;return target[key](...args);};return Reflect.get(target,key,target);}});originals.set(proxy,raw);return proxy;};
  db.prepare=function(sql){return wrap(prepare.call(this,sql));};db.batch=function(inputs){operations++;return batch.call(this,inputs.map(input=>originals.get(input)??input));};
  t.after(()=>{db.prepare=prepare;db.batch=batch;});
  const response=await f.inspect('memory-consumption-episodes-v4'),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.consumptionEpisodes.sources.length,4);
  t.diagnostic(JSON.stringify({shared,operations}));assert.ok(operations<50,'Complete read must stay below the conservative 50-call D1 budget: '+operations);
});

for(const fault of ['body','event','custody','access','enrollment','receipt-scope','truncated-ack'])test('governed artifact consumption: final replay rejects '+fault,async t=>{
  const f=await memoryArtifactFixture(t,{shared:true}),view=await f.submit();assert.equal(view.status,200);const event=(await view.json()).appended[0];assert.equal((await f.run()).status,'completed');
  let injected=false;const selected=statements=>statements.some(statement=>statement.sql.includes('AS remembered_until')&&statement.values.includes('governed-artifact-view-v1'));
  if(fault==='truncated-ack')f.controls.afterBatch=(statements,results)=>{if(!injected&&selected(statements)){injected=true;results.pop();}};
  else f.controls.beforeBatch=statements=>{if(injected||!selected(statements))return;injected=true;
    if(fault==='body')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.contentRef);
    if(fault==='event')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.original);
    if(fault==='custody')f.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='artifact' AND resource_id=?").run(f.payload.artifact_id);
    if(fault==='access')f.sqlite.prepare("UPDATE organization_projects SET status='archived' WHERE project_access_id=?").run(f.sharing.projectAccessId);
    if(fault==='enrollment')f.sqlite.exec('UPDATE memory_live_enrollments SET recall_enabled=0');
    if(fault==='receipt-scope')f.sqlite.prepare("UPDATE project_event_scopes SET actor_user_id='another-member' WHERE event_id=?").run(event.eventId);
  };
  const response=await f.inspect('memory-consumption-episodes-v4');assert.equal(response.status,403,await response.clone().text());assert.ok(injected);assert.equal((await response.text()).includes(f.payload.content_sha256),false);
});

async function artifactHistoryFrameFixture(t,{shared=false}={}){
  const f=await memoryArtifactFixture(t,{shared}),actor=await liveMemoryPrincipal(f.env,f.owner),authority=await liveMemoryAuthority(f.env,f.enrollment());
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentRenamed',{project_id:f.projectId,document_id:f.documentId,new_title:'A genuine source dependency'});
  if(shared)assert.equal((await f.request('/api/events?after=0&content=0')).status,200);
  const view=await f.submit();assert.equal(view.status,200,await view.clone().text());const event=(await view.json()).appended[0],certifier=await import('../worker/memory-artifact-view.ts');
  const selectors=[{eventId:event.eventId,artifactId:f.payload.artifact_id,documentId:f.documentId,projectId:f.projectId,contentRef:f.contentRef}];
  const frame=async()=>{const frames=await certifier.captureNativeArtifactHistoryFrames(f.env,actor,selectors,shared?authority.binding:undefined);return frames.get(event.eventId);};
  const certify=frame=>certifier.prepareNativeArtifactHistoryFrame(f.env,actor,frame);
  const replay=certificate=>f.env.DB.prepare(`SELECT CASE WHEN (${certificate.source.sql}) THEN 1 ELSE json('artifact-frame-changed') END AS verified`).bind(...certificate.source.bindings).all();
  return Object.assign(f,{actor,authority,event,certifier,selectors,frame,certify,replay});
}
for(const shared of [false,true])for(const fault of ['omitted-dependency','duplicate-row','missing-batch','source-edit','view-erasure','body-erasure','document-removal','authority',...(shared?['custody','projection-state','unindexed-source']:[])])test('native artifact frames: complete original proof survives '+shared+'/'+fault,async t=>{
  const f=await artifactHistoryFrameFixture(t,{shared});
  let injected=false;
  if(['omitted-dependency','duplicate-row','missing-batch'].includes(fault))f.controls.afterBatch=(statements,results)=>{
    if(injected||!statements[0]?.sql.includes('ORDER BY event.sequence LIMIT 513'))return;injected=true;
    if(fault==='missing-batch')results.pop();
    else if(fault==='omitted-dependency')results[0].results=results[0].results.filter(row=>row.type!=='DocumentRenamed');
    else results[0].results[1]=results[0].results[0];
  };
  if(fault==='missing-batch'||fault==='duplicate-row'){await assert.rejects(f.frame);assert.ok(injected);return;}
  const frame=await f.frame(),certificate=await f.certify(frame);assert.ok(!(certificate instanceof Response));
  if(fault==='omitted-dependency'){await assert.rejects(()=>f.replay(certificate));assert.ok(injected);return;}
  assert.equal((await f.replay(certificate)).results[0].verified,1);
  if(fault==='source-edit')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.new_title','Different dependency') WHERE private_event_id IN(SELECT event_id FROM events WHERE type='DocumentRenamed')").run();
  if(fault==='view-erasure')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.event.eventId);
  if(fault==='body-erasure')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(f.contentRef);
  if(fault==='document-removal')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentRemoved',{project_id:f.projectId,document_id:f.documentId});
  if(fault==='authority')f.sqlite.prepare("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z' WHERE user_id=?").run(f.owner);
  if(fault==='custody')f.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='artifact' AND resource_id=?").run(f.payload.artifact_id);
  if(fault==='projection-state')f.sqlite.prepare("UPDATE project_migration_states SET status='pending' WHERE project_access_id=?").run(f.sharing.projectAccessId);
  if(fault==='unindexed-source')await appendAuditEvent(f.env,f.streamId,'worker:renderer','DocumentRenderCompleted',{project_id:f.projectId,document_id:f.documentId,artifact_id:f.payload.artifact_id,artifact_kind:'short_story',content_ref:f.contentRef});
  await assert.rejects(()=>f.replay(certificate));
});

test('native artifact frames: opaque handles cannot cross environment, principal or copied identity',async t=>{
  const f=await artifactHistoryFrameFixture(t),frame=await f.frame();assert.ok(!(await f.certify(frame) instanceof Response));
  assert.ok(await f.certify({...frame}) instanceof Response);
  assert.ok(await f.certifier.prepareNativeArtifactHistoryFrame({...f.env},f.actor,frame) instanceof Response);
  assert.ok(await f.certifier.prepareNativeArtifactHistoryFrame(f.env,{...f.actor,userId:'another'},frame) instanceof Response);
  await assert.rejects(()=>f.certifier.captureNativeArtifactHistoryFrames(f.env,f.actor,Array(5).fill(f.selectors[0])));
});

for(const fault of ['bytes','rows'])test('native artifact frames: '+fault+' overflow is bounded before native hydration',async t=>{
  const f=await artifactHistoryFrameFixture(t);
  if(fault==='bytes')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.new_title',?) WHERE private_event_id IN(SELECT event_id FROM events WHERE type='DocumentRenamed')").run('x'.repeat(1_500_000));
  else for(let i=0;i<513;i++)await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'DocumentOpened',{project_id:f.projectId,document_id:f.documentId});
  let hydrated=null;f.controls.afterBatch=(statements,results)=>{if(statements[0]?.sql.includes('ORDER BY event.sequence LIMIT 513'))hydrated=results[0].results.length;};
  assert.ok(await f.certify(await f.frame()) instanceof Response);assert.equal(hydrated,0);
});

test('native artifact frames: unrelated unindexed appends need no repair but current-view writing stays strict',async t=>{
  const f=await artifactHistoryFrameFixture(t,{shared:true}),before=f.sqlite.prepare('SELECT * FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId);
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'ChatMessageSent',{project_id:f.projectId,document_id:f.documentId,message:'Unrelated synthetic activity'});
  const certificate=await f.certify(await f.frame());assert.ok(!(certificate instanceof Response));assert.equal((await f.replay(certificate)).results[0].verified,1);
  assert.equal((await f.submit()).status,409,'Current-view writer still requires the refreshed native projection');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM project_migration_states WHERE project_access_id=?').get(f.sharing.projectAccessId),before,'Historical certification never repairs a project index');
});

async function nativeBlockInspectionFixture(t,{shared=false,memory=false}={}){
  const f=await (memory?memoryArtifactFixture:fixture)(t,{depth:true,...(shared?{shared:true}:{})}),blockId='genuine-inspected-block';
  const response=await f.request('/api/events',f.json({action:'append',event:{type:'BlockCreated',payload:{project_id:f.projectId,document_id:f.documentId,scope:'document',block_id:blockId,type:'direction',properties:{text:'Original inspected native block'}}}}));
  assert.equal(response.status,200,await response.clone().text());const source=(await response.json()).appended.find(row=>row.type==='BlockCreated');assert.ok(source);
  const payload={project_id:f.projectId,document_id:f.documentId,block_id:blockId,source_event_ids:[source.eventId],source_surface:'document-context-controls'};
  const inspect=(changes={},extra={})=>f.request('/api/events/hot',f.json({action:'hot',event:{type:'BlockInspected',payload:{...payload,...changes}},...extra}));
  return Object.assign(f,{blockId,blockSource:source,blockPayload:payload,inspectBlock:inspect});
}
for(const shared of [false,true])test('native block inspection: genuine current source publication is actor-private '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared}),before=f.counts(),response=await f.inspectBlock();assert.equal(response.status,200,await response.clone().text());
  const event=(await response.json()).appended[0];assert.equal(event.type,'BlockInspected');assert.equal(event.actor,'user:'+f.owner);assert.equal(event.payload.capture_version,'native-block-inspection-v1');assert.match(event.payload.state_sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(event.payload.source_event_ids,[f.blockSource.eventId]);assert.ok(f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(event.eventId));assert.deepEqual(f.counts(),before);
  const {presentActorArtifactView}=await import('../worker/memory-artifact-presentation.ts');assert.equal(presentActorArtifactView(event,'other-actor').type,'ProjectResourceRestricted');assert.equal(presentActorArtifactView(event,f.owner).type,'BlockInspected');
});

for(const shared of [false,true])test('native block inspection: structured relationship history remains separate from field receipts '+shared,async t=>{
 const f=await nativeBlockInspectionFixture(t,{shared,memory:true}),scope={project_id:f.projectId,document_id:f.documentId};
 const root=await f.request('/api/events',f.json({action:'append',event:{type:'BlockCreated',payload:{...scope,scope:'document',block_id:'inspection-context-root',type:'context',properties:{text:'Parent structure'}}}}));assert.equal(root.status,200,await root.clone().text());
 const added=await f.request('/api/events',f.json({action:'append',event:{type:'BlockRelationAdded',payload:{...scope,relation_id:'inspection-relationship',from_block_id:'inspection-context-root',to_block_id:f.blockId,kind:'context_contains',properties:{member_order:0}}}}));assert.equal(added.status,200,await added.clone().text());
 const relationship=(await added.json()).appended.find(event=>event.type==='BlockRelationAdded');assert.ok(relationship);
 const full=[f.blockSource.eventId,relationship.eventId];
 assert.equal((await f.inspectBlock({source_event_ids:full})).status,409,'relationship IDs are not native block-field versions');
 const first=await f.inspectBlock();assert.equal(first.status,200,await first.clone().text());const firstEvent=(await first.json()).appended[0];
 const removed=await f.request('/api/events',f.json({action:'append',event:{type:'BlockRelationRemoved',payload:{...scope,relation_id:'inspection-relationship'}}}));assert.equal(removed.status,200,await removed.clone().text());
 if(shared){
  const before=f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockInspected'").get().n;
  assert.equal((await f.inspectBlock()).status,409,'removed resources require an ordinary project refresh, not a Memory repair');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockInspected'").get().n,before);
  const refresh=await f.request('/api/events?after=0&limit=2000&content=0');assert.equal(refresh.status,200,await refresh.clone().text());
 }
 const second=await f.inspectBlock();assert.equal(second.status,200,await second.clone().text());const secondEvent=(await second.json()).appended[0];
 assert.equal(firstEvent.payload.state_sha256,secondEvent.payload.state_sha256,'field version does not assert a relationship version');
 assert.deepEqual(secondEvent.payload.source_event_ids,[f.blockSource.eventId]);
 assert.equal((await f.run()).status,'completed');
 for(const event of [firstEvent,secondEvent])assert.ok(f.sqlite.prepare('SELECT event_id FROM memory_live_sources WHERE event_id=?').get(event.eventId));
});

async function nativeUndoInspectionFixture(t,{shared=false,type='BlockPropertyEdited',memory=true}={}){
 const f=await nativeBlockInspectionFixture(t,{shared,memory}),scope={project_id:f.projectId,document_id:f.documentId,block_id:f.blockId};
 const fields=type==='BlockPropertyEdited'?{property_path:'text',old_value:'Original inspected native block',new_value:'Revised inspected native block'}
  :type==='ChipEdited'?{property:'text',old_value:'Original inspected native block',new_value:'Revised inspected native block'}
  :type==='BlockRenamed'?{old_handle:f.blockSource.payload.handle??f.blockId,new_handle:'Revised native handle'}
  :type==='BlockWeightSet'?{previous_weight:1,weight:0.5}:{};
 const write=async event=>{const response=await f.request('/api/events',f.json({action:'append',event}));assert.equal(response.status,200,await response.clone().text());return(await response.json()).appended[0];};
 const changed=await write({type,payload:{...scope,...fields}}),payload={...changed.payload};
 if(type==='BlockPropertyEdited'||type==='ChipEdited')[payload.old_value,payload.new_value]=[payload.new_value,payload.old_value];
 if(type==='BlockRenamed')[payload.old_handle,payload.new_handle]=[payload.new_handle,payload.old_handle];
 if(type==='BlockWeightSet')[payload.previous_weight,payload.weight]=[payload.weight,payload.previous_weight];
 const undone=await write({type:type==='BlockLocked'?'BlockUnlocked':type==='BlockRemoved'?'BlockRestored':type,payload,compensatesEventId:changed.eventId});
 if(shared){const refreshed=await f.request('/api/events?after=0&limit=2000&content=0');assert.equal(refreshed.status,200,await refreshed.clone().text());}
 const ids=[f.blockSource.eventId,changed.eventId,undone.eventId];
 return Object.assign(f,{changed,undone,undoSources:ids,inspectUndo:()=>f.inspectBlock({source_event_ids:ids})});
}
for(const shared of [false,true])for(const type of ['BlockPropertyEdited','ChipEdited','BlockRenamed','BlockWeightSet','BlockLocked'])test('native block undo: exact same-author field history '+type+'/'+shared,async t=>{
 const f=await nativeUndoInspectionFixture(t,{shared,type}),before=f.counts(),response=await f.inspectUndo();assert.equal(response.status,200,await response.clone().text());
 const observed=(await response.json()).appended[0];assert.deepEqual(observed.payload.source_event_ids,f.undoSources);assert.deepEqual(f.counts(),before);
 assert.equal((await f.run()).status,'completed');assert.ok(f.sqlite.prepare('SELECT event_id FROM memory_live_sources WHERE event_id=?').get(observed.eventId));
 const {observeNativeMemoryBlockBindings}=await import('../worker/memory-native-blocks.ts'),{AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts');
 const witness=new AssistantContextReadWitness(f.env),source=f.sqlite.prepare('SELECT sequence FROM events WHERE event_id=?').get(f.changed.eventId);
 const historical=await observeNativeMemoryBlockBindings(f.env,f.enrollment(),[{eventId:f.changed.eventId,sequence:source.sequence,blockPointer:f.blockId,eventType:type}],witness);
 assert.equal(historical.entries.length,0,'a later undo cannot certify the earlier field version');assert.equal(historical.unresolved,1);
});
for(const shared of [false,true])test('native block undo: redo and its own reversal remain separately bound '+shared,async t=>{
 const f=await nativeUndoInspectionFixture(t,{shared}),write=async event=>{const response=await f.request('/api/events',f.json({action:'append',event}));assert.equal(response.status,200,await response.clone().text());return(await response.json()).appended[0];};
 const redone=await write({type:f.changed.type,payload:f.changed.payload});
 const undoneAgain=await write({type:f.undone.type,payload:f.undone.payload,compensatesEventId:redone.eventId});
 f.undoSources.push(redone.eventId,undoneAgain.eventId);
 const response=await f.inspectUndo();assert.equal(response.status,200,await response.clone().text());const receipt=(await response.json()).appended[0];
 assert.deepEqual(receipt.payload.source_event_ids,f.undoSources);assert.equal((await f.run()).status,'completed');
 assert.ok(f.sqlite.prepare('SELECT event_id FROM memory_live_sources WHERE event_id=?').get(receipt.eventId));
});
for(const shared of [false,true])for(const fault of ['wrong-inverse','wrong-field','foreign-target','cross-author','private-erased','extra-compensator','undo-chain'])test('native block undo: ambiguous history never publishes '+fault+'/'+shared,async t=>{
 const f=await nativeUndoInspectionFixture(t,{shared});
 if(fault==='wrong-inverse')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.new_value','invented') WHERE private_event_id=?").run(f.undone.eventId);
 if(fault==='wrong-field')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.property_path','different-field') WHERE private_event_id=?").run(f.undone.eventId);
 if(fault==='foreign-target'||fault==='cross-author'){
  // Simulate a damaged restore while preserving the exact immutable schema at
  // the subsequent native read; ordinary app writes cannot update these rows.
  const trigger=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='events_block_update'").get().sql;
  f.sqlite.exec('DROP TRIGGER events_block_update');
  try{if(fault==='foreign-target')f.sqlite.prepare('UPDATE events SET compensates_event_id=? WHERE event_id=?').run(f.blockSource.eventId,f.undone.eventId);
   else f.sqlite.prepare("UPDATE events SET actor='user:other-actor' WHERE event_id=?").run(f.undone.eventId);
  }finally{f.sqlite.exec(trigger);}
 }
 if(fault==='private-erased')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.undone.eventId);
 if(fault==='extra-compensator'||fault==='undo-chain'){
  const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/runtime.ts');
  const head=f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(f.streamId).head;
  const event=makeEvent(f.streamId,head+1,f.undone.actor,'synthetic-native-undo-test',crypto.randomUUID(),'BlockPropertyEdited',f.changed.payload,{compensatesEventId:fault==='undo-chain'?f.undone.eventId:f.changed.eventId});
  f.sqlite.prepare('INSERT INTO event_write_stage('+EVENT_WRITE_COLUMNS+') VALUES('+Array(17).fill('?').join(',')+')').run(...eventWriteBindings(event));
  if(shared){const refreshed=await f.request('/api/events?after=0&limit=2000&content=0');assert.equal(refreshed.status,200);}
  f.undoSources.push(event.eventId);
 }
 const before=f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockInspected'").get().n;
 assert.equal((await f.inspectUndo()).status,409);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockInspected'").get().n,before);
});

for(const shared of [false,true])test('native block inspection: consented capture binds exact versions without plaintext '+shared,async t=>{
  const f=await memoryArtifactFixture(t,{shared}),blockId='memory-observed-context',payload={project_id:f.projectId,document_id:f.documentId,block_id:blockId,scope:'document',type:'direction',properties:{text:'Private inspected block body'}};
  const created=await f.request('/api/events',f.json({action:'append',event:{type:'BlockCreated',payload}}));assert.equal(created.status,200,await created.clone().text());const original=(await created.json()).appended.find(row=>row.type==='BlockCreated');
  const response=await f.request('/api/events/hot',f.json({action:'hot',event:{type:'BlockInspected',payload:{project_id:f.projectId,document_id:f.documentId,block_id:blockId,source_event_ids:[original.eventId],source_surface:'document-context-controls'}}}));
  assert.equal(response.status,200,await response.clone().text());const observed=(await response.json()).appended[0],run=await f.run();assert.equal(run.status,'completed',JSON.stringify(run));
  assert.ok(f.sqlite.prepare('SELECT * FROM memory_live_sources WHERE event_id=?').get(observed.eventId));
  const {captureNativeBlockInspections}=await import('../worker/memory-native-block-inspection.ts'),{AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts'),e=f.enrollment(),a=await liveMemoryAuthority(f.env,e),witness=new AssistantContextReadWitness(f.env);
  const captured=await captureNativeBlockInspections(f.env,e,a,{after:0,through:e.cursor_sequence,remembered:true},witness);assert.equal(captured.sources.length,1);assert.equal(captured.sources[0].version.blockId,blockId);
  assert.equal(JSON.stringify(captured.sources).includes('Private inspected'),false);witness.seal(null);await f.env.DB.batch(witness.precommitStatements());
  f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(original.eventId);await assert.rejects(()=>f.env.DB.batch(witness.precommitStatements()));
});

for(const shared of [false,true])test('native block inspection: fabricated, stale and mixed claims never publish '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared}),count=()=>f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockInspected'").get().n;
  for(const change of [{source_event_ids:[]},{source_event_ids:['unknown']},{source_event_ids:[f.blockSource.eventId,f.blockSource.eventId]},
    {source_event_ids:['optimistic:source']},{block_id:'wrong'},{document_id:'wrong'},{project_id:'wrong'},{source_surface:'library'},
    {capture_version:'native-block-inspection-v1'},{state_sha256:'0'.repeat(64)},{synthetic:true},{actor_user_id:'other'}]){
    const response=await f.inspectBlock(change);assert.ok([400,403,409].includes(response.status),JSON.stringify(change));
  }
  const before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const mixed=await f.inspectBlock({}, {events:[{type:'BlockInspected',payload:f.blockPayload},{type:'DocumentRenamed',payload:{document_id:f.documentId,new_title:'Not written'}}]});assert.equal(mixed.status,400);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n,before);
  await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'BlockPropertyEdited',{project_id:f.projectId,document_id:f.documentId,block_id:f.blockId,property_path:'text',new_value:'Updated source'});
  assert.equal((await f.inspectBlock()).status,409);assert.equal(count(),0);
});
for(const shared of [false,true])for(const fault of ['source-erased','block-removed','document-removed','late-property','lost-ack','false-ack'])test('native block inspection: final '+fault+' '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared});let injected=false;
  const selected=statements=>statements.some(row=>row.sql.startsWith('INSERT INTO event_write_stage(')&&row.values.includes('BlockInspected'));
  if(fault==='lost-ack'||fault==='false-ack')f.controls.afterBatch=async(statements,results)=>{if(!injected&&selected(statements)){injected=true;if(fault==='lost-ack')throw Error('isolated-lost-ack');results.at(-1).results=[{block_inspection_committed:0}];}};
  else f.controls.beforeBatch=async statements=>{if(injected||!selected(statements))return;injected=true;
    if(fault==='source-erased')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.blockSource.eventId);
    if(fault==='block-removed'||fault==='document-removed'||fault==='late-property')await appendAuditEvent(f.env,f.streamId,'user:'+f.owner,
      fault==='block-removed'?'BlockRemoved':fault==='document-removed'?'DocumentRemoved':'BlockPropertyEdited',
      {project_id:f.projectId,document_id:f.documentId,block_id:f.blockId,...(fault==='late-property'?{property_path:'text',new_value:'Changed between capture and commit'}:{})});
  };
  const response=await f.inspectBlock();assert.equal(response.status,409,await response.clone().text());assert.equal(injected,true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockInspected'").get().n,Number(fault==='lost-ack'||fault==='false-ack'));
});

for(const shared of [false,true])test('native block inspection: bounded mixed pages resume without skipping and Forget removes references '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared,memory:true}),ids=[];
  for(let i=0;i<33;i++){
    const response=await f.inspectBlock();assert.equal(response.status,200,await response.clone().text());ids.push((await response.json()).appended[0].eventId);
    if(i===10||i===32){const view=await f.submit();assert.equal(view.status,200,await view.clone().text());ids.push((await view.json()).appended[0].eventId);}
  }
  assert.equal((await f.run()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id IN(SELECT value FROM json_each(?))').get(JSON.stringify(ids)).n,33);
  assert.ok(f.enrollment().cutoff_sequence>f.enrollment().cursor_sequence);
  f.sqlite.exec("UPDATE memory_live_enrollments SET next_due_at='2000-01-01T00:00:00.000Z'");assert.equal((await f.run()).status,'completed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id IN(SELECT value FROM json_each(?))').get(JSON.stringify(ids)).n,35);assert.equal(f.enrollment().cutoff_sequence,null);
  const response=await f.request('/api/memory/settings?id='+f.enrollment().enrollment_id,{...f.json({confirmation:'FORGET_MY_MEMORY',revision:f.enrollment().revision}),method:'DELETE'});
  assert.equal(response.status,200,await response.clone().text());assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources').get().n,0);
});
for(const shared of [false,true])for(const fault of ['source-erased','enrollment-paused','receipt-custody','source-custody','suppressed-reference'])test('native block inspection: atomic capture refuses '+fault+' '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared,memory:true}),cursor=f.enrollment().cursor_sequence,response=await f.inspectBlock();assert.equal(response.status,200,await response.clone().text());const id=(await response.json()).appended[0].eventId;let injected=false;
  f.controls.beforeBatch=statements=>{if(injected||!statements.some(row=>row.sql.startsWith('INSERT INTO memory_live_sources')&&row.values.includes(id)))return;injected=true;
    if(fault==='source-erased')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.blockSource.eventId);
    if(fault==='enrollment-paused')f.sqlite.exec('UPDATE memory_live_enrollments SET learn_enabled=0');
    if(fault==='receipt-custody')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(id);
    if(fault==='source-custody')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(f.blockSource.eventId);
    if(fault==='suppressed-reference')f.sqlite.exec("CREATE TRIGGER suppress_block_reference BEFORE INSERT ON memory_live_sources BEGIN SELECT RAISE(IGNORE); END");
  };
  assert.equal((await f.run()).status,'partial');assert.equal(injected,true);assert.equal(f.enrollment().cursor_sequence,cursor);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_live_sources WHERE event_id=?').get(id).n,0);
});
for(const shared of [false,true])for(const undo of [false,true])test('native block inspection: isolated D1 native writer capture and late erasure '+shared+'/undo='+undo,{timeout:180000},async t=>{
  const f=await (undo?nativeUndoInspectionFixture(t,{shared}):nativeBlockInspectionFixture(t,{shared,memory:true})),{createRequire}=await import('node:module'),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare'),{exportSynthetic,install}=await import('./helpers/model3d-workerd-snapshot.mjs');let outbound=0;
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['BlockInspection'],script:"export default {fetch(){return new Response('Isolated',{status:404});}}",outboundService(){outbound++;throw Error('External fetch forbidden');}});
  t.after(async()=>{await mf.dispose();assert.equal(outbound,0);});const db=await mf.getD1Database('BlockInspection');await install(db,exportSynthetic(f.sqlite));f.env.DB=db;
  const response=await (undo?f.inspectUndo():f.inspectBlock());assert.equal(response.status,200,await response.clone().text());const event=(await response.json()).appended[0],run=await f.run();assert.equal(run.status,'completed',JSON.stringify(run));
  const e=await db.prepare('SELECT * FROM memory_live_enrollments').first(),a=await liveMemoryAuthority(f.env,e),{captureNativeBlockInspections}=await import('../worker/memory-native-block-inspection.ts'),{AssistantContextReadWitness}=await import('../worker/assistant-context-source.ts'),witness=new AssistantContextReadWitness(f.env);
  const capture=await captureNativeBlockInspections(f.env,e,a,{after:0,through:e.cursor_sequence,remembered:true},witness);assert.equal(capture.sources[0].eventId,event.eventId);witness.seal(null);await db.batch(witness.precommitStatements());
  await db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').bind(undo?f.undone.eventId:f.blockSource.eventId).run();await assert.rejects(()=>db.batch(witness.precommitStatements()));assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

for(const shared of [false,true])test('native block inspection: v5 private inspector is exact, bounded and never widens older contracts '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared,memory:true}),response=await f.inspectBlock();assert.equal(response.status,200,await response.clone().text());const event=(await response.json()).appended[0];assert.equal((await f.submit()).status,200);assert.equal((await f.run()).status,'completed');
  const db=f.env.DB,prepare=db.prepare,batch=db.batch,originals=new WeakMap();let operations=0;
  const wrap=raw=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args));if(['all','first','run','raw'].includes(key))return(...args)=>{operations++;return target[key](...args);};return Reflect.get(target,key,target);}});originals.set(proxy,raw);return proxy;};
  db.prepare=function(sql){return wrap(prepare.call(this,sql));};db.batch=function(inputs){operations++;return batch.call(this,inputs.map(input=>originals.get(input)??input));};t.after(()=>{db.prepare=prepare;db.batch=batch;});
  const inspected=await f.inspect('memory-consumption-episodes-v5');assert.equal(inspected.status,200,await inspected.clone().text());const body=await inspected.json(),p=body.consumptionEpisodes;assert.ok(operations<50,'Complete inspector budget '+operations);t.diagnostic(JSON.stringify({shared,operations}));
  assert.equal(p.sources.length,2);const source=p.sources.find(row=>row.eventId===event.eventId);assert.deepEqual(source.target,{kind:'block',documentId:f.documentId,blockId:f.blockId,revision:event.payload.block_revision,stateSha256:event.payload.state_sha256});assert.equal(JSON.stringify(body).includes('Original inspected native block'),false);
  assert.equal(p.coverage.unavailableBlockSourceCount,0);assert.equal(p.episodes[p.sources.indexOf(source)].observations[0].kind,'inspector-open');
  for(const version of ['','memory-consumption-episodes-v1','memory-consumption-episodes-v2','memory-consumption-episodes-v3','memory-consumption-episodes-v4']){const legacy=await f.inspect(version);assert.equal(legacy.status,200,await legacy.clone().text());assert.equal((await legacy.json()).consumptionEpisodes?.sources?.some(row=>row.eventId===event.eventId)??false,false);}
  f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.blockSource.eventId);const withdrawn=await f.inspect('memory-consumption-episodes-v5');assert.equal(withdrawn.status,200,await withdrawn.clone().text());const expired=await withdrawn.json();assert.equal(expired.consumptionEpisodes.sources.some(row=>row.eventId===event.eventId),false);assert.equal(expired.consumptionEpisodes.coverage.unavailableBlockSourceCount,1);
});
for(const shared of [false,true])for(const fault of ['source','receipt','enrollment','truncated-ack'])test('native block inspection: v5 final delivery rejects '+fault+' '+shared,async t=>{
  const f=await nativeBlockInspectionFixture(t,{shared,memory:true}),receipt=await f.inspectBlock();assert.equal(receipt.status,200,await receipt.clone().text());const id=(await receipt.json()).appended[0].eventId;assert.equal((await f.run()).status,'completed');let injected=false;
  const selected=statements=>statements.some(row=>row.sql.includes('AS remembered_until')&&row.values.includes('user:'+f.owner));
  if(fault==='truncated-ack')f.controls.afterBatch=(statements,results)=>{if(!injected&&selected(statements)){injected=true;results.pop();}};
  else f.controls.beforeBatch=statements=>{if(injected||!selected(statements))return;injected=true;
    if(fault==='source'||fault==='receipt')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(fault==='source'?f.blockSource.eventId:id);
    if(fault==='enrollment')f.sqlite.exec('UPDATE memory_live_enrollments SET recall_enabled=0');
  };
  const response=await f.inspect('memory-consumption-episodes-v5');assert.equal(response.status,403,await response.clone().text());assert.equal(injected,true);assert.equal((await response.text()).includes(f.blockId),false);
});

for(const shared of [false,true])test('block rename memory: native edits join capture, recall and reference export without renamed prose '+shared,async t=>{
  const f=await artifactDerivationFixture(t,{shared}),blockId='memory-renamed-context';
  const send=async(type,payload)=>{const response=await f.request('/api/events',f.json({action:'append',event:{type,payload:{project_id:f.projectId,document_id:f.documentId,block_id:blockId,...payload}}}));
    assert.equal(response.status,200,await response.clone().text());return (await response.json()).appended.find(row=>row.type===type);};
  const created=await send('BlockCreated',{scope:'document',type:'direction',properties:{text:'Private original block body'}});
  const renamed=await send('BlockRenamed',{new_handle:'private-do-not-quote-title'});assert.ok(renamed);
  assert.equal((await f.run()).status,'completed');assert.ok(f.sqlite.prepare('SELECT * FROM memory_live_sources WHERE event_id=?').get(renamed.eventId));
  const e=f.enrollment(),recall=await f.request('/api/memory/recall?id='+e.enrollment_id+'&revision='+e.revision);assert.equal(recall.status,200,await recall.clone().text());
  const recalled=await recall.json();assert.ok(recalled.sources.some(row=>row.eventId===renamed.eventId));assert.ok(recalled.consumption.edit>=2);
  assert.equal(JSON.stringify(recalled).includes('private-do-not-quote-title'),false);
  const client=(await import('../src/state/live-memory-client.ts')).createLiveMemoryClient(async(url,init)=>f.request(url,init));
  const row=(await client.settings()).enrollments.find(row=>row.id===e.enrollment_id);assert.ok(row);
  const exported=JSON.parse(await client.exportReferences(row));assert.equal(JSON.stringify(exported).includes('private-do-not-quote-title'),false);
  assert.ok(exported.sources.some(source=>source.eventId===renamed.eventId&&source.action==='edit'));
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get(),admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id),capture=await sources.captureNativeDerivationSources(f.env,lease);assert.equal(capture.status,'captured');
  const value=sources.nativeDerivationSourceInputs(f.env,capture.capture),observation=value.observations.find(row=>row.eventId===renamed.eventId);
  assert.equal(observation.action,'edit');assert.equal(observation.independentEvidence,false);
  const binding=value.provenance.blockBindings.entries.find(row=>row.eventId===renamed.eventId);assert.ok(binding);
  assert.deepEqual(binding.eventIds,[created.eventId,renamed.eventId]);assert.equal(binding.revision,f.sqlite.prepare('SELECT sequence FROM events WHERE event_id=?').get(renamed.eventId).sequence);assert.equal(value.provenance.blockBindings.unresolved,0);
  assert.equal(JSON.stringify(value).includes('private-do-not-quote-title'),false);assert.equal(value.originals.length,0);
  assert.equal(await sources.replayNativeDerivationSources(f.env,capture.capture),true);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.new_handle','late-title') WHERE private_event_id=?").run(renamed.eventId);
  assert.equal(await sources.replayNativeDerivationSources(f.env,capture.capture),false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_finance').get().n,0);
});

for(const shared of [false,true])test('document rename memory: native edit reference has no title and rejects erased source bodies '+shared,async t=>{
  const f=await artifactDerivationFixture(t,{shared});
  const response=await f.request('/api/events',f.json({action:'append',event:{type:'DocumentRenamed',payload:{project_id:f.projectId,document_id:f.documentId,new_title:'Private revised document title'}}}));
  assert.equal(response.status,200,await response.clone().text());const renamed=(await response.json()).appended.find(row=>row.type==='DocumentRenamed');assert.ok(renamed);
  assert.equal((await f.run()).status,'completed');assert.ok(f.sqlite.prepare('SELECT * FROM memory_live_sources WHERE event_id=?').get(renamed.eventId));
  const client=(await import('../src/state/live-memory-client.ts')).createLiveMemoryClient(async(url,init)=>f.request(url,init)),e=f.enrollment();
  const row=(await client.settings()).enrollments.find(row=>row.id===e.enrollment_id),exported=JSON.parse(await client.exportReferences(row));
  assert.ok(exported.sources.some(source=>source.eventId===renamed.eventId&&source.action==='edit'&&source.blockId===null));
  assert.equal(JSON.stringify(exported).includes('Private revised document title'),false);
  const job=f.sqlite.prepare('SELECT * FROM memory_derivation_jobs').get(),admission=await import('../worker/memory-derivation-admission.ts'),sources=await import('../worker/memory-derivation-sources.ts');
  const lease=await admission.claimNativeDerivationJob(f.env,job.job_id),capture=await sources.captureNativeDerivationSources(f.env,lease);assert.equal(capture.status,'captured');
  const value=sources.nativeDerivationSourceInputs(f.env,capture.capture),observation=value.observations.find(row=>row.eventId===renamed.eventId);
  assert.equal(observation.action,'edit');assert.equal(observation.independentEvidence,false);assert.equal(value.originals.length,0);
  assert.equal(JSON.stringify(value).includes('Private revised document title'),false);assert.equal(await sources.replayNativeDerivationSources(f.env,capture.capture),true);
  f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(renamed.eventId);
  assert.equal(await sources.replayNativeDerivationSources(f.env,capture.capture),false);
  const after=JSON.parse(await client.exportReferences(row));assert.ok(!after.sources.some(source=>source.eventId===renamed.eventId));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_derivation_finance').get().n,0);
});
