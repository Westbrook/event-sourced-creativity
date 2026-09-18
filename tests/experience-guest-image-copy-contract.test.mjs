import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {fixture,insert,rows,snapshot,changes,readHook} from './helpers/guest-image-stage-fixture.mjs';
import * as copy from '../worker/experience-guest-image-copy-contract.ts';
const [{GUEST_IMAGE_CLAIM_SCHEMA,claimGuestImageSave,readGuestImageClaim,inspectCompletedGuestImageClaim,guestImageCompletedClaimData},
  {inspectGuestImageSaveInventory},{GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{POLICY_VERSION}]=await Promise.all([
  import('../worker/experience-guest-image-claim.ts'),import('../worker/experience-guest-image-claim-inventory.ts'),
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),import('../worker/policy-version.ts')]);
const hash=letter=>`sha256:${letter.repeat(64)}`,id=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const stamp='2020-01-01T00:00:00.000Z',origin='https://guest.example.invalid',owner='copy-contract-owner';
const identity={sessionId:'copy-session',guestSubject:`guest:${id(1)}`,projectId:'copy-project',documentId:'copy-document',draftHash:hash('a'),manifestDigest:hash('b'),sourceHead:3};
const inputs=[{type:'ProjectCreated',payload:{project_id:identity.projectId,name:'Original'}},
  {type:'DocumentCreated',payload:{project_id:identity.projectId,document_id:identity.documentId,title:'Original'}},
  {type:'BlockCreated',payload:{block_id:id(2),project_id:identity.projectId,document_id:identity.documentId,type:'subject',content:'A blue heron'}}];
const event=(eventId,sequence,type,payload,actor='user',client='server:guest-context-adoption',correlation='guest-context-adoption:copy-session')=>({eventId,streamId:`creative:${owner}`,sequence,
  occurredAt:stamp,recordedAt:stamp,actor,clientId:client,correlationId:correlation,causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const prefixEvents=inputs.map((source,i)=>event(id(i+3),i+3,source.type,{...source.payload,client_event_id:`guest-context-adoption:v1:copy-session:${i}`}));
const lease={session_id:identity.sessionId,lease_id:'copy-lease',destination_user_id:owner,manifest_digest:identity.manifestDigest,request_id:'copy-request',
  request_ids_json:'["copy-request"]',acquisitions:1,created_at_ms:1,expires_at_ms:1000};
const sourceEventIds=[id(6),id(7),id(8)],prefixInput={...identity,sourceEventIds,destinationUserId:owner,origin,head:2};
const sourcePayload={block_id:id(9),type:'output',scope:'document',content:'Original output requirement',project_id:identity.projectId,document_id:identity.documentId,actor_user_id:identity.guestSubject,
  output_command_envelope:{action:'save',spec:{kind:'image',text:'A blue heron'},planSuggestions:{count_policies:{},suggested_counts:{}},guestSponsorPreparation:{source:{sourcePolicyId:'source-policy',
    sourcePolicyDigest:hash('c'),requestDigest:hash('d'),contentDigest:hash('e')}}}};
const saveEvent={...event(id(2),4,'BlockCreated',sourcePayload,identity.guestSubject,'server:guest-output','original-save'),streamId:`creative:${identity.guestSubject}`};
const command={scope_key:`personal:${identity.guestSubject}:${identity.projectId}`,actor_user_id:identity.guestSubject,command_key:'original-save',request_digest:'f'.repeat(64),action:'save',event_id:saveEvent.eventId,created_at:stamp};
const resource={resource_id:'original-save:text',campaign_id:'original-campaign',policy_digest:hash('a'),limits_digest:hash('b'),actor_user_id:identity.guestSubject,session_digest:hash('c'),
  operation:'text-intake',intent_key:'original-save',payload_digest:hash('f'),text_bytes:201,issued_grant_id:null,recorded_at_ms:1};
const sourceInput={head:3,eventIds:sourceEventIds,expiresAt:'2020-01-02T00:00:00.000Z',sessionPolicyId:'session-policy',sessionTermsDigest:hash('d'),sessionExpiresAtMs:Date.parse('2020-01-03T00:00:00.000Z'),releaseHash:hash('e')};
const original=sourcePayload.output_command_envelope.guestSponsorPreparation.source;
const source={...sourceInput,sourcePolicyId:original.sourcePolicyId,sourcePolicyDigest:original.sourcePolicyDigest,requestDigest:original.requestDigest,contentDigest:original.contentDigest,
  save:{id:saveEvent.eventId,sequence:4,occurred:stamp,recorded:stamp,public:JSON.stringify({block_id:id(9),type:'output',scope:'document',project_id:identity.projectId,document_id:identity.documentId,actor_user_id:identity.guestSubject,_private_ref:saveEvent.eventId}),privateDigest:hash('f')},command,resource};
const saveInput={...identity,documentId:identity.documentId,source,contextHead:5,commandKey:'copied-save',requirementId:id(9)};
const provenance={version:1,sessionId:identity.sessionId,manifestDigest:identity.manifestDigest,sourceCommandKey:'original-save',sourceRequestDigest:'f'.repeat(64),sourceEventId:saveEvent.eventId,guestSubject:identity.guestSubject};
const expectedEnvelope={action:'save',documentId:identity.documentId,expectedRevision:'output:5',clientMutationId:'copied-save',blockId:id(9),
  spec:{kind:'image',text:'A blue heron'},planSuggestions:{count_policies:{},suggested_counts:{}},guestImageClaim:provenance};
const tail=event(id(1),6,'BlockCreated',{...sourcePayload,actor_user_id:owner,output_command_envelope:expectedEnvelope},`user:${owner}`,'server:output-requirements','copied-save');
const lineageInput={...identity,destinationUserId:owner,draftId:`experience-draft-${'a'.repeat(64)}`,origin,contextLineageDigest:hash('b'),source,
  commandKey:'copied-save',requestDigest:'c'.repeat(64),requirementId:id(9),contextHead:5};
function publicPrefix(event){const p=event.payload;return JSON.stringify(event.type==='ProjectCreated'?{project_id:p.project_id,client_event_id:p.client_event_id,_private_ref:event.eventId}:
  event.type==='DocumentCreated'?{project_id:p.project_id,document_id:p.document_id,client_event_id:p.client_event_id,_private_ref:event.eventId}:
    {block_id:p.block_id,project_id:p.project_id,document_id:p.document_id,type:p.type,client_event_id:p.client_event_id,_private_ref:event.eventId});}
const expectedPrefix={version:1,...identity,sourceEventIds,sourceHead:3,destinationUserId:owner,origin,targetStart:3,targetHead:5,
  events:prefixEvents.map((event,i)=>({id:event.eventId,sequence:event.sequence,occurred:stamp,recorded:stamp,type:event.type,public:publicPrefix(event),privateDigest:hash('f'),
    project:identity.projectId,document:event.type==='ProjectCreated'?null:identity.documentId,key:`guest-context-adoption:v1:copy-session:${i}`})),lease};
const expectedLineage={version:1,kind:'first-image-save',sessionId:identity.sessionId,guestSubject:identity.guestSubject,destinationUserId:owner,projectId:identity.projectId,
  documentId:identity.documentId,draftId:lineageInput.draftId,draftHash:identity.draftHash,manifestDigest:identity.manifestDigest,origin,contextLineageDigest:hash('b'),source,
  target:{id:tail.eventId,sequence:6,occurred:stamp,recorded:stamp,public:JSON.stringify({block_id:id(9),type:'output',scope:'document',project_id:identity.projectId,
    document_id:identity.documentId,actor_user_id:owner,_private_ref:tail.eventId}),privateDigest:hash('d'),commandKey:'copied-save',requestDigest:'c'.repeat(64),requirementId:id(9),contextHead:5}};
const sha=value=>createHash('sha256').update(value).digest('hex');

// Explicit original value contracts; expected native storage values are not
// regenerated by the implementation under test or an ephemeral Git checkout.
test('prefix construction retains native actor, ordering, original payload and client receipts',()=>{
  for(const [i,input]of inputs.entries()){
    const args=copy.guestImageCopyPrefixEventInput({sessionId:identity.sessionId,destinationStreamId:`creative:${owner}`,head:2},input,i);
    assert.deepEqual(args,[`creative:${owner}`,i+3,'user','server:guest-context-adoption','guest-context-adoption:copy-session',input.type,
      {...input.payload,client_event_id:`guest-context-adoption:v1:copy-session:${i}`}]);assert.notEqual(args[6],input.payload);
  }
  const value=copy.guestImageCopyPrefixLineage(prefixInput,prefixEvents,[hash('f'),hash('f'),hash('f')],lease);
  assert.deepEqual(value,expectedPrefix);assert.equal(value.targetHead,5);assert.equal(value.sourceHead,3);
  assert.deepEqual(Object.keys(value),['version','sessionId','guestSubject','projectId','documentId','draftHash','manifestDigest','sourceEventIds','sourceHead','destinationUserId','origin','targetStart','targetHead','events','lease']);
});
test('SAVE source, provenance, envelope, event and immutable lineage retain original and destination ownership',()=>{
  const actual=copy.guestImageCopyOriginalSource(sourceInput,{event:saveEvent,command,resource},sourcePayload,original,hash('f'));
  assert.deepEqual(actual,source);assert.notEqual(actual.command,command);assert.notEqual(actual.resource,resource);
  assert.deepEqual(copy.guestImageCopyClaimProvenance({...identity,source}),provenance);
  const envelope=copy.guestImageCopySaveEnvelope(saveInput,sourcePayload.output_command_envelope);
  assert.equal(JSON.stringify(envelope),JSON.stringify(expectedEnvelope));assert.notEqual(envelope.spec,sourcePayload.output_command_envelope.spec);
  assert.deepEqual(copy.guestImageCopySaveEventInput({destinationStreamId:`creative:${owner}`,destinationUserId:owner,contextHead:5,commandKey:'copied-save'},sourcePayload,envelope),
    [`creative:${owner}`,6,`user:${owner}`,'server:output-requirements','copied-save','BlockCreated',tail.payload]);
  assert.equal(JSON.stringify(copy.guestImageCopyLineage(lineageInput,tail,hash('d'))),JSON.stringify(expectedLineage));
});
test('stable SAVE key derives from source manifest and actual canonical destination without live authority',async()=>{
  const serialized=JSON.stringify({destinationUserId:owner,domain:'forma-guest-image-save-claim@1',manifestDigest:identity.manifestDigest,sessionId:identity.sessionId});
  assert.equal(await copy.guestImageCopyCommandKey(identity.sessionId,owner,identity.manifestDigest),`guest-image-save-claim-v1:${sha(serialized)}`);
  assert.notEqual(await copy.guestImageCopyCommandKey(identity.sessionId,'other-owner',identity.manifestDigest),await copy.guestImageCopyCommandKey(identity.sessionId,owner,identity.manifestDigest));
});
test('pure predicate bindings retain native metadata and one exact original financial receipt',()=>{
  const original=JSON.parse(copy.guestImageCopyEventMeta(expectedLineage,false).bindings[0]),target=JSON.parse(copy.guestImageCopyEventMeta(expectedLineage,true).bindings[0]);
  assert.equal(original[5],identity.guestSubject);assert.equal(original[6],'server:guest-output');assert.equal(target[5],`user:${owner}`);assert.equal(target[6],'server:output-requirements');
  const proof=copy.guestImageCopyCommandProof(expectedLineage);assert.deepEqual(JSON.parse(proof.bindings[0]),Object.values(command));assert.deepEqual(JSON.parse(proof.bindings[2]),Object.values(resource));
  assert.deepEqual(JSON.parse(proof.bindings[1]),[`personal:${owner}:${identity.projectId}`,owner,'copied-save','c'.repeat(64),'save',tail.eventId,stamp]);
  assert.deepEqual(copy.guestImageCopyTargetBody(expectedLineage,'private-original').bindings,[tail.eventId,owner,identity.projectId,identity.documentId,stamp,'private-original']);
  assert.deepEqual(copy.guestImageCopyTargetCustody(expectedLineage,expectedPrefix).bindings,[tail.eventId,JSON.stringify([id(2),id(9)]),`creative:${owner}`,id(9),`creative:${owner}`,6,id(9)]);
  const prefixProof=copy.guestImageCopyPrefixTargets(expectedPrefix,['one','two','three']);
  assert.deepEqual(JSON.parse(prefixProof.bindings[0]),expectedPrefix.events.map((event,i)=>({...event,private:['one','two','three'][i]})));
  assert.deepEqual(prefixProof.bindings.slice(1),[`creative:${owner}`,'guest-context-adoption:copy-session',owner,3]);
  const row={session_id:'s',destination_user_id:owner,lease_id:'l',request_id:'r',manifest_digest:hash('a'),context_lineage_digest:hash('b'),lineage_json:'{}',lineage_digest:hash('c'),created_at_ms:1};
  assert.deepEqual(copy.guestImageCopyClaimRowProof(row).bindings,[JSON.stringify(Object.values(row))]);
});

function canonical(method='POST',extra={},url=origin+'/internal-copy-witness',signal){return new Request(url,{method,headers:{...(method==='POST'?{origin}:{}),
  'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.invalid`,...extra},signal});}
async function completedFixture(t){
  const f=await fixture(t);for(const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA,...GUEST_IMAGE_CLAIM_SCHEMA])f.sqlite.exec(sql);
  insert(f,'users',{user_id:owner,email:`${owner}@example.invalid`,display_name:owner,role:'creator',consent_version:POLICY_VERSION,consented_at:stamp,created_at:stamp,updated_at:stamp});
  f.env.FORMA_RETENTION_DAYS='2';
  const inventory=await inspectGuestImageSaveInventory(f.request,f.env,{proof:f.proof});
  f.claim=await claimGuestImageSave(canonical(),f.env,{sessionId:f.session.sessionId,requestId:'copy-contract-request',approvedManifestDigest:inventory.manifestDigest,proof:f.proof});
  assert.equal(f.claim.status,'image-save-claimed');assert.equal(f.claim.requirementCustodyTransferred,true);return f;
}
test('real completed witness supports stored-origin GET without exposing authority through its receipt or JSON',async t=>{
  const f=await completedFixture(t),request=canonical('GET'),before=snapshot(f),count=changes(f),witness=await inspectCompletedGuestImageClaim(request,f.env,{sessionId:f.session.sessionId});
  assert.ok(witness);assert.equal(JSON.stringify(witness),'{}');assert.ok(Object.isFrozen(witness));
  const data=guestImageCompletedClaimData(request,f.env,witness);assert.equal(data.lineage.destinationUserId,owner);assert.equal(data.lineage.origin,origin);
  assert.deepEqual(Object.keys(data.prefix),['row','lineage','proof']);assert.ok(Object.isFrozen(data.proof));assert.ok(Object.isFrozen(data.lineage));
  assert.equal(data.lineage.source.head,f.committed.head);assert.equal(data.lineage.target.contextHead,f.committed.head);
  assert.equal(data.lineage.target.sequence,f.committed.head+1);assert.equal(data.receipt.generationAvailable,false);
  assert.throws(()=>guestImageCompletedClaimData(request,f.env,data.receipt));assert.throws(()=>guestImageCompletedClaimData(request,f.env,{}));
  assert.throws(()=>guestImageCompletedClaimData(canonical('GET'),f.env,witness));assert.throws(()=>guestImageCompletedClaimData(request,{...f.env},witness));
  assert.equal(Object.isFrozen(f.env),false);assert.equal(Object.isFrozen(f.env.DB),false);
  assert.equal((await readGuestImageClaim(canonical(),f.env,{sessionId:f.session.sessionId})).eventId,data.receipt.eventId);
  await assert.rejects(readGuestImageClaim(request,f.env,{sessionId:f.session.sessionId}));
  assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
});
for(const [name,build] of [
  ['wrong stored origin',()=>canonical('GET',{},'https://foreign.example.invalid/internal')],['empty Origin',()=>canonical('GET',{origin:''})],
  ['foreign Origin',()=>canonical('GET',{origin:'https://foreign.example.invalid'})],['cross-site',()=>canonical('GET',{'sec-fetch-site':'cross-site'})],
  ['query',()=>canonical('GET',{},origin+'/internal?q=1')],['fragment',()=>canonical('GET',{},origin+'/internal#fragment')],
  ['impersonation',()=>canonical('GET',{cookie:'forma_impersonation=forbidden'})],['workspace',()=>canonical('GET',{cookie:'forma_project_context=forbidden'})],
])test(`completed GET witness refuses ${name}`,async t=>{const f=await completedFixture(t),before=snapshot(f);await assert.rejects(inspectCompletedGuestImageClaim(build(),f.env,{sessionId:f.session.sessionId}));assert.deepEqual(snapshot(f),before);});
for(const change of ['headers','database','signal','pilot'])test(`opaque accessor rejects later ${change} mutation without freezing runtime objects`,async t=>{
  const f=await completedFixture(t),controller=new AbortController(),request=canonical('GET',{},undefined,controller.signal),witness=await inspectCompletedGuestImageClaim(request,f.env,{sessionId:f.session.sessionId});
  if(change==='headers')request.headers.set('x-mutated','1');else if(change==='database')f.env.DB={...f.env.DB};else if(change==='signal')controller.abort();else f.env.FORMA_PILOT_COHORT_ID='changed';
  assert.throws(()=>guestImageCompletedClaimData(request,f.env,witness));
});
test('completed witness refuses request mutation during native completed-row await',async t=>{
  const f=await completedFixture(t),request=canonical('GET'),done=readHook(f,sql=>sql.includes('FROM experience_guest_image_claims WHERE session_id='),()=>request.headers.set('x-mutated','1'));
  await assert.rejects(inspectCompletedGuestImageClaim(request,f.env,{sessionId:f.session.sessionId}));done();
});
test('completed witness proof must be joined again and refuses revoked canonical consent',async t=>{
  const f=await completedFixture(t),request=canonical('GET'),witness=await inspectCompletedGuestImageClaim(request,f.env,{sessionId:f.session.sessionId}),data=guestImageCompletedClaimData(request,f.env,witness);
  assert.ok(await f.DB.prepare(`SELECT 1 AS valid WHERE ${data.proof.sql}`).bind(...data.proof.bindings).first());
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);
  assert.equal(await f.DB.prepare(`SELECT 1 AS valid WHERE ${data.proof.sql}`).bind(...data.proof.bindings).first(),null);
  await assert.rejects(inspectCompletedGuestImageClaim(request,f.env,{sessionId:f.session.sessionId}));
  assert.equal(rows(f,'experience_guest_image_claims').length,1);
});
