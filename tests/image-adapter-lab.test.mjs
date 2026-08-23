import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applicationDefinition, navigationItemActive, resolveServerRoute } from "../src/platform/applications.ts";

test("adapter qualification is a refreshable Product route with preserved legacy aliases",()=>{
  assert.deepEqual(resolveServerRoute("/laboratory/image-adapters"),{application:"product",entryPath:"/laboratory/image-adapters/",canonicalFamily:"/laboratory/image-adapters"});
  assert.equal(navigationItemActive("product","evaluation","/laboratory/image-adapters"),true);
  assert.ok(applicationDefinition("product").navigation.some((item)=>item.id==="evaluation"));
  assert.ok(applicationDefinition("product").requiredCapabilities.includes("evaluation.qualification.run"));
});

test("Product adapter qualification previews routing without paid generation or provider secrets",async()=>{
  const [component,legacy,api,evidence,governance,entry,index]=await Promise.all([
    readFile(new URL("../src/apps/product/adapter-preview.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-image-adapter-lab.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/image-adapters-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/image-adapter-evaluation-evidence.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/apps/operations/canvas-governance.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/apps/product/entry.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/index.ts",import.meta.url),"utf8"),
  ]);
  assert.match(entry,/forma-product-adapter-preview/);
  assert.match(component,/evaluation\.qualification\.run/);
  assert.match(component,/\/api\/portfolio\/product\/adapter-preview/);
  assert.match(component,/!body\.dryRun\|\|body\.providerCall\|\|body\.pixelsTransmitted/);
  assert.match(component,/Routing or fallback reason/);
  assert.match(component,/no provider request, no image transmission/);
  assert.match(api,/handleQualificationPreview/);
  assert.match(api,/providerCall:false,pixelsTransmitted:false/);
  assert.match(api,/\["evaluation\.qualification\.run","platform\.provider\.configure"\]/);
  assert.match(api,/requireCapability\(request,env,"platform\.provider\.configure"\)/);
  assert.doesNotMatch(component,/state\/store|this\.store/);
  assert.match(index,/\/api\/image-adapters/);
  assert.match(legacy,/Known capability edges/);
  assert.match(legacy,/Retained frozen comparison/);
  assert.match(legacy,/Expanded prompt contracts/);
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
  assert.match(legacy,/Qualified production adapter/);
  assert.match(api,/IMAGE_ADAPTER_EVALUATION_PLAN/);
  assert.match(api,/published output-pixel rates plus the selected provider caption expansion/);
  assert.doesNotMatch(api,/generateCreativeImage\(/);
});
