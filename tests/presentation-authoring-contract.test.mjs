import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inferPresentationSourceOutline } from "../src/model/presentation-source.ts";
import { MAX_MANAGED_PRESENTATION_SLIDES, buildManagedProductionPlan } from "../src/model/managed-production.ts";

const executiveFixture = JSON.parse(await readFile(new URL("./fixtures/presentation-executive-source.json", import.meta.url), "utf8"));
const authoringSource = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const rejectedDraftSource = await readFile(new URL("../src/components/presentation-rejected-drafts.ts", import.meta.url), "utf8");

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
  assert.match(authoringSource, /#clearPrivateGenerationInputs=\(\)=>\{this\.#actorInputContent=\{\};this\.#failedInputJob=null;this\.#runningInputJob=null/);
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
  assert.match(rejectedDraftSource,/loadPresentationCandidates\(jobId, this\.documentId\)/u);
  assert.match(rejectedDraftSource,/loadPresentationCandidate\(this\.#jobId, responseId, this\.documentId\)/u);
  assert.match(rejectedDraftSource,/preservePresentationCandidate\(this\.#jobId, responseId, this\.documentId\)/u);
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
  assert.match(authoringSource, /this\.#productionMode==="managed"&&!unsupportedAuthoredSlideCount\?buildManagedProductionPlan/);
  assert.match(authoringSource, /authored slides exceed the \$\{MAX_MANAGED_PRESENTATION_SLIDES\}-slide editable PowerPoint limit/);
  assert.match(authoringSource, /\|\|unsupportedAuthoredSlideCount\|\|/);
  assert.match(authoringSource, /if\(this\.#submitting\|\|this\.#referenceBusy/);
  assert.match(authoringSource, /this\.#submitting=true;this\.requestUpdate\(\)/);
  assert.match(authoringSource, /contextGroupIds:content\.items\[index\]\.context_group_ids\?\?receipt\.contextGroupIds\?\?\[\]/);
  assert.match(authoringSource, /context_group_ids:item\.contextGroupIds\?\?\[\]/);
});
