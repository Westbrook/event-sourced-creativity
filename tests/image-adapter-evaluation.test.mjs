import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IMAGE_ADAPTER_CORPUS_VERSION, IMAGE_ADAPTER_EVALUATION_CORPUS } from "../evals/image-adapters/canvas-image-corpus-v1.ts";
import { IMAGE_ADAPTER_CORPUS_VERSION as IMAGE_ADAPTER_CORPUS_V2, IMAGE_ADAPTER_EVALUATION_CORPUS as IMAGE_ADAPTER_EVALUATION_CORPUS_V2 } from "../evals/image-adapters/canvas-image-corpus-v2.ts";
import { IMAGE_ADAPTER_CORPUS_VERSION as IMAGE_ADAPTER_CORPUS_V3, IMAGE_ADAPTER_EVALUATION_CORPUS as IMAGE_ADAPTER_EVALUATION_CORPUS_V3 } from "../evals/image-adapters/canvas-image-corpus-v3.ts";
import { IMAGE_ADAPTER_CORPUS_VERSION as IMAGE_ADAPTER_CORPUS_V4, IMAGE_ADAPTER_EVALUATION_CORPUS as IMAGE_ADAPTER_EVALUATION_CORPUS_V4 } from "../evals/image-adapters/canvas-image-corpus-v4.ts";
import { IMAGE_ADAPTER_CORPUS_VERSION as IMAGE_ADAPTER_CORPUS_V5, IMAGE_ADAPTER_EVALUATION_CORPUS as IMAGE_ADAPTER_EVALUATION_CORPUS_V5 } from "../evals/image-adapters/canvas-image-corpus-v5.ts";
import { IMAGE_ADAPTER_CORPUS_VERSION as IMAGE_ADAPTER_CORPUS_V6, IMAGE_ADAPTER_EVALUATION_CORPUS as IMAGE_ADAPTER_EVALUATION_CORPUS_V6 } from "../evals/image-adapters/canvas-image-corpus-v6.ts";
import { IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE, IMAGE_ADAPTER_EVALUATION_EVIDENCE, IMAGE_ADAPTER_EVALUATION_PLAN, IMAGE_ADAPTER_V7_EVALUATION_EVIDENCE, IMAGE_ADAPTER_V8_EVALUATION_EVIDENCE, IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE, IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE, IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE, passingImageAdapterEvaluation } from "../worker/image-adapter-evaluation-evidence.ts";
import { candidateOptions, candidateProfile, IDEOGRAM_CANDIDATE_CAMPAIGNS, IDEOGRAM_CANDIDATE_PROFILES, IDEOGRAM_EVAL_COHORTS } from "../worker/ideogram-adapter-cycles.ts";

test("the frozen image-adapter corpus covers five capabilities across 50 unique contexts",()=>{
  assert.equal(IMAGE_ADAPTER_CORPUS_VERSION,"canvas-image-corpus-v1");
  assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS.length,50);
  assert.equal(new Set(IMAGE_ADAPTER_EVALUATION_CORPUS.map((item)=>item.id)).size,50);
  for(const category of ["composition","typography","spatial","material","reference"]){
    assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS.filter((item)=>item.category===category).length,10);
  }
  assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS.filter((item)=>item.options.referenceAsset).length,10);
  assert.deepEqual(new Set(IMAGE_ADAPTER_EVALUATION_CORPUS.map((item)=>item.options.promptTechnique)),new Set(["prose","bullets","json","xml"]));
});

test("paid evaluation evidence remains review-required when the frozen gate does not pass",()=>{
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.caseCount,50);
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.corpusVersion,"canvas-image-corpus-v2");
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.adapterVersion,"v6");
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.passed,false);
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.status,"review_required");
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.fal.failed,1);
  assert.equal(IMAGE_ADAPTER_EVALUATION_EVIDENCE.reference.preserveCompositionUsable,3);
});

test("the replacement corpus retains 50 contexts on a common square provider contract",()=>{
  assert.equal(IMAGE_ADAPTER_CORPUS_V2,"canvas-image-corpus-v2");assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS_V2.length,50);assert.equal(new Set(IMAGE_ADAPTER_EVALUATION_CORPUS_V2.map((item)=>item.id)).size,50);
  assert.ok(IMAGE_ADAPTER_EVALUATION_CORPUS_V2.every((item)=>item.options.size==="1024x1024"&&item.options.outputFormat!=="webp"));
  assert.ok(IMAGE_ADAPTER_EVALUATION_CORPUS_V2.filter((item)=>item.options.referenceMode==="preserve_composition").every((item)=>/Replace every source subject/.test(item.direction.scene)&&!/loose visual inspiration/i.test(item.direction.scene)));
});

test("v3 preserves v2 semantics and its stopped v7 evidence remains immutable",()=>{
  assert.equal(IMAGE_ADAPTER_CORPUS_V3,"canvas-image-corpus-v3");assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS_V3.length,50);
  for(let index=0;index<50;index++){const previous=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V2[index]);const current=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V3[index]);previous.id=previous.id.replace(/^v2-/,"v3-");assert.deepEqual(current,previous);}
  assert.equal(IMAGE_ADAPTER_V7_EVALUATION_EVIDENCE.status,"stopped_nonpassing");assert.equal(IMAGE_ADAPTER_V7_EVALUATION_EVIDENCE.fal.failedAttempts,2);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v7",IMAGE_ADAPTER_CORPUS_V3),null);
});

test("v8 has a new frozen corpus and prompt contract without inheriting v7 evidence",()=>{
  assert.equal(IMAGE_ADAPTER_CORPUS_V4,"canvas-image-corpus-v4");assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS_V4.length,50);
  for(let index=0;index<50;index++){const previous=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V3[index]);const current=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V4[index]);previous.id=previous.id.replace(/^v3-/,"v4-");assert.deepEqual(current,previous);}
  assert.equal(IMAGE_ADAPTER_V8_EVALUATION_EVIDENCE.status,"stopped_nonpassing");assert.equal(IMAGE_ADAPTER_V8_EVALUATION_EVIDENCE.attemptedCases,2);assert.equal(IMAGE_ADAPTER_V8_EVALUATION_EVIDENCE.fal.failedAttempts,2);assert.equal(IMAGE_ADAPTER_V8_EVALUATION_EVIDENCE.providerRequestIds.length,2);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v8",IMAGE_ADAPTER_CORPUS_V4),null);
});

test("v9 freezes the same semantics behind a provider-native caption contract",()=>{
  assert.equal(IMAGE_ADAPTER_CORPUS_V5,"canvas-image-corpus-v5");assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS_V5.length,50);
  for(let index=0;index<50;index++){const previous=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V4[index]);const current=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V5[index]);previous.id=previous.id.replace(/^v4-/,"v5-");assert.deepEqual(current,previous);}
  assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.status,"completed_nonpassing");assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.requestCount,3);assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.completedRequests,2);assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.failedRequests,1);assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.strategies[0].expansionModel,"None");assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.strategies[1].expansionModel,"Medium");assert.equal(IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE.strategies[2].expansionModel,"Large");
});

test("v10 remains immutable while v52 carries passing evidence for the unchanged v6 gate",()=>{
  assert.equal(IMAGE_ADAPTER_CORPUS_V6,"canvas-image-corpus-v6");assert.equal(IMAGE_ADAPTER_EVALUATION_CORPUS_V6.length,50);
  for(let index=0;index<50;index++){const previous=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V5[index]);const current=structuredClone(IMAGE_ADAPTER_EVALUATION_CORPUS_V6[index]);previous.id=previous.id.replace(/^v5-/,"v6-");assert.deepEqual(current,previous);}
  assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.adapterVersion,"v52");assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.promptAdapterVersion,"ideogram-context-v6");assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion,IMAGE_ADAPTER_CORPUS_V6);assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.status,"passing_evidence_ready");assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.preflight.status,"passed");assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.preflight.failureCount,0);assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.preflight.expandedPromptCases,50);assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.preflight.mediumExpansionCases,0);assert.equal(IMAGE_ADAPTER_EVALUATION_PLAN.preflight.largeExpansionCases,50);
  assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.status,"completed_nonpassing");assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.fullCorpusCompleted,true);assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.evaluatedPairs,50);assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.fal.failed,0);assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.fal.usable,26);assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.reference.falUsable,0);assert.equal(IMAGE_ADAPTER_V10_EVALUATION_EVIDENCE.failedCriteria.length,5);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v10",IMAGE_ADAPTER_CORPUS_V6),null);
  assert.equal(IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE.status,"passed");assert.equal(IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE.fullCorpusCompleted,true);assert.equal(IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE.fal.usable,43);assert.equal(IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE.reference.falUsable,10);assert.deepEqual(IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE.failedCriteria,[]);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v52",IMAGE_ADAPTER_CORPUS_V6),IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE);
});

test("the runner requires explicit failed-case retries and supports report-only regeneration",async()=>{
  const [runner,diagnostic]=await Promise.all([readFile(new URL("../scripts/run-image-adapter-eval.mjs",import.meta.url),"utf8"),readFile(new URL("../scripts/run-ideogram-v9-diagnostic.mjs",import.meta.url),"utf8")]);
  assert.match(runner,/--retry-failed/);
  assert.match(runner,/--case/);
  assert.match(runner,/unknown_image_adapter_case/);
  assert.match(runner,/--report-only/);
  assert.match(runner,/paid_evaluation_approval_required/);
  assert.match(runner,/candidate cycles for campaign/);
  assert.match(runner,/canvas-image-corpus-v6/);
  assert.match(runner,/generateFalCreativeImage/);
  assert.match(runner,/canonicalPromptHash/);
  assert.match(runner,/providerPromptHash/);
  assert.match(runner,/evaluationFingerprint/);
  assert.match(runner,/delete checkpoint\.cases\[item\.id\]\.evaluation/);
  assert.match(runner,/withoutAttemptHistory/);
  assert.match(runner,/recoveredCases/);
  assert.match(runner,/same_context_canonical_hash_mismatch/);
  assert.match(runner,/--preflight-only/);
  assert.match(runner,/paidOperations:0/);
  assert.match(runner,/mandatorySubjectRepeated/);
  assert.match(runner,/BENIGN STORY CONTEXT/);
  assert.match(runner,/expanded_plain/);
  assert.match(runner,/capabilityUsableFloor/);
  assert.match(runner,/promptTechniqueUsableFloor/);
  assert.match(runner,/Source reference image/);
  assert.match(runner,/same frozen semantic context/);
  assert.match(runner,/evaluationVersion|evaluatorVersion/);
  assert.match(runner,/fullCorpusRun/);
  assert.match(runner,/stoppedEarly/);
  assert.match(runner,/attemptedCases/);
  assert.match(runner,/Request ID/);
  assert.match(runner,/targeted preflight is diagnostic only/);
  assert.match(runner,/STOP qualification cannot pass/);
  assert.match(runner,/current\?\.status==="failed"&&!retryFailed/);
  assert.match(runner,/if\(!reportOnly&&!preflightOnly\)/);
  assert.match(runner,/if\(!String\(values\[key\]\?\?""\)\.trim\(\)\)values\[key\]=value/);
  assert.match(runner,/corpus\.length===IMAGE_ADAPTER_EVALUATION_CORPUS\.length/);
  assert.match(diagnostic,/I explicitly approve this three-request Ideogram v9 diagnostic/);
  assert.match(diagnostic,/native-caption-none/);
  assert.match(diagnostic,/expanded-plain-medium/);
  assert.match(diagnostic,/expanded-plain-large/);
  assert.match(diagnostic,/requestCount:variants\.length/);
});

test("the bounded candidate funnel reuses the paid baseline and cannot qualify on a screen",async()=>{
  const [runner,coordinator,plan]=await Promise.all([
    readFile(new URL("../scripts/run-image-adapter-eval.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/run-image-adapter-cycle-search.mjs",import.meta.url),"utf8"),
    readFile(new URL("../docs/evaluations/ideogram-adapter-cycle-plan.md",import.meta.url),"utf8"),
  ]);
  assert.match(runner,/candidate_baseline_corpus_hash_mismatch/);assert.match(runner,/baselineReused:true/);assert.match(runner,/newImageCostMicrousd:0/);assert.match(runner,/revisedPrompt/);assert.match(runner,/stage==="full"/);assert.match(runner,/outputs","image-adapter-cycles/);
  assert.match(coordinator,/Math\.min\(10/);assert.match(coordinator,/I explicitly approve up to ten paid image-adapter candidate cycles/);assert.match(coordinator,/runStage\(profile\.version,"full",true\)/);assert.match(coordinator,/if\(!micro\.screeningPassed\)/);assert.match(coordinator,/if\(!sentinel\.screeningPassed\)/);assert.match(coordinator,/if\(full\.passed\)/);
  assert.match(plan,/Only this stage may produce a passing governance artifact/);assert.match(plan,/New OpenAI image cost is zero/);
});

test("each immutable campaign covers at most ten cycles and respects endpoint expansion limits",()=>{
  assert.equal(IDEOGRAM_CANDIDATE_PROFILES.length,50);assert.equal(new Set(IDEOGRAM_CANDIDATE_PROFILES.map((item)=>item.version)).size,50);assert.equal(IDEOGRAM_CANDIDATE_CAMPAIGNS[1].length,10);assert.equal(IDEOGRAM_CANDIDATE_CAMPAIGNS[2].length,10);assert.equal(IDEOGRAM_CANDIDATE_CAMPAIGNS[3].length,10);assert.equal(IDEOGRAM_CANDIDATE_CAMPAIGNS[4].length,10);assert.equal(IDEOGRAM_CANDIDATE_CAMPAIGNS[5].length,10);assert.equal(IDEOGRAM_EVAL_COHORTS.micro.length,7);assert.equal(IDEOGRAM_EVAL_COHORTS.sentinel.length,15);
  const v14=candidateProfile("v14");assert.ok(v14);assert.equal(candidateOptions(v14,undefined,"low").ideogramExpansionModel,"Medium");assert.equal(candidateOptions(v14,undefined,"high").ideogramExpansionModel,"Large");assert.equal(candidateOptions(v14,{bytes:new Uint8Array([1]),mimeType:"image/png",source:"uploaded-reference",mode:"inspiration"},"low").ideogramExpansionModel,"Large");
  const v21=candidateProfile("v21");assert.ok(v21);assert.equal(candidateOptions(v21,undefined,"low").ideogramExpansionModel,"None");assert.equal(candidateOptions(v21,undefined,"high").ideogramCaptionStrategy,"spatial_material");assert.ok(IDEOGRAM_CANDIDATE_CAMPAIGNS[2].every((item)=>item.campaign===2));
  const v31=candidateProfile("v31");assert.ok(v31);assert.equal(candidateOptions(v31,undefined,"high").ideogramCaptionStrategy,"literal_contract");assert.ok(IDEOGRAM_CANDIDATE_CAMPAIGNS[3].every((item)=>item.campaign===3&&item.promptMode==="expanded_plain"));
  const v41=candidateProfile("v41");assert.ok(v41);assert.equal(candidateOptions(v41,undefined,"high").ideogramCaptionStrategy,"production_director");assert.equal(candidateOptions(v41,undefined,"high").ideogramSeed,4293889);assert.ok(IDEOGRAM_CANDIDATE_CAMPAIGNS[4].every((item)=>item.campaign===4&&item.promptMode==="expanded_plain"&&Number.isInteger(item.seed)));
  const v51=candidateProfile("v51");assert.ok(v51);assert.equal(candidateOptions(v51,undefined,"high").ideogramCaptionStrategy,"shot_plan");assert.equal(candidateOptions(v51,undefined,"low",true).ideogramExpansionModel,"Medium");assert.equal(candidateOptions(v51,undefined,"low",false).ideogramExpansionModel,"Large");assert.ok(IDEOGRAM_CANDIDATE_CAMPAIGNS[5].every((item)=>item.campaign===5&&item.promptMode==="expanded_plain"&&Number.isInteger(item.seed)));
});

test("exhausted campaigns remain immutable and campaign 5 exposes its passing adapter",()=>{
  assert.equal(IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE.status,"exhausted_nonpassing");assert.equal(IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE.attemptedCycles,10);assert.equal(IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE.bestCandidate.adapterVersion,"v20");assert.equal(IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE.bestCandidate.usable,5);assert.equal(IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE.sentinelRuns,0);assert.equal(IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE.fullQualificationRuns,0);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v20",IMAGE_ADAPTER_CORPUS_V6),null);
  assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.status,"exhausted_nonpassing");assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.attemptedCycles,10);assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.bestCandidate.adapterVersion,"v30");assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.bestCandidate.usable,6);assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.bestCandidate.referenceUsable,2);assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.sentinelRuns,0);assert.equal(IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE.fullQualificationRuns,0);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v30",IMAGE_ADAPTER_CORPUS_V6),null);
  assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.status,"exhausted_nonpassing");assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.attemptedCycles,10);assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.bestCandidate.adapterVersion,"v33");assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.bestCandidate.usable,11);assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.bestCandidate.referenceUsable,2);assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.sentinelRuns,2);assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.fullQualificationRuns,0);assert.equal(IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE.providerSafetyFailures.length,3);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v33",IMAGE_ADAPTER_CORPUS_V6),null);
  assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.status,"exhausted_nonpassing");assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.attemptedCycles,10);assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.highestStage,"full");assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.bestCandidate.adapterVersion,"v46");assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.bestCandidate.usable,41);assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.bestCandidate.referenceUsable,9);assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.sentinelRuns,2);assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.fullQualificationRuns,1);assert.deepEqual(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.bestCandidate.failedCapabilities,["material capability floor (5/10)","JSON prompt-technique floor (8/12)"]);assert.equal(IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE.providerSafetyFailures.length,1);assert.equal(passingImageAdapterEvaluation("fal-ideogram-v4","v46",IMAGE_ADAPTER_CORPUS_V6),null);
  assert.equal(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.status,"passed");assert.equal(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.attemptedCycles,2);assert.equal(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.bestCandidate.adapterVersion,"v52");assert.equal(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.bestCandidate.usable,43);assert.equal(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.bestCandidate.referenceUsable,10);assert.equal(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.fullQualificationRuns,2);assert.deepEqual(IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE.bestCandidate.failedCapabilities,[]);
});
