import test from 'node:test';
import assert from 'node:assert/strict';
import {generationOutcome} from '../src/still/generation-outcome.ts';
import {classifyProviderFailure,publicFailureDetail} from '../worker/provider-errors.ts';
const base={jobId:'attempt',documentId:'document',kind:'generate',status:'failed',members:[],result:{},errorDetail:{code:'operation_failed',category:'unknown',scope:'unknown',action:'none',message:'unknown',retryable:false}};
const job=(error={},result={},rest={})=>({...base,...rest,result,errorDetail:{...base.errorDetail,...error}});
test('historical preparation error produces truthful receipt-based education and source-free support',()=>{
 const input=job({message:'memory_boundary_schema_unavailable'},{prompt:'PRIVATE PROMPT',generationReceipt:{provider_request_status:'not_submitted',source_transmission_status:'not_transmitted',settled_cost_microusd:0,reservation_status:'released'}});
 const before=JSON.stringify(input),out=generationOutcome(input);
 assert.equal(out.kind,'service-before-dispatch');assert.match(out.next,/Check service readiness/);assert.equal(out.facts.length,4);
 assert.doesNotMatch(out.supportSummary,/PRIVATE|memory_boundary/);assert.equal(JSON.stringify(input),before);
 const missing=generationOutcome(job({message:'memory_boundary_schema_unavailable'}));assert.ok(!missing.facts.some(f=>/No provider|not transmitted|\$0.00/.test(f)));
 const lookalike=generationOutcome(job({message:'untrusted prefix memory_boundary_schema_unavailable'}));assert.equal(lookalike.serviceBlocked,false);
});
test('application diagnostic is exact, bounded and excluded from public details',()=>{
 const error=classifyProviderFailure(new Error('memory_boundary_schema_unavailable'));
 assert.equal(error.code,'generation_preparation_unavailable');assert.equal(error.pipelineStage,'storage');assert.equal(error.retryable,false);
 assert.equal(error.diagnosticCode,'memory_boundary_schema_unavailable');assert.equal(publicFailureDetail(error).diagnosticCode,undefined);
 assert.notEqual(classifyProviderFailure(new Error('memory_boundary_schema_unavailable'),new Response('',{status:500})).code,error.code);
});
for(const [name,input,content,kind] of [
 ['usable',job({}, {}, {status:'completed'}),'available','usable'],
 ['saved result unavailable',job({}, {}, {status:'completed'}),'unavailable','saved-content-load-failed'],
 ['partial',job({}, {}, {status:'partial'}),undefined,'partial'],
 ['validation',job({action:'edit_request'}),undefined,'request-validation'],
 ['local safety',job({code:'safety_preflight_flagged',category:'safety'},{},{safetyDeliveryAvailable:true}),undefined,'local-safety-preflight'],
 ['provider safety',job({category:'safety'}),undefined,'provider-refusal'],
 ['account access',job({category:'authentication'}),undefined,'account-access'],
 ['temporary',job({retryable:true,category:'network'},{generationReceipt:{provider_request_status:'not_submitted'}}),undefined,'temporary-before-dispatch'],
 ['unknown submission',job({code:'provider_submission_uncertain'}),undefined,'unknown-submission'],
 ['saved provider result',job({retryable:true,category:'network'},{artifactKind:'video',providerJobId:'original-paid-id'},{kind:'render_document'}),undefined,'provider-result-local-save-failure'],
 ['unknown',job(),undefined,'unknown'],
])test(name+' has cause-specific outcome',()=>{const out=generationOutcome(input,content);assert.equal(out.kind,kind);if(['unknown-submission','account-access','provider-result-local-save-failure'].includes(kind))assert.equal(out.canStartNew,false);});
test('managed or refused provider work never exposes single-result recovery',()=>{
 for(const input of [job({retryable:true},{artifactKind:'video',providerJobId:'original',productionSceneReceipts:{}},{kind:'render_document'}),job({retryable:true,category:'safety'},{artifactKind:'video',providerJobId:'original'},{kind:'render_document'})])assert.equal(generationOutcome(input).recovery,null);
});

test('small recorded charges stay nonzero and a rejected receipt is not called unconfirmed',()=>{
 const out=generationOutcome(job({category:'safety'},{generationReceipt:{provider_request_status:'rejected',settled_cost_microusd:1}}));
 assert.ok(out.facts.includes('Recorded usage: $0.000001.'));assert.ok(!out.facts.some(f=>f.includes('unconfirmed')));
});
test('a service failure with unknown submission never suggests a replacement request',()=>{
 const out=generationOutcome(job({message:'memory_boundary_schema_unavailable'},{generationReceipt:{provider_request_status:'submission_unknown'}}));
 assert.equal(out.kind,'unknown-submission');assert.equal(out.canStartNew,false);
});

test('schema subchecks produce bounded internal diagnostics without public source data',async()=>{
 const {qualifySemanticConsumerBoundary}=await import('../worker/memory-consumer-boundary.ts');
 const {memoryDerivationConsumerSchemaProfile:profile}=await import('../worker/memory-derivation-consumer-schema.ts');
 const {preparationFailureDiagnostic}=await import('../worker/generation-preparation-error.ts');
 for(const [encoded,check] of [[null,'response_shape'],['invalid','response_shape'],[JSON.stringify([{name:'unknown',sql:'PRIVATE',table:'unknown',type:'table'}]),'unexpected_object'],[JSON.stringify([{name:profile.names[0],sql:'PRIVATE',table:'memory_derivation_consumers',type:'table'}]),'missing_family']]){
  let error;try{await qualifySemanticConsumerBoundary(encoded);}catch(caught){error=caught;}
  assert.equal(error.preparationCheck,check);const detail=classifyProviderFailure(error);
  assert.equal(detail.diagnosticCheck,check);assert.equal(publicFailureDetail(detail).diagnosticCheck,undefined);
  const log=preparationFailureDiagnostic(detail,'01a0cadd-2429-7893-9203-a123331424f1');assert.equal(log.correlationId,'01a0cadd-2429-7893-9203-a123331424f1');assert.equal(log.deploymentVersion,null);assert.doesNotMatch(JSON.stringify(log),/PRIVATE/);
 }
});
