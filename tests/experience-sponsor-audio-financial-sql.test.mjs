import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

// Synthetic relational qualification only. Fixture rows never mint financial,
// native, admission, execution or paid-call capabilities. The separate actual
// native fixture qualifies original admission/Run and the expiry relationship.
const hooks=registerOutputSourceImports();
const savedFetch=globalThis.fetch;let egress=0;
globalThis.fetch=()=>{egress++;throw Error('No network in Audio financial SQL qualification');};
after(()=>{globalThis.fetch=savedFetch;hooks.deregister();assert.equal(egress,0);});
const {AUDIO_FINANCIAL_FROM}=await import('../worker/experience-sponsor-audio-financial.ts');
const [{estimateOpenAITextCallMaximumMicrousd},{STABLE_AUDIO_ADAPTER_CONTRACT,estimateAudioProviderCostMicrousd},{EXPERIENCE_AUDIO_INTENT}]=await Promise.all([
 import('../worker/openai-text-cost.ts'),import('../src/model/audio.ts'),import('../src/experiences/contracts.ts'),
]);
const actor='audio-financial-actor',payer='audio-financial-payer',stream=`creative:${actor}`;
const maximumMicrousd=1037600,maximumTokens=128000,audioModel='fal-ai/stable-audio-3/medium/text-to-audio';
const sha=hex=>`sha256:${hex.repeat(64)}`;
const oldDeadline=Date.parse('2025-09-17T12:34:56.789Z'),createdAt='2025-09-17T12:30:00.000Z';
const strictLimits={functionArguments:32,parameters:100,sqlBytes:100000};
const select=`SELECT execution.payer_user_id,execution.grant_id,slot.scope_key,slot.slot_id,
 consumption.consumption_id,consumption.campaign_id,issued.grant_id AS issued_grant_id,issued.policy_digest,
 consumption.envelope_digest,slot.cost_reservation_id,slot.token_reservation_id ${AUDIO_FINANCIAL_FROM}`;
const pinned=`SELECT CASE WHEN (EXISTS(SELECT 1 ${AUDIO_FINANCIAL_FROM}
 AND execution.payer_user_id=? AND execution.grant_id=? AND slot.scope_key=? AND slot.slot_id=?
 AND consumption.consumption_id=? AND consumption.campaign_id=? AND issued.grant_id=? AND issued.policy_digest=?
 AND consumption.envelope_digest=? AND slot.cost_reservation_id=? AND slot.token_reservation_id=?)) THEN 1 ELSE 0 END AS current`;

// Read the actual named CREATE TABLE literals: no invented columns and no
// approximated schema. Foreign keys and immutable triggers are omitted only in
// the corruption-probe fixture, so each SQL refusal can be observed directly.
function literals(path){
 const source=readFileSync(new URL(path,import.meta.url),'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),values=[];
 const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))values.push(node.text);ts.forEachChild(node,visit);};visit(ast);return values;
}
const schemas=[...literals('../worker/runtime.ts'),...literals('../worker/output-requirements-schema.ts'),
 ...literals('../worker/experience-sponsor-entitlement.ts'),...literals('../worker/experience-sponsor-issuer.ts')];
const tables=['document_jobs','output_operation_slots','output_execution_grants','output_plan_revisions','output_operation_routes',
 'experience_sponsor_campaigns','experience_sponsor_consumptions','experience_sponsor_grants','experience_sponsor_issuances','budget_reservations','cost_budget_reservations',
 'project_budget_reservation_scopes','pilot_cost_reservation_scopes'];
const schema=tables.map(table=>{
 const matches=schemas.filter(sql=>new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(`,'u').test(sql));
 assert.equal(matches.length,1,`exact native schema for ${table}`);return matches[0];
});
function fixture(t){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());f.sqlite.exec('PRAGMA foreign_keys=OFF');for(const sql of schema)f.sqlite.exec(sql);
 const insert=(table,row)=>{
  const columns=f.sqlite.prepare(`PRAGMA table_info(${table})`).all();
  const complete={...Object.fromEntries(columns.filter(c=>c.notnull&&c.dflt_value===null&&!Object.hasOwn(row,c.name)).map(c=>[c.name,c.type==='INTEGER'?1:'fixture'])),...row};
  f.sqlite.prepare(`INSERT INTO ${table} (${Object.keys(complete).join(',')}) VALUES (${Object.keys(complete).map(()=>'?').join(',')})`).run(...Object.values(complete));
 };
 const purchases={};
 for(const suffix of ['a','b']){
  const jobId=`audio-${suffix.repeat(64)}`,scopeKey=`personal:${actor}`,grantId=`execution-${suffix}`,slotId=`slot-${suffix}`,planId=`plan-${suffix}`;
  const tokenReservationId=`tokens-${suffix}`,costReservationId=`cost-${suffix}`,issuedId=`issued-${suffix}`,campaignId=`campaign-${suffix}`,consumptionId=`consumption-${suffix}`;
  const sourceDigest=suffix.repeat(64),routeDigest=(suffix==='a'?'c':'d').repeat(64),envelopeDigest=sha(suffix==='a'?'e':'f'),sessionDigest=sha('1'),policyDigest=sha('2');
  const expiresAt=new Date(oldDeadline).toISOString(),intentKey=`intent-${suffix}`,correlationId=`${jobId}:attempt:1`;
  const envelope={version:8,family:'canonical-instrumental-cue@1',campaignId,consumptionId,intentKey,actorKind:'canonical-principal',actorUserId:actor,
   sessionDigest,payerUserId:payer,ownerUserId:actor,projectId:`project-${suffix}`,documentId:`document-${suffix}`,sourceRevision:12,sourceDigest:`sha256:${sourceDigest}`,
   issuedAtMs:Date.parse(createdAt),expiresAtMs:oldDeadline-1000,originalRequestId:jobId,originalExpiresAtMs:oldDeadline,audioActorRequestDigest:sha('3'),audioSponsorReviewDigest:sha('4'),
   recipe:{appId:'audio',outputKind:'audio',provider:'fal',model:audioModel,routeDigest:`sha256:${routeDigest}`,maximumTokens,maximumMicrousd,
    calls:{parsing:0,planning:1,render:1,repair:1},outputCount:1,durationMs:20000,width:0,height:0}};
  insert('document_jobs',{job_id:jobId,owner_id:actor,stream_id:stream,document_id:envelope.documentId,kind:'render_document',status:'failed',source_surface:'outputs',
   correlation_id:correlationId,requested_sequence:12,request_json:'PRIVATE REQUEST MUST NOT BE READ',result_json:'PRIVATE RESULT MUST NOT BE READ',expires_at:new Date(oldDeadline+30*86400000).toISOString(),requested_at:createdAt,updated_at:createdAt});
  insert('output_plan_revisions',{scope_key:scopeKey,scope_kind:'personal',owner_user_id:actor,project_id:envelope.projectId,document_id:envelope.documentId,organization_id:null,project_access_id:null,
   plan_revision_id:planId,plan_id:planId,revision:1,source_digest:sourceDigest,source_head:12,target_count:1,created_at:createdAt});
  insert('output_execution_grants',{scope_key:scopeKey,grant_id:grantId,plan_revision_id:planId,actor_user_id:actor,payer_user_id:payer,context_id:null,
   maximum_microusd:maximumMicrousd,maximum_calls:3,status:'revoked',expires_at:expiresAt,created_at:createdAt});
  insert('output_operation_slots',{scope_key:scopeKey,slot_id:slotId,grant_id:grantId,plan_revision_id:planId,target_id:`target-${suffix}`,source_digest:sourceDigest,provider:'fal',model:audioModel,
   route_digest:routeDigest,job_id:jobId,cost_reservation_id:costReservationId,token_reservation_id:tokenReservationId,maximum_microusd:maximumMicrousd,maximum_calls:3,maximum_tokens:maximumTokens,
   attempt_ordinal:0,previous_slot_id:null,status:'uncertain',created_at:createdAt,updated_at:createdAt});
  for(const stage of ['planning:0:initial','planning:0:repair','audio:initial'])insert('output_operation_routes',{scope_key:scopeKey,slot_id:slotId,stage_key:stage,
   provider:stage==='audio:initial'?'fal':'openai',model:stage==='audio:initial'?audioModel:'gpt-5.6-terra',maximum_calls:1});
  insert('experience_sponsor_campaigns',{campaign_id:campaignId,policy_digest:policyDigest,policy_json:'{}',enabled:0});
  insert('experience_sponsor_grants',{grant_id:issuedId,campaign_id:campaignId,policy_digest:policyDigest,actor_user_id:actor,session_digest:sessionDigest,intent_key:intentKey,envelope_digest:envelopeDigest,
   issued_at_ms:envelope.issuedAtMs,expires_at_ms:envelope.expiresAtMs,enabled:0});
  insert('experience_sponsor_consumptions',{consumption_id:consumptionId,grant_id:issuedId,campaign_id:campaignId,actor_user_id:actor,session_digest:sessionDigest,intent_key:intentKey,envelope_digest:envelopeDigest,
   job_id:jobId,maximum_microusd:maximumMicrousd,admitted_at_ms:envelope.issuedAtMs+1});
  insert('experience_sponsor_issuances',{grant_id:issuedId,campaign_id:campaignId,actor_user_id:actor,intent_key:intentKey,policy_digest:policyDigest,driver_command_json:'PRIVATE DRIVER MUST NOT BE READ',
   command_digest:sha('5'),envelope_digest:envelopeDigest,envelope_json:JSON.stringify(envelope)});
  const ledger={owner_id:payer,stream_id:stream,correlation_id:correlationId,operation:'document-render:audio',period:'2025-09',created_at:createdAt,updated_at:createdAt};
  insert('budget_reservations',{reservation_id:tokenReservationId,...ledger,reserved_tokens:maximumTokens,used_tokens:3,status:'settled',settled_at:expiresAt});
  insert('cost_budget_reservations',{reservation_id:costReservationId,...ledger,reserved_microusd:maximumMicrousd,used_microusd:17,status:'settled',allow_user_overage:0,settled_at:expiresAt});
  purchases[suffix]={jobId,scopeKey,grantId,slotId,planId,tokenReservationId,costReservationId,issuedId,campaignId,consumptionId,envelopeDigest,policyDigest,envelope};
 }
 const limits=enforceD1ExpressionDepth(f,{queryLimits:strictLimits});t.after(()=>limits.restore());
 const snapshot=()=>({schema:f.sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(),version:f.sqlite.prepare('PRAGMA schema_version').get(),changes:f.sqlite.prepare('SELECT total_changes() AS total').get(),
  rows:Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))});
 const prove=async(purchase=purchases.a)=>{
  const before=snapshot(),row=await f.env.DB.prepare(select).bind(purchase.jobId,actor).first();
  assert.deepEqual(snapshot(),before,'financial reconstruction reads do not mutate rows/schema/total_changes');limits.assertVerified();return row;
 };
 const retain=async(purchase=purchases.a)=>{
  const row=await prove(purchase);assert.ok(row);return async()=>{
   const before=snapshot(),result=await f.env.DB.prepare(pinned).bind(purchase.jobId,actor,row.payer_user_id,row.grant_id,row.scope_key,row.slot_id,row.consumption_id,row.campaign_id,
    row.issued_grant_id,row.policy_digest,row.envelope_digest,row.cost_reservation_id,row.token_reservation_id).first();assert.deepEqual(snapshot(),before);limits.assertVerified();return result.current;
  };
 };
 const mutateEnvelope=change=>{const envelope=structuredClone(purchases.a.envelope);change(envelope);f.sqlite.prepare('UPDATE experience_sponsor_issuances SET envelope_json=? WHERE grant_id=?').run(JSON.stringify(envelope),purchases.a.issuedId);};
 return {...f,insert,purchases,prove,retain,mutateEnvelope,limits};
}

test('Audio financial complete SQL shapes preserve exactly two original lookup bindings and no private/current eligibility reads',async t=>{
 assert.equal((AUDIO_FINANCIAL_FROM.match(/\?/gu)||[]).length,2);
 assert.doesNotMatch(AUDIO_FINANCIAL_FROM,/\b(?:private_content|event_private_payloads|request_json|result_json|driver_command_json|experience_sponsor_campaigns|CURRENT_TIMESTAMP)\b|['"]now['"]/iu);
 const f=fixture(t),row=await f.prove(),retained=await f.retain();
 assert.equal(row.payer_user_id,payer);assert.equal(row.slot_id,'slot-a');assert.equal(await retained(),1);assert.notEqual(actor,payer);
 assert.equal((await f.prove(f.purchases.b)).slot_id,'slot-b');
 assert.equal(f.limits.records.length,2);assert.deepEqual(new Set(f.limits.boundCounts),new Set([2,13]));
 t.diagnostic(JSON.stringify({qualification:'synthetic SQL only; no capability/admission/Run claim',shapes:f.limits.records.length,
  maxBindings:Math.max(...f.limits.boundCounts),maxSqlBytes:Math.max(...f.limits.records.map(r=>r.statementBytes)),expressionDepth:100,...strictLimits,egress}));
});

test('Audio financial V8 cap matches both native planner limits and the accepted published-rate render bound',()=>{
 const planner=input=>Math.max(500000,estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra',input,3000));
 const render=estimateAudioProviderCostMicrousd(STABLE_AUDIO_ADAPTER_CONTRACT,EXPERIENCE_AUDIO_INTENT);
 assert.equal(render,37600);assert.equal(planner(25000),500000);assert.equal(planner(61000),500000);
 assert.equal(maximumMicrousd,2*planner(25000)+render);assert.equal(maximumMicrousd,2*planner(61000)+render);
 assert.match(AUDIO_FINANCIAL_FROM,/slot\.maximum_microusd=1037600/u);
});

test('Audio original financial reconstruction survives revoked/absent campaign, expired quote and absent creative source',async t=>{
 const f=fixture(t);assert.ok(Date.now()>oldDeadline);const retained=await f.retain();
 f.sqlite.exec('DELETE FROM experience_sponsor_campaigns');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN('private_content','event_private_payloads')").get().n,0);
 f.sqlite.prepare("UPDATE document_jobs SET request_json='erased',result_json=NULL,status='completed'").run();
 f.sqlite.prepare("UPDATE output_operation_slots SET status='succeeded'").run();
 assert.ok(await f.prove());assert.equal(await retained(),1);
});

const rowMutations=[
 ['creative owner',"UPDATE document_jobs SET owner_id='other' WHERE job_id=?"],
 ['creative stream',"UPDATE document_jobs SET stream_id='creative:other' WHERE job_id=?"],
 ['Document',"UPDATE document_jobs SET document_id='other' WHERE job_id=?"],
 ['job kind',"UPDATE document_jobs SET kind='generate' WHERE job_id=?"],
 ['job surface',"UPDATE document_jobs SET source_surface='other' WHERE job_id=?"],
 ['slot source',"UPDATE output_operation_slots SET source_digest='other' WHERE job_id=?"],
 ['slot provider',"UPDATE output_operation_slots SET provider='openai' WHERE job_id=?"],
 ['slot model',"UPDATE output_operation_slots SET model='other' WHERE job_id=?"],
 ['slot route',"UPDATE output_operation_slots SET route_digest='other' WHERE job_id=?"],
 ['slot max calls',"UPDATE output_operation_slots SET maximum_calls=4 WHERE job_id=?"],
 ['slot max tokens',"UPDATE output_operation_slots SET maximum_tokens=128001 WHERE job_id=?"],
 ['slot max cost',"UPDATE output_operation_slots SET maximum_microusd=1037601 WHERE job_id=?"],
 ['replacement attempt',"UPDATE output_operation_slots SET attempt_ordinal=1,previous_slot_id='prior' WHERE job_id=?"],
 ['foreign token hold',"UPDATE output_operation_slots SET token_reservation_id='tokens-b' WHERE job_id=?"],
 ['foreign cost hold',"UPDATE output_operation_slots SET cost_reservation_id='cost-b' WHERE job_id=?"],
 ['foreign grant',"UPDATE output_operation_slots SET grant_id='execution-b' WHERE job_id=?"],
 ['foreign plan',"UPDATE output_operation_slots SET plan_revision_id='plan-b' WHERE job_id=?"],
 ['consumption identity',"UPDATE experience_sponsor_consumptions SET envelope_digest='other' WHERE job_id=?"],
 ['consumption cap',"UPDATE experience_sponsor_consumptions SET maximum_microusd=1037601 WHERE job_id=?"],
];
test('Audio financial predicate rejects original native/consumption identity mutations',async t=>{
 for(const [name,sql] of rowMutations){const f=fixture(t);assert.ok(await f.prove());f.sqlite.prepare(sql).run(f.purchases.a.jobId);assert.equal(await f.prove(),null,name);}
});

const relationalMutations=[
 ['actor becomes payer',"UPDATE output_execution_grants SET payer_user_id=actor_user_id WHERE grant_id='execution-a'"],
 ['foreign execution actor',"UPDATE output_execution_grants SET actor_user_id='other' WHERE grant_id='execution-a'"],
 ['foreign execution plan',"UPDATE output_execution_grants SET plan_revision_id='plan-b' WHERE grant_id='execution-a'"],
 ['context execution',"UPDATE output_execution_grants SET context_id='context' WHERE grant_id='execution-a'"],
 ['execution cost cap',"UPDATE output_execution_grants SET maximum_microusd=1037601 WHERE grant_id='execution-a'"],
 ['execution call cap',"UPDATE output_execution_grants SET maximum_calls=2 WHERE grant_id='execution-a'"],
 ['original authorization deadline',"UPDATE output_execution_grants SET expires_at='2025-09-17T12:34:56.790Z' WHERE grant_id='execution-a'"],
 ['foreign Project',"UPDATE output_plan_revisions SET project_id='other' WHERE plan_revision_id='plan-a'"],
 ['foreign plan owner',"UPDATE output_plan_revisions SET owner_user_id='other' WHERE plan_revision_id='plan-a'"],
 ['changed source revision',"UPDATE output_plan_revisions SET source_head=13 WHERE plan_revision_id='plan-a'"],
 ['changed original source',"UPDATE output_plan_revisions SET source_digest='other' WHERE plan_revision_id='plan-a'"],
 ['project scope',"UPDATE output_plan_revisions SET scope_kind='project',organization_id='org',project_access_id='access' WHERE plan_revision_id='plan-a'"],
 ['token payer',"UPDATE budget_reservations SET owner_id='other' WHERE reservation_id='tokens-a'"],
 ['token stream',"UPDATE budget_reservations SET stream_id='other' WHERE reservation_id='tokens-a'"],
 ['token correlation',"UPDATE budget_reservations SET correlation_id='other' WHERE reservation_id='tokens-a'"],
 ['token operation',"UPDATE budget_reservations SET operation='document-render:scene' WHERE reservation_id='tokens-a'"],
 ['token ceiling',"UPDATE budget_reservations SET reserved_tokens=128001 WHERE reservation_id='tokens-a'"],
 ['cost payer',"UPDATE cost_budget_reservations SET owner_id='other' WHERE reservation_id='cost-a'"],
 ['cost stream',"UPDATE cost_budget_reservations SET stream_id='other' WHERE reservation_id='cost-a'"],
 ['cost correlation',"UPDATE cost_budget_reservations SET correlation_id='other' WHERE reservation_id='cost-a'"],
 ['cost operation',"UPDATE cost_budget_reservations SET operation='document-render:scene' WHERE reservation_id='cost-a'"],
 ['cost period',"UPDATE cost_budget_reservations SET period='other' WHERE reservation_id='cost-a'"],
 ['cost ceiling',"UPDATE cost_budget_reservations SET reserved_microusd=1037601 WHERE reservation_id='cost-a'"],
 ['cost overage',"UPDATE cost_budget_reservations SET allow_user_overage=1 WHERE reservation_id='cost-a'"],
 ['issued actor',"UPDATE experience_sponsor_grants SET actor_user_id='other' WHERE grant_id='issued-a'"],
 ['issued session',"UPDATE experience_sponsor_grants SET session_digest='other' WHERE grant_id='issued-a'"],
 ['issued intent',"UPDATE experience_sponsor_grants SET intent_key='other' WHERE grant_id='issued-a'"],
 ['issued policy',"UPDATE experience_sponsor_grants SET policy_digest='other' WHERE grant_id='issued-a'"],
 ['issued original time',"UPDATE experience_sponsor_grants SET issued_at_ms=issued_at_ms+1 WHERE grant_id='issued-a'"],
 ['issued original expiry',"UPDATE experience_sponsor_grants SET expires_at_ms=expires_at_ms+1 WHERE grant_id='issued-a'"],
 ['extra same-grant slot',"UPDATE output_operation_slots SET grant_id='execution-a' WHERE slot_id='slot-b'"],
];
test('Audio financial predicate rejects cross-owner, cross-plan, original grant and ledger substitution',async t=>{
 for(const [name,sql] of relationalMutations){const f=fixture(t);f.sqlite.exec(sql);assert.equal(await f.prove(),null,name);}
});

test('Audio financial predicate requires exactly one initial planner, one optional repair route and one media route',async t=>{
 for(const stage of ['planning:0:initial','planning:0:repair','audio:initial'])for(const [column,value] of [['provider','other'],['model','other'],['maximum_calls',2],['stage_key','other']]){
  const f=fixture(t);f.sqlite.prepare(`UPDATE output_operation_routes SET ${column}=? WHERE slot_id='slot-a' AND stage_key=?`).run(value,stage);assert.equal(await f.prove(),null,`${stage} ${column}`);
 }
 for(const change of ['delete','extra']){
  const f=fixture(t);if(change==='delete')f.sqlite.prepare("DELETE FROM output_operation_routes WHERE slot_id='slot-a' AND stage_key='planning:0:repair'").run();
  else f.insert('output_operation_routes',{scope_key:`personal:${actor}`,slot_id:'slot-a',stage_key:'audio:retry',provider:'fal',model:audioModel,maximum_calls:1});
  assert.equal(await f.prove(),null,change);
 }
});

const envelopeMutations=[
 ['version',e=>e.version=6],['family',e=>e.family='canonical-scene-screenplay@1'],['actor kind',e=>e.actorKind='guest'],['actor',e=>e.actorUserId='other'],['owner',e=>e.ownerUserId='other'],
 ['payer',e=>e.payerUserId=actor],['campaign',e=>e.campaignId='other'],['consumption',e=>e.consumptionId='other'],['session',e=>e.sessionDigest=sha('9')],['intent',e=>e.intentKey='other'],
 ['Document',e=>e.documentId='other'],['Project',e=>e.projectId='other'],['source revision',e=>e.sourceRevision++],['source digest',e=>e.sourceDigest=sha('9')],
 ['original request',e=>e.originalRequestId='audio-'+ '9'.repeat(64)],['original expiry',e=>e.originalExpiresAtMs++],['noninteger expiry',e=>e.originalExpiresAtMs+=0.5],
 ['string expiry',e=>e.originalExpiresAtMs=String(e.originalExpiresAtMs)],['missing expiry',e=>delete e.originalExpiresAtMs],
 ['app',e=>e.recipe.appId='scene'],['output',e=>e.recipe.outputKind='scene'],['provider',e=>e.recipe.provider='openai'],['model',e=>e.recipe.model='other'],
 ['route',e=>e.recipe.routeDigest=sha('9')],['tokens',e=>e.recipe.maximumTokens++],['money',e=>e.recipe.maximumMicrousd++],['output count',e=>e.recipe.outputCount=2],
 ['duration',e=>e.recipe.durationMs=30000],['width',e=>e.recipe.width=1],['height',e=>e.recipe.height=1],
 ...['parsing','planning','render','repair'].map(key=>[`call ${key}`,e=>e.recipe.calls[key]++]),
 ...['audioActorRequestDigest','audioSponsorReviewDigest'].flatMap(key=>[
  [`missing ${key}`,e=>delete e[key]],[`bad prefix ${key}`,e=>e[key]='blake3:'+ 'a'.repeat(64)],[`short ${key}`,e=>e[key]='sha256:a'],
  [`bad hex ${key}`,e=>e[key]='sha256:'+ 'z'.repeat(64)],[`uppercase ${key}`,e=>e[key]='sha256:'+ 'A'.repeat(64)],[`object ${key}`,e=>e[key]={digest:sha('1')}],
 ]),
];
test('Audio financial predicate binds closed V8 original operational envelope identities without reading actor/review bodies',async t=>{
 for(const [name,change] of envelopeMutations){const f=fixture(t);f.mutateEnvelope(change);assert.equal(await f.prove(),null,name);}
});

test('Audio retained common financial assertion refuses switched identities after the original lookup',async t=>{
 const f=fixture(t),retained=await f.retain();assert.equal(await retained(),1);
 // Both rows are otherwise coherent. A captured assertion must not silently
 // switch to a freshly substituted financial identity for the original job.
 f.sqlite.prepare("UPDATE output_operation_slots SET cost_reservation_id='replacement-cost' WHERE slot_id='slot-a'").run();
 f.sqlite.prepare("UPDATE cost_budget_reservations SET reservation_id='replacement-cost' WHERE reservation_id='cost-a'").run();
 assert.ok(await f.prove());assert.equal(await retained(),0);
});

test('actual immutable issuance and consumption triggers retain operational actor/review identity without private rereads',async t=>{
 const f=fixture(t);
 for(const [path,name] of [['../worker/experience-sponsor-issuer.ts','SPONSOR_ISSUER_SCHEMA'],['../worker/experience-sponsor-entitlement.ts','SPONSOR_ENTITLEMENT_SCHEMA']]){
  const source=readFileSync(new URL(path,import.meta.url),'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const declarations=ast.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]).filter(declaration=>declaration.name.getText(ast)===name);
  assert.equal(declarations.length,1);const javascript=ts.transpileModule(`const ${declarations[0].getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const actualSchema=new Function(`${javascript}\nreturn ${name};`)();
  const triggers=actualSchema.filter(sql=>sql.startsWith('CREATE TRIGGER'));
  assert.equal(triggers.length,3);for(const sql of triggers)f.sqlite.exec(sql);
 }
 const retained=await f.retain();
 for(const key of ['audioActorRequestDigest','audioSponsorReviewDigest'])assert.throws(()=>f.mutateEnvelope(e=>e[key]=sha('9')),/sponsor_issuance_immutable/u);
 assert.throws(()=>f.sqlite.exec("DELETE FROM experience_sponsor_issuances WHERE grant_id='issued-a'"),/sponsor_issuance_immutable/u);
 assert.throws(()=>f.sqlite.exec("INSERT OR REPLACE INTO experience_sponsor_issuances SELECT * FROM experience_sponsor_issuances WHERE grant_id='issued-a'"),/sponsor_issuance_exists/u);
 assert.throws(()=>f.sqlite.exec("UPDATE experience_sponsor_consumptions SET envelope_digest='changed' WHERE consumption_id='consumption-a'"),/sponsor_consumption_is_immutable/u);
 assert.throws(()=>f.sqlite.exec("INSERT OR REPLACE INTO experience_sponsor_consumptions SELECT * FROM experience_sponsor_consumptions WHERE consumption_id='consumption-a'"),/sponsor_consumption_already_exists/u);
 assert.equal(await retained(),1);
});


test('Audio original authorization expiry binds the grant while job expiry remains independent retention',async t=>{
 const f=fixture(t),retained=await f.retain();
 const job=f.sqlite.prepare('SELECT expires_at FROM document_jobs WHERE job_id=?').get(f.purchases.a.jobId);
 const grant=f.sqlite.prepare("SELECT expires_at FROM output_execution_grants WHERE grant_id='execution-a'").get();
 assert.equal(Date.parse(grant.expires_at),f.purchases.a.envelope.originalExpiresAtMs);
 assert.ok(Date.parse(job.expires_at)>Date.parse(grant.expires_at));
 // Extending or expiring storage retention does not change original money.
 for(const retention of ['2099-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z']){
  f.sqlite.prepare('UPDATE document_jobs SET expires_at=? WHERE job_id=?').run(retention,f.purchases.a.jobId);
  assert.ok(await f.prove());assert.equal(await retained(),1);
 }
 // A substituted grant authorization deadline cannot become the old receipt.
 f.sqlite.prepare("UPDATE output_execution_grants SET expires_at='2025-09-17T12:34:56.790Z' WHERE grant_id='execution-a'").run();
 assert.equal(await f.prove(),null);assert.equal(await retained(),0);
});


const personalScopeMutations=[
 ['foreign cost workspace',f=>f.sqlite.prepare("UPDATE cost_budget_reservations SET workspace_id='other-workspace' WHERE reservation_id='cost-a'").run()],
 ['token project scope',f=>f.insert('project_budget_reservation_scopes',{reservation_kind:'tokens',reservation_id:'tokens-a',organization_id:'other-workspace',project_access_id:'other-project',actor_user_id:payer,workspace_scope_id:'other-workspace',created_at:createdAt})],
 ['cost project scope',f=>f.insert('project_budget_reservation_scopes',{reservation_kind:'usd',reservation_id:'cost-a',organization_id:'forma',project_access_id:'other-project',actor_user_id:payer,workspace_scope_id:'forma',created_at:createdAt})],
 ['cost pilot scope',f=>f.insert('pilot_cost_reservation_scopes',{reservation_id:'cost-a',cohort_id:'other-cohort',organization_id:'forma',actor_user_id:payer,created_at:createdAt})],
];
for(const [name,mutate] of personalScopeMutations)test(`Audio original personal financial pair refuses ${name}`,async t=>{
 const f=fixture(t),retained=await f.retain();assert.equal(await retained(),1);mutate(f);
 assert.equal(await f.prove(),null,'scope metadata cannot redirect the original personal monetary identity');
 assert.equal(await retained(),0,'the same original financial assertion must detect late scope attachment');
});

test('Audio original financial identity does not depend on unrelated reservation scopes',async t=>{
 const f=fixture(t),retained=await f.retain();
 f.insert('project_budget_reservation_scopes',{reservation_kind:'tokens',reservation_id:'tokens-b',organization_id:'other-workspace',project_access_id:'other-project',actor_user_id:payer,workspace_scope_id:'other-workspace',created_at:createdAt});
 f.insert('project_budget_reservation_scopes',{reservation_kind:'usd',reservation_id:'cost-b',organization_id:'other-workspace',project_access_id:'other-project',actor_user_id:payer,workspace_scope_id:'other-workspace',created_at:createdAt});
 f.insert('pilot_cost_reservation_scopes',{reservation_id:'cost-b',cohort_id:'other-cohort',organization_id:'other-workspace',actor_user_id:payer,created_at:createdAt});
 assert.ok(await f.prove());assert.equal(await retained(),1);
});
