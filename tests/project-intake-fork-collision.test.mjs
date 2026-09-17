import assert from 'node:assert/strict';
import test from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';

const resolver=registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{readWorkspaceEvents},{foldEvents},{projectIntake}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../src/model/events.ts'),import('../src/model/project-intake.ts'),
]).catch(error=>{resolver.deregister();throw error;});
test.after(()=>resolver.deregister());

const oldProject='10000000-0000-4000-8000-000000000001';
const sourceId='10000000-0000-4000-8000-000000000002';
const targetId='10000000-0000-4000-8000-000000000003';
const newProject='20000000-0000-4000-8000-000000000001';
const freshId='20000000-0000-4000-8000-000000000002';
const intakeEvents=documentId=>[
  {type:'ProjectCreated',payload:{project_id:newProject,name:'New intake project',state:'active'}},
  {type:'DocumentCreated',payload:{project_id:newProject,document_id:documentId,title:'Replacement intake title',handle:'replacement-intake'}},
  {type:'EmptyCanvasChosen',payload:{project_id:newProject,document_id:documentId,source_surface:'projects'}},
];

async function fixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  const actor='intake-fork-collision',stream='creative:'+actor;
  const headers={'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.invalid'};
  let networkCalls=0,mediaCalls=0;
  t.mock.method(globalThis,'fetch',()=>{networkCalls++;throw Error('Intake collision tests forbid network/provider calls');});
  for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{mediaCalls++;throw Error('Intake collision tests forbid media calls');};
  t.after(()=>{assert.equal(networkCalls,0);assert.equal(mediaCalls,0);});
  const send=async body=>{
    const response=await handleEvents(new Request('http://localhost/api/events',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)}),f.env);
    return {response,body:await response.json()};
  };
  const batch=async events=>{
    const result=await send({action:'batch',clientId:'test:intake-fork',correlationId:'test:intake-fork',events});
    assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.body.appended.length,events.length);return result.body;
  };
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,actor);
  assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers}),f.env)).status,200);
  const rows=(table,where='',bindings=[])=>f.sqlite.prepare(`SELECT * FROM ${table}${where} ORDER BY rowid`).all(...bindings);
  const snapshot=()=>({
    events:rows('events',' WHERE stream_id=?',[stream]),
    privatePayloads:rows('event_private_payloads',' WHERE owner_id=?',[actor]),
    receipts:rows('event_client_receipts',' WHERE stream_id=?',[stream]),
    head:f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) head FROM events WHERE stream_id=?').get(stream).head,
    financial:Object.fromEntries(['document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters']
      .filter(table=>f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)).map(table=>[table,rows(table)])),
  });
  const history=()=>readWorkspaceEvents(f.env,stream);
  const fold=async(documentId,projectId)=>foldEvents(await history(),Infinity,documentId,projectId);
  const intake=(events,action='commit')=>{
    assert.ok(projectIntake(events),'The candidate must satisfy the actual ordinary intake grammar');
    return send({action:'project_intake',intakeAction:action,events});
  };
  return {...f,actor,stream,batch,snapshot,history,fold,intake};
}

for(const originType of ['DocumentCreated','DocumentForked'])for(const removed of [false,true]){
  test(`intake refuses ${removed?'removed':'live'} ${originType} identity without changing its native state`,async t=>{
    const f=await fixture(t);
    await f.batch([
      {type:'ProjectCreated',payload:{project_id:oldProject,name:'Original native project',state:'active'}},
      {type:'DocumentCreated',payload:{project_id:oldProject,document_id:sourceId,title:'Source document',handle:'source-document'}},
      {type:originType,payload:{project_id:oldProject,document_id:targetId,title:'Original document identity',handle:'original-document',
        ...(originType==='DocumentForked'?{source_document_id:sourceId}:{})}},
      ...(removed?[{type:'DocumentRemoved',payload:{project_id:oldProject,document_id:targetId}}]:[]),
    ]);
    const before=f.snapshot(),original=await f.fold(targetId,oldProject);
    assert.equal(original.documents.some(document=>document.id===targetId),!removed);
    const result=await f.intake(intakeEvents(targetId)),after=f.snapshot();
    t.diagnostic(JSON.stringify({originType,removed,status:result.response.status,error:result.body.error??null,
      eventDelta:after.events.length-before.events.length,privatePayloadDelta:after.privatePayloads.length-before.privatePayloads.length,
      receiptDelta:after.receipts.length-before.receipts.length,headDelta:after.head-before.head}));
    assert.equal(result.response.status,409);assert.equal(result.body.status,'unknown');
    assert.deepEqual(after,before,'Refusal must roll back every event, private envelope, receipt and head increment');
    assert.deepEqual(await f.fold(targetId,oldProject),original,'The native reducer must retain the exact original document state');
    assert.equal((await f.history()).some(event=>event.type==='DocumentRestored'),false);
  });
}

test('intake refuses a fork created after its absent-receipt read at a current native head',async t=>{
  const f=await fixture(t);
  await f.batch([
    {type:'ProjectCreated',payload:{project_id:oldProject,name:'Original native project',state:'active'}},
    {type:'DocumentCreated',payload:{project_id:oldProject,document_id:sourceId,title:'Source document',handle:'source-document'}},
  ]);
  const prepare=f.DB.prepare.bind(f.DB),batch=f.DB.batch.bind(f.DB);
  let injected=false,accepted=null,projection=null,intakeBatches=0;
  f.DB.prepare=sql=>{
    const statement=prepare(sql);
    if(!sql.startsWith('SELECT expected.value AS requested_key'))return statement;
    const wrap=current=>{
      const bind=current.bind.bind(current),all=current.all.bind(current);
      current.bind=(...values)=>wrap(bind(...values));
      current.all=async()=>{
        const result=await all();
        if(!injected){
          assert.equal(result.results.length,3);assert.ok(result.results.every(row=>row.receipt_key===null&&row.receipt_total===0));
          injected=true;
          await f.batch([{type:'DocumentForked',payload:{project_id:oldProject,document_id:targetId,source_document_id:sourceId,title:'Late original fork',handle:'late-original-fork'}}]);
          accepted=f.snapshot();projection=await f.fold(targetId,oldProject);
        }
        return result; // Preserve the actual original DB response and authority.
      };
      return current;
    };
    return wrap(statement);
  };
  f.DB.batch=async statements=>{
    if(statements.some(statement=>statement.sql.includes('VALUES(?,?,CASE WHEN')&&statement.sql.includes('event_client_receipts'))){
      intakeBatches++;assert.ok(accepted);
      const staged=statements.filter(statement=>statement.sql.startsWith('INSERT INTO event_write_stage'));
      assert.equal(staged.length,3);
      assert.equal(staged[0].bindings.at(-1),accepted.head,'The native append must use the head after the actual fork injection');
      assert.equal(f.snapshot().head,accepted.head,'No stale-head failure may substitute for the identity guard');
    }
    return batch(statements);
  };
  let result;
  try{result=await f.intake(intakeEvents(targetId));}
  finally{f.DB.prepare=prepare;f.DB.batch=batch;}
  assert.equal(injected,true);assert.equal(intakeBatches,1);
  assert.equal(result.response.status,409);assert.equal(result.body.status,'unknown');
  assert.deepEqual(f.snapshot(),accepted,'The intake adds no state beyond the separately accepted original fork');
  assert.deepEqual(await f.fold(targetId,oldProject),projection);
});

for(const removed of [false,true])test(`fresh ordinary intake preserves exact Check and repeat commit after ${removed?'original removal':'creation'}`,async t=>{
  const f=await fixture(t),events=intakeEvents(freshId),before=f.snapshot();
  const missing=await f.intake(events,'check');assert.equal(missing.response.status,409);assert.deepEqual(f.snapshot(),before);
  const committed=await f.intake(events);assert.equal(committed.response.status,200,JSON.stringify(committed.body));
  assert.equal(committed.body.status,'complete');assert.equal(committed.body.appended.length,events.length);
  const created=f.snapshot();assert.equal(created.events.length-before.events.length,3);
  assert.equal(created.privatePayloads.length-before.privatePayloads.length,3);assert.equal(created.receipts.length-before.receipts.length,3);
  assert.equal(created.head-before.head,3);assert.deepEqual(created.financial,before.financial);
  assert.equal((await f.fold(freshId,newProject)).documents.some(document=>document.id===freshId),true);
  if(removed)await f.batch([{type:'DocumentRemoved',payload:{project_id:newProject,document_id:freshId}}]);
  const accepted=f.snapshot(),projection=await f.fold(freshId,newProject);
  assert.equal(projection.documents.some(document=>document.id===freshId),!removed);
  for(const action of ['check','commit']){
    const repeated=await f.intake(events,action);assert.equal(repeated.response.status,200,JSON.stringify(repeated.body));
    assert.equal(repeated.body.status,'complete');assert.equal(repeated.body.head,accepted.head);
    assert.deepEqual(repeated.body.appended,committed.body.appended,'Recovery must return the exact original receipt and event identities');
    assert.deepEqual(f.snapshot(),accepted);assert.deepEqual(await f.fold(freshId,newProject),projection);
  }
});
