import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";

// Reuse the existing full component + LocaleController/native-port fixture.
// Only test registration is omitted; no application method is replaced.
const fixtureUrl=new URL("./presentation-guidance-accessibility.test.mjs",import.meta.url);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let fixtureModule=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isClassDeclaration(node)||ts.isFunctionDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==="registerHooks").map(node=>node.getFullText(tree)).join("\n");
fixtureModule=fixtureModule.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_match,prefix,_quote,specifier)=>prefix+JSON.stringify(specifier.startsWith(".")?new URL(specifier,fixtureUrl).href:specifier.startsWith("node:")?specifier:import.meta.resolve(specifier)));
fixtureModule=fixtureModule.replaceAll('import.meta.resolve("vite")',JSON.stringify(import.meta.resolve("vite"))).replaceAll("import.meta.url",JSON.stringify(fixtureUrl.href));
fixtureModule+="\nexport {fixture,candidate,inspect,receiptRows};\n";
const {fixture,candidate,inspect,receiptRows}=await import("data:text/javascript;base64,"+Buffer.from(fixtureModule).toString("base64"));
const noProviders=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("UI union fixtures cannot call an external API or provider"));
const paidRequests=h=>h.requests.filter(request=>request.url==="/api/document-jobs"&&request.body?.payload?.sceneCostPreview!==true);
async function actualHost(t,options={}){noProviders(t);const h=await createSceneStoreHost({count:1,...options});t.after(()=>h.close());return h;}

for(const locale of["en","fr","ar","ja"])test("UI union "+locale+": actual composer exposes all manual1–15 choices without losing source preflight",async t=>{
  noProviders(t);
  const f=fixture(t,{locale});await f.open("manual",2);
  const values=[...f.host.markup.matchAll(/<option value=([^\s>]+)[^>]*>/gu)].map(([,raw])=>f.renderer.resolve(raw)).filter(value=>/^\d+$/u.test(String(value))).map(Number);
  assert.deepEqual(values,Array.from({length:15},(_,index)=>index+1));
  assert.equal(f.state.requests.length,0,"rendering choices never dispatches work");
  const create=f.renderer.ownNodes(f.host,"button").find(button=>button.attributes.class==="button primary");
  assert.ok(create&&!Object.hasOwn(create.attributes,"disabled"));
  await f.submit();assert.equal(f.state.requests[0][1].requestedSlideCount,2,"authored explicit count stays exact");
});

for(const locale of["en","fr","ar","ja"])test("UI union "+locale+": flexible private count labels preserve unresolved money and historical review-only provenance",async t=>{
  noProviders(t);
  const detail=candidate(1,{requestedSlideCount:null,slideCountPolicy:{kind:"flexible",unit:"slide",min:8,max:15,aim:10},
    reviewOnlyReason:"validation-provenance-unavailable",complete:true,accounting:{
      settled_cost_microusd:780,settled_cost_complete:false,reservation_microusd:1_000_000,reservation_status:"executing",
      actual_provider_call_count:1,attempted_provider_call_count:2,unresolved_provider_call_count:1,provider_submission_uncertain:true}});
  const original=structuredClone(detail),f=await inspect(t,locale,[detail]),rows=receiptRows(f);
  const range=f.i18n.number(8)+"–"+f.i18n.number(15);
  assert.ok(rows.get(f.i18n.t("presentation.draft.requestedPlanned")).includes(range));
  assert.equal(rows.has(f.i18n.t("presentation.draft.settledCost")),false);
  assert.equal(rows.get(f.i18n.t("presentation.draft.settlement")),f.i18n.t("presentation.draft.settlementPending"));
  assert.ok(f.visible().includes(f.i18n.t("presentation.draft.provenanceUnavailable")));
  await f.click(f.i18n.t("presentation.draft.compareRequested"));
  assert.ok(f.visible().includes(range));assert.ok(!f.visible().includes(f.i18n.t("presentation.draft.requestComplete")));
  assert.deepEqual(detail,original);assert.equal(f.state.requests.length,0);assert.equal(f.clipboard.length,0);
});

for(const shared of[false,true])test("UI union actual Store "+shared+": Output bootstrap and refresh stay free alongside the exact Scene source",async t=>{
  const h=await actualHost(t,{shared}),current=h.store.captureSceneCostSource(h.request),before=h.worker.counts(),planning=h.store.planningConsent.get();
  const output=await h.store.outputRequirements.ensure(h.request.documentId);
  assert.equal(output.state,"ready",JSON.stringify(output));assert.equal(output.snapshot.documentId,h.request.documentId);
  assert.equal(output.snapshot.projectId,h.store.projection.get().projectId);assert.equal(output.snapshot.scope.actorUserId,h.store.session.get().user.userId);
  assert.equal(output.snapshot.scope.projectAccessId,h.store.session.get().projectContext?.projectAccessId??null);
  assert.equal(current(),true);assert.equal(h.store.planningConsent.get(),planning);
  assert.deepEqual(h.worker.counts(),before);assert.equal(paidRequests(h).length,0);
  const original=(await h.quote()).preview;assert.equal(original.requestId,h.request.requestId);
  await h.store.outputRequirements.ensure(h.request.documentId,{force:true});
  assert.equal(current(),true);assert.equal(h.request.requestId,original.requestId);
  assert.deepEqual(h.worker.counts(),before);assert.equal(paidRequests(h).length,0);
});

test("UI union actual Store: changed authored events invalidate Output reads without admitting or replacing a Scene",async t=>{
  const h=await actualHost(t),before=h.worker.counts();
  const output=await h.store.outputRequirements.ensure(h.request.documentId);assert.equal(output.state,"ready");
  const appended=await h.store.append({type:"BlockCreated",payload:{project_id:h.store.projection.get().projectId,document_id:h.request.documentId,
    block_id:"union-additional-fact",type:"message",handle:"message/union-fact",position:"z",properties:{text:"Retain the exact harbor direction.",weight:1}}});
  assert.equal(appended.length,1);assert.equal(h.store.outputRequirements.resource(h.request.documentId).state,"refreshing");
  const refreshed=await h.store.outputRequirements.ensure(h.request.documentId);assert.equal(refreshed.state,"ready");
  assert.equal(refreshed.snapshot.documentId,h.request.documentId);
  assert.equal(h.worker.counts().document_jobs,before.document_jobs);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
  assert.equal(paidRequests(h).length,0);
});

test("UI union actual Store: manual15 and bounded flexible commitments use distinct retained request identities without weakening Scene approval",async t=>{
  const h=await actualHost(t);
  assert.equal(await h.store.renderDocumentArtifact("slides",{documentId:h.request.documentId,productionMode:"manual",requestedSlideCount:15}),true,h.store.ui.toast);
  const first=paidRequests(h).at(-1).body.payload;assert.equal(first.itemCount,15);assert.equal(first.requestedSlideCount,15);
  const policy={kind:"flexible",unit:"slide",min:8,max:15,aim:10};
  assert.equal(await h.store.renderDocumentArtifact("slides",{documentId:h.request.documentId,productionMode:"manual",slideCountPolicy:policy}),true,h.store.ui.toast);
  const second=paidRequests(h).at(-1).body.payload;assert.equal(second.itemCount,10);assert.equal(second.requestedSlideCount,undefined);
  assert.deepEqual(second.slideCountPolicy,policy);assert.notEqual(first.requestKey,second.requestKey);
  const count=paidRequests(h).length;
  for(const options of[{requestedSlideCount:16},{slideCountPolicy:policy,requestedSlideCount:10},{slideCountPolicy:{...policy,max:16}},{slideCountPolicy:policy,productionMode:"managed"}]){
    assert.equal(await h.store.renderDocumentArtifact("slides",{documentId:h.request.documentId,productionMode:"manual",...options}),false);
  }
  assert.equal(paidRequests(h).length,count);
  assert.equal(await h.store.renderDocumentArtifact("scene",{documentId:h.request.documentId,productionMode:"manual"}),false);
  assert.equal(paidRequests(h).length,count,"the new Slides path cannot bypass the separate exact Scene approval");
  assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

test("UI union actual Store: Output work stays revision authority without entering factual provider context",async t=>{
  const h=await actualHost(t),outputId="union-owed-work",wording="OUTPUT_ONLY_OWED_WORK_MUST_NOT_BECOME_EVIDENCE";
  const appended=await h.store.append({type:"BlockCreated",payload:{project_id:h.store.projection.get().projectId,document_id:h.request.documentId,
    block_id:outputId,type:"output",handle:"output/owed",position:"z",properties:{text:wording,weight:1}}});
  assert.equal(appended.length,1);
  assert.equal(await h.store.renderDocumentArtifact("slides",{documentId:h.request.documentId,productionMode:"manual",requestedSlideCount:15}),true,h.store.ui.toast);
  const payload=paidRequests(h).at(-1).body.payload;
  assert.ok(payload.snapshot.facts.some(fact=>fact.block_id==="scene-reuse-direction"&&fact.properties.text==="The keeper checks the harbor."));
  assert.equal(payload.snapshot.facts.some(fact=>fact.block_id===outputId||fact.type==="output"),false);
  assert.equal(JSON.stringify(payload.snapshot).includes(wording),false);
  assert.ok(payload.sourceBlockVersions.some(block=>block.block_id===outputId),"excluded instructions still participate in full authored revision authority");
  assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

test("UI union actual Store: applying a fresh authority epoch clears Output cache and invalidates an earlier Scene source closure",async t=>{
  const h=await actualHost(t),original=h.store.session.get(),current=h.store.captureSceneCostSource(h.request),before=h.worker.counts();
  assert.equal((await h.store.outputRequirements.ensure(h.request.documentId)).state,"ready");
  assert.equal(current(),true);
  await h.store.refreshSession(Promise.resolve(Response.json({...original,permissionEpoch:String(original.permissionEpoch)+":changed"})));
  assert.equal(h.store.outputRequirements.resource(h.request.documentId).snapshot,null);assert.equal(current(),false);
  assert.equal(h.store.planningConsent.get(),null);assert.deepEqual(h.worker.counts(),before);assert.equal(paidRequests(h).length,0);
});
