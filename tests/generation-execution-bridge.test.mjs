import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionJournal } from '../evals/generation-reliability/execution-journal.mjs';
import { DurableExecutionBridge } from '../evals/generation-reliability/execution-bridge.mjs';
import { mockPlan, mockHost, MOCK_RUNTIME, resealPlan } from '../evals/generation-reliability/bridge-fixtures/mock-host.mjs';
import { reviewedRequests } from '../evals/generation-reliability/execution-plan.mjs';
import { generateCreativeImage } from '../worker/openai-adapter.ts';

async function fixture(t,options={}) {
  const path=await mkdtemp(join(tmpdir(),'forma-bridge-')),file=join(path,'journal.sqlite');
  const plan=options.plan??mockPlan(),journal=new ExecutionJournal(file),host=mockHost(plan,{...options,journalId:journal.identity});
  const bridge=new DurableExecutionBridge({journal,...host,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:options.now??(()=>1000)});
  t.after(async()=>{journal.close();await rm(path,{recursive:true,force:true});});
  const args={plan,trialId:plan.manifest.trials[0].id,context:{session:'opaque-mock-session'}};
  return {plan,journal,bridge,host,args,file};
}

test('disabled by default: no authority, custody, reservation, transport or key read',async t=>{
  const f=await fixture(t);f.bridge.enabled=false;
  assert.equal((await f.bridge.run(f.args)).action,'disabled');
  assert.equal(f.journal.events().length,0);assert.equal(f.host.calls.length,0);
});

test('actual unchanged adapter JSON bytes match the reviewed direct cell including omissions',async()=>{
  const p=mockPlan(),c=p.manifest.cells[0],expected=reviewedRequests(c,p.user),calls=[];
  const prior=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),body:init.body});
    if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
    return Response.json({data:[{b64_json:btoa('pixels')}],usage:{input_tokens:1,output_tokens:2,total_tokens:3}});
  };
  try {
    await generateCreativeImage({OPENAI_API_KEY:'mock-only',OPENAI_IMAGE_MODEL:'gpt-image-2.5-sunburst'},'mock-owner',c.source??{}, {},{preparedPrompt:c.config.prompt,quality:'high',size:'1536x1024',outputFormat:'png',partialImages:0});
    assert.equal(calls.length,2);assert.equal(calls[0].body,expected.moderation.body);assert.equal(calls[1].body,expected.image.body);
    assert.equal(Object.hasOwn(JSON.parse(calls[1].body),'stream'),false);
    assert.equal(Object.hasOwn(JSON.parse(calls[1].body),'moderation'),false);
  } finally {globalThis.fetch=prior;}
});

test('completed evidence survives journal reopen; reuse verifies all receipts and pixels with zero calls',async t=>{
  const f=await fixture(t);assert.equal((await f.bridge.run(f.args)).action,'completed');
  const second=new ExecutionJournal(f.file);t.after(()=>second.close());
  const next=new DurableExecutionBridge({...f.host,journal:second,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:()=>1000});
  const calls=f.host.calls.length;
  assert.equal((await next.run(f.args)).action,'reuse_completed');assert.equal(f.host.calls.length,calls);
  const op=Object.values(second.read().operations)[0];assert.equal(op.chargedMicrousd,10);
  assert.equal(Object.keys(op.custody).length,7);
  const bytes=await readFile(f.file);assert.equal(bytes.includes(Buffer.from(f.plan.manifest.cells[0].config.prompt)),false);
  f.host.artifacts.set(op.artifact.ref,Buffer.from('tampered'));
  assert.equal((await next.run(f.args)).reason,'completed_artifact_mismatch');assert.equal(f.host.calls.length,calls);
});

test('two journal connections atomically reserve only one purchase',async t=>{
  let release,arrived;const gate=new Promise(r=>release=r),waiting=new Promise(r=>arrived=r);
  const f=await fixture(t,{onExecute:async({stage})=>{if(stage==='moderation'){arrived();await gate;}}});
  const second=new ExecutionJournal(f.file);t.after(()=>second.close());
  const competitor=new DurableExecutionBridge({...f.host,journal:second,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:()=>1000});
  const first=f.bridge.run(f.args);await waiting;
  const other=await competitor.run(f.args);assert.equal(other.action,'hold');release();await first;
  assert.equal(f.host.calls.filter(x=>x.stage==='image').length,1);
  assert.equal(f.journal.events().filter(e=>e.type==='reserved').length,1);
});

test('simultaneous initial admissions race at SQLite reservation',async t=>{
  const f=await fixture(t),other=new ExecutionJournal(f.file);t.after(()=>other.close());
  const second=new DurableExecutionBridge({...f.host,journal:other,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:()=>1000});
  const outcomes=await Promise.allSettled([f.bridge.run(f.args),second.run(f.args)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled'&&r.value.action==='completed').length,1);
  assert.equal(f.host.calls.filter(x=>x.stage==='image').length,1);
});

test('lost response remains unknown across reopen/new experiment/config; no replacement pixels',async t=>{
  const f=await fixture(t,{onExecute:async({stage})=>{if(stage==='image')throw new Error('lost-response');}});
  assert.equal((await f.bridge.run(f.args)).action,'hold');const count=f.host.calls.length;
  assert.equal((await f.bridge.run(f.args)).action,'hold');
  const renamed=mockPlan({experiment:'new-id'});
  assert.equal((await f.bridge.run({...f.args,plan:renamed,trialId:renamed.manifest.trials[0].id})).reason,'existing_purchase_other_review');
  const changed=mockPlan({experiment:'new-id',prompt:'A red bowl. No people.'});
  await assert.rejects(f.bridge.run({...f.args,plan:changed,trialId:changed.manifest.trials[0].id}),/unknown_exposure/);
  assert.equal(f.host.calls.length,count);
  assert.equal((await f.bridge.reconcile(f.args)).reason,'original_request_unknown');
});

test('accepted crash: only two durable original reads across reruns, never resubmission',async t=>{
  const f=await fixture(t,{onExecute:async({stage},hooks)=>{if(stage==='image'){hooks.accepted({provider:'openai',providerRequestId:'original-123'});throw new Error('crash');}}});
  await f.bridge.run(f.args);const r=await f.bridge.reconcile(f.args);assert.deepEqual(r.reads,['status','result']);
  await f.bridge.reconcile(f.args);
  assert.equal(f.host.calls.filter(x=>x.kind).length,2);assert.equal(f.host.calls.filter(x=>x.stage==='image').length,1);
  assert.ok(f.host.calls.filter(x=>x.kind).every(x=>x.identity.providerRequestId==='original-123'));
});

test('missing usage retains content success and pixels while all new initiation holds',async t=>{
  const f=await fixture(t,{onExecute:async({stage})=>stage==='image'?{providerRequestId:'usage-missing',contentOutcome:'usable',accountingState:'unknown',artifact:Buffer.from('usable-pixels'),receipt:{}}:null});
  await f.bridge.run(f.args);const op=Object.values(f.journal.read().operations)[0];
  assert.equal(op.status,'hold');assert.equal(op.stages.image.contentOutcome,'usable');assert.equal(op.stages.image.accountingState,'unknown');
  assert.equal(f.host.artifacts.get(op.artifact.ref).toString(),'usable-pixels');
  await f.bridge.run(f.args);assert.equal(f.host.calls.filter(x=>x.stage==='image').length,1);
});

test('accounting checkpoint persists before a response-retention failure',async t=>{
  const f=await fixture(t,{onPut:async({key})=>{if(key.endsWith(':image:response'))throw new Error('retention-write-failed');}});
  await f.bridge.run(f.args);const op=Object.values(f.journal.read().operations)[0];
  assert.equal(op.chargedMicrousd,10);assert.equal(op.stages.image.accountingState,'settled');assert.equal(op.status,'hold');
  await f.bridge.run(f.args);assert.equal(f.host.calls.filter(x=>x.stage==='image').length,1);
});

test('expired access, revoked access and expired admission cannot initiate a purchase',async t=>{
  const f=await fixture(t);f.host.expire(999);
  await assert.rejects(f.bridge.run(f.args),/retention_denied/);assert.equal(f.host.calls.length,0);assert.equal(f.journal.events().length,0);
  f.host.expire(10000);f.host.deny();await assert.rejects(f.bridge.run(f.args),/access_revoked/);
});

test('retention expires at private write boundary; no provider dispatch',async t=>{
  let clock=1000;const f=await fixture(t,{now:()=>clock,onPut:()=>{clock=10001;}});
  const r=await f.bridge.run(f.args);assert.equal(r.action,'hold');assert.equal(f.host.calls.length,0);
});

test('invalid review, F2 unavailable, preparation and payload mutation all have zero purchases',async t=>{
  const f=await fixture(t);
  const bad=structuredClone(f.plan);bad.requests[f.plan.manifest.cells[0].id].image.body+=' ';
  await assert.rejects(f.bridge.run({...f.args,plan:bad}),/identity_mismatch/);
  const unavailable=resealPlan(f.plan,{financial:{version:'F2',available:false,maximumCostMicrousd:null}});
  await assert.rejects(f.bridge.run({...f.args,plan:unavailable}),/financial_admission_unavailable/);
  const prep=mockPlan({preparation:true});await assert.rejects(f.bridge.run({...f.args,plan:prep,trialId:prep.manifest.trials[0].id}),/frozen_current_source/);
  f.host.authority.resolveAdmission=async()=>({reviewedPlanId:'wrong'});
  await assert.rejects(f.bridge.run(f.args),/authority_denied/);
  assert.equal(f.host.calls.length,0);assert.equal(f.journal.events().length,0);
});

test('snapshot inputs before asynchronous authorization prevents candidate mutation',async t=>{
  const f=await fixture(t),mutable=structuredClone(f.plan),original=f.host.authority.resolveAccess;
  f.host.authority.resolveAccess=async(...args)=>{mutable.candidate.id='changed';mutable.requests[f.plan.manifest.cells[0].id].image.body='mutated';return original(...args);};
  await f.bridge.run({...f.args,plan:mutable});
  assert.equal(f.host.calls.find(c=>c.stage==='image').request.body,f.plan.requests[f.plan.manifest.cells[0].id].image.body);
});

test('stop before admission; explicit resume required; stop after moderation resumes image once',async t=>{
  const f=await fixture(t);await f.bridge.stop({...f.args,stopped:true});
  await assert.rejects(f.bridge.run(f.args),/study_stopped/);assert.equal(f.host.calls.length,0);
  await f.bridge.stop({...f.args,stopped:false});
  const original=f.host.transport.execute;
  f.host.transport.execute=async(...args)=>{const result=await original(...args);if(args[0].stage==='moderation')await f.bridge.stop({...f.args,stopped:true});return result;};
  assert.equal((await f.bridge.run(f.args)).action,'paused');
  await f.bridge.stop({...f.args,stopped:false});
  assert.equal((await f.bridge.run(f.args)).action,'completed');
  assert.equal(f.host.calls.filter(c=>c.stage==='moderation').length,1);assert.equal(f.host.calls.filter(c=>c.stage==='image').length,1);
});

test('malformed/flagged moderation blocks image; over-estimate charge holds without replacement',async t=>{
  const f=await fixture(t,{onExecute:async({stage})=>stage==='moderation'?{contentOutcome:'refused',accountingState:'settled',costMicrousd:0,safety:{verdict:'flagged'},receipt:{}}:null});
  assert.equal((await f.bridge.run(f.args)).action,'hold');assert.equal(f.host.calls.filter(x=>x.stage==='image').length,0);
  const g=await fixture(t,{onExecute:async({stage})=>stage==='image'?{contentOutcome:'usable',accountingState:'settled',costMicrousd:60,artifact:Buffer.from('pixels'),receipt:{}}:null});
  assert.equal((await g.bridge.run(g.args)).action,'hold');assert.equal(Object.values(g.journal.read().operations)[0].chargedMicrousd,60);
});

test('reconciliation rejects changed provider identity and never reclaims failed read',async t=>{
  const f=await fixture(t,{onExecute:async({stage},hooks)=>{if(stage==='image'){hooks.accepted({provider:'openai',providerRequestId:'original'});throw new Error('lost');}}});
  await f.bridge.run(f.args);f.host.transport.status=async()=>({provider:'fal',providerRequestId:'other',state:'completed'});
  assert.equal((await f.bridge.reconcile(f.args)).reason,'original_request_reconciliation_mismatch');
  assert.equal((await f.bridge.reconcile(f.args)).reason,'reconciliation_bound_exhausted');
  assert.equal(f.host.calls.filter(x=>x.stage==='image').length,1);
});

test('new journal cannot replace the canonical authority-bound ledger',async t=>{
  const f=await fixture(t),other=new ExecutionJournal(f.file+'.new');t.after(()=>other.close());
  const bridge=new DurableExecutionBridge({...f.host,journal:other,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:()=>1000});
  await assert.rejects(bridge.run(f.args),/access_or_retention_denied/);assert.equal(f.host.calls.length,0);
});

test('process death after dispatch intent survives reopen and cannot purchase again',async t=>{
  const f=await fixture(t);
  const code=`
    import {ExecutionJournal} from './evals/generation-reliability/execution-journal.mjs';
    import {DurableExecutionBridge} from './evals/generation-reliability/execution-bridge.mjs';
    import {mockPlan,mockHost,MOCK_RUNTIME} from './evals/generation-reliability/bridge-fixtures/mock-host.mjs';
    const journal=new ExecutionJournal(process.env.MOCK_JOURNAL),plan=mockPlan();
    const host=mockHost(plan,{journalId:journal.identity,onExecute:async({stage})=>{if(stage==='image')process.exit(73);}});
    await new DurableExecutionBridge({journal,...host,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:()=>1000}).run({plan,trialId:plan.manifest.trials[0].id,context:{}});
  `;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),env:{...process.env,MOCK_JOURNAL:f.file},encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);
  assert.equal((await f.bridge.run(f.args)).action,'hold');assert.equal(f.host.calls.length,0);
  assert.equal(Object.values(f.journal.read().operations)[0].stages.image.status,'submitted');
});

test('accounting summary includes preparation, custody, unknown spend and all unexecuted stages',async t=>{
  const {executionSummary}=await import('../evals/generation-reliability/execution-summary.mjs');
  const f=await fixture(t,{onExecute:async({stage})=>{if(stage==='image')throw new Error('lost');}});
  const before=executionSummary(f.plan,f.journal);assert.equal(before.counts.initiated,0);assert.equal(before.stageCounts.evidenceStorage.planned,9);
  await f.bridge.run(f.args);const after=executionSummary(f.plan,f.journal);
  assert.equal(after.counts.initiated,1);assert.equal(after.counts.blocked,1);assert.equal(after.stageCounts.storage.unexecuted,1);
  assert.equal(after.unknownExposureMicrousd,null);assert.equal(after.providerEnforcedChargeCap,false);
});

test('unsupported original-request retrieval holds without even a status read',async t=>{
  const f=await fixture(t,{onExecute:async({stage},hooks)=>{if(stage==='image'){hooks.accepted({provider:'openai',providerRequestId:'original'});throw new Error('lost');}}});
  await f.bridge.run(f.args);f.host.transport.reconciliationSupported=false;
  assert.equal((await f.bridge.reconcile(f.args)).reason,'original_request_retrieval_unsupported');assert.equal(f.host.calls.filter(x=>x.kind).length,0);
});

test('false control/reconciliation callbacks are not authority receipts',async t=>{
  const f=await fixture(t);f.host.authority.authorizeControl=async()=>false;
  await assert.rejects(f.bridge.stop(f.args),/study_control_denied/);
  assert.equal(f.host.calls.length,0);
});

test('actual C arms reproduce adapter bytes and immutable study contains exact F2 gate',async()=>{
  const {firstCompilerStudy}=await import('../evals/generation-reliability/first-compiler-study.mjs');
  const plan=await firstCompilerStudy();
  assert.equal(plan.financial.available,false);assert.equal(plan.financial.maximumCostMicrousd,null);
  assert.equal(plan.manifest.trials.length,2);assert.equal(plan.preparation.plannerCalls,1);assert.equal(plan.candidate.visualFidelityMeasured,false);
  const prior=globalThis.fetch;
  try {
    for(const cell of plan.manifest.cells) {
      const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:init.body});return String(url).endsWith('/moderations')?Response.json({results:[{flagged:false,categories:{}}]}):Response.json({data:[{b64_json:btoa('mock')}],usage:{input_tokens:1,output_tokens:2,total_tokens:3}});};
      await generateCreativeImage({OPENAI_API_KEY:'mock-only',OPENAI_IMAGE_MODEL:cell.config.model},'new-current-synthetic-control-no-live-owner',plan.manifest.cases[0].source,plan.manifest.cases[0].direction,{quality:'high',size:'1536x1024',outputFormat:'png',partialImages:0,preparedPrompt:cell.config.prompt});
      assert.equal(calls.length,2);assert.equal(calls[0].body,plan.requests[cell.id].moderation.body);assert.equal(calls[1].body,plan.requests[cell.id].image.body);
    }
  } finally {globalThis.fetch=prior;}
});

test('caller authorized flag grants nothing, opaque transport errors never enter journal',async t=>{
  const privateText='PRIVATE_SOURCE_DO_NOT_LOG';
  const f=await fixture(t,{onExecute:async()=>{throw new Error(privateText);}});
  const result=await f.bridge.run({...f.args,authorized:true});assert.equal(result.reason,'host_operation_failed');
  assert.equal(JSON.stringify(f.journal.read()).includes(privateText),false);assert.equal(JSON.stringify(f.journal.events()).includes(privateText),false);
});

test('allowance revoked between moderation and image stops at the next checkpoint',async t=>{
  const f=await fixture(t);let lowered=false;
  const original=f.host.authority.resolveAdmission;
  f.host.authority.resolveAdmission=async args=>({...await original(args),...(lowered?{allowanceMicrousd:0}:{})});
  const execute=f.host.transport.execute;f.host.transport.execute=async(...args)=>{const r=await execute(...args);lowered=true;return r;};
  assert.equal((await f.bridge.run(f.args)).reason,'authorized_allowance_exceeded');
  assert.equal(f.host.calls.filter(x=>x.stage==='image').length,0);
});

test('new runner rejects live flags; checked study remains immutable and offline',()=>{
  const {status,stdout,stderr}=spawnCheck('--check');assert.equal(status,0,stderr);
  const result=JSON.parse(stdout);assert.equal(result.realProviderCalls,0);assert.equal(result.counts.initiated,0);assert.equal(result.counts.planned,2);
  const live=spawnCheck('--live');assert.notEqual(live.status,0);assert.match(live.stderr,/offline_only/);
});
function spawnCheck(option) { return spawnSync(process.execPath,['--import','tsx','scripts/check-generation-execution-bridge.mjs',option],{cwd:new URL('../',import.meta.url),encoding:'utf8'}); }
