import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

// Predicate qualification only. These plain DTOs do not mint or impersonate
// native, financial, execution or paid-claim handles. Full runtime success must
// separately exercise the genuine native producer and opaque capability APIs.
const hooks=registerOutputSourceImports();
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0;
globalThis.fetch=()=>{egress++;throw Error('No network in Scene paid-claim SQL qualification');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);hooks.deregister();assert.equal(egress,0);});
const {claimedSceneBudgetGuard}=await import('../worker/pilot-policy.ts');
const {OUTPUT_REQUIREMENTS_SCHEMA}=await import('../worker/output-requirements-schema.ts');
const source=readFileSync(new URL('../worker/experience-sponsor-scene-paid-claim.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('experience-sponsor-scene-paid-claim.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='sameSlotAssertion');
assert.equal(declarations.length,1,'qualify the one exact named source declaration, without substring markers');
const javascript=ts.transpileModule(declarations[0].getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const sameSlotAssertion=new Function(`${javascript}\nreturn sameSlotAssertion;`)();
const strictLimits={functionArguments:32,parameters:100,sqlBytes:100000};
const actor='scene-sql-actor',payer='scene-sql-payer',stream=`creative:${actor}`;

// Deliberately small schema containing all columns read by these two actual SQL
// predicates. The actual native fixture found that an earlier version invented
// document_jobs.project_id; project custody now follows the actual plan table.
// Original failed native evidence is retained separately. There is no admission, campaign approval, schema installation in
// production, financial mutation by the code under test, or native proof claim.
const schema=`
CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,correlation_id TEXT,document_id TEXT,kind TEXT,source_surface TEXT,status TEXT,lease_expires_at TEXT,expires_at TEXT);
CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,grant_id TEXT,plan_revision_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT,maximum_tokens INTEGER,maximum_microusd INTEGER,maximum_calls INTEGER,provider TEXT,model TEXT,route_digest TEXT,attempt_ordinal INTEGER,status TEXT,previous_slot_id TEXT,PRIMARY KEY(scope_key,slot_id));
CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,scope_kind TEXT,owner_user_id TEXT,project_id TEXT,document_id TEXT,PRIMARY KEY(scope_key,plan_revision_id));
CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,actor_user_id TEXT,payer_user_id TEXT,maximum_microusd INTEGER,maximum_calls INTEGER,plan_revision_id TEXT,context_id TEXT,status TEXT,expires_at TEXT,PRIMARY KEY(scope_key,grant_id));
CREATE TABLE output_operation_routes(scope_key TEXT,slot_id TEXT,stage_key TEXT,provider TEXT,model TEXT,maximum_calls INTEGER);
CREATE TABLE budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_tokens INTEGER,used_tokens INTEGER,status TEXT,settled_at TEXT);
CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_microusd INTEGER,used_microusd INTEGER,status TEXT,allow_user_overage INTEGER,workspace_id TEXT,settled_at TEXT);
CREATE TABLE budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_tokens INTEGER,reserved_tokens INTEGER,hard_limit_tokens INTEGER);
CREATE TABLE cost_budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_microusd INTEGER,reserved_microusd INTEGER,hard_limit_microusd INTEGER);
CREATE TABLE project_budget_reservation_scopes(reservation_kind TEXT,reservation_id TEXT);
CREATE TABLE pilot_cost_reservation_scopes(reservation_id TEXT);
CREATE TABLE pilot_cohorts(cohort_id TEXT,organization_id TEXT,status TEXT);
CREATE TABLE pilot_participants(cohort_id TEXT,organization_id TEXT,user_id TEXT,status TEXT,revoked_at TEXT);`;
function fixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());f.sqlite.exec(schema);
  const period=new Date().toISOString().slice(0,7),future=new Date(Date.now()+3_600_000).toISOString();
  const insert=(table,row)=>f.sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  const purchases={};
  for(const suffix of ['a','b']){
    const identity={jobId:`job-${suffix}`,scopeKey:`personal:${actor}`,grantId:`grant-${suffix}`,slotId:`slot-${suffix}`,streamId:stream,correlationId:`job-${suffix}:attempt:1`,period,
      tokenReservationId:`tokens-${suffix}`,costReservationId:`cost-${suffix}`,reservedTokens:128000,reservedMicrousd:1000000,actorUserId:actor,payerUserId:payer};
    const prepared={binding:{documentId:'scene-document',projectId:'scene-project'}};
    const native={provider:'openai',model:'gpt-5.6-terra',routeDigest:suffix.repeat(64)};
    purchases[suffix]={identity,prepared,native};
    insert('document_jobs',{job_id:identity.jobId,owner_id:actor,stream_id:stream,correlation_id:identity.correlationId,document_id:prepared.binding.documentId,
      kind:'render_document',source_surface:'outputs',status:'running',lease_expires_at:future,expires_at:future});
    insert('output_plan_revisions',{scope_key:identity.scopeKey,plan_revision_id:`plan-${suffix}`,scope_kind:'personal',owner_user_id:actor,project_id:prepared.binding.projectId,document_id:prepared.binding.documentId});
    insert('output_operation_slots',{scope_key:identity.scopeKey,slot_id:identity.slotId,job_id:identity.jobId,grant_id:identity.grantId,plan_revision_id:`plan-${suffix}`,
      token_reservation_id:identity.tokenReservationId,cost_reservation_id:identity.costReservationId,maximum_tokens:128000,maximum_microusd:1000000,maximum_calls:1,
      provider:native.provider,model:native.model,route_digest:native.routeDigest,attempt_ordinal:0,status:'running',previous_slot_id:null});
    insert('output_execution_grants',{scope_key:identity.scopeKey,grant_id:identity.grantId,actor_user_id:actor,payer_user_id:payer,maximum_microusd:1000000,maximum_calls:1,
      plan_revision_id:`plan-${suffix}`,context_id:null,status:'active',expires_at:future});
    insert('output_operation_routes',{scope_key:identity.scopeKey,slot_id:identity.slotId,stage_key:'planning:0:initial',provider:native.provider,model:native.model,maximum_calls:1});
    const ledger={owner_id:payer,stream_id:stream,correlation_id:identity.correlationId,operation:'document-render:scene',period};
    insert('budget_reservations',{reservation_id:identity.tokenReservationId,...ledger,reserved_tokens:128000,used_tokens:0,status:'active',settled_at:null});
    insert('cost_budget_reservations',{reservation_id:identity.costReservationId,...ledger,reserved_microusd:1000000,used_microusd:0,status:'executing',allow_user_overage:0,workspace_id:'forma',settled_at:null});
  }
  for(const [scope,scopeId] of [['user',payer],['workspace','forma']]){
    insert('budget_counters',{scope,scope_id:scopeId,period,used_tokens:0,reserved_tokens:256000,hard_limit_tokens:10000000});
    insert('cost_budget_counters',{scope,scope_id:scopeId,period,used_microusd:0,reserved_microusd:2000000,hard_limit_microusd:100000000});
  }
  const limits=enforceD1ExpressionDepth(f,{queryLimits:strictLimits});t.after(()=>limits.restore());
  const tables=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  const snapshot=()=>({schema:f.sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(),version:f.sqlite.prepare('PRAGMA schema_version').get(),
    changes:f.sqlite.prepare('SELECT total_changes() AS total').get(),rows:Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))});
  const prove=async(purchase=purchases.a)=>{
    const before=snapshot(),{identity,prepared,native}=purchase;
    const slot=sameSlotAssertion(identity,prepared,native);
    const ledger=claimedSceneBudgetGuard(f.env,{actorUserId:identity.payerUserId,streamId:identity.streamId,correlationId:identity.correlationId,period:identity.period,
      tokenReservationId:identity.tokenReservationId,costReservationId:identity.costReservationId,reservedTokens:identity.reservedTokens,reservedMicrousd:identity.reservedMicrousd,
      projectScope:null,pilotCohortId:null});
    const statements=[slot,ledger].map(assertion=>f.env.DB.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...assertion.bindings));
    assert.ok(statements.every(statement=>statement.sql.startsWith('SELECT ')));
    const results=await f.env.DB.batch(statements);assert.deepEqual(snapshot(),before,'both predicate reads preserve all rows, schema and total_changes');limits.assertVerified();
    assert.equal(results.length,2);return results.map(result=>result.results[0].current);
  };
  return {...f,purchases,prove,limits,insert};
}

test('Scene paid SQL minimal custody columns belong to the actual native job and plan schemas',()=>{
  const runtime=readFileSync(new URL('../worker/runtime.ts',import.meta.url),'utf8');
  const runtimeAst=ts.createSourceFile('runtime.ts',runtime,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),jobDdl=[];
  const visit=node=>{if(ts.isStringLiteral(node)&&node.text.startsWith('CREATE TABLE IF NOT EXISTS document_jobs ('))jobDdl.push(node.text);ts.forEachChild(node,visit);};
  visit(runtimeAst);assert.equal(jobDdl.length,1,'use the actual named native job CREATE TABLE literal');
  const planDdl=OUTPUT_REQUIREMENTS_SCHEMA.filter(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS output_plan_revisions('));assert.equal(planDdl.length,1);
  const actual=new DatabaseSync(':memory:'),minimum=new DatabaseSync(':memory:');
  try{
    actual.exec(jobDdl[0]);actual.exec(planDdl[0]);minimum.exec(schema);
    for(const table of ['document_jobs','output_plan_revisions']){
      const actualColumns=new Set(actual.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
      for(const column of minimum.prepare(`PRAGMA table_info(${table})`).all())assert.ok(actualColumns.has(column.name),`${table}.${column.name} must exist in actual native schema`);
    }
    assert.equal(actual.prepare('PRAGMA table_info(document_jobs)').all().some(row=>row.name==='project_id'),false);
  }finally{minimum.close();actual.close();}
});

test('Scene paid SQL: two independent actor/payer purchases each satisfy the actual same-slot and ledger guards',async t=>{
  const f=fixture(t);assert.notEqual(actor,payer);
  assert.deepEqual(await f.prove(f.purchases.a),[1,1]);assert.deepEqual(await f.prove(f.purchases.b),[1,1]);
  assert.equal(f.limits.records.length,2);assert.ok(f.limits.boundCounts.every(count=>count===1));
  t.diagnostic('Pure SQL only: 2 read statements, 1 binding each, expression depth 100 / function args 32 / parameters 100 / SQL bytes 100000; no native brands exercised.');
});

test('Scene paid SQL accepts the exact queued slot before native provider-call claiming changes it to running',async t=>{
  const f=fixture(t);f.sqlite.prepare("UPDATE output_operation_slots SET status='queued' WHERE slot_id='slot-a'").run();
  assert.deepEqual(await f.prove(),[1,1]);
  // The slot can be queued while its original native job is already claimed.
  // This never permits a merely queued job to dispatch without a current lease.
  f.sqlite.prepare("UPDATE document_jobs SET status='queued' WHERE job_id='job-a'").run();assert.deepEqual(await f.prove(),[0,1]);
});

const mixes=[
  ['foreign job',p=>{p.identity.jobId='job-b';}],
  ['foreign slot',p=>{p.identity.slotId='slot-b';}],
  ['foreign grant',p=>{p.identity.grantId='grant-b';}],
  ['foreign token reservation',p=>{p.identity.tokenReservationId='tokens-b';}],
  ['foreign cost reservation',p=>{p.identity.costReservationId='cost-b';}],
  ['foreign correlation',p=>{p.identity.correlationId='job-b:attempt:1';}],
  ['valid foreign ledger with original job',p=>{Object.assign(p.identity,{tokenReservationId:'tokens-b',costReservationId:'cost-b',correlationId:'job-b:attempt:1'});},[0,1]],
  ['foreign whole slot and ledger with original job',(p,f)=>{p.identity={...f.purchases.b.identity,jobId:p.identity.jobId};p.native={...f.purchases.b.native};},[0,1]],
  ['token maximum',p=>{p.identity.reservedTokens++;}],
  ['money maximum',p=>{p.identity.reservedMicrousd++;}],
  ['prior period',p=>{p.identity.period='2000-01';}],
  ['foreign route',p=>{p.native.routeDigest='b'.repeat(64);},[0,1]],
  ['creative actor replaced by payer',p=>{p.identity.actorUserId=payer;},[0,1]],
  ['payer replaced by actor',p=>{p.identity.payerUserId=actor;}],
  ['different document',p=>{p.prepared.binding.documentId='other';},[0,1]],
  ['different project',p=>{p.prepared.binding.projectId='other';},[0,1]],
];
for(const [name,change,expected] of mixes)test(`Scene paid SQL refuses ${name} across otherwise valid purchases`,async t=>{
  const f=fixture(t);assert.deepEqual(await f.prove(f.purchases.b),[1,1]);const candidate=structuredClone(f.purchases.a);change(candidate,f);
  const result=await f.prove(candidate);assert.equal(result.every(value=>value===1),false);if(expected)assert.deepEqual(result,expected);
});

const mutations=[
  ['used token hold',"UPDATE budget_reservations SET used_tokens=1 WHERE reservation_id='tokens-a'",[1,0]],
  ['used money hold',"UPDATE cost_budget_reservations SET used_microusd=1 WHERE reservation_id='cost-a'",[1,0]],
  ['released token hold',"UPDATE budget_reservations SET status='released' WHERE reservation_id='tokens-a'",[1,0]],
  ['released money hold',"UPDATE cost_budget_reservations SET status='released' WHERE reservation_id='cost-a'",[1,0]],
  ['settled token timestamp',"UPDATE budget_reservations SET settled_at='2026-01-01' WHERE reservation_id='tokens-a'",[1,0]],
  ['settled money timestamp',"UPDATE cost_budget_reservations SET settled_at='2026-01-01' WHERE reservation_id='cost-a'",[1,0]],
  ['refunded money counter',"UPDATE cost_budget_counters SET reserved_microusd=0 WHERE scope='user'",[1,0]],
  ['refunded token counter',"UPDATE budget_counters SET reserved_tokens=0 WHERE scope='user'",[1,0]],
  ['exceeded money counter',"UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='workspace'",[1,0]],
  ['exceeded token counter',"UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='workspace'",[1,0]],
  ['money overage enabled',"UPDATE cost_budget_reservations SET allow_user_overage=1 WHERE reservation_id='cost-a'",[1,0]],
  ['project-attached token hold',"INSERT INTO project_budget_reservation_scopes VALUES('tokens','tokens-a')",[1,0]],
  ['project-attached money hold',"INSERT INTO project_budget_reservation_scopes VALUES('usd','cost-a')",[1,0]],
  ['pilot-attached money hold',"INSERT INTO pilot_cost_reservation_scopes VALUES('cost-a')",[1,0]],
  ['payer newly in pilot',`INSERT INTO pilot_cohorts VALUES('cohort','org','active');INSERT INTO pilot_participants VALUES('cohort','org','${payer}','active',NULL)`,[1,0]],
  ['token ledger actor changed',`UPDATE budget_reservations SET owner_id='${actor}' WHERE reservation_id='tokens-a'`],
  ['money ledger correlation changed',"UPDATE cost_budget_reservations SET correlation_id='other' WHERE reservation_id='cost-a'"],
  ['money ledger period changed',"UPDATE cost_budget_reservations SET period='2000-01' WHERE reservation_id='cost-a'"],
  ['token ledger maximum changed',"UPDATE budget_reservations SET reserved_tokens=127999 WHERE reservation_id='tokens-a'"],
  ['money ledger maximum changed',"UPDATE cost_budget_reservations SET reserved_microusd=999999 WHERE reservation_id='cost-a'"],
  ['expired job lease',"UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE job_id='job-a'",[0,1]],
  ['expired job',"UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id='job-a'",[0,1]],
  ['expired execution grant',"UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE grant_id='grant-a'",[0,1]],
  ['completed job',"UPDATE document_jobs SET status='completed' WHERE job_id='job-a'",[0,1]],
  ['nonrunning slot',"UPDATE output_operation_slots SET status='succeeded' WHERE slot_id='slot-a'",[0,1]],
  ['revoked execution grant',"UPDATE output_execution_grants SET status='revoked' WHERE grant_id='grant-a'",[0,1]],
  ['route model changed',"UPDATE output_operation_routes SET model='other-model' WHERE slot_id='slot-a'",[0,1]],
  ['extra route',"INSERT INTO output_operation_routes VALUES('personal:scene-sql-actor','slot-a','planning:0:repair','openai','gpt-5.6-terra',1)",[0,1]],
  ['extra sibling slot',"UPDATE output_operation_slots SET grant_id='grant-a' WHERE slot_id='slot-b'",[0,1]],
  ['recovery ordinal',"UPDATE output_operation_slots SET attempt_ordinal=1,previous_slot_id='original' WHERE slot_id='slot-a'",[0,1]],
  ['extra maximum call',"UPDATE output_operation_slots SET maximum_calls=2 WHERE slot_id='slot-a'",[0,1]],
  ['route maximum call',"UPDATE output_operation_routes SET maximum_calls=2 WHERE slot_id='slot-a'",[0,1]],
  ['changed plan revision',"UPDATE output_execution_grants SET plan_revision_id='other' WHERE grant_id='grant-a'",[0,1]],
  ['foreign plan owner',"UPDATE output_plan_revisions SET owner_user_id='other' WHERE plan_revision_id='plan-a'",[0,1]],
  ['foreign plan document',"UPDATE output_plan_revisions SET document_id='other' WHERE plan_revision_id='plan-a'",[0,1]],
  ['foreign plan project',"UPDATE output_plan_revisions SET project_id='other' WHERE plan_revision_id='plan-a'",[0,1]],
  ['project-scoped plan',"UPDATE output_plan_revisions SET scope_kind='project' WHERE plan_revision_id='plan-a'",[0,1]],
  ['missing original plan',"DELETE FROM output_plan_revisions WHERE plan_revision_id='plan-a'",[0,1]],
  ['foreign plan scope key',"UPDATE output_plan_revisions SET scope_key='other' WHERE plan_revision_id='plan-a'",[0,1]],
  ['unexpected context',"UPDATE output_execution_grants SET context_id='other' WHERE grant_id='grant-a'",[0,1]],
];
for(const [name,sql,expected] of mutations)test(`Scene paid SQL refuses ${name} at the final snapshot`,async t=>{
  const f=fixture(t);f.sqlite.exec(sql);const result=await f.prove();assert.equal(result.every(value=>value===1),false);if(expected)assert.deepEqual(result,expected);
});
