import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [store,artifacts]=await Promise.all([
  readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
  readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8"),
]);

test("uncertain storyboard receipts expose a localized owner-only status check without offering duplicate paid generation",()=>{
  assert.match(artifacts,/const reconciliationEligible=Boolean\(session&&!session\.impersonation&&\(!session\.projectContext\|\|session\.projectContext\.ownerUserId===session\.user\.userId\)&&job\.status==="failed"&&kind==="storyboard"&&job\.result\?\.storyboardProviderSubmission==="pending"&&!job\.result\.providerJobId\)/);
  assert.match(artifacts,/reconciliationEligible\?html`<button[^>]*@click=\$\{\(\)=>void this\.#reconcileProviderReceipt\(job\.jobId\)\}/);
  assert.match(artifacts,/this\.i18n\.system\("Checking…"\):this\.i18n\.system\("Refresh provider status"\)/);
  assert.match(artifacts,/async #reconcileProviderReceipt\(jobId:string\)\{if\(this\.#reconcilingProviderJobId\)return;/);
  assert.match(artifacts,/\?disabled=\$\{Boolean\(this\.#reconcilingProviderJobId\)\}/);
});

test("receipt reconciliation accepts only a same-document confirmed owner receipt and requires a separate deliberate recovery",()=>{
  const start=store.indexOf("  async reconcileDocumentProviderReceipt(jobId:string){");
  const end=store.indexOf("  async recoverDocumentRender(jobId:string){",start);
  assert.ok(start>=0&&end>start);
  const action=store.slice(start,end);
  assert.match(action,/original\.result\?\.artifactKind!=="storyboard"\|\|original\.result\.storyboardProviderSubmission!=="pending"\|\|original\.result\.providerJobId/);
  assert.match(action,/guardedFetch\(`\/api\/document-jobs\/\$\{encodeURIComponent\(jobId\)\}\/reconcile-provider`,\{method:"POST"\}/);
  assert.match(action,/body\.reconciledProviderRequest!==true/);
  assert.match(action,/body\.job\.jobId!==jobId\|\|body\.job\.documentId!==original\.documentId/);
  assert.match(action,/body\.job\.result\.storyboardProviderSubmission!=="confirmed"/);
  assert.match(action,/\["pending","submitted","unknown"\]\.includes\(providerJobId\.toLowerCase\(\)\)/);
  assert.doesNotMatch(action,/\/retry|\/run|recoverDocumentRender|renderDocumentArtifact/,"finding a receipt cannot secretly submit or recover paid work");
});

test("owner-facing provider diagnostics allow only bounded HTTP statuses and explicitly safe transport classifications",()=>{
  const start=store.indexOf("  async reconcileDocumentProviderReceipt(jobId:string){");
  const end=store.indexOf("  async recoverDocumentRender(jobId:string){",start);
  const action=store.slice(start,end);
  assert.match(action,/body\.error==="provider_receipt_lookup_failed"/);
  assert.match(action,/Number\.isSafeInteger\(body\.providerStatus\).*>=400.*<=599/);
  assert.match(action,/\["TypeError","AbortError","DOMException","Error"\]\.includes\(body\.providerErrorClass\)/);
  assert.match(action,/body\.providerErrorCode==="string"&&\/\^\[A-Z\]\[A-Z0-9_\]\{0,63\}\$\/u\.test\(body\.providerErrorCode\)/);
  assert.doesNotMatch(action,/body\.(?:providerUrl|providerMessage|providerPrompt|providerHeaders|providerKey)/,"raw provider locations, messages, prompts, credentials, and headers never enter an owner notification");
});
