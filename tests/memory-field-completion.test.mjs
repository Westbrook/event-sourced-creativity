import assert from 'node:assert/strict';
import test from 'node:test';
import {parseMemoryFieldCompletion} from '../src/model/memory-field-completion.ts';
import {readMemoryFieldResponse,MEMORY_FIELD_RESPONSE_BYTES} from '../src/state/memory-field-response.ts';
const now=Date.now(),target={projectId:'project',documentId:'document',blockId:'block',revision:3,text:'Original authored text',locale:'ja'};
const fixture=()=>({bindingHash:'a'.repeat(64),validUntil:new Date(now+30000).toISOString(),independentEvidence:false,review:{version:'memory-edit-review-v1',executionId:'execution',turnId:'turn',projectId:target.projectId,documentId:target.documentId,sourceHash:'b'.repeat(64),locale:target.locale,mode:'review-only',independentEvidence:false,edits:[{blockId:'block',field:'text',revision:3,beforeExcerpt:target.text,suggestedText:'候補 <script>text only</script>'}]}});
test('field completion clones exact field/language review without giving it independent authority',()=>{
 const source=fixture(),parsed=parseMemoryFieldCompletion(source,target,now);assert.ok(parsed);source.review.edits[0].suggestedText='later changed';assert.notEqual(parsed.review.edits[0].suggestedText,'later changed');assert.equal(parsed.independentEvidence,false);
});
for(const [key,value]of Object.entries({projectId:'other',documentId:'other',blockId:'other',revision:4,text:'UNSENT LOCAL DRAFT',locale:'en'}))test('field completion rejects changed '+key,()=>assert.equal(parseMemoryFieldCompletion(fixture(),{...target,[key]:value},now),null));
for(const [name,mutate]of [
 ['expired',s=>s.validUntil=new Date(now-1).toISOString()],['extended lease',s=>s.validUntil=new Date(now+86400000).toISOString()],
 ['invalid hash',s=>s.bindingHash='opaque'],['independent claim',s=>s.independentEvidence=true],['extra operation',s=>s.action='apply'],
 ['another edit',s=>s.review.edits.push({...s.review.edits[0],blockId:'other'})],['different field',s=>s.review.edits[0].field='label'],
 ['private accessor',s=>Object.defineProperty(s,'review',{enumerable:true,get(){return assert.fail('Do not evaluate accessors');}})],
 ['hidden field',s=>Object.defineProperty(s,'hidden',{value:'private'})],['review accessor',s=>Object.defineProperty(s.review,'sourceHash',{enumerable:true,get(){return assert.fail('Do not evaluate source accessors');}})],
])test('field completion fails closed for '+name,()=>{const source=fixture();mutate(source);assert.equal(parseMemoryFieldCompletion(source,target,now),null);});
const signal=()=>new AbortController().signal;
test('field response decoder preserves split UTF-8 and releases its reader',async()=>{
 const encoded=new TextEncoder().encode(JSON.stringify({text:'候補'}));let i=0;
 const response=new Response(new ReadableStream({pull(c){if(i<encoded.length)c.enqueue(encoded.slice(i,++i));else c.close();}}),{headers:{'content-type':'application/json'}});
 assert.deepEqual(await readMemoryFieldResponse(response,signal()),{text:'候補'});assert.equal(response.body.locked,false);
});
for(const [name,bytes]of [['over-limit',new TextEncoder().encode(JSON.stringify({text:'x'.repeat(MEMORY_FIELD_RESPONSE_BYTES)}))],['invalid UTF-8',new Uint8Array([123,34,0xff,34,125])],['invalid JSON',new TextEncoder().encode('{')]])test('field response rejects '+name,async()=>{
 const response=new Response(bytes,{headers:{'content-type':'application/json'}});await assert.rejects(readMemoryFieldResponse(response,signal()));assert.equal(response.body.locked,false);
});
test('field response abort releases a stalled read without awaiting producer cancellation',{timeout:1000},async()=>{
 let pulled,canceled=0;const started=new Promise(resolve=>{pulled=resolve;});
 const response=new Response(new ReadableStream({pull(){pulled();return new Promise(()=>{});},cancel(){canceled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}}),controller=new AbortController();
 const reading=readMemoryFieldResponse(response,controller.signal);await started;controller.abort();await assert.rejects(reading,/aborted/);assert.ok(canceled>=1);assert.equal(response.body.locked,false);
});
test('field response refuses non-JSON and already-aborted reads',async()=>{
 await assert.rejects(readMemoryFieldResponse(new Response('plain'),signal()));const controller=new AbortController();controller.abort();await assert.rejects(readMemoryFieldResponse(Response.json({}),controller.signal));
});

const {parseMemoryFieldRequest,memoryFieldTextHash,memoryFieldRequestCurrent}=await import('../src/model/memory-field-request.ts');
test('field generation binds exact saved Unicode text and clones closed target data',async()=>{
 const text='静かな方向 اقتراح',request={blockId:'block',field:'text',revision:2,textHash:await memoryFieldTextHash(text)};
 const parsed=parseMemoryFieldRequest(request);assert.deepEqual(parsed,request);assert.notEqual(parsed,request);
 const atom={id:'block',type:'direction',text,version:2,providerEligible:true,providerVisibility:'editable',intent:'include'};
 assert.equal(await memoryFieldRequestCurrent({decisionAtoms:[atom]},parsed),true);
 for(const patch of [{text:'x'.repeat(1201)},{text:text+' '},{version:3},{locked:true},{protected:true},{immutable:true},{providerEligible:false},{providerVisibility:'restricted'},{intent:'prohibit'},{type:'reference'}])
  assert.equal(await memoryFieldRequestCurrent({decisionAtoms:[{...atom,...patch}]},parsed),false);
 assert.equal(await memoryFieldRequestCurrent({decisionAtoms:[atom,atom]},parsed),false);
 for(const patch of [{field:'label'},{revision:0},{revision:1.1},{textHash:'invalid'},{blockId:'\ud800'},{draft:'never accepted'}])assert.equal(parseMemoryFieldRequest({...request,...patch}),null);
 const getter={...request};Object.defineProperty(getter,'blockId',{enumerable:true,get(){return assert.fail('do not run getters');}});assert.equal(parseMemoryFieldRequest(getter),null);
 await assert.rejects(memoryFieldTextHash('\ud800'));
});

const {parseMemoryBackgroundField,memoryBackgroundFieldApprovalHash}=await import('../src/model/memory-background-field.ts');
const backgroundFixture=()=>({version:'memory-background-field-v1',jobId:'a'.repeat(64),claimKey:'derived:'+'b'.repeat(64),outputHash:'c'.repeat(64),projectId:target.projectId,documentId:target.documentId,blockId:target.blockId,revision:target.revision,sequence:17,textHash:'d'.repeat(64),beforeExcerpt:target.text,suggestedText:'候補',locale:target.locale,validUntil:new Date(Date.now()+30000).toISOString(),independentEvidence:false});
test('background field presentation has a real job identity and exact replacement approval without a fake turn',async()=>{
 const value=backgroundFixture(),parsed=parseMemoryBackgroundField(value,target);assert.ok(parsed);assert.notEqual(parsed,value);assert.equal(Object.hasOwn(parsed,'turnId'),false);
 const approved=await memoryBackgroundFieldApprovalHash(value);assert.match(approved,/^[a-f0-9]{64}$/u);
 value.suggestedText+=' changed';assert.notEqual(await memoryBackgroundFieldApprovalHash(value),approved);
 for(const key of ['jobId','outputHash','textHash']){const revised=backgroundFixture();revised[key]='e'.repeat(64);assert.notEqual(await memoryBackgroundFieldApprovalHash(revised),approved);}
});
for(const [key,value]of Object.entries({jobId:'invalid',claimKey:'invalid',revision:0,sequence:0,beforeExcerpt:'UNSENT',locale:'en',suggestedText:'',independentEvidence:true,validUntil:new Date(0).toISOString(),turnId:'fake-turn',projectId:'other'}))test('background field presentation rejects '+key,()=>assert.equal(parseMemoryBackgroundField({...backgroundFixture(),[key]:value},target),null));
test('background field presentation refuses accessors without invocation',()=>{const value=backgroundFixture();Object.defineProperty(value,'jobId',{enumerable:true,get(){return assert.fail('No getter invocation');}});assert.equal(parseMemoryBackgroundField(value,target),null);});
