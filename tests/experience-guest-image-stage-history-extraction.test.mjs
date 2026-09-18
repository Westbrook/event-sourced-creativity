import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {guestImageStageNativePayload,guestImageStageConfirmedPlan,guestImageStageEvent,guestImageStageCommandRow,
  guestImageStagePlanRows,guestImageStageIntentRow,guestImageStageQuoteRow,guestImageStageQuoteShape,
  guestImageStageQuoteRecipe} from '../worker/experience-guest-image-stage-contract.ts';

// Native offer bytes are the existing independently frozen reference, not the
// current builder. The remaining expected values below are explicit original
// native storage contracts. No Git object, DB, provider or environment is needed.
const reference=JSON.parse(readFileSync(new URL('./fixtures/guest-image-native-disclosure-d848.json',import.meta.url),'utf8'));
const native=reference.cases.find(value=>value.name==='Image square');
assert.equal(createHash('sha256').update(native.expectedSerialized).digest('hex'),native.expectedSha256);
const offer=JSON.parse(native.expectedSerialized),target=structuredClone(native.input.target);
const hash=letter=>`sha256:${letter.repeat(64)}`;
const stamp='2020-01-01T00:00:01.000Z',saveStamp='2020-01-01T00:00:00.000Z',quoteStamp='2020-01-01T00:00:02.000Z';
const ids={prefix:'11111111-1111-1111-1111-111111111111',save:'22222222-2222-2222-2222-222222222222',
  confirm:'33333333-3333-3333-3333-333333333333',quote:'44444444-4444-4444-4444-444444444444',revision:'55555555-5555-5555-5555-555555555555',
  preflight:'66666666-6666-6666-6666-666666666666'};
const transport={planning:{api:'https://api.openai.com/v1/responses',maximumOutputTokens:1200,reasoningEffort:'low',verbosity:'low',
  format:{type:'json_schema',name:'forma_creative_direction',strict:true,schemaDigest:'sha256:d847c85755559fbe899d448a88e3a18067564990c7f2228b62f32c96bd00805d'},store:false},
  image:{api:'https://api.openai.com/v1/images/generations',adapterId:'openai-image',adapterVersion:'v5',quality:'high',outputFormat:'png',partialImages:0,outputCount:1},
  safety:{api:'https://api.openai.com/v1/moderations',provider:'openai',model:'omni-moderation-latest',maximumCalls:1,input:'text'}};
const template={version:2,appId:'image',recipeVersion:'image@2',releaseDigest:hash('a'),outputKind:'image',inputMode:'text-only',outputCount:1,durationMs:0,
  width:1024,height:1024,route:offer.route,maximumCalls:offer.maximumCalls,maximumTokens:offer.maximumTokens,maximumMicrousd:offer.maximumMicrousd,
  calls:structuredClone(offer.settings.calls),settings:{kind:'generate',productionMode:'manual',budgetAcknowledged:true,preflightAcknowledged:true,
    imageRender:structuredClone(offer.settings.imageRender),imageBudget:structuredClone(offer.settings.imageBudget),executionPolicy:structuredClone(offer.settings.executionPolicy)},transport};
const data={scopeKey:'personal:original-guest:original-project',actorUserId:'original-guest',projectId:'original-project',documentId:'original-document',streamId:'creative:original-guest',
  sourceHead:1,sourceEventIds:[ids.prefix],savedEventId:ids.save,savedCreatedAt:saveStamp,campaignId:'original-campaign',sessionDigest:hash('b'),
  sourceDigest:hash('c'),requirementsDigest:hash('d'),compiledPlan:{targets:[target]},target,targetId:target.id,contractDigest:hash('e'),
  confirmationOptions:{count_policies:{},suggested_counts:{}},releaseRevision:2,releaseHash:hash('a'),approvedTemplate:template,
  driver:{driverId:'original-driver',intentKey:'original-intent',commandJson:'{"original":true}',commandDigest:hash('f')},confirmationTextBytes:321};
const confirmed={id:'original-document',revisionId:ids.revision,revision:1,confirmedAt:stamp,requirementsDigest:hash('d'),sourceDigest:hash('c'),
  plan:data.compiledPlan,targetContractDigests:{'disclosure-parity':hash('e')},confirmationOptions:{count_policies:{},suggested_counts:{}}};
const envelope={documentId:'original-document',expectedRevision:'output:2',clientMutationId:'original-confirm-key',action:'confirm'};
const payload={plan_revision_id:ids.revision,confirmed_plan:confirmed,output_command_envelope:envelope,
  project_id:'original-project',document_id:'original-document',actor_user_id:'original-guest'};
const event={eventId:ids.confirm,streamId:'creative:original-guest',sequence:3,occurredAt:stamp,recordedAt:stamp,actor:'original-guest',clientId:'server:guest-output',
  correlationId:'original-confirm-key',causationId:null,compensatesEventId:null,schemaVersion:1,type:'OutputPlanConfirmed',payload};
const quote={id:ids.preflight,planRevisionId:ids.revision,sourceDigest:hash('c'),requirementsDigest:hash('d'),targets:[offer],
  operationAttempts:{'disclosure-parity':{ordinal:0,previousSlotId:null}},maximumMicrousd:1000000,maximumCalls:2,
  expiresAt:'2020-01-01T00:15:02.000Z',createdAt:quoteStamp,termsDigest:hash('f')};
const ceiling=Date.parse(quote.expiresAt),shapeExpected={revisionId:ids.revision,recordedAt:quoteStamp,expiresAtMs:ceiling};
const digest=value=>createHash('sha256').update(value).digest('hex');

test('pure original confirmation, payload and SQL row values preserve exact field order and ownership',()=>{
  assert.equal(JSON.stringify(guestImageStageConfirmedPlan(data,ids.revision,stamp)),JSON.stringify(confirmed));
  const actual=guestImageStageNativePayload(data,envelope,{plan_revision_id:ids.revision,confirmed_plan:confirmed});
  assert.equal(JSON.stringify(actual),JSON.stringify(payload));assert.notEqual(actual.output_command_envelope,envelope);
  const expected={plan:{scope_key:data.scopeKey,scope_kind:'personal',owner_user_id:'original-guest',project_id:'original-project',document_id:'original-document',
    organization_id:null,project_access_id:null,plan_revision_id:ids.revision,plan_id:'original-document',revision:1,confirmed_event_id:ids.confirm,
    requirements_digest:hash('d'),source_digest:hash('c'),resolver_version:'output-plan-v1',source_head:2,target_count:1,created_at:stamp},
    target:{scope_key:data.scopeKey,plan_revision_id:ids.revision,target_id:'disclosure-parity',target_contract_digest:hash('e'),media_kind:'image',required:1,selected:1,ordinal:0}};
  assert.equal(JSON.stringify(guestImageStagePlanRows(data,confirmed,event)),JSON.stringify(expected));
  assert.equal(JSON.stringify(guestImageStageCommandRow(data,event,'confirm',hash('f'))),JSON.stringify({scope_key:data.scopeKey,actor_user_id:'original-guest',
    command_key:'original-confirm-key',request_digest:hash('f'),action:'confirm',event_id:ids.confirm,created_at:stamp}));
  assert.equal(JSON.stringify(guestImageStageIntentRow(data,Date.parse(stamp))),JSON.stringify({driver_id:'original-driver',campaign_id:'original-campaign',actor_user_id:'original-guest',
    session_digest:hash('b'),intent_key:'original-intent',document_id:'original-document',command_json:'{"original":true}',command_digest:hash('f'),
    source_digest:hash('c'),requirements_digest:hash('d'),source_text_bytes:321,created_at_ms:Date.parse(stamp)}));
  assert.equal(JSON.stringify(guestImageStageQuoteRow(data,quote,{eventId:ids.quote})),JSON.stringify({scope_key:data.scopeKey,preflight_id:ids.preflight,plan_revision_id:ids.revision,
    actor_user_id:'original-guest',terms_digest:hash('f'),event_id:ids.quote,expires_at:quote.expiresAt,created_at:quoteStamp}));
});

test('exact original event is cloned and frozen; confirmation and preflight have distinct historical bounds',()=>{
  const actual=guestImageStageEvent(data,event,'confirm',payload,{commandKey:event.correlationId,expiresAtMs:ceiling});
  assert.equal(JSON.stringify(actual),JSON.stringify(event));assert.notEqual(actual,event);assert.notEqual(actual.payload,event.payload);
  assert.ok(Object.isFrozen(actual));assert.ok(Object.isFrozen(actual.payload.confirmed_plan));
  const preflightEnvelope={...envelope,expectedRevision:'output:3',clientMutationId:'original-preflight-key',action:'preflight'};
  const values={preflight_id:quote.id,plan_revision_id:ids.revision,preflight:quote,guest_sponsor_quote_transport:transport};
  const quotePayload=guestImageStageNativePayload(data,preflightEnvelope,values);
  assert.deepEqual(Object.keys(quotePayload),['preflight_id','plan_revision_id','preflight','guest_sponsor_quote_transport','output_command_envelope','project_id','document_id','actor_user_id']);
  const raw={...event,eventId:ids.quote,sequence:4,occurredAt:quoteStamp,recordedAt:quoteStamp,correlationId:'original-preflight-key',type:'OutputPlanPreflighted',payload:quotePayload};
  const expected={commandKey:raw.correlationId,expiresAtMs:ceiling,confirmEvent:event};
  assert.equal(JSON.stringify(guestImageStageEvent(data,raw,'preflight',quotePayload,expected)),JSON.stringify(raw));
  assert.throws(()=>guestImageStageEvent(data,raw,'preflight',quotePayload,{commandKey:raw.correlationId,expiresAtMs:ceiling}));
  assert.throws(()=>guestImageStageEvent(data,{...raw,eventId:ids.confirm},'preflight',quotePayload,expected));
  assert.throws(()=>guestImageStageEvent(data,{...raw,occurredAt:saveStamp,recordedAt:saveStamp},'preflight',quotePayload,expected));
});

for(const [name,mutate] of [
  ['payload property order',raw=>{raw.payload=Object.fromEntries(Object.entries(raw.payload).reverse());}],
  ['extra event field',raw=>{raw.unexpected=true;}],['source event ID',raw=>{raw.eventId=ids.prefix;}],['SAVE event ID',raw=>{raw.eventId=ids.save;}],
  ['foreign guest',raw=>{raw.actor='canonical-claimant';}],['wrong head',raw=>{raw.sequence++;}],['malformed timestamp',raw=>{raw.recordedAt='2020-01-01';}],
  ['before SAVE',raw=>{raw.occurredAt=raw.recordedAt='2019-12-31T23:59:59.000Z';}],['at deadline',raw=>{raw.occurredAt=raw.recordedAt=quote.expiresAt;}],
  ['wrong client',raw=>{raw.clientId='client';}],['wrong correlation',raw=>{raw.correlationId='replacement';}],['causation',raw=>{raw.causationId=ids.prefix;}],
])test(`original stage event rejects ${name}`,()=>{const raw=structuredClone(event);mutate(raw);
  assert.throws(()=>guestImageStageEvent(data,raw,'confirm',payload,{commandKey:event.correlationId,expiresAtMs:ceiling}),/image_output_successor_invalid/u);});

test('quote shape preserves expired historical quote without renewal and enforces both exact ceilings',()=>{
  assert.equal(guestImageStageQuoteShape(data,quote,shapeExpected),quote);
  assert.throws(()=>guestImageStageQuoteShape(data,quote,{...shapeExpected,expiresAtMs:ceiling-1}),/quote_invalid/u);
  assert.equal(guestImageStageQuoteShape(data,{...quote,expiresAt:'2020-01-01T00:02:00.000Z'},shapeExpected).expiresAt,'2020-01-01T00:02:00.000Z');
  assert.throws(()=>guestImageStageQuoteShape(data,{...quote,expiresAt:'2020-01-01T00:15:02.001Z'},{...shapeExpected,expiresAtMs:ceiling+10000}));
  assert.throws(()=>guestImageStageQuoteShape(data,{...quote,expiresAt:quote.createdAt},shapeExpected));
  assert.throws(()=>guestImageStageQuoteShape(data,{...quote,renewed:true},shapeExpected));
  assert.throws(()=>guestImageStageQuoteShape(data,{...quote,operationAttempts:{'disclosure-parity':{ordinal:1,previousSlotId:null}}},shapeExpected));
});

test('actual native offer and original transport match without current provider configuration or network',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('pure extraction attempted network');});
  const recipe=await guestImageStageQuoteRecipe(data,offer,transport);
  assert.deepEqual(recipe,{appId:'image',recipeVersion:'image@2',releaseDigest:hash('a'),outputKind:'image',provider:'openai',model:'gpt-image-2',
    routeDigest:`sha256:${digest(JSON.stringify(sort(offer)))}`,settingsDigest:`sha256:${digest(JSON.stringify(sort(offer.settings)))}`,
    outputCount:1,durationMs:0,width:1024,height:1024,calls:{parsing:0,planning:1,render:1,repair:0},maximumTokens:128000,maximumMicrousd:1000000});
  assert.equal(fetch.mock.callCount(),0);
});
// Independent canonical object ordering for expected digest, not the compiler helper.
function sort(value){return Array.isArray(value)?value.map(sort):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}

for(const [name,mutate] of [
  ['target instructions',value=>{value.offered.settings.payload.outputTargetInstructions='Coherently substituted text';}],
  ['target identity',value=>{value.offered.targetId='another-target';}],['disclosure',value=>{value.offered.transferDescription='No transfer';}],
  ['reason values',value=>{value.offered.reasonValues.maximumExecutionSeconds=241;}],['transport',value=>{value.transport.image.adapterVersion='v4';}],
  ['geometry',value=>{value.offered.settings.imageRender.format.dimensions.width=2048;}],['call limit',value=>{value.offered.maximumCalls=3;}],
])test(`retained native contract refuses changed ${name}`,async()=>{const value={offered:structuredClone(offer),transport:structuredClone(transport)};mutate(value);
  await assert.rejects(guestImageStageQuoteRecipe(data,value.offered,value.transport));});

test('minimal row and shape inputs do not require erased plan, target, provider or live authority',()=>{
  const forbidden=new Proxy({}, {get(){throw Error('erased or live authority was accessed');}});
  const scope={scopeKey:data.scopeKey,actorUserId:data.actorUserId,compiledPlan:forbidden,target:forbidden,env:forbidden};
  assert.equal(guestImageStageQuoteRow(scope,quote,{eventId:ids.quote}).preflight_id,quote.id);
  assert.equal(guestImageStageQuoteShape({sourceDigest:data.sourceDigest,requirementsDigest:data.requirementsDigest,targetId:target.id},quote,shapeExpected),quote);
});
