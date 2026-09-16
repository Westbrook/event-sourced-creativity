import test from 'node:test';
import assert from 'node:assert/strict';
import {outputPlannerResponseShape,retainedPlannerResponseShape} from '../worker/output-planner-response-shape.ts';
const model='fixture-model';
const good=()=>({id:'response-1',model,status:'completed',output:[{type:'reasoning',id:'reasoning-1',summary:[]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'PRIVATE GENERATED CONTENT'}]}]});
test('strict planner shape preserves valid message/reasoning contract',()=>assert.equal(outputPlannerResponseShape(good(),model).valid,true));
for(const [name,mutate,issue] of [
 ['model',b=>b.model='different','model_mismatch'],['status',b=>b.status='incomplete','status_not_completed'],
 ['incomplete',b=>b.incomplete_details={reason:'max_output_tokens'},'incomplete_details_present'],
 ['extra reasoning',b=>b.output[0].encrypted_content='PRIVATE ENCRYPTED CONTENT','reasoning_extra_fields'],
 ['reasoning summary',b=>b.output[0].summary=[{type:'wrong',text:'SECRET'}],'reasoning_summary_invalid'],
 ['role',b=>b.output[1].role='user','message_role_invalid'],['message status',b=>b.output[1].status='in_progress','message_status_invalid'],
 ['refusal',b=>b.output[1].content=[{type:'refusal',refusal:'SECRET'}],'message_content_invalid'],
 ['multiple',b=>b.output.push(b.output[1]),'message_count_invalid'],['null',b=>b.output.push(null),'output_item_not_object'],
] as const)test('rejects '+name,()=>{const body:any=good();mutate(body);const result=outputPlannerResponseShape(body,model);assert.equal(result.valid,false);assert.ok(result.issues.includes(issue));assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);});
const identity={jobId:'job',documentId:'document',streamId:'stream',kind:'audio',clientRequestId:'client',responseId:'response-1',model};
const retained=()=>({job_id:identity.jobId,document_id:identity.documentId,stream_id:identity.streamId,artifact_kind:identity.kind,response_id:identity.responseId,call:{clientRequestId:identity.clientRequestId,providerRequestId:identity.responseId,model},raw_envelope:JSON.stringify(good())});
test('exact retained call returns only structural evidence',()=>assert.deepEqual(retainedPlannerResponseShape(JSON.stringify(retained()),identity),{valid:true,issues:[],reasoningEncryptedContent:false}));
for(const key of ['job_id','document_id','stream_id','artifact_kind','response_id'])test('rejects mismatched retained '+key,()=>assert.equal(retainedPlannerResponseShape(JSON.stringify({...retained(),[key]:'other'}),identity),null));
for(const key of ['clientRequestId','providerRequestId','model'])test('rejects mismatched call '+key,()=>{const r=retained();r.call[key]='other';assert.equal(retainedPlannerResponseShape(JSON.stringify(r),identity),null);});
test('invalid and oversized retained envelopes fail closed',()=>{assert.equal(retainedPlannerResponseShape('{',identity),null);assert.equal(retainedPlannerResponseShape(JSON.stringify({...retained(),raw_envelope:'x'.repeat(524289)}),identity),null);});
