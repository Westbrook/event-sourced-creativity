import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const imports=registerOutputSourceImports();
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0;
globalThis.fetch=()=>{egress++;throw Error('No network in inert Scene policy qualification');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);imports.deregister();assert.equal(egress,0);});
const [policyApi,approval,{canonicalJson,digest},{registeredExperience},{SCENE_OUTPUT_POLICY},{OUTPUT_NATIVE_EXECUTION_POLICY},
 {OPENAI_TEXT_PRICING_VERSION},{handleSession,POLICY_VERSION},{OUTPUT_REQUIREMENTS_SCHEMA},{SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
 {createSponsorAdmissionAuthority}]=await Promise.all([
 import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-approval.ts'),import('../src/experiences/compiler.ts'),import('../src/experiences/intake.ts'),
 import('../src/model/output-scene-contract.ts'),import('../src/model/output-execution-policy.ts'),import('../worker/openai-text-cost.ts'),import('../worker/pilot-policy.ts'),
 import('../worker/output-requirements-schema.ts'),import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-admission.ts'),
]);
const {readSponsorScenePolicy,compileSponsorSceneEnvelope,readSponsorPolicy,compileSponsorEnvelope,DEFAULT_SPONSOR_POLICY}=policyApi;
const {compileSponsorApprovalProposal,approveSponsorCampaign,loadApprovedSponsorSceneCampaign,loadApprovedSponsorCampaign,loadApprovedSponsorStoryCampaign,loadApprovedSponsorSlidesCampaign}=approval;
const h=c=>`sha256:${c.repeat(64)}`,actor='scene-actor',payer='scene-payer',now=1_000_000;
const release=await registeredExperience('scene');
const template={version:1,family:'canonical-scene-screenplay@1',appId:'scene',recipeVersion:`scene@${release.definition.revision}`,releaseDigest:release.releaseHash,
 outputKind:'scene',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,route:'document-scene-screenplay-manual-v1',maximumCalls:1,maximumTokens:128000,
 maximumInputTokens:125000,maximumOutputTokens:3000,maximumMicrousd:1000000,call:{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra'},scenePolicy:SCENE_OUTPUT_POLICY,
 pricingVersion:OPENAI_TEXT_PRICING_VERSION,cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};
const allowance={maximumOperations:20,maximumTextBytes:100_000,maximumOperationsPerWindow:10,maximumTextBytesPerWindow:50_000,maximumPendingGrants:2,maximumInflightJobs:1};
const policy={version:6,family:'canonical-scene-screenplay@1',mode:'candidate',campaignId:'scene-campaign',policyVersion:'scene-policy@1',payerUserId:payer,audience:'canonical-principal',approvalReceiptDigest:h('4'),
 startsAtMs:now-1000,expiresAtMs:now+100_000,maximumGrantLifetimeMs:60_000,maximumAdmissions:10,maximumMicrousd:10000000,maximumAdmissionsPerActor:5,
 windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources:{version:1,startsAtMs:now-500,expiresAtMs:now+80_000,windowMs:60_000,maximumOperationTextBytes:10_000,campaign:allowance,actor:allowance}};
// These digests are finite proposal facts, deliberately not native source proof.
const recipe={appId:'scene',recipeVersion:template.recipeVersion,releaseDigest:release.releaseHash,outputKind:'scene',provider:'openai',model:'gpt-5.6-terra',routeDigest:h('2'),settingsDigest:h('3'),
 outputCount:1,durationMs:0,width:0,height:0,calls:{parsing:0,planning:1,render:0,repair:0},maximumTokens:128000,maximumMicrousd:1000000};
const envelope={version:6,family:'canonical-scene-screenplay@1',campaignId:policy.campaignId,policyVersion:policy.policyVersion,consumptionId:'scene-consumption',intentKey:'scene-intent',actorKind:'canonical-principal',
 actorUserId:actor,sessionDigest:h('5'),payerUserId:payer,ownerUserId:actor,projectId:'project',documentId:'document',sourceRevision:7,sourceDigest:h('6'),orderedAssetDigests:[],rightsDigest:h('7'),
 compiledInputDigest:h('8'),transferEnvelopeDigest:h('9'),recipe,issuedAtMs:now,expiresAtMs:now+30_000,templateDigest:await digest(template)};
const proposal=(p=policy)=>{const {approvalReceiptDigest:ignored,...terms}=structuredClone(p);void ignored;return{policy:terms,eligibleActorUserIds:[actor],issuerUserIds:[actor]};};
const headers=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
const request=(userId=actor,body,signal)=>new Request('http://localhost/__fixture/scene-policy',{method:body?'POST':'GET',headers:{...headers(userId),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal});
const snapshot=f=>({rows:f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]),changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,schema:f.sqlite.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all()});
async function fixture(t,{approved=true}={}){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 for(const userId of [actor,payer,'unlisted'])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(userId)}),f.env)).status,200);
 f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
 for(const sql of [OUTPUT_REQUIREMENTS_SCHEMA[0],...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...approval.SPONSOR_APPROVAL_SCHEMA])f.sqlite.exec(sql);
 const time=Date.now(),p={...structuredClone(policy),startsAtMs:time-10_000,expiresAtMs:time+300_000,resources:{...structuredClone(policy.resources),startsAtMs:time-10_000,expiresAtMs:time+300_000}};
 const input=proposal(p),compiled=await compileSponsorApprovalProposal(input),command={action:'approve-sponsor-campaign',approvalId:'scene-approval',proposal:input,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
 if(approved)await approveSponsorCampaign(request(payer,command),f.env);
 return {...f,p,input,compiled,command};
}

test('dedicated V6 canonical data preserves native one-call Scene limits and immutable snapshots',async()=>{
 const p=structuredClone(policy),e=structuredClone(envelope),pending=compileSponsorSceneEnvelope(p,e);p.family='guest';e.recipe.calls.render=1;
 const actual=await pending;assert.equal(actual.policyJson,canonicalJson(policy));assert.equal(actual.envelopeJson,canonicalJson(envelope));
 assert.equal(actual.policyDigest,await digest(policy));assert.equal(actual.envelopeDigest,await digest(envelope));assert.ok(Object.isFrozen(actual.policy.templates[0].scenePolicy.pageRange));
 assert.deepEqual(actual.envelope.recipe.calls,{parsing:0,planning:1,render:0,repair:0});assert.equal(actual.envelope.recipe.maximumMicrousd,1000000);
 const input=proposal(),original=structuredClone(input),proposed=compileSponsorApprovalProposal(input);input.policy.payerUserId='other';input.eligibleActorUserIds.push('other');
 assert.equal((await proposed).termsJson,canonicalJson(original));assert.equal((await proposed).policy.approvalReceiptDigest,await digest(original));
});

test('common V6 review data still requires genuine Scene preparation before native admission work',async()=>{
 assert.strictEqual(readSponsorPolicy(),DEFAULT_SPONSOR_POLICY);assert.equal(readSponsorPolicy(policy).version,6);
 assert.deepEqual(await compileSponsorEnvelope(policy,envelope),await compileSponsorSceneEnvelope(policy,envelope));
 let reads=0;const trusted={request:request(),env:{DB:{prepare(){reads++;throw Error('No native read permitted');}}},scope:{actorUserId:actor,documentId:'document'},principal:{userId:actor},context:null,sourceAssertions:[],sourceDigest:h('a'),requirementsDigest:h('b')};
 await assert.rejects(createSponsorAdmissionAuthority({trusted,command:{action:'authorize'},policy,envelope,grantId:'scene-grant'}),/sponsor_scene_preparation_required/);assert.equal(reads,0);
});

test('V6 closed policy, envelope and approval grammars refuse cross-family and permission expansion',async()=>{
 for(const mutate of [p=>p.version=5,p=>p.version=3,p=>p.family='canonical-short-story@1',p=>p.audience='guest',p=>p.extra=true,p=>p.templates.push(template),p=>p.templates=[],
  p=>p.templates[0].maximumCalls=2,p=>p.templates[0].scenePolicy.characterCount=3,p=>p.templates[0].maximumOutputTokens=6000,p=>p.templates[0].call.stage='render:0:initial',
  p=>p.templates[0].maximumInputTokens=125001,p=>p.maximumMicrousd=999999,p=>p.maximumAdmissions=0,p=>p.maximumAdmissionsPerActor=11,p=>p.maximumAdmissionsPerWindow=11,
  p=>p.maximumAdmissionsPerActorWindow=6,p=>p.maximumGrantLifetimeMs=900001,p=>p.expiresAtMs=p.startsAtMs,p=>p.windowMs=0,p=>p.resources.startsAtMs=p.startsAtMs-1,
  p=>p.resources.expiresAtMs=p.expiresAtMs+1,p=>p.resources.version=2,p=>p.resources.passiveReads=true]){const changed=structuredClone(policy);mutate(changed);assert.throws(()=>readSponsorScenePolicy(changed));}
 for(const mutate of [e=>e.version=4,e=>e.family='canonical-five-slide-deck@1',e=>e.actorKind='guest',e=>e.ownerUserId='other',e=>{e.actorUserId=payer;e.ownerUserId=payer;},
  e=>e.payerUserId='other',e=>e.orderedAssetDigests=[h('c')],e=>e.recipe.calls.render=1,e=>e.recipe.calls.repair=1,e=>e.recipe.maximumMicrousd=999999,e=>e.recipe.maximumTokens=128001,
  e=>e.recipe.releaseDigest=h('a'),e=>e.templateDigest=h('b'),e=>e.recipe.extra=true,e=>e.issuedAtMs=policy.resources.startsAtMs-1,e=>e.expiresAtMs=e.issuedAtMs+60001,e=>e.sourceRevision=-1,e=>e.extra=true]){
  const changed=structuredClone(envelope);mutate(changed);await assert.rejects(compileSponsorSceneEnvelope(policy,changed));
 }
 for(const mutate of [p=>p.policy.approvalReceiptDigest=h('a'),p=>p.policy.version=3,p=>p.eligibleActorUserIds.push(payer),p=>p.issuerUserIds=['other'],p=>p.issuerUserIds=[],p=>p.eligibleActorUserIds.push(actor)]){
  const changed=proposal();mutate(changed);await assert.rejects(compileSponsorApprovalProposal(changed));
 }
 let reads=0;const getter={...policy};Object.defineProperty(getter,'family',{enumerable:true,get(){reads++;return policy.family;}});assert.throws(()=>readSponsorScenePolicy(getter));assert.equal(reads,0);
});

test('actual synthetic payer approval loads only through the Scene reader with zero reader writes',async t=>{
 const f=await fixture(t),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());
 const result=await loadApprovedSponsorSceneCampaign(request(),f.env,policy.campaignId);assert.equal(result.policy.version,6);assert.equal(result.actor.userId,actor);assert.equal(result.policyDigest,f.compiled.policyDigest);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT payer_authority_json FROM experience_sponsor_approvals').get().payer_authority_json).length,13);
 assert.deepEqual(snapshot(f),before);limits.assertVerified();
 for(const loader of [loadApprovedSponsorCampaign,loadApprovedSponsorStoryCampaign,loadApprovedSponsorSlidesCampaign])await assert.rejects(loader(request(),f.env,policy.campaignId),/sponsor_approved_campaign_unavailable/);
 assert.deepEqual(snapshot(f),before);
 t.diagnostic(JSON.stringify({statements:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),zeroReaderWrites:true,egress}));
});

test('V6 approval still requires payer authentication and exact reviewed explicit terms',async t=>{
 const f=await fixture(t,{approved:false}),before=snapshot(f);
 for(const [user,change] of [[actor,{}],[payer,{confirmation:'yes'}],[payer,{reviewedTermsDigest:h('f')}],[payer,{proposal:{...f.input,issuerUserIds:['unlisted']}}]])await assert.rejects(approveSponsorCampaign(request(user,{...f.command,...change}),f.env));
 assert.deepEqual(snapshot(f),before);const approved=await approveSponsorCampaign(request(payer,f.command),f.env);assert.equal(approved.policy.version,6);
 const rows=f.sqlite.prepare('SELECT * FROM experience_sponsor_approvals').all(),replay=await approveSponsorCampaign(request(payer,f.command),f.env);assert.equal(replay.replayed,true);assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_sponsor_approvals').all(),rows);
 for(const table of ['experience_sponsor_grants','experience_sponsor_consumptions','experience_sponsor_resource_receipts','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
});

for(const mutation of ['disabled','revoked','actor-consent','payer-consent','payer-email','actor-ineligible','expired'])test(`Scene approved loader refuses ${mutation}`,async t=>{
 const f=await fixture(t);let user=actor;
 if(mutation==='disabled')f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0').run();
 if(mutation==='revoked')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms').run();
 if(mutation==='actor-consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
 if(mutation==='payer-consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
 if(mutation==='payer-email')f.sqlite.prepare('UPDATE users SET email=? WHERE user_id=?').run('changed@invalid',payer);
 if(mutation==='actor-ineligible')user='unlisted';
 const before=snapshot(f),clock=Date.now;if(mutation==='expired')Date.now=()=>f.p.expiresAtMs;
 try{await assert.rejects(loadApprovedSponsorSceneCampaign(request(user),f.env,policy.campaignId));}finally{Date.now=clock;}
 assert.deepEqual(snapshot(f),before);
});

for(const fault of ['abort','database','headers','actor-email','sparse','failed','expired'])test(`Scene approved loader refuses final-boundary ${fault}`,async t=>{
 const f=await fixture(t),controller=new AbortController(),req=request(actor,undefined,controller.signal),batch=f.DB.batch.bind(f.DB),clock=Date.now;let reached=false;
 f.DB.batch=async statements=>{if(fault==='actor-email')f.sqlite.prepare('UPDATE users SET email=? WHERE user_id=?').run('changed@invalid',actor);
  const result=await batch(statements);reached=true;if(fault==='abort')controller.abort();if(fault==='database')f.env.DB={...f.DB};if(fault==='headers')req.headers.set('oai-authenticated-user-email','changed@invalid');
  if(fault==='sparse')delete result[0];if(fault==='failed')result[0].success=false;if(fault==='expired')Date.now=()=>f.p.expiresAtMs;return result;
 };
 try{await assert.rejects(loadApprovedSponsorSceneCampaign(req,f.env,policy.campaignId));}finally{Date.now=clock;}
 if(fault!=='actor-email')assert.equal(reached,true);
});


test('V6 dedicated inputs capture own data before validation without Proxy reads',async()=>{
 let reads=0;
 const changing=value=>new Proxy(structuredClone(value),{get(target,key,receiver){reads++;if(key==='maximumMicrousd'||key==='sourceRevision')return -1;return Reflect.get(target,key,receiver);}});
 assert.equal(readSponsorScenePolicy(changing(policy)).maximumMicrousd,policy.maximumMicrousd);
 assert.equal((await compileSponsorSceneEnvelope(changing(policy),changing(envelope))).envelope.sourceRevision,envelope.sourceRevision);
 assert.equal(reads,0);
 const accessor=structuredClone(envelope);Object.defineProperty(accessor,'sourceRevision',{enumerable:true,get(){reads++;return 7;}});
 await assert.rejects(compileSponsorSceneEnvelope(policy,accessor));assert.equal(reads,0);
});

test('Scene approved loader refuses a pre-aborted request before its first read',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();let reads=0;f.DB.prepare=()=>{reads++;throw Error('No read after abort');};
 await assert.rejects(loadApprovedSponsorSceneCampaign(request(actor,undefined,controller.signal),f.env,policy.campaignId),/sponsor_approval_principal_changed/);assert.equal(reads,0);
});

for(const column of ['role','updated_at','consented_at'])test(`Scene approved loader joins native actor to original ${column} across changed-and-restored rows`,async t=>{
 const f=await fixture(t);f.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(actor);
 const before=f.sqlite.prepare(`SELECT ${column} AS value FROM users WHERE user_id=?`).get(actor).value;
 const changed=column==='role'?'admin':'2099-01-01T00:00:00.000Z';assert.notEqual(before,changed);
 const prepare=f.DB.prepare;let reads=0;
 f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.apply(this,bindings);
  if(sql.includes('SELECT principal.*')&&bindings[0]===actor){const first=bound.first;bound.first=async function(...args){const row=await first.apply(this,args);reads++;
   if(reads===1)f.sqlite.prepare(`UPDATE users SET ${column}=? WHERE user_id=?`).run(changed,actor);
   if(reads===2)f.sqlite.prepare(`UPDATE users SET ${column}=? WHERE user_id=?`).run(before,actor);return row;};}return bound;};return statement;};
 await assert.rejects(loadApprovedSponsorSceneCampaign(request(),f.env,policy.campaignId),/sponsor_approval_principal_changed/);assert.equal(reads,2);
 assert.equal(f.sqlite.prepare(`SELECT ${column} AS value FROM users WHERE user_id=?`).get(actor).value,before);
});

test('V1 V2 V4 V5 canonical outputs retain independent pre-edit goldens',async()=>{
 const golden=JSON.parse(readFileSync(new URL('./fixtures/scene-v6-prior-sponsor-canonical-goldens.json',import.meta.url),'utf8'));
 assert.equal(golden.sourceCommit,'c4c6a8937eace8e442bb317dd5ce2ac4a5abfff7');assert.deepEqual(DEFAULT_SPONSOR_POLICY,golden.defaultPolicy);
 for(const version of golden.versions){const p=JSON.parse(version.compiled.policyJson),e=JSON.parse(version.compiled.envelopeJson),actual=await compileSponsorEnvelope(p,e);
  for(const key of ['policyJson','policyDigest','envelopeJson','envelopeDigest'])assert.equal(actual[key],version.compiled[key],`V${version.version} ${key}`);
  if(version.approval.supported){const compiled=await compileSponsorApprovalProposal(JSON.parse(version.approval.termsJson));for(const key of ['termsJson','termsDigest','policyJson','policyDigest'])assert.equal(compiled[key],version.approval[key],`V${version.version} approval ${key}`);}
  else await assert.rejects(compileSponsorApprovalProposal(proposal(p)),new RegExp(version.approval.errorCode));
 }
});


test('V6 approval proposal snapshots exact own-data lists before validation',async()=>{
 const original=proposal();let reads=0;
 const input=new Proxy(structuredClone(original),{get(target,key,receiver){reads++;if(key==='eligibleActorUserIds')return [];if(key==='issuerUserIds')return ['invalid actor id'];return Reflect.get(target,key,receiver);}});
 const actual=await compileSponsorApprovalProposal(input);assert.equal(actual.termsJson,canonicalJson(original));assert.equal(reads,0);
 const hiddenVersion=new Proxy(structuredClone(original.policy),{getOwnPropertyDescriptor(target,key){const value=Reflect.getOwnPropertyDescriptor(target,key);return key==='version'?{...value,value:2}:value;}});
 await assert.rejects(compileSponsorApprovalProposal({...original,policy:hiddenVersion}),/sponsor_approval_terms_invalid/);
});
