import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IMAGE_ADAPTER_CORPUS_VERSION, IMAGE_ADAPTER_EVALUATION_CORPUS } from "../evals/image-adapters/canvas-image-corpus-v1.ts";
import { IMAGE_ADAPTER_CORPUS_VERSION as IMAGE_ADAPTER_CORPUS_V2, IMAGE_ADAPTER_EVALUATION_CORPUS as IMAGE_ADAPTER_EVALUATION_CORPUS_V2 } from "../evals/image-adapters/canvas-image-corpus-v2.ts";
import { IMAGE_ADAPTER_EVALUATION_EVIDENCE } from "../worker/image-adapter-evaluation-evidence.ts";

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

test("the runner requires explicit failed-case retries and supports report-only regeneration",async()=>{
  const runner=await readFile(new URL("../scripts/run-image-adapter-eval.mjs",import.meta.url),"utf8");
  assert.match(runner,/--retry-failed/);
  assert.match(runner,/--case/);
  assert.match(runner,/unknown_image_adapter_case/);
  assert.match(runner,/--report-only/);
  assert.match(runner,/paid_evaluation_approval_required/);
  assert.match(runner,/canvas-image-corpus-v2/);
  assert.match(runner,/generateFalCreativeImage/);
  assert.match(runner,/current\?\.promptHash===expectedPromptHash/);
  assert.match(runner,/Source reference image/);
  assert.match(runner,/Exact submitted prompt/);
  assert.match(runner,/evaluatorVersion===EVALUATOR_VERSION/);
  assert.match(runner,/fullCorpusRun/);
  assert.match(runner,/targeted preflight is diagnostic only/);
  assert.match(runner,/STOP qualification cannot pass/);
  assert.match(runner,/current\?\.status==="failed"&&!retryFailed/);
  assert.match(runner,/if\(!reportOnly\)/);
  assert.match(runner,/if\(!String\(values\[key\]\?\?""\)\.trim\(\)\)values\[key\]=value/);
  assert.match(runner,/corpus\.length===IMAGE_ADAPTER_EVALUATION_CORPUS\.length/);
});
