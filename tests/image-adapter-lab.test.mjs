import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applicationDefinition, navigationItemActive, resolveServerRoute } from "../src/platform/applications.ts";

test("the image-adapter laboratory is a refreshable Laboratory route",()=>{
  assert.deepEqual(resolveServerRoute("/laboratory/image-adapters"),{application:"laboratory",entryPath:"/laboratory/image-adapters/",canonicalFamily:"/laboratory/image-adapters"});
  assert.equal(navigationItemActive("laboratory","image-adapters","/laboratory/image-adapters"),true);
  assert.ok(applicationDefinition("laboratory").navigation.some((item)=>item.id==="image-adapters"));
});

test("the image-adapter laboratory previews routing without initiating paid generation",async()=>{
  const [component,api,evidence,governance,entry,index]=await Promise.all([
    readFile(new URL("../src/components/forma-image-adapter-lab.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/image-adapters-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/image-adapter-evaluation-evidence.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/apps/operations/canvas-governance.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/apps/laboratory/entry.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/index.ts",import.meta.url),"utf8"),
  ]);
  assert.match(entry,/forma-image-adapter-lab/);
  assert.match(index,/\/api\/image-adapters/);
  assert.match(component,/No provider call, image generation, or billable operation occurred/);
  assert.match(component,/Known capability edges/);
  assert.match(component,/Review qualification/);
  assert.match(component,/Retained frozen comparison/);
  assert.match(component,/Expanded prompt contracts/);
  assert.match(component,/Medium \/ Large/);
  assert.match(component,/Provider request IDs/);
  assert.match(component,/Bounded candidate search/);
  assert.match(component,/Cycle limit exhausted/);
  assert.match(component,/Compare retained finalists/);
  assert.match(component,/Inspect provider safety failures/);
  assert.match(api,/selectImageAdapter/);
  assert.match(api,/IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE/);
  assert.match(api,/IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE/);
  assert.match(api,/IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE/);
  assert.match(api,/IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE/);
  assert.match(api,/IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE/);
  assert.match(api,/IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE/);
  assert.match(evidence,/caseCount:50/);
  assert.match(evidence,/status:"review_required"/);
  assert.match(evidence,/status:"stopped_nonpassing"/);
  assert.match(evidence,/status:"passing_evidence_ready"/);
  assert.match(evidence,/status:"completed_nonpassing"/);
  assert.match(evidence,/adapterVersion:"v10"/);
  assert.match(evidence,/promptAdapterVersion:"ideogram-context-v6"/);
  assert.match(evidence,/adapterVersion:"v52"/);
  assert.match(evidence,/status:"passed"/);
  assert.match(evidence,/attemptedVersions:\["v41","v42","v43","v44","v45","v46","v47","v48","v49","v50"\]/);
  assert.match(evidence,/IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE/);
  assert.match(governance,/Administrative control plane/);
  assert.match(governance,/server-retained passing report/);
  assert.match(api,/Multi-reference fallback/);
  assert.match(api,/FAL_IDEOGRAM_ADAPTER_ID/);
  assert.match(component,/Qualified production adapter/);
  assert.match(api,/IMAGE_ADAPTER_EVALUATION_PLAN/);
  assert.match(api,/published output-pixel rates plus the selected provider caption expansion/);
  assert.doesNotMatch(api,/generateCreativeImage\(/);
});
