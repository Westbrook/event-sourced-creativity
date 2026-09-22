import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { imageAdapterRequestIdentity, imageAdapterReuseDecision, imageAdapterFailureReceipt } from '../scripts/image-adapter-eval-cache.mjs';
import { generateCreativeImage } from '../worker/openai-adapter.ts';
import { openAIImageModel } from '../worker/image-generation-policy.ts';

const bytes=Buffer.from('synthetic retained pixels'), digest=x=>createHash('sha256').update(x).digest('hex');
const identity=(model='gpt-image-2.5-flare',overrides={})=>imageAdapterRequestIdentity({provider:'openai',model,endpoint:'https://api.openai.com/v1/images/generations',adapterId:'openai-image',adapterVersion:'v5',policyVersion:'fixture-policy-v1',canonicalPrompt:'exact prompt',providerPrompt:'exact prompt',settings:{quality:'low',size:'1024x1024',outputFormat:'png',stream:false,partialImages:0},...overrides});
const completed=id=>({status:'completed',provider:id.provider,model:id.model,adapterId:id.adapterId,adapterVersion:id.adapterVersion,canonicalPromptHash:id.canonicalPromptHash,providerPromptHash:id.providerPromptHash,identity:id,imageFile:'pixels.png',contentHash:digest(bytes)});

async function withNoFetch(fn){const original=globalThis.fetch;let count=0;globalThis.fetch=()=>{count++;throw Error('forbidden provider call');};try{await fn();assert.equal(count,0);}finally{globalThis.fetch=original;}}

for(const model of ['gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-2','gpt-image-2.5-sunburst-2026-09-08'])test(`completed ${model} reruns make zero provider calls`,()=>withNoFetch(async()=>{
 const id=identity(model),receipt=completed(id),before=JSON.stringify(receipt);
 for(let repeat=0;repeat<2;repeat++){const result=await imageAdapterReuseDecision(receipt,id,{readArtifact:async()=>bytes});assert.equal(result.status,'reused');assert.equal(result.identityCoverage,'exact');assert.equal(result.receipt.model,model);}
 assert.equal(JSON.stringify(receipt),before);
}));

test('corrupt/missing retained bytes, changed configuration, and failed retries never purchase replacements',()=>withNoFetch(async()=>{
 const id=identity(),receipt=completed(id);
 for(const readArtifact of [async()=>Buffer.from('corrupt'),async()=>{throw Error('ENOENT');}])assert.equal((await imageAdapterReuseDecision(receipt,id,{readArtifact})).status,'new_trial_needed');
 for(const changed of [identity('gpt-image-2.5-sunburst'),identity(undefined,{endpoint:'https://api.openai.com/v1/images/edits'}),identity(undefined,{policyVersion:'changed'}),identity(undefined,{adapterVersion:'v6'}),identity(undefined,{providerPrompt:'changed'}),identity(undefined,{references:[{bytes:Buffer.from('new'),mimeType:'image/png'}]}),identity(undefined,{settings:{...id.settings,quality:'high'}}),identity(undefined,{settings:{...id.settings,outputFormat:'webp'}}),identity(undefined,{settings:{...id.settings,stream:true,partialImages:1}})]){
  assert.equal((await imageAdapterReuseDecision(receipt,changed,{readArtifact:async()=>bytes})).status,'new_trial_needed');
 }
 for(const status of ['failed','rejected']){const result=await imageAdapterReuseDecision({...receipt,status},id,{retryFailed:true,newTrialId:'not-an-authorization'});assert.equal(result.status,'new_trial_needed');assert.equal(result.reason,'failure_requires_new_authorized_manifest_trial');}
}));

test('accepted/submitted/uncertain requests retain original identity even when current config changes',()=>withNoFetch(async()=>{
 for(const patch of [{status:'accepted'},{status:'submitted'},{status:'uncertain'},{status:'failed',providerRequestId:'original-request'},{status:'failed',detail:{code:'provider_submission_uncertain'}},{status:'failed',detail:{category:'network'}},{status:'failed',providerSubmissions:{old:{status:'pending',provider:'fal',model:'ideogram/v4/fast'}}},{status:'failed',generationReceipt:{provider_request_status:'submission_unknown'}}]){
  const receipt={...completed(identity('gpt-image-2')),...patch};const result=await imageAdapterReuseDecision(receipt,identity());assert.equal(result.status,'reconciliation_required');assert.equal(result.retainedReceipt,receipt);assert.equal(result.retainedReceipt.model,'gpt-image-2');
 }
}));

test('legacy migration is nonmutating and partial provenance never becomes full current evidence',()=>withNoFetch(async()=>{
 const id=identity(),receipt=completed(id);delete receipt.identity;const before=JSON.stringify(receipt);
 const result=await imageAdapterReuseDecision(receipt,id,{readArtifact:async()=>bytes});assert.equal(result.identityCoverage,'historical_partial_only');assert.equal(JSON.stringify(receipt),before);
 assert.equal((await imageAdapterReuseDecision({...receipt,quality:'high'},id,{readArtifact:async()=>bytes})).status,'new_trial_needed');
 assert.equal((await imageAdapterReuseDecision({...receipt,model:'gpt-image-2'},id,{readArtifact:async()=>bytes})).reason,'legacy_model_mismatch');
}));

test('aliases, evidenced snapshots, ordered reference digests and exact whitespace remain distinct',()=>{
 const alias=identity(),pinned=identity(undefined,{modelSnapshot:'fixture-pinned-snapshot'});
 assert.equal(alias.aliasResolution,'unknown');assert.equal(alias.modelSnapshot,null);assert.equal(pinned.aliasResolution,'pinned');assert.notEqual(alias.identityHash,pinned.identityHash);
 const a={bytes:Buffer.from('a'),mimeType:'image/png'},b={bytes:Buffer.from('b'),mimeType:'image/png'};
 assert.notEqual(identity(undefined,{references:[a,b]}).identityHash,identity(undefined,{references:[b,a]}).identityHash);
 assert.notEqual(identity().identityHash,identity(undefined,{providerPrompt:'exact prompt\n'}).identityHash);
});

test('mocked failing actual adapter attempt records Flare rather than configured Sunburst final',async()=>{
 const original=globalThis.fetch,calls=[],submissions=[];
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});return Response.json({error:{message:'synthetic rejection',code:'moderation_blocked'}},{status:400});};
 try{
  const env={OPENAI_API_KEY:'offline-inert',OPENAI_IMAGE_MODEL:'gpt-image-2.5-sunburst'},id=identity(openAIImageModel(env,'low'));
  await assert.rejects(async()=>{try{await generateCreativeImage(env,'offline',{}, {},{quality:'low',size:'1024x1024',preparedPrompt:'exact prompt',onProviderSubmission:r=>submissions.push(r)});}catch(error){const receipt=imageAdapterFailureReceipt(error,id,submissions.at(-1));assert.equal(receipt.model,calls.at(-1).body.model);assert.equal(receipt.model,'gpt-image-2.5-flare');assert.equal(receipt.endpoint,calls.at(-1).url);throw error;}});
  assert.equal(calls.filter(c=>c.url.endsWith('/images/generations')).length,1);
 }finally{globalThis.fetch=original;}
});

test('real runner composes all 50 identities, reuses mixed-model files and writes only a separate review',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),tmp=await mkdtemp(path.join(os.tmpdir(),'e15-runner-'));
 try{
  const retained=path.join(tmp,'retained'),review=path.join(tmp,'review'),counts=path.join(tmp,'fetch-count.json'),guard=path.join(tmp,'no-fetch.mjs');await mkdir(retained);await mkdir(review);
  await writeFile(guard,`import {writeFileSync} from 'node:fs';let calls=0;globalThis.fetch=()=>{calls++;throw Error('offline fetch tripwire');};process.on('exit',()=>writeFileSync(${JSON.stringify(counts)},JSON.stringify({calls})));`);
  const run=(...args)=>{const out=execFileSync(process.execPath,['--import','tsx','--import',guard,'scripts/run-image-adapter-eval.mjs',`--retained-dir=${retained}`,`--review-dir=${review}`,...args],{cwd:root,env:{PATH:process.env.PATH,OPENAI_IMAGE_MODEL:'gpt-image-2.5-sunburst'},maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});return out.toString();};
  run('--preflight-only=true');assert.equal(JSON.parse(await readFile(counts)).calls,0);
  const manifest=JSON.parse(await readFile(path.join(review,'manifest.json')));assert.equal(manifest.operations.length,100);
  const openai=manifest.operations.filter(o=>o.arm==='openai');assert.equal(openai.filter(o=>o.identity.model==='gpt-image-2.5-flare').length,20);assert.equal(openai.filter(o=>o.identity.model==='gpt-image-2.5-sunburst').length,30);
  const checkpoint={corpusHash:manifest.corpusHash,cases:{}};
  for(const operation of manifest.operations){const id=operation.identity,receipt={...completed(id),imageFile:`${operation.caseId}-${operation.arm}.png`,quality:id.settings.quality,width:1024,height:1024,costMicrousd:0};checkpoint.cases[operation.caseId]??={};checkpoint.cases[operation.caseId][operation.arm]=receipt;await writeFile(path.join(retained,receipt.imageFile),bytes);}
  await writeFile(path.join(retained,'checkpoint.json'),JSON.stringify(checkpoint));const before=await readFile(path.join(retained,'checkpoint.json'),'utf8');
  for(let repeat=0;repeat<2;repeat++){run('--reuse-only=true');assert.equal(JSON.parse(await readFile(counts)).calls,0);const report=JSON.parse(await readFile(path.join(review,'report.json')));assert.equal(report.providers.openai.completed,50);assert.equal(await readFile(path.join(retained,'checkpoint.json'),'utf8'),before);assert.equal(report.providers.openai.model,null);assert.deepEqual(new Set(report.providers.openai.models),new Set(['gpt-image-2.5-flare','gpt-image-2.5-sunburst']));assert.ok(report.reuse.every(d=>d.status==='reused'));}
  const first=checkpoint.cases[openai[0].caseId].openai;first.model='gpt-image-2';delete first.identity;await writeFile(path.join(retained,'checkpoint.json'),JSON.stringify(checkpoint));run('--reuse-only=true','--retry-failed=true');assert.equal(JSON.parse(await readFile(counts)).calls,0);assert.equal(JSON.parse(await readFile(path.join(review,'reuse-decisions.json')))[0].reason,'legacy_model_mismatch');
  assert.notEqual(await readFile(path.join(retained,'checkpoint.json'),'utf8'),before);assert.equal(JSON.parse(await readFile(path.join(retained,'checkpoint.json'))).cases[openai[0].caseId].openai.model,'gpt-image-2');
  const low=openai.find(o=>o.identity.settings.quality==='low');checkpoint.cases[low.caseId].openai.status='accepted';await writeFile(path.join(retained,'checkpoint.json'),JSON.stringify(checkpoint));run('--reuse-only=true','--retry-failed=true');assert.equal(JSON.parse(await readFile(counts)).calls,0);assert.equal(JSON.parse(await readFile(path.join(review,'reuse-decisions.json'))).find(d=>d.caseId===low.caseId&&d.arm==='openai').status,'reconciliation_required');
  const failedCase=openai.find(o=>o.caseId!==openai[0].caseId&&o.caseId!==low.caseId);checkpoint.cases[failedCase.caseId].openai.status='failed';await writeFile(path.join(retained,'checkpoint.json'),JSON.stringify(checkpoint));run('--reuse-only=true','--retry-failed=true');assert.equal(JSON.parse(await readFile(counts)).calls,0);const failedReport=JSON.parse(await readFile(path.join(review,'report.json')));assert.equal(failedReport.failures[0].model,failedCase.identity.model);assert.equal(failedReport.providers.openai.failed,1);assert.ok(failedReport.providers.openai.retainedModels.includes('gpt-image-2'));assert.equal(failedReport.newSuccessfulImageProviderCostMicrousd,0);
  assert.throws(()=>run('--reuse-only=true',`--review-dir=${retained}`),/retained_evidence_read_only/);assert.equal(JSON.parse(await readFile(counts)).calls,0);
  await writeFile(path.join(retained,first.imageFile),'corrupt');run('--reuse-only=true');assert.equal(JSON.parse(await readFile(counts)).calls,0);assert.equal(JSON.parse(await readFile(path.join(review,'reuse-decisions.json')))[0].reason,'retained_artifact_corrupt');
  assert.throws(()=>run('--approve-paid-eval=I explicitly approve this paid image-adapter evaluation'),/new_trial_needed/);assert.equal(JSON.parse(await readFile(counts)).calls,0);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
