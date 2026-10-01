import test from 'node:test';
import assert from 'node:assert/strict';
import {outputPlannerResponseShape,retainedPlannerResponseShape} from '../worker/output-planner-response-shape.ts';
const model='fixture-model';
type TestEnvelope = { model: string; status: string; output: Array<Record<string, unknown> | null>; [key: string]: unknown };
const good=():TestEnvelope=>({id:'response-1',model,status:'completed',output:[{type:'reasoning',id:'reasoning-1',summary:[]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'PRIVATE GENERATED CONTENT'}]}]});
test('strict planner shape preserves valid message/reasoning contract',()=>assert.equal(outputPlannerResponseShape(good(),model).valid,true));
for(const [name,mutate,issue] of [
 ['model',(b:TestEnvelope)=>b.model='different','model_mismatch'],['status',(b:TestEnvelope)=>b.status='incomplete','status_not_completed'],
 ['incomplete',(b:TestEnvelope)=>b.incomplete_details={reason:'max_output_tokens'},'incomplete_details_present'],
 ['extra reasoning',(b:TestEnvelope)=>b.output[0]!.unknown='PRIVATE ENCRYPTED CONTENT','reasoning_extra_fields'],
 ['malformed encrypted reasoning',(b:TestEnvelope)=>b.output[0]!.encrypted_content={secret:'SECRET'},'reasoning_encrypted_content_invalid'],
 ['malformed reasoning content',(b:TestEnvelope)=>b.output[0]!.content={text:'SECRET'},'reasoning_content_invalid'],
 ['wrong reasoning content type',(b:TestEnvelope)=>b.output[0]!.content=[{type:'output_text',text:'SECRET'}],'reasoning_content_invalid'],
 ['extra reasoning content field',(b:TestEnvelope)=>b.output[0]!.content=[{type:'reasoning_text',text:'SECRET',unknown:'PRIVATE'}],'reasoning_content_invalid'],
 ['reasoning summary',(b:TestEnvelope)=>b.output[0]!.summary=[{type:'wrong',text:'SECRET'}],'reasoning_summary_invalid'],
 ['role',(b:TestEnvelope)=>b.output[1]!.role='user','message_role_invalid'],['message status',(b:TestEnvelope)=>b.output[1]!.status='in_progress','message_status_invalid'],
 ['refusal',(b:TestEnvelope)=>b.output[1]!.content=[{type:'refusal',refusal:'SECRET'}],'message_content_invalid'],
 ['multiple',(b:TestEnvelope)=>b.output.push(b.output[1]),'message_count_invalid'],['null',(b:TestEnvelope)=>b.output.push(null),'output_item_not_object'],
] as const)test('rejects '+name,()=>{const body=good();mutate(body);const result=outputPlannerResponseShape(body,model);assert.equal(result.valid,false);assert.ok(result.issues.includes(issue));assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);});
const identity={jobId:'job',documentId:'document',streamId:'stream',kind:'audio',clientRequestId:'client',responseId:'response-1',model};
for(const content of [null,[],[{type:'reasoning_text',text:'PRIVATE REASONING'}]])test('accepts documented optional reasoning content '+JSON.stringify(content),()=>{const body=good();body.output[0]!.content=content;assert.equal(outputPlannerResponseShape(body,model).valid,true);assert.doesNotMatch(JSON.stringify(outputPlannerResponseShape(body,model)),/PRIVATE/);});
const retained=()=>({job_id:identity.jobId,document_id:identity.documentId,stream_id:identity.streamId,artifact_kind:identity.kind,response_id:identity.responseId,call:{clientRequestId:identity.clientRequestId,providerRequestId:identity.responseId,model},raw_envelope:JSON.stringify(good())});
test('exact retained call returns only structural evidence',()=>assert.deepEqual(retainedPlannerResponseShape(JSON.stringify(retained()),identity),{valid:true,issues:[],reasoningEncryptedContent:false}));
for(const encrypted of [null,'OPAQUE ENCRYPTED CONTENT'])test('accepts documented encrypted reasoning '+typeof encrypted,()=>{const body=good();body.output[0]!.encrypted_content=encrypted;assert.deepEqual(outputPlannerResponseShape(body,model),{valid:true,issues:[],reasoningEncryptedContent:true});assert.doesNotMatch(JSON.stringify(outputPlannerResponseShape(body,model)),/OPAQUE/);});
for(const key of ['job_id','document_id','stream_id','artifact_kind','response_id'])test('rejects mismatched retained '+key,()=>assert.equal(retainedPlannerResponseShape(JSON.stringify({...retained(),[key]:'other'}),identity),null));
for(const key of ['clientRequestId','providerRequestId','model'] as const)test('rejects mismatched call '+key,()=>{const r=retained();r.call[key]='other';assert.equal(retainedPlannerResponseShape(JSON.stringify(r),identity),null);});
test('invalid and oversized retained envelopes fail closed',()=>{assert.equal(retainedPlannerResponseShape('{',identity),null);assert.equal(retainedPlannerResponseShape(JSON.stringify({...retained(),raw_envelope:'x'.repeat(524289)}),identity),null);});
