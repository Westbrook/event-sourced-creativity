import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,snapshot,noWrites,assertUnpaid} from './sponsor-audio-evidence-fixture.mjs';
const {describeSponsorAudioAdmission,readSponsorAudioTemplateEvidence}=await import('../worker/experience-sponsor-audio-evidence.ts');
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('No egress in Audio boundary qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const finalProof=statements=>statements.some(statement=>statement.sql.includes('private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?'));
async function reader(f,method){
 const recipe=method==='template'?(await describeSponsorAudioAdmission(f.trusted,f.command)).recipe:null;
 return ()=>method==='describe'?describeSponsorAudioAdmission(f.trusted,f.command):readSponsorAudioTemplateEvidence(f.trusted,f.command,recipe);
}
const settle=promise=>promise.then(value=>({value}),error=>({error}));
const nestedMicrotask=(depth,action)=>queueMicrotask(()=>depth===1?action():nestedMicrotask(depth-1,action));
for(const method of ['describe','template'])test(`Audio boundary sparse acknowledgement denies ${method}`,async t=>{
 const f=await fixture(t),read=await reader(f,method),before=snapshot(f),readonly=noWrites(f),batch=f.DB.batch.bind(f.DB);let reached=false;
 f.DB.batch=async statements=>{const results=await batch(statements);if(finalProof(statements)){reached=true;assert.ok(results.length>0);assert.ok(results.every(result=>result.success===true&&result.results[0].current===1));delete results[0];}return results;};
 const outcome=await settle(read());
 t.diagnostic(JSON.stringify({method,realFinalBatch:reached,missingOwnAcknowledgement:true,returnedEvidence:Boolean(outcome.value),unchangedDatabase:true}));
 assert.equal(reached,true);assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);assert.ok(outcome.error,'missing own acknowledgement must not produce evidence');
});
test('Audio boundary accepts only dense own-data native acknowledgements without executing accessors',async t=>{
 for(const fault of ['all-holes','inherited-slot','accessor-slot','sparse-row','inherited-current','accessor-current','string-current','missing-success','false-success','error','extra-row','proxy-row-length','proxy-batch-length']){
  const f=await fixture(t),before=snapshot(f),readonly=noWrites(f),batch=f.DB.batch.bind(f.DB);let reached=false,getters=0;
  f.DB.batch=async statements=>{const results=await batch(statements);if(!finalProof(statements))return results;reached=true;
   if(fault==='all-holes')return new Array(results.length);
   if(fault==='inherited-slot'){const first=results[0];delete results[0];Object.setPrototypeOf(results,Object.assign(Object.create(Array.prototype),{0:first}));}
   if(fault==='accessor-slot'){const first=results[0];Object.defineProperty(results,'0',{get(){getters++;return first;}});}
   if(fault==='sparse-row')delete results[0].results[0];
   if(fault==='inherited-current')results[0].results[0]=Object.create({current:1});
   if(fault==='accessor-current')Object.defineProperty(results[0].results[0],'current',{get(){getters++;return 1;}});
   if(fault==='string-current')results[0].results[0].current='1';
   if(fault==='missing-success')delete results[0].success;
   if(fault==='false-success')results[0].success=false;
   if(fault==='error')results[0].error='read failed';
   if(fault==='extra-row')results[0].results.push({current:0});
   if(fault==='proxy-row-length'){results[0].results.push({current:0});results[0].results=new Proxy(results[0].results,{get(target,key,receiver){return key==='length'?1:Reflect.get(target,key,receiver);}});}
   if(fault==='proxy-batch-length'){const expected=results.length;results.push({success:false,results:[{current:0}]});return new Proxy(results,{get(target,key,receiver){return key==='length'?expected:Reflect.get(target,key,receiver);}});}
   return results;
  };
  await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command),/sponsor_authority_changed/);assert.equal(reached,true,fault);assert.equal(getters,0,fault);assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
 }
});
for(const method of ['describe','template'])for(const fault of ['abort','deadline','request','database'])test(`Audio boundary outer await ${fault} denies ${method}`,async t=>{
 const f=await fixture(t),read=await reader(f,method),controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
 const before=snapshot(f),readonly=noWrites(f),batch=f.DB.batch.bind(f.DB),clock=Date.now,deadline=Date.parse(f.command.audioCostConsent.expiresAt);let reached=false,changed=false;
 f.DB.batch=async statements=>{const results=await batch(statements);if(finalProof(statements)){reached=true;
  // Depth 1 runs before checked() resumes, depth 2 before readNative() resumes,
  // and depth 3 after readNative's final guard but before the public wrapper.
  // Execute actual SQL and return its unchanged acknowledgement in every case.
  nestedMicrotask(3,()=>{changed=true;if(fault==='abort')controller.abort();if(fault==='deadline')Date.now=()=>deadline;
   if(fault==='request')f.trusted.request=new Request(f.request.url,{method:'POST',headers:f.request.headers,body:JSON.stringify(f.command)});if(fault==='database')f.env.DB={...f.DB};});
 }return results;};
 let outcome;try{outcome=await settle(read());}finally{Date.now=clock;}
 t.diagnostic(JSON.stringify({method,fault,depth:3,realFinalBatch:reached,changed,returnedEvidence:Boolean(outcome.value),unchangedDatabase:true}));
 assert.equal(reached,true);assert.equal(changed,true);assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);assert.ok(outcome.error,'outer public await must recheck the captured lifetime');assert.match(outcome.error.message,/sponsor_authority_changed/);
});
test('Audio boundary live readers preserve their public shapes and expose no lifetime function',async t=>{
 const f=await fixture(t),before=snapshot(f),readonly=noWrites(f),description=await describeSponsorAudioAdmission(f.trusted,f.command),actual=await readSponsorAudioTemplateEvidence(f.trusted,f.command,description.recipe);
 assert.deepEqual(Object.keys(actual).sort(),['consent','offered','recipe']);assert.equal(Object.hasOwn(description,'assertCurrent'),false);assert.equal(Object.hasOwn(actual,'assertCurrent'),false);
 const noFunction=value=>{assert.notEqual(typeof value,'function');if(value&&typeof value==='object')for(const item of Object.values(value))noFunction(item);};noFunction(description);noFunction(actual);
 assert.ok(Object.isFrozen(description));assert.ok(Object.isFrozen(actual));assert.equal(actual.recipe.maximumTokens,128000);assert.deepEqual(actual.recipe.calls,{parsing:0,planning:1,render:1,repair:1});
 assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
});
