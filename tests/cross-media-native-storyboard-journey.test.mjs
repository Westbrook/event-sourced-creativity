import assert from 'node:assert/strict';
import test from 'node:test';
import {storyboardIntentFixture,authorizeNative,handleExperienceOutput,outputDocumentExecutionBridge,post,policy,closeFixtureImports} from './sponsor-storyboard-intent-native-fixture.mjs';
import {runDocumentJob} from '../worker/document-jobs-api.ts';
import {outputTestDatabase} from './output-execution-test-helpers.mjs';
import {png} from './output-asset-fixtures.mjs';
test.after(closeFixtureImports);
const plan=()=>({title:'Lantern',summary:'Lantern returns home.',content_markdown:'A lantern is found, lifted, carried home and placed in the window.',presentation:null,items:Array.from({length:4},(_,i)=>({title:'Frame '+(i+1),body:'The keeper carries the same lantern.',notes:'Blue dusk and warm light.',image_prompt:'Adult keeper carries a lantern at dusk '+i,context_group_ids:[],slide:null}))});
async function journey(t,mode='success'){
 const f=await storyboardIntentFixture(t),control=await authorizeNative(f),storage=outputTestDatabase();t.after(()=>storage.sqlite.close());f.env.MEDIA=storage.env.MEDIA;
 const calls=[],original=globalThis.fetch;let frame=0;
 const batch=f.env.DB.batch;
 if(mode==='custody-failure')f.env.DB.batch=async statements=>{
  if(statements.some(s=>s.sql?.includes('INSERT INTO private_content')&&s.bindings?.some(v=>typeof v==='string'&&v.includes('native-planner-original'))))throw Error('private receipt failure');
  return batch.call(f.env.DB,statements);
 };
 if(mode==='storage-failure')f.env.MEDIA.put=async()=>{throw Error('final object storage unavailable');};
 globalThis.fetch=async(url,init={})=>{
  const address=String(url),method=init.method??'GET';calls.push({address,method});
  if(address.endsWith('/responses')){
   const input=JSON.parse(init.body),body={id:'native-planner-original',model:input.model,status:'completed',output:[{type:'message',id:'msg',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(plan())}]}],usage:{input_tokens:100,output_tokens:200,total_tokens:300,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
   if(mode==='refusal')body.output[0].content=[{type:'refusal',refusal:'Synthetic refusal'}];
   if(mode==='incomplete')body.status='incomplete';
   if(mode==='expiry')f.sqlite.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'");
   if(mode==='revocation')f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'");
   if(mode==='unknown-usage')delete body.usage;
   return mode==='malformed'?new Response('{'):Response.json(body);
  }
  if(address.endsWith('/moderations'))return Response.json({id:'moderation',model:'omni-moderation-latest',results:[{flagged:false,categories:{}}]});
  if(method==='POST'&&address==='https://queue.fal.run/ideogram/v4'){
   frame++;if(mode==='uncertain')throw Error('Original request acknowledgement lost');
   return Response.json({request_id:'native-frame-'+frame,status:'IN_QUEUE'});
  }
  if(mode==='accepted-unknown'&&address.includes('/status'))throw Error('Original accepted request status unavailable');
  if(address.includes('/status'))return Response.json({status:'COMPLETED'});
  if(address.includes('/requests/'))return Response.json({images:[{url:'https://v3b.fal.media/files/native-frame-'+frame+'.png',content_type:'image/png',width:1536,height:1024}]});
  if(address.startsWith('https://v3b.fal.media/'))return new Response(png({width:1536,height:1024}),{headers:{'content-type':'image/png'}});
  throw Error('Unexpected offline request '+address);
 };t.after(()=>{globalThis.fetch=original;});
 const run=await handleExperienceOutput(new Request('http://localhost'+f.outputPath+'/run',post({draftHash:f.plan.draftHash,grantId:control.slot.grant_id,explicitRun:true})),f.env,{waitUntil(){throw Error('detached work');}},outputDocumentExecutionBridge);
 assert.equal(run.status,200,await run.clone().text());
 const user=await policy.requireUser(new Request('http://localhost/api/session'),f.env);
 const result=await runDocumentJob(f.env,user.user,control.slot.job_id);
 return {...f,control,calls,result,storage};
}
test('E2 native Storyboard: real admission through planner, original Fal frames, private custody and final storage',async t=>{
 const f=await journey(t);assert.equal(f.result.status,'completed',JSON.stringify({error:f.result.error_message,result:JSON.parse(f.result.result_json).errorDetail,calls:f.calls}));
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.address==='https://queue.fal.run/ideogram/v4').length,4);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,5);
 assert.ok(f.storage.media.size>=4);
 const receipts=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.ok(receipts.every(r=>r.status==='settled'&&r.used_microusd>0));
 const prior=f.calls.length;const user=await policy.requireUser(new Request('http://localhost/api/session'),f.env);await runDocumentJob(f.env,user.user,f.control.slot.job_id);assert.equal(f.calls.length,prior);
 assert.ok(f.sqlite.prepare("SELECT COUNT(*) n FROM private_content WHERE kind='document-artifact'").get().n>0);
});
for(const mode of ['refusal','incomplete','malformed','unknown-usage','uncertain','accepted-unknown','custody-failure','storage-failure','expiry','revocation'])test('E2 native Storyboard journey: '+mode+' preserves original purchase without replacement',async t=>{
 const f=await journey(t,mode);assert.notEqual(f.result.status,'completed');
 const ledger=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();
 if(['custody-failure','storage-failure','expiry','revocation'].includes(mode))assert.ok(ledger.some(r=>r.stage_key==='planning:0:initial'&&r.used_microusd>0),JSON.stringify(ledger));
 if(['unknown-usage','malformed','uncertain','accepted-unknown'].includes(mode))assert.ok(ledger.some(r=>r.used_microusd===null));
 const before=f.calls.filter(c=>c.method==='POST').length;
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.address==='https://queue.fal.run/ideogram/v4').length,['uncertain','accepted-unknown','storage-failure'].includes(mode)?1:0);
 const user=await policy.requireUser(new Request('http://localhost/api/session'),f.env);await runDocumentJob(f.env,user.user,f.control.slot.job_id);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,before);
});
