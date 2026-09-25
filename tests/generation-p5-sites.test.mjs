import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,consentHash} from './generation-p4-fixture.mjs';
import {hash} from '../evals/generation-reliability/core.mjs';
import {createSitesStudyApi,SITES_STUDY_PREFIX} from '../worker/generation-study-api.ts';
import worker from '../worker/index.ts';
const routes=['approval','execute','observe','recover','reconcile','stop','cleanup','cleanup-proposal'];
const poison=new Proxy({},{get(){throw Error('unexpected default-off I/O');}});
const command=(env,action,body,headers={})=>new Request(env.FORMA_GENERATION_STUDY_ORIGIN+SITES_STUDY_PREFIX+action,{method:'POST',headers:{origin:env.FORMA_GENERATION_STUDY_ORIGIN,'content-type':'application/json','oai-authenticated-user-id':'mock-owner','oai-authenticated-user-email':'owner@example.test',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
// All fixture identities/receipts remain synthetic, including fixtures exercising
// the production classification parser. Classification text does not certify truth.
async function setup(t,options={}){
 const f=await fixture(t,{classification:'actual',...options,configure:async(p,records)=>{
  for(const r of records.filter(r=>r.body.kind==='account')){r.body.credentialBinding=hash('OFFLINE-NON-CREDENTIAL');r.body.projectHeader=hash('OFFLINE-project');r.ref.contentHash=await consentHash(r.body);}
 }});
 f.env.OPENAI_PROJECT='OFFLINE-project';
 const config={entries:[{proposal:f.proposal,account:{accountId:hash('P4-SYNTHETIC-account'),region:'us'},credentialSha256:hash(f.env.OPENAI_API_KEY),projectHeaderSha256:hash(f.env.OPENAI_PROJECT)}]};
 const handler=createSitesStudyApi(config);
 const req=(action,body={},headers={})=>command(f.env,action,{proposalId:f.proposal.proposalId,...body},headers);
 const call=async(action,body,headers)=>(await handler(req(action,body,headers),f.env)).json();
 const approve=async()=>{const p=await call('approval',{action:'preview'});assert.equal(p.committable,true);return call('approval',f.command(p));};
 return {...f,config,handler,req,call,approve};
}
for(const route of routes)test('actual Worker empty configuration: '+route,async()=>{
 const env={DB:poison,MEDIA:poison,ASSETS:poison,FORMA_GENERATION_STUDY_ORIGIN:'https://study.example.test'};
 const result=await worker.fetch(command(env,route,{}),env,{waitUntil(){throw Error('unrelated sweep');}});
 assert.equal(result.headers.get('cache-control'),'private, no-store');
 assert.equal((await result.json()).status,['approval','execute'].includes(route)?'disabled':'unconfigured');
});
test('flags alone cannot enable shipped Worker',async()=>{
 const env={DB:poison,MEDIA:poison,ASSETS:poison,FORMA_GENERATION_STUDY_APPROVAL_ENABLED:'1',FORMA_GENERATION_STUDY_ENABLED:'1',FORMA_GENERATION_STUDY_ORIGIN:'https://study.example.test'};
 for(const action of ['approval','execute'])assert.equal((await(await worker.fetch(command(env,action,{}),env,{waitUntil(){throw Error('sweep');}})).json()).status,'unconfigured');
});
for(const mode of ['accepted-estimate','bounded-proof'])test('Sites selectors preserve full pair, original receipts and human boundary: '+mode,async t=>{
 const headers=[];const f=await setup(t,{mode,fetch:({init})=>{headers.push(init.headers);}});
 assert.equal((await f.approve()).status,'committed');
 assert.equal((await f.call('execute',{arm:'baseline'})).status,'disabled');
 f.env.FORMA_GENERATION_STUDY_ENABLED='1';
 assert.equal((await f.call('execute',{arm:'baseline'})).reason,'original_charge_unreconciled');assert.equal(f.calls.length,3);
 assert.match((await f.call('execute',{arm:'treatment'})).error,/paused_or_stopped/);
 await f.settle();
 assert.match((await f.call('execute',{arm:'treatment'})).error,/paused_or_stopped/);
 assert.equal((await f.call('observe',{arm:'baseline',safety:'clear',fidelity:'expected-failure',finding:'baseline tether',evidenceRef:'SYNTHETIC-human-review',resume:true})).action,'observation_recorded');
 assert.equal((await f.call('execute',{arm:'treatment'})).reason,'original_charge_unreconciled');assert.equal(f.calls.length,6);
 assert(headers.every(h=>h['OpenAI-Project']==='OFFLINE-project'));
 f.env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED='0';f.env.FORMA_GENERATION_STUDY_ENABLED='0';
 assert.equal((await f.call('reconcile',{arm:'baseline'})).action,'completed');
 const recovered=await f.handler(f.req('recover',{arm:'baseline'}),f.env);assert.equal(recovered.headers.get('content-type'),'image/png');assert.equal(recovered.headers.get('cache-control'),'private, no-store');assert((await recovered.arrayBuffer()).byteLength>0);
 assert.equal(f.calls.length,6);
});
for(const headers of [{origin:'https://evil.test'},{'oai-authenticated-user-id':'other'},{cookie:'forma_impersonation=other'},{cookie:'forma_project_context=other'}])test('configured route denies identity/scope/origin before dispatch: '+JSON.stringify(headers),async t=>{
 const f=await setup(t);await f.approve();f.env.FORMA_GENERATION_STUDY_ENABLED='1';
 assert.equal((await f.call('execute',{arm:'baseline'},headers)).status,'denied');assert.equal(f.calls.length,0);
});
for(const body of [{arm:'baseline',policy:{}},{arm:'baseline',grantId:'fake'},{arm:'third'},{arm:'baseline',evidence:[]},{arm:'baseline',resume:true}])test('HTTP cannot introduce authority '+JSON.stringify(body),async t=>{
 const f=await setup(t);f.env.FORMA_GENERATION_STUDY_ENABLED='1';assert.equal((await f.call('execute',body)).status,'denied');assert.equal(f.calls.length,0);
});
for(const binding of ['OPENAI_API_KEY','OPENAI_PROJECT'])test('changed binding fails before purchase: '+binding,async t=>{
 const f=await setup(t);await f.approve();f.env.FORMA_GENERATION_STUDY_ENABLED='1';f.env[binding]='changed';assert.equal((await f.call('execute',{arm:'baseline'})).error,'authoring_study_credential_binding_changed');assert.equal(f.calls.length,0);
});
test('synthetic config never promoted by production wrapper',async t=>{
 const f=await fixture(t);const handler=createSitesStudyApi({entries:[{proposal:f.proposal}]});const r=await handler(f.approvalRequest({action:'preview',proposalId:f.proposal.proposalId}),f.env);assert.equal(r.status,404);
 const result=await handler(command(f.env,'approval',{action:'preview',proposalId:f.proposal.proposalId}),f.env);assert.equal((await result.json()).error,'authoring_study_actual_configuration_required');
});
for(const committed of [false,true])test('expired proposal cleanup preserves accounting and unrelated private content; committed='+committed,async t=>{
 const f=await setup(t);if(committed)await f.approve();else await f.call('approval',{action:'preview'});
 assert.equal((await f.call('cleanup-proposal')).status,'denied');
 const counts=f.counts();const expired='2026-10-01T01:00:00.000Z';Date.now=()=>Date.parse(expired);f.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?expired.slice(0,7):expired);
 f.env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED='0';f.env.FORMA_GENERATION_STUDY_ENABLED='0';
 f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES('unrelated','mock-owner','other','keep',?,?)").run(expired,f.proposal.plan.packet.input.expiresAt);
 const r=await f.call('cleanup-proposal');assert.equal(r.action,'expired_proposal_copies_deleted');assert.equal(r.deleted,committed?15:13);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM authoring_study_evidence').get().n,12);
 const after=f.counts();assert.equal(after.authoring_study_commits,counts.authoring_study_commits);assert.equal(after.generation_study_financial_grants,counts.generation_study_financial_grants);
 assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='unrelated'").get().content,'keep');assert.equal((await f.call('cleanup-proposal')).deleted,0);assert.equal(f.calls.length,0);
});
test('operation cleanup after disabled switches retains original charges, policies, holds and intent',async t=>{
 const f=await setup(t);await f.approve();f.env.FORMA_GENERATION_STUDY_ENABLED='1';await f.call('execute',{arm:'baseline'});await f.settle();
 const tables=['generation_study_charges','generation_study_reconciliations','generation_study_financial_grants','generation_study_operations','generation_study_stages','authoring_study_commits'];
 const counts=()=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n]));const before=counts();assert.equal(f.media.size,1);
 const now='2026-10-01T01:00:00.000Z';Date.now=()=>Date.parse(now);f.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?now.slice(0,7):now);f.env.FORMA_GENERATION_STUDY_ENABLED='0';f.env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED='0';
 assert.equal((await f.call('cleanup',{arm:'baseline'})).action,'expired_private_copies_deleted');assert.equal(f.media.size,0);
 assert.equal((await f.call('cleanup-proposal')).action,'expired_proposal_copies_deleted');assert.deepEqual(counts(),before);
 assert.equal((await f.call('cleanup',{arm:'baseline'})).status,'denied');assert.equal(f.calls.length,3);
});
