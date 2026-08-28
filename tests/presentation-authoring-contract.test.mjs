import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { registerHooks } from "node:module";
import ts from "typescript";

import { inferPresentationSourceOutline } from "../src/model/presentation-source.ts";
import { MAX_MANAGED_PRESENTATION_SLIDES, buildManagedProductionPlan } from "../src/model/managed-production.ts";

const executiveFixture = JSON.parse(await readFile(new URL("./fixtures/presentation-executive-source.json", import.meta.url), "utf8"));
const authoringSource = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const rejectedDraftSource = await readFile(new URL("../src/components/presentation-rejected-drafts.ts", import.meta.url), "utf8");


function presentationContractMember(source, className, name) {
  const tree=ts.createSourceFile("presentation-contract.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===className);
  const member=owner?.members.find(node=>node.name?.getText(tree)===name);
  assert.ok(member,"the actual "+className+"."+name+" contract remains present");
  return member.getText(tree);
}
function assertPresentationDraftReadOwnership(source) {
  const member=name=>presentationContractMember(source,"PresentationRejectedDrafts",name);
  const opened=member("#openDrafts"),selected=member("#selectCandidate"),preserved=member("#preserveCandidate");
  assert.match(opened,/const source=this\.store\.captureSourceOwnership\(\),documentId=this\.documentId;/u);
  assert.match(opened,/const revision=\+\+this\.#privateRevision;/u);
  assert.match(opened,/if\(!known\)return;/u,"only the exact known job/document can open");
  for(const read of[opened,selected,preserved])assert.match(read,/const current=\(\)=>this\.isConnected&&this\.store\.sourceOwnershipActive\(source\)&&revision===this\.#privateRevision&&this\.#jobId===jobId&&this\.documentId===documentId;/u);
  assert.match(opened,/await this\.store\.loadPresentationCandidates\(jobId, documentId\);\s*if \(!current\(\)\) return;\s*this\.#candidates = listing\.candidates;/u);
  assert.match(selected,/jobId=this\.#jobId,documentId=this\.#jobDocumentId,revision=this\.#privateRevision;/u);
  assert.match(selected,/await this\.store\.loadPresentationCandidate\(jobId, responseId, documentId\);\s*if \(!current\(\)\|\|detail\.jobId!==jobId\|\|detail\.documentId!==documentId\|\|detail\.responseId!==responseId\) return;\s*this\.#details\.set\(responseId, detail\);/u);
  assert.match(preserved,/jobId=this\.#jobId,documentId=this\.#jobDocumentId,revision=this\.#privateRevision,referenceRevision=this\.#referenceRevision;/u);
  assert.match(preserved,/await this\.store\.preservePresentationCandidate\(jobId, responseId, documentId\);\s*if\(referenceRevision!==this\.#referenceRevision\|\|!this\.store\.sourceOwnershipScopeActive\(source\)\|\|preserved\.jobId!==jobId\|\|preserved\.documentId!==documentId\|\|preserved\.responseId!==responseId\)return;/u);
  assert.match(preserved,/this\.#rememberJob\(jobId,documentId,source\);this\.requestUpdate\(\);\s*if\(!current\(\)\)return;\s*this\.#candidates =/u,"an original preservation acknowledgment is not permission to publish private material");
}

test("the real executive document exposes all twelve inline authored slides before generation", () => {
  const outline = inferPresentationSourceOutline(executiveFixture.snapshot);

  assert.equal(outline.authoredSlideCount, 12);
  assert.equal(outline.sections.length, 3);
  assert.deepEqual(outline.slides.map((slide) => slide.number), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.deepEqual(outline.sections.map((section) => section.slideNumbers), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
  assert.match(authoringSource, /#presentationOutline\(\)\{return inferPresentationSourceOutline\(this\.#projection\(\)\.blocks/);
  assert.match(authoringSource, /if\(this\.#kind==="slides"\)this\.#resetPresentationCount\(\)/);
  assert.match(authoringSource, /authoredSlideCount=outline\?\.authoredSlideCount\?\?null/);
  assert.match(authoringSource, /Predicted presentation/);
  assert.match(authoringSource,/\?selected=\$\{count===this\.#itemCount\}/,"the visible manual selector must match the actual authored-slide request on its first render");
  assert.match(authoringSource, /Inspect \$\{outline\.slides\.length\} authored slide title/);
});

test("managed presentation planning visibly preserves all twelve authored slides or explicitly expands to twenty-three", () => {
  const faithful = buildManagedProductionPlan("slides", executiveFixture.snapshot, { requestedSlideCount: 12 });
  const expanded = buildManagedProductionPlan("slides", executiveFixture.snapshot, { requestedSlideCount: 23 });
  const undersized = buildManagedProductionPlan("slides", executiveFixture.snapshot, { requestedSlideCount: 6 });

  assert.equal(faithful.authoredSlideCount, 12);
  assert.equal(faithful.predictedSlideCount, 12);
  assert.equal(expanded.requestedSlideCount, 23);
  assert.equal(expanded.predictedSlideCount, 23);
  assert.equal(expanded.scenes.length, 23);
  assert.equal(expanded.providerBatchCount, 3);
  assert.equal(expanded.providerCallCount, 3);
  assert.equal(expanded.maximumProviderCallCount, 12);
  assert.equal(expanded.estimatedPlanningCostMicrousd, 3_000_000);
  assert.deepEqual(expanded.providerBatches.map((batch) => batch.slideCount), [8, 8, 7]);
  assert.equal(undersized.predictedSlideCount, 12);
  assert.equal(undersized.slideCountMismatchReason, "requested_less_than_authored");
  assert.match(authoringSource, /requestedItemCount:this\.#itemCount,requestedSlideCount:this\.#itemCount/);
  assert.match(authoringSource, /itemCount:this\.#kind==="slides"\|\|this\.#productionMode==="manual"/);
  assert.match(authoringSource, /Authored and planned slide counts differ/);
});

test("presentation authoring names the real paid provider, bounded repair exposure, private source transmission, and settled charge", () => {
  assert.match(authoringSource, /Paid provider · OpenAI Responses/);
  assert.match(authoringSource, /session\?\.provider\.plannerModel\?\?session\?\.provider\.model/);
  assert.match(authoringSource, /Initial reservation and application-enforced spending ceiling:/);
  assert.match(authoringSource, /blocks any request or repair whose conservative maximum would exceed this ceiling/);
  assert.match(authoringSource, /not a provider-enforced cap/);
  assert.match(authoringSource, /total paid requests including bounded validation and continuity repairs/);
  assert.match(authoringSource, /active, authorized source text, numbered slide instructions, stakeholder quotations, and numerical claims to OpenAI/);
  assert.match(authoringSource, /Stable source identifiers remain private to Forma/);
  assert.match(authoringSource, /Settled provider cost:/);
  assert.match(authoringSource, /actualMicrousd\/1_000_000\)\.toFixed\(6\)/);
  assert.match(authoringSource, /Presentation style/);
  assert.match(authoringSource, /Follow the authored document/);
  assert.match(authoringSource, /Source fidelity/);
  assert.match(authoringSource, /presentationFidelity:this\.#presentationFidelity/);
});

test("clears actor-private presentation receipts immediately when authorization changes", () => {
  assert.match(authoringSource, /#actorInputContent:Record<string,string>/);
  const privateCleanup=authoringSource.slice(authoringSource.indexOf("  #clearPrivateGenerationInputs="),authoringSource.indexOf("  override connectedCallback()"));
  assert.match(privateCleanup, /#clearPrivateGenerationInputs=\(\)=>\{\s*this\.#privateSourceRevision\+\+;\s*this\.#closeViewerPopovers\(\);this\.#sceneInputCurrent=null;this\.#clearSceneCost\(\)/u, "authorization withdrawal invalidates the owned Scene input read before clearing its quote");
  assert.match(presentationContractMember(authoringSource,"DocumentArtifacts","#privateSourceCurrent"),/return\(\)=>this\.isConnected&&revision===this\.#privateSourceRevision&&this\.store\.sourceOwnershipActive\(source\);/u);
  assert.match(privateCleanup, /this\.#actorInputContent=\{\};this\.#failedInputJob=null;this\.#runningInputJob=null/);
  assert.doesNotMatch(privateCleanup, /\bawait\b/, "private receipts must be cleared synchronously on authorization withdrawal");
  assert.match(authoringSource, /addEventListener\("forma-authorization-changed",this\.#clearPrivateGenerationInputs\)/);
  assert.match(authoringSource, /removeEventListener\("forma-authorization-changed",this\.#clearPrivateGenerationInputs\)/);
  assert.match(authoringSource, /loadActorDocumentGenerationReceipt\(job\.jobId\)/);
});

test("rejected presentation drafts remain private, read-only, and available after their failure notice is dismissed",()=>{
  assert.match(authoringSource,/rejectedDraftJobs=readOnly\?\[\]:this\.store\.documentJobs\.get\(\)\.filter/u);
  assert.match(authoringSource,/<forma-presentation-rejected-drafts \.documentId=/u);
  assert.match(rejectedDraftSource,/Rejected drafts · private/u);
  assert.match(rejectedDraftSource,/Only you can see this material\. It cannot be shared, exported, or promoted/u);
  assert.match(rejectedDraftSource,/loadPreservedPresentationCandidateJobs\(documentId\)/u,"governed drafts remain discoverable after transient job history expires");
  assert.match(presentationContractMember(rejectedDraftSource,"PresentationRejectedDrafts","#openDrafts"),/loadPresentationCandidates\(jobId, documentId\)/u);
  assert.match(rejectedDraftSource,/Number\(right\.complete\) - Number\(left\.complete\)/u,"review prioritizes the best fully validated retained provider response");
  assert.match(rejectedDraftSource,/right\.providerAttempt - left\.providerAttempt/u,"later repairs win when candidate quality is otherwise identical");
  assert.match(presentationContractMember(rejectedDraftSource,"PresentationRejectedDrafts","#selectCandidate"),/loadPresentationCandidate\(jobId, responseId, documentId\)/u);
  assert.match(presentationContractMember(rejectedDraftSource,"PresentationRejectedDrafts","#preserveCandidate"),/preservePresentationCandidate\(jobId, responseId, documentId\)/u);
  assertPresentationDraftReadOwnership(rejectedDraftSource);
  assert.match(rejectedDraftSource,/addEventListener\("forma-authorization-changed", this\.#clearAuthorizedDrafts\)/u);
  assert.match(rejectedDraftSource,/removeEventListener\("forma-authorization-changed", this\.#clearAuthorizedDrafts\)/u);
  assert.match(rejectedDraftSource,/<forma-presentation-slide /u);
  assert.doesNotMatch(rejectedDraftSource,/<forma-presentation-deck|unsafeHTML|localStorage|sessionStorage|DocumentRenderCompleted/u,"rejected drafts cannot inherit publication/export controls or enter durable shared state");
  assert.match(rejectedDraftSource,/Compare alternatives/u);
  assert.match(rejectedDraftSource,/Source material/u);
  assert.match(rejectedDraftSource,/Accepted presentation/u);
});

test("managed presentation requests reject unsupported counts, prevent duplicate submission, and retain evidence assignments", () => {
  assert.equal(MAX_MANAGED_PRESENTATION_SLIDES, 100);
  assert.throws(
    () => buildManagedProductionPlan("slides", executiveFixture.snapshot, { requestedSlideCount: MAX_MANAGED_PRESENTATION_SLIDES + 1 }),
    /managed_presentation_slide_count_exceeds_supported_maximum/,
  );
  assert.match(authoringSource, /max=\$\{MAX_MANAGED_PRESENTATION_SLIDES\}/);
  assert.match(authoringSource, /value>MAX_MANAGED_PRESENTATION_SLIDES/);
  assert.match(authoringSource, /this\.#invalidSlideCount\?(?:this\.i18n\.system\("|`)Enter a whole number/);
  assert.match(authoringSource, /unsupportedAuthoredSlideCount=authoredSlideCount!==null&&authoredSlideCount>MAX_MANAGED_PRESENTATION_SLIDES/);
  assert.match(authoringSource, /this\.#productionMode==="managed"&&this\.#kind!=="scene"&&!unsupportedAuthoredSlideCount\?buildManagedProductionPlan/);
  assert.match(authoringSource, /authored slides exceed the \$\{MAX_MANAGED_PRESENTATION_SLIDES\}-slide editable PowerPoint limit/);
  assert.match(authoringSource, /\|\|unsupportedAuthoredSlideCount\|\|/);
  assert.match(authoringSource, /if\(this\.#submitting\|\|this\.#referenceBusy/);
  assert.match(authoringSource, /this\.#submitting=true;this\.requestUpdate\(\)/);
  assert.match(authoringSource, /contextGroupIds:content\.items\[index\]\.context_group_ids\?\?receipt\.contextGroupIds\?\?\[\]/);
  assert.match(authoringSource, /context_group_ids:item\.contextGroupIds\?\?\[\]/);
});

// Reuse the existing actual component/native-port fixture without registering its
// unrelated tests or changing any production method, authorization guard, or port.
const nativeFixtureUrl = new URL("./inactive-generation-dialog-host.test.mjs", import.meta.url);
const nativeFixtureSource = await readFile(nativeFixtureUrl, "utf8");
const nativeFixtureTree = ts.createSourceFile(nativeFixtureUrl.pathname, nativeFixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstFixtureTest = nativeFixtureTree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(nativeFixtureTree) === "test");
assert.ok(firstFixtureTest, "the existing full-component fixture is separated from its tests");
const nativeFixtureHasExport = nativeFixtureTree.statements
  .slice(0, nativeFixtureTree.statements.indexOf(firstFixtureTest))
  .some(node => (
    ts.isFunctionDeclaration(node) && node.name?.text === "fixture"
      && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && !node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  ) || (
    ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.some(entry => entry.name.text === "fixture" && (entry.propertyName?.text ?? entry.name.text) === "fixture")
  ));
const nativeFixtureModuleUrl = new URL(nativeFixtureUrl);
nativeFixtureModuleUrl.searchParams.set("presentation-native-contract", "1");
const nativeFixtureHook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === nativeFixtureModuleUrl.href) return { url: specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === nativeFixtureModuleUrl.href) return { format: "module", source: nativeFixtureSource.slice(0, firstFixtureTest.getFullStart()) + (nativeFixtureHasExport ? "" : "\nexport { fixture };\n"), shortCircuit: true };
    return next(url, context);
  },
});
let artifactViewerFixture;
try { ({ fixture: artifactViewerFixture } = await import(nativeFixtureModuleUrl.href)); }
finally { nativeFixtureHook.deregister(); }

async function openNativeArtifactActions(t) {
  const f = artifactViewerFixture("create", { artifact: true });
  t.after(() => {
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    f.host.disconnectedCallback();
    f.i18n.hostDisconnected();
  });
  f.state.events.find(event => event.type === "DocumentRenderCompleted").payload.artifact_kind = "slides";
  assert.equal(await f.host.openArtifactById("artifact-A"), true);
  await f.flush();
  const popover = f.renderer.query(f.host, "forma-ui-popover").find(instance => instance.attributes.class === "artifact-viewer-actions-popover");
  assert.ok(popover, "the actual Slides footer uses the shared native popover");
  const panel = f.renderer.ownNodes(popover, "section").find(node => node.attributes.popover === "auto");
  const trigger = f.renderer.ownNodes(popover, "button").find(node => node.attributes.popovertarget === panel?.attributes.id);
  assert.ok(panel && trigger, "the actual button controls the actual native panel");
  trigger.click();
  assert.equal(panel.matches(":popover-open"), true, "the emitted button's native default opens its panel");
  return { f, popover, panel };
}

test("native Slides actions close synchronously before the unchanged private-input handoff", async t => {
  const { f, popover, panel } = await openNativeArtifactActions(t);
  const actions = f.renderer.ownNodes(popover, "div").find(node => node.attributes.class === "artifact-viewer-actions-body");
  const inspect = f.renderer.ownNodes(popover, "button").find(node => typeof node.handlers.click === "function" && node.handlers.click.toString().includes("#inputId"));
  assert.ok(actions && inspect, "the actual viewer retains its Inspect inputs executor");
  assert.equal(actions.handlers.click.capture, true, "native menu closure owns the capture phase before the existing executor");
  // This button is its own closest button in the browser. The shared fixture's
  // general closest port is intentionally empty, so provide only that exact fact.
  inspect.closest = selector => selector === "button,a" ? inspect : null;
  const trace = [];
  const hidePopover = panel.hidePopover;
  panel.hidePopover = () => { hidePopover(); trace.push("native-hidden"); };
  let prevented = false, stopped = false;
  const event = { target: inspect, currentTarget: actions, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } };
  actions.handlers.click.handleEvent(event);
  assert.equal(prevented, false);
  assert.equal(stopped, false);
  assert.equal(panel.matches(":popover-open"), false, "the native panel is already closed before target dispatch");
  trace.push("input-handoff");
  inspect.handlers.click.call(f.host, event);
  assert.deepEqual(trace, ["native-hidden", "input-handoff"]);
  await f.flush();
  const receipt = f.renderer.query(f.host, "forma-generation-input-dialog").find(instance => instance.open);
  assert.ok(receipt, "the unchanged action opens the actual private receipt component");
  const retainedInput = JSON.parse(f.state.content["input-A"]);
  assert.deepEqual(receipt.inspection.receipt, retainedInput, "the entire original private receipt remains unchanged");
  assert.equal(receipt.inspection.prompt, retainedInput.render.submitted_prompt.trim(), "the existing prompt display normalization is unchanged");
  assert.equal(f.state.requests.length, 0, "Inspect inputs does not purchase or regenerate");
});

test("authorization withdrawal closes the native Slides panel before the synchronous cleanup returns", async t => {
  const { f, panel } = await openNativeArtifactActions(t);
  const trace = [];
  const hidePopover = panel.hidePopover;
  panel.hidePopover = () => { hidePopover(); trace.push("native-hidden"); };
  f.state.canRead = false;
  f.emitAuthorization();
  trace.push("authorization-returned");
  assert.equal(panel.matches(":popover-open"), false, "authorization withdrawal closes the native panel without an await or redraw");
  assert.deepEqual(trace, ["native-hidden", "authorization-returned"]);
  f.draw();
  assert.equal(f.renderer.query(f.host, "forma-generation-input-dialog").some(instance => instance.open), false);
  assert.equal(f.state.requests.length, 0);
});

for(const [label,before,after]of[
  ["list post-await ownership","if (!current()) return;\n      this.#candidates = listing.candidates;","this.#candidates = listing.candidates;"],
  ["detail current and exact identity","if (!current()||detail.jobId!==jobId||detail.documentId!==documentId||detail.responseId!==responseId) return;","if (!current()) return;"],
  ["preserve private-publication ownership","if(!current())return;\n      this.#candidates =","this.#candidates ="],
])test("presentation read contract rejects a missing "+label+" guard",()=>{
  assert.ok(rejectedDraftSource.includes(before),"the causal control targets the exact current guard");
  assert.throws(()=>assertPresentationDraftReadOwnership(rejectedDraftSource.replace(before,after)),assert.AssertionError);
});

for(const withdrawn of[false,true])test("actual presentation opening "+(withdrawn?"is retired by same-scope synchronous cleanup":"survives its healthy current source"),async t=>{
  let observed=false;
  const f=artifactViewerFixture("create",{artifact:true,onUpdate(current,step){
    if(step!==1||!withdrawn)return;
    const source=current.store.captureSourceOwnership();
    current.emitAuthorization();observed=true;
    assert.equal(current.store.sourceOwnershipActive(source),true,"the simulated Store identity is unchanged; the component's private revision owns this retirement");
  }});
  t.after(()=>{
    for(const {instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}
    f.host.disconnectedCallback();f.i18n.hostDisconnected();
  });
  const opened=await f.host.openArtifactById("artifact-A");await f.flush();
  assert.equal(observed,withdrawn);assert.equal(opened,!withdrawn);
  const dialogs=f.renderer.query(f.host,"dialog.document-artifact-view").filter(dialog=>dialog.open);
  assert.equal(dialogs.length,withdrawn?0:1);
  assert.equal(f.state.requests.length,0,"an interrupted opening neither purchases nor saves");
});
