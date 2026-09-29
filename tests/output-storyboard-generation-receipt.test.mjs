import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const source=readFileSync(process.env.FORMA_RECEIPT_SOURCE_ROOT?process.env.FORMA_RECEIPT_SOURCE_ROOT+'/worker/document-jobs-api.ts':new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
test('native Storyboard accepted receipt reflects the existing five-stage allowance in public and private views',async()=>{
 const start=source.indexOf('async function acceptedGenerationReceipt('),end=source.indexOf('\nfunction parentJobIdFromRequest',start);assert(start>0&&end>start);
 let captured;const deps={
  sceneConfigurationFromRequest:()=>null,readOutputAudioPayload:()=>null,
  sourceSnapshotSha256:async value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  captureDocumentRenderSettings:payload=>({schema_version:1,artifact_kind:payload.artifactKind,settings:{itemCount:payload.itemCount,productionMode:payload.productionMode}}),
  storePrivateContent:async(_env,owner,kind,raw)=>{captured={owner,kind,value:JSON.parse(raw)};return{contentId:'original-input',expiresAt:new Date(Date.now()+86400000).toISOString()};}
 };
 const fn=new Function(...Object.keys(deps),stripTypeScriptTypes(source.slice(start,end))+';return acceptedGenerationReceipt;')(...Object.values(deps));
 const payload={artifactKind:'storyboard',productionMode:'manual',itemCount:4,paidMediaConfirmed:true,snapshot:{facts:[{instruction:'Retained authored story'}]}},maximum=3800000;
 async function receipt(native,production=null,extra={}){return fn({OPENAI_MODEL:'gpt-5.6-terra'},{userId:'owner'},{...payload,...extra},'same-document','original-job',maximum,production,undefined,undefined,undefined,undefined,undefined,native);}
 const actual=await receipt(true);
 for(const view of [actual,actual.settings,captured.value.request]){
  assert.equal(view.planned_provider_call_count,5);assert.equal(view.maximum_provider_call_count,5);assert.equal(view.max_repair_call_count,0);assert.equal(view.reservation_microusd,maximum);
 }
 assert.equal(actual.minimum_provider_call_count,5);assert.equal(actual.actual_provider_call_count,null);assert.equal(actual.repair_calls_may_incur_additional_usage,false);
 for(const view of [actual,captured.value.accounting]){assert.equal(view.reservation_is_application_hard_cap,true);assert.equal(view.reservation_is_provider_hard_cap,false);assert.equal(view.maximum_authorized_cost_microusd,maximum);assert.equal(view.settled_cost_microusd,0);}
 assert.equal(actual.source_transmission_status,'not_transmitted');assert.equal(actual.provider_request_status,'not_submitted');assert.equal(captured.value.source.status,'not_transmitted');assert.equal(captured.value.planner.request_status,'not_submitted');assert.equal(captured.value.job_id,'original-job');assert.equal(captured.value.document_id,'same-document');assert.deepEqual(captured.value.document_snapshot,payload.snapshot);
 // Raw flags alone cannot select native receipt accounting; legacy behavior is unchanged.
 const legacy=await receipt(false,null,{nativeStoryboardReceipt:true,outputStoryboard:{forged:true},outputExecution:{slotId:'forged'}});
 assert.equal(legacy.planned_provider_call_count,1);assert.equal(legacy.maximum_provider_call_count,2);assert.equal(legacy.max_repair_call_count,1);assert.equal(legacy.reservation_is_application_hard_cap,false);assert.equal(Object.hasOwn(legacy,'maximum_authorized_cost_microusd'),false);
 const managed=await receipt(false,{providerCallCount:7,maxRepairCallCount:2,maximumProviderCallCount:9,providerBatchCount:3},{productionMode:'managed'});
 assert.equal(managed.planned_provider_call_count,7);assert.equal(managed.maximum_provider_call_count,9);assert.equal(managed.max_repair_call_count,2);assert.equal(managed.batch_count,3);assert.equal(managed.reservation_is_application_hard_cap,false);
 // The actual sole callsite passes the private server preparation, not a JSON flag.
 assert.match(source,/const nativeStoryboard=outputPreparation\?\.outputStoryboard\?\?null/u);
 assert.match(source,/if\(nativeStoryboard\)await nativeStoryboard\.refresh\(\)/u);
 const calls=source.match(/await acceptedGenerationReceipt\([^;]+/gu);assert.equal(calls.length,1);assert(calls[0].includes('nativeScene?.payload,Boolean(nativeStoryboard)'));
});
