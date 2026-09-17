import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,origin,rows,nativeEvents} from './helpers/guest-image-stage-fixture.mjs';
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement,denseGuestImageAcknowledgement},{preflightGuestImage,readGuestImagePreflight}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts')]);
async function confirmation(f,request=f.request){const review=await prepareGuestImageConfirmation(request,f.env,f.input);return {
  input:{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true},review};}
const reservation=statements=>statements.some(row=>row.sql.startsWith('INSERT INTO experience_sponsor_driver_stages('));

test('complete ACK evidence uses own data for every slot, success flag and required change count',()=>{
  const good=()=>[{success:true,meta:{changes:1}},{success:true,meta:{changes:2}}];
  assert.equal(denseGuestImageAcknowledgement(good(),2,[0],1),true);
  const malformed=[];let getterCalls=0;
  {const rows=good(),proto=Object.create(Array.prototype);proto[0]=rows[0];delete rows[0];Object.setPrototypeOf(rows,proto);malformed.push(rows);}
  {const rows=good();Object.defineProperty(rows,0,{get(){getterCalls++;return {success:true,meta:{changes:1}};}});malformed.push(rows);}
  {const rows=good();rows[0]=Object.assign(Object.create({success:true}),{meta:{changes:1}});malformed.push(rows);}
  {const rows=good();Object.defineProperty(rows[0],'success',{get(){getterCalls++;return true;}});malformed.push(rows);}
  {const rows=good();rows[0]=Object.assign(Object.create({meta:{changes:1}}),{success:true});malformed.push(rows);}
  {const rows=good();Object.defineProperty(rows[0],'meta',{get(){getterCalls++;return {changes:1};}});malformed.push(rows);}
  {const rows=good();rows[0].meta=Object.create({changes:1});malformed.push(rows);}
  {const rows=good();Object.defineProperty(rows[0].meta,'changes',{get(){getterCalls++;return 1;}});malformed.push(rows);}
  {const rows=good();rows[1].meta=Object.create({changes:2});malformed.push(rows);}
  {const rows=good();rows[0]=Object.assign([],{success:true,meta:{changes:1}});malformed.push(rows);}
  {const rows=good();rows[0].meta=Object.assign([],{changes:1});malformed.push(rows);}
  for(const value of malformed)assert.equal(denseGuestImageAcknowledgement(value,2,[0],1),false);
  assert.equal(getterCalls,0,'accessors must never supply permission evidence');
});

test('a real committed reservation with an inherited ACK slot stays charged unknown and constructs no quote',async t=>{
  const f=await fixture(t),{input}=await confirmation(f);await confirmGuestImageRequirement(f.request,f.env,input);
  const nativeBatch=f.DB.batch;let reservationCalls=0,malformed=false,quoteEntries=0;
  const key=f.env.OPENAI_API_KEY;Object.defineProperty(f.env,'OPENAI_API_KEY',{configurable:true,get(){quoteEntries++;return key;}});
  f.DB.batch=async statements=>{
    const result=await nativeBatch.call(f.DB,statements);
    if(reservation(statements)){
      reservationCalls++;const index=statements.findIndex(row=>row.sql.startsWith('INSERT INTO experience_sponsor_driver_stages('));
      assert.equal(result[index].success,true);assert.equal(result[index].meta.changes,1);
      const inherited=result[index],prototype=Object.create(Object.getPrototypeOf(result));
      Object.defineProperty(prototype,String(index),{value:inherited,configurable:true});
      delete result[index];Object.setPrototypeOf(result,prototype);
      assert.equal(Object.hasOwn(result,index),false);assert.equal(result[index],inherited);malformed=true;
    }
    return result;
  };
  const outcome=await preflightGuestImage(f.request,f.env,f.input).then(value=>({value}),error=>({error:String(error)}));
  const observed={malformed,reservationCalls,quoteEntries,outcome,receipts:rows(f,'experience_sponsor_resource_receipts').length,
    stages:rows(f,'experience_sponsor_driver_stages').length,quotes:rows(f,'output_preflights').length,head:nativeEvents(f).at(-1).sequence};
  t.diagnostic(JSON.stringify(observed));
  assert.equal(malformed,true);assert.equal(reservationCalls,1);assert.equal(quoteEntries,0,'an inherited ACK slot is not a complete dense acknowledgement');
  assert.ok(outcome.error);assert.equal(observed.receipts,3);assert.equal(observed.stages,1);assert.equal(observed.quotes,0);assert.equal(observed.head,f.committed.head+2);
  await assert.rejects(readGuestImagePreflight(f.request,f.env,f.input));
  await assert.rejects(preflightGuestImage(f.request,f.env,f.input));
  assert.equal(reservationCalls,1);assert.equal(quoteEntries,0);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,3);
});

test('lost confirmation ACK rechecks request after the real final proof resolves and before disclosing',async t=>{
  const f=await fixture(t),controller=new AbortController(),request=new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin},signal:controller.signal});
  const {input}=await confirmation(f,request),nativeBatch=f.DB.batch,prepare=f.DB.prepare;let recovering=false,fullProofs=0,armed=false,tick=null;
  const trace=[],signal=request.signal;Object.defineProperty(request,'signal',{get(){if(armed)trace.push(`signal:${tick}`);return signal;}});
  f.DB.batch=async statements=>{const result=await nativeBatch.call(f.DB,statements);if(statements.some(row=>row.sql.startsWith('INSERT INTO output_plan_revisions('))){recovering=true;throw Error('lost actual confirmation ACK');}return result;};
  const schedule=n=>{tick=n;trace.push(`tick:${n}`);if(n===0){trace.push('abort');controller.abort();}else queueMicrotask(()=>schedule(n-1));};
  function wrap(statement,sql){const bind=statement.bind,first=statement.first;
    statement.bind=function(...values){return wrap(bind.apply(this,values),sql);};
    statement.first=async function(...args){const result=await first.apply(this,args);
      if(recovering&&sql.startsWith('SELECT 1 AS current WHERE EXISTS(WITH guest_output_proof_')&&++fullProofs===2){
        assert.equal(result.current,1);armed=true;trace.push('real-final-proof');queueMicrotask(()=>schedule(3));}
      return result;};return statement;}
  f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};
  const outcome=await confirmGuestImageRequirement(request,f.env,input).then(value=>({value}),error=>({error:String(error)}));
  t.diagnostic(JSON.stringify({armed,fullProofs,trace,outcome,head:nativeEvents(f).at(-1).sequence}));
  assert.equal(armed,true);assert.equal(fullProofs,2);assert.equal(signal.aborted,true);
  assert.ok(trace.some(item=>item==='signal:1'),'real final currentness checks run before the boundary abort');
  assert.ok(outcome.error,'a completed inner proof does not waive the caller continuation request check');
  assert.equal(rows(f,'output_commands').filter(row=>row.action==='confirm').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,2);
  assert.equal(nativeEvents(f).at(-1).sequence,f.committed.head+2,'the original confirmation remains committed without disclosure or retry');
});
