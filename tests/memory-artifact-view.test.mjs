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

async function memoryArtifactFixture(t) {
  const f=await fixture(t,{depth:true});
  for(const name of ['0020_assistant_runtime_tables.sql','0021_assistant_specialist_consent.sql','0025_memory_live_base.sql','0026_memory_live_conversation.sql'])
    f.sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  Object.assign(f.env,{FORMA_MEMORY_ENABLED:'true',FORMA_MEMORY_USER_IDS:f.owner,FORMA_MEMORY_SCHEDULING_ENABLED:'true'});
  const timeZone=Intl.supportedValuesOf('timeZone').find(zone=>{const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date()));return hour>=1&&hour<5;});
  const preferences={projectId:f.projectId,documentId:f.documentId,learn:true,recall:true,background:true,retentionDays:30,timeZone,
    expiresAt:new Date(Date.now()+30*86400000).toISOString(),revision:0,confirmation:'ENABLE_PERSONAL_MEMORY',policyVersion:'personal-memory-v2',
    reviewTiming:'daily-with-daytime-catch-up',expectedCustody:{kind:'personal'}};
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
  const selected=statements=>statements.some(statement=>statement.sql.includes('AS remembered_until')&&statement.sql.includes('personal-artifact-view-v2'));
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
      if (mutation === 'permission-epoch') f.sqlite.prepare("UPDATE users SET permission_epoch='withdrawn' WHERE user_id=?").run(f.owner);
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
  assert.equal((await f.submit()).status, 403);
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

async function artifactDerivationFixture(t){
  const f=await memoryArtifactFixture(t);
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
  assert.equal(body.consumptionEpisodes.coverage.unavailableArtifactSourceCount,1);assert.deepEqual(f.counts(),money);
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
