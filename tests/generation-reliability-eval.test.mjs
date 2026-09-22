import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HIST, PROD, hash, seal, makeCell, validateManifest, validateCorpus, assertRequestedModel, factorDiff } from '../evals/generation-reliability/core.mjs';
import { CASES, legacyCorpusInventory } from '../evals/generation-reliability/cases.mjs';
import { EXPERIMENTS, COMBINATIONS, exampleManifests, firstScreen } from '../evals/generation-reliability/catalog.mjs';
import { frozenTechniqueComparison } from '../evals/generation-reliability/techniques.mjs';
import { verifyPrivateIncident } from '../evals/generation-reliability/private-fixture.mjs';
import { reuseDecision, reconcileOriginal } from '../evals/generation-reliability/reuse.mjs';
import { summarize, costs, blindedReview, runMockTrials, mockCompleted, COST_STAGES } from '../evals/generation-reliability/results.mjs';

globalThis.fetch=()=>{throw new Error('network_forbidden_in_offline_tests');};
const examples=exampleManifests(), screen=firstScreen(), c=CASES[0];
const record=(trial,patch={})=>({trialId:trial.id,initiated:true,...mockCompleted(screen.cases.find(c=>c.id===trial.caseId)),...patch,
  callCounts:patch.callCounts??Object.fromEntries(COST_STAGES.map(stage=>[stage,(patch.costs??mockCompleted(c).costs).filter(x=>x.stage===stage).length])),
  costs:(patch.costs??mockCompleted(c).costs).map((x,i)=>({...x,operationId:`${trial.id}:${i}`}))});

test('historical identity stays separate from PROD and unknown historical fields stay unknown',()=>{
  assert.notEqual(HIST.id,PROD.id);assert.equal(HIST.requestedModel,'gpt-image-2');assert.equal(HIST.promptCharacters,5596);
  assert.equal(HIST.promptHash,'a121553479bb542c2618a51b374e32d1ad88c24a2a316f9580f4b43a72d23953');
  assert.ok(Object.values(HIST.unknown).every(v=>v===null));assert.throws(()=>{HIST.quality='low';},TypeError);
});
test('all E and C designs are deterministic, content sealed, dry-run only',()=>{
  assert.equal(examples.length,40);assert.deepEqual(exampleManifests(),examples);
  for(const m of examples) {assert.equal(validateManifest(m).valid,true);assert.equal(m.budget.maximumCostMicrousd,null);assert.equal(m.counts.initiated,0);}
  for(let n=1;n<=16;n++)assert.ok(EXPERIMENTS.some(e=>new RegExp(`^E${n}([a-z]|$)`).test(e[0])));
  for(let n=1;n<=10;n++)assert.ok(COMBINATIONS.some(e=>e[0]===`C${n}`));
  assert.notEqual(examples.find(m=>m.experiment==='E0a').id,examples.find(m=>m.experiment==='E0b').id);
});
test('screen has six cases, 36 explicit trials, interleaved frozen arms, no free reruns',()=>{
  assert.equal(screen.cases.length,6);assert.equal(screen.trials.length,36);assert.equal(new Set(screen.trials.map(t=>t.id)).size,36);
  for(let i=0;i<36;i+=2){assert.equal(screen.trials[i].caseId,screen.trials[i+1].caseId);assert.notEqual(screen.trials[i].cellId,screen.trials[i+1].cellId);}
});
test('source/model/prompt/reference mutations cannot silently reuse trial identities',()=>{
  const m=structuredClone(screen);m.cells[0].config.model='gpt-image-2';assert.throws(()=>validateManifest(m),/identity_mismatch/);
  const root=screen.cells[0];
  for(const patch of [{model:'gpt-image-2.5-flare'},{prompt:`${c.prompt}\nAdditional direction`},{references:[{bytesHash:'a'.repeat(64)}]}]){
    const config={...root.config,...patch},variant=makeCell(c,config,root,factorDiff(root.config,config));assert.notEqual(variant.id,root.id);
  }
});
test('factor isolation rejects model plus quality disguised as quality only',()=>{
  const root=screen.cells[0];assert.throws(()=>makeCell(c,{...root.config,quality:'low',model:'gpt-image-2.5-flare'},root,['quality']),/factor_isolation/);
  assert.throws(()=>assertRequestedModel(root,{model:'gpt-image-2.5-flare'}),/actual_requested_model_mismatch/);
});
test('semantic omission fails before an experiment is admitted',()=>{
  assert.throws(()=>makeCell(c,{...screen.cells[0].config,prompt:'A generic person'}),/semantic_coverage_missing/);
  assert.throws(()=>validateCorpus([c,c]),/duplicate_case/);
});
test('reference and route factors E9a/E9b/E9c remain distinct',()=>{
  const a=examples.find(m=>m.experiment==='E9a'),b=examples.find(m=>m.experiment==='E9b'),d=examples.find(m=>m.experiment==='E9c');
  assert.equal(a.cells.length,4);assert.deepEqual(a.cells[1].changedFactors,['endpoint','references']);
  assert.deepEqual(b.cells[1].changedFactors,['references']);assert.deepEqual(d.cells[1].changedFactors,['referenceRoleWording']);
  assert.equal(b.cells[0].config.references[0].originalBytesHash,b.cells[1].config.references[0].originalBytesHash);
});
test('C9 includes four model-quality cells without invoking production low override',()=>{
  const m=examples.find(m=>m.experiment==='C9');assert.equal(m.cells.length,4);
  assert.deepEqual(new Set(m.cells.map(c=>`${c.config.model}:${c.config.quality}`)),new Set(['gpt-image-2.5-sunburst-2026-09-08:high','gpt-image-2.5-flare-2026-09-08:high','gpt-image-2.5-sunburst-2026-09-08:low','gpt-image-2.5-flare-2026-09-08:low']));
});
test('legacy corpus metadata retains actual shape/rubrics and resolves all 20 low cells to Flare',()=>{
  const corpus=legacyCorpusInventory();assert.equal(corpus.length,50);assert.equal(corpus.filter(c=>c.settings.quality==='low'&&c.effectiveProductionModel==='gpt-image-2.5-flare').length,20);
  assert.ok(corpus.every(c=>c.requirements.length&&c.sourceHash&&c.plannerHash));
});
test('technique comparison keeps actual original direction/source for every representation',()=>{
  const result=frozenTechniqueComparison({source:c.source,direction:c.direction,settings:{size:'1536x1024',quality:'high',partialImages:0}});
  assert.equal(result.plannerCalls,0);assert.equal(result.variants.length,4);
  assert.ok(result.variants.every(v=>v.sourceHash===c.hashes.source&&v.plannerHash===c.hashes.planner&&v.prompt.includes('Atticus Finch')));
  assert.throws(()=>frozenTechniqueComparison({source:c.source,settings:{}}),/captured/);
  assert.throws(()=>frozenTechniqueComparison({source:c.source,direction:c.direction,settings:{},capturedPrompt:{technique:'prose',text:'not actual'}}),/not_reproduced/);
});
test('private fixture access and expiration are enforced without writing the incident',async()=>{
  await assert.rejects(verifyPrivateIncident('/does/not/exist',{authorized:false}),/denied/);
  await assert.rejects(verifyPrivateIncident('/does/not/exist',{authorized:true,purpose:'offline-incident-verification',ownerScope:'local',retentionExpiresAt:'2020-01-01'}),/denied/);
  const dir=await mkdtemp(join(tmpdir(),'generation-private-'));
  try{const p=join(dir,'prompt');await writeFile(p,'mock');await assert.rejects(verifyPrivateIncident(p,{authorized:true,purpose:'offline-incident-verification',ownerScope:'synthetic',retentionExpiresAt:HIST.retentionExpiresAt},Date.parse('2026-09-22')),/bytes_mismatch/);}finally{await rm(dir,{recursive:true});}
});
test('completed evidence and mismatches cause ZERO provider calls; uncertain originals cause ZERO submissions',async()=>{
  const f=JSON.parse(await readFile(new URL('../evals/generation-reliability/fixtures/resume.json',import.meta.url),'utf8'));
  for(const item of f.cases){
    const trial=screen.trials[0], retained={status:item.status,submissionStatus:item.submissionStatus,trialId:trial.id,cellId:item.mismatch?'old-cell':trial.cellId,provider:item.provider??'openai',providerRequestId:'original-only',contentHash:hash(f.artifact)};
    const calls={submit:0,status:0,result:0};const transport={submit:()=>{calls.submit++;throw new Error('forbidden');},status:async({provider,providerRequestId})=>{calls.status++;return{provider,providerRequestId,state:'completed'};},result:async({provider,providerRequestId})=>{calls.result++;return{provider,providerRequestId,artifact:'synthetic'};}};
    assert.equal(reuseDecision(trial,retained,Buffer.from(f.artifact)).action,item.expected);
    const result=await reconcileOriginal(trial,retained,transport,{artifactBytes:Buffer.from(f.artifact)});
    assert.equal(calls.submit,0);assert.equal(result.counts.generationSubmissions,0);
    assert.equal(calls.status,item.expected==='reconcile_original'?1:0);assert.equal(calls.result,item.expected==='reconcile_original'?1:0);
  }
});
test('uncertain request with missing original identity holds, reconciliation never substitutes provider/request',async()=>{
  const t=screen.trials[0];assert.equal(reuseDecision(t,{status:'uncertain'}).action,'hold_unknown_original');
  await assert.rejects(reconcileOriginal(t,{status:'uncertain',provider:'fal',providerRequestId:'old'},{status:async()=>({provider:'openai',providerRequestId:'new',state:'completed'})}),/mismatch/);
});
test('initiated blocks are denominator members; unexecuted are not failures',()=>{
  const a=record(screen.trials[0]);const b=record(screen.trials[1],{status:'blocked',dispatched:false,judgment:null,artifactHash:null,costs:[{stage:'planner',costMicrousd:100},{stage:'moderation',costMicrousd:0}]});
  const s=summarize(screen,[a,b]);assert.deepEqual(s.counts,{planned:36,initiated:2,dispatched:1,completed:1,blocked:1,unexecuted:34});assert.equal(s.acceptance.rate,.5);assert.equal(s.costs.knownMicrousd,1000);
});
test('no-tool, transport, storage, unusable and safety outcomes remain in initiated denominator',()=>{
  const records=['no_tool','uncertain','failed','unusable','blocked'].map((status,i)=>record(screen.trials[i],{status,judgment:null,artifactHash:null}));
  const s=summarize(screen,records);assert.equal(s.acceptance.denominator,5);assert.equal(s.acceptance.usable,0);assert.equal(s.counts.unexecuted,31);
});
test('successful content with unknown media usage stays usable, separately stops spending',()=>{
  const s=summarize(screen,[record(screen.trials[0],{costs:[{stage:'media',costMicrousd:null},{stage:'evaluator',costMicrousd:200}]})]);
  assert.equal(s.acceptance.usable,1);assert.equal(s.costs.unknownCalls,1);assert.equal(s.totalCostPerUsableMicrousd,null);assert.equal(s.pauseRequired,true);
});
test('all stage costs include failed planner/evaluator calls and deduplicate operation receipts',()=>{
  const c={operationId:'p1',stage:'planner',costMicrousd:100};
  assert.equal(costs([{costs:[c,c,{operationId:'e1',stage:'evaluator',costMicrousd:null}]}]).knownMicrousd,100);
  assert.throws(()=>costs([{costs:[c,{...c,costMicrousd:200}]}]),/conflicting/);
  assert.throws(()=>summarize(screen,[record(screen.trials[0],{costs:[]})]),/media_call_missing/);
});
test('blinded packet has no arm/model/provider identity and accounts for absent artifacts',()=>{
  const packet=blindedReview(screen,[record(screen.trials[0]),record(screen.trials[1],{status:'blocked',artifactHash:null})],'private-test-secret-123');
  const publicText=JSON.stringify(packet.reviewer);assert.ok(!publicText.includes('sunburst'));assert.ok(!publicText.includes(screen.cells[0].id));assert.equal(packet.privateKey.length,2);assert.equal(packet.reviewer.filter(i=>!i.artifactAvailable).length,1);
});
test('critical semantic loss and unsafe outputs pause even when the provider completed',()=>{
  for(const judgment of [{artifactUsable:true,scores:{'authored-brief':1}},{artifactUsable:true,unsafe:true,scores:{'authored-brief':4}}]){
    const result=runMockTrials(screen,{[screen.trials[0].id]:mockCompleted(c,{judgment})});assert.equal(result.summary.acceptance.usable,0);assert.equal(result.stop,'unsafe_or_critical_intent_loss');assert.equal(result.summary.counts.unexecuted,35);
  }
});
test('budget stop leaves uninitiated trials unobserved',()=>{
  const fixtures=Object.fromEntries(screen.trials.map(t=>[t.id,mockCompleted(c)]));
  const r=runMockTrials(screen,fixtures,{maximumCostMicrousd:1000});assert.equal(r.stop,'budget_bound');assert.equal(r.summary.counts.initiated,1);assert.equal(r.summary.acceptance.denominator,1);assert.equal(r.actualProviderCalls,0);
});
test('paired summaries cluster three repetitions into six case units',()=>{
  const s=summarize(screen,screen.trials.map(t=>record(t)));assert.equal(s.uncertainty.independentCaseUnits,6);assert.equal(s.uncertainty.correlatedRepetitions,3);assert.equal(s.uncertainty.label,'exploratory_small_case_sample');assert.equal(s.pairedCases.length,6);assert.deepEqual(s.uncertainty.caseBootstrap95,[0,0]);
});
test('changing manifest to live mode is rejected even if resealed',()=>{
  const {id,...body}=screen;assert.ok(id);body.mode='live';assert.throws(()=>validateManifest(seal('manifest',body)),/offline_only/);
});

test('missing planner and evaluator receipts create unknown exposure rather than zero cost',()=>{
  const r=record(screen.trials[0]);r.callCounts.planner=1;r.callCounts.evaluator=2;
  const s=summarize(screen,[r]);assert.equal(s.costs.unknownCalls,2);assert.equal(s.pauseRequired,true);
});
test('non-square dimensions are honored and mismatched output is not usable',()=>{
  const r=record(screen.trials[0],{artifact:{width:1024,height:1024,format:'png'}});
  assert.equal(summarize(screen,[r]).acceptance.usable,0);
  assert.equal(summarize(screen,[record(screen.trials[0])]).acceptance.usable,1);
});

test('F resolver asserts requested model in every model-by-quality cell and keeps unsupported Responses blocked',async()=>{
  const {qualifyCell}=await import('../evals/generation-reliability/capabilities.mjs');
  for(const cell of examples.find(m=>m.experiment==='C9').cells){const q=qualifyCell(cell);assert.equal(q.operation.requestedModel,cell.config.model);assert.equal(q.operation.settings.quality.effective,cell.config.quality);assert.equal(q.liveAdmitted,false);}
  const responses=qualifyCell(examples.find(m=>m.experiment==='E4').cells[1]);assert.equal(responses.operation,null);assert.ok(responses.capability.issues.some(i=>i.code==='responses_runtime_unqualified'));
});

test('A stage fixtures preserve planner/local/provider distinctions and unknown billing independently of content',async()=>{
  const {outcomeFixtures}=await import('../evals/generation-reliability/fixtures/outcomes.mjs');
  const f=outcomeFixtures(c);
  for(const [name,fixture] of Object.entries(f)) {
    const result=runMockTrials(screen,{[screen.trials[0].id]:fixture});assert.equal(result.actualProviderCalls,0);
    assert.equal(result.summary.stageOutcomes[0].outcome.pipelineStage,fixture.outcome.pipelineStage);
    assert.equal(result.summary.acceptance.denominator,1);
    if(name==='usableUnknownBilling') {assert.equal(result.summary.acceptance.usable,1);assert.equal(result.stop,'unknown_financial_exposure');}
    if(name==='malformedModeration') assert.equal(result.summary.counts.dispatched,0);
  }
});

test('K legacy uncertainty fixtures retain original reconciliation and never become new generation submissions',async()=>{
  const {legacyResumeView}=await import('../evals/generation-reliability/reuse.mjs');
  const fixtures=JSON.parse(await readFile(new URL('../evals/generation-reliability/fixtures/legacy-resume.json',import.meta.url),'utf8'));
  for(const receipt of fixtures.receipts){
    const before=JSON.stringify(receipt);let submissions=0,reads=0;
    const view=legacyResumeView(receipt);assert.equal(view.status,'uncertain');
    const result=await reconcileOriginal(screen.trials[0],receipt,{submit(){submissions++;},async status(id){reads++;return{...id,state:'pending'};},async result(){throw new Error('not_complete');}});
    assert.equal(submissions,0);assert.equal(result.counts.generationSubmissions,0);assert.ok(reads<=1);assert.equal(JSON.stringify(receipt),before);
    assert.ok(['reconcile_original','hold_unknown_original'].includes(result.action));
  }
});

test('CLI rejects live flags and refuses changed frozen files without modifying them',async()=>{
  const {execFileSync}=await import('node:child_process');const dir=await mkdtemp(join(tmpdir(),'generation-manifest-'));
  const root=new URL('../',import.meta.url);
  try{
    const run=(...args)=>execFileSync(process.execPath,['--experimental-strip-types','scripts/run-generation-reliability-eval.mjs',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    assert.throws(()=>run('--live'),/Live execution is not implemented/);
    run(`--out=${dir}`);run(`--out=${dir}`);
    const p=join(dir,'E0a.json');await writeFile(p,'preserved prior evidence');
    assert.throws(()=>run(`--out=${dir}`),/immutable_example_exists/);assert.equal(await readFile(p,'utf8'),'preserved prior evidence');
  } finally {await rm(dir,{recursive:true});}
});
