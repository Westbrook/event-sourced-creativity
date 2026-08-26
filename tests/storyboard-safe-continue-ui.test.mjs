import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import typescript from "typescript";

import englishMessages from "../src/components/design-system/locales/system-en.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";

const storeSource = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");
const componentSource = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const syntax = typescript.createSourceFile("store.ts", storeSource, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
const store = syntax.statements.find((statement) => typescript.isClassDeclaration(statement) && statement.name?.text === "FormaStore");
assert.ok(store);

function actualMethod(name) {
  const method = store.members.find((member) => typescript.isMethodDeclaration(member) && member.name.getText(syntax) === name);
  assert.ok(method, `the actual ${name} store method remains available`);
  return method.getText(syntax);
}

const harnessSource = `
const formatGenerationUsd = (microusd) => "$" + (microusd / 1000000).toFixed(2);

export class StoryboardContinuationHarness {
  principal = { user: { userId: "storyboard-owner" }, impersonation: null };
  session = { get: () => this.principal };
  jobs = [];
  documentJobs = { get: () => this.jobs, set: (jobs) => { this.jobs = jobs; } };
  requests = [];
  notices = [];
  driven = [];
  polls = [];
  responseOverrides = {};
  activeScope = "storyboard-owner";
  #jobDetails = new Map();
  #activeAuthorizationScope() { return this.activeScope; }
  #assertAuthorizationScope(scope) { if (scope !== this.activeScope) throw new Error("authorization_changed"); }
  #scopeStillActive(scope) { return scope === this.activeScope; }
  #systemNotice(source) { return source; }
  #driveDocumentJobs(jobs) { this.driven.push(jobs); }
  #scheduleJobPoll(delay) { this.polls.push(delay); }
  notify() {}
  toast(message) { this.notices.push(message); }
  async guardedFetch(input, init, action) {
    this.requests.push({ input, init, action });
    const original = this.jobs[0];
    const body = {
      job: { ...original, status: "queued" },
      continuedWithSaferFrames: true,
      reusedReservations: true,
      ...this.responseOverrides,
    };
    return { ok: true, json: async () => body };
  }

  ${actualMethod("canContinueDocumentStoryboardWithSaferFrames")}
  ${actualMethod("continueDocumentStoryboardWithSaferFrames")}
}
`;

const { outputText } = typescript.transpileModule(harnessSource, {
  compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext },
  fileName: "storyboard-safe-continue-harness.ts",
});
const { StoryboardContinuationHarness } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

function failedStoryboard() {
  return {
    jobId: "owner-storyboard-job",
    documentId: "owner-document",
    kind: "render_document",
    status: "failed",
    productionMode: "manual",
    errorDetail: {
      code: "fal_safety_rejected",
      category: "safety",
      httpStatus: 422,
      retryable: false,
    },
    result: {
      artifactKind: "storyboard",
      storyboardProviderSubmission: "confirmed",
      providerJobId: "accepted-frame-02",
      renderedItems: [{ title: "Frame one", mediaUrl: "/private/frame-one" }],
      artifactPlan: { items: [{ title: "Frame one" }, { title: "Frame two" }, { title: "Frame three" }, { title: "Frame four" }] },
      costReservationMicrousd: 5_000_000,
    },
  };
}

test("only the actual nonimpersonating owner can continue one confirmed terminal Fal safety rejection", () => {
  const harness = new StoryboardContinuationHarness();
  const eligible = failedStoryboard();
  assert.equal(harness.canContinueDocumentStoryboardWithSaferFrames(eligible), true);

  const invalid = [
    (job) => { job.status = "queued"; },
    (job) => { job.kind = "generate"; },
    (job) => { job.productionMode = "managed"; },
    (job) => { job.result.artifactKind = "video"; },
    (job) => { job.errorDetail.code = "safety_rejected"; },
    (job) => { job.errorDetail.category = "provider"; },
    (job) => { job.errorDetail.httpStatus = 400; },
    (job) => { job.errorDetail.retryable = true; },
    (job) => { job.result.storyboardProviderSubmission = "pending"; },
    (job) => { job.result.providerJobId = "pending"; },
    (job) => { job.result.providerJobId = "../another-owner"; },
    (job) => { job.result.renderedItems = []; },
    (job) => { job.result.costReservationMicrousd = 0; },
  ];

  for (const invalidate of invalid) {
    const rejected = failedStoryboard();
    invalidate(rejected);
    assert.equal(harness.canContinueDocumentStoryboardWithSaferFrames(rejected), false, invalidate.toString());
  }

  harness.principal.impersonation = { active: true };
  assert.equal(harness.canContinueDocumentStoryboardWithSaferFrames(eligible), false);
  harness.principal = { user: { userId: "storyboard-owner" }, impersonation: null, projectContext: { ownerUserId: "another-owner" } };
  assert.equal(harness.canContinueDocumentStoryboardWithSaferFrames(eligible), false);
  harness.principal.projectContext.ownerUserId = "storyboard-owner";
  const redactedProjectOwner = failedStoryboard();
  delete redactedProjectOwner.result.providerJobId;
  assert.equal(harness.canContinueDocumentStoryboardWithSaferFrames(redactedProjectOwner), true, "the server validates the exact accepted identifier privately for the actual shared-project owner");
});

test("continuation deliberately requeues the identical owner job once and honestly reuses its existing maximum", async () => {
  const harness = new StoryboardContinuationHarness();
  harness.jobs = [failedStoryboard()];

  assert.equal(await harness.continueDocumentStoryboardWithSaferFrames("owner-storyboard-job"), true);
  assert.deepEqual(harness.requests.map(({ input, init }) => ({ input, init })), [{
    input: "/api/document-jobs/owner-storyboard-job/continue-safer-frames",
    init: { method: "POST" },
  }]);
  assert.equal(harness.jobs.length, 1);
  assert.equal(harness.jobs[0].jobId, "owner-storyboard-job");
  assert.equal(harness.jobs[0].documentId, "owner-document");
  assert.equal(harness.jobs[0].status, "queued");
  assert.equal(harness.driven.length, 1);
  assert.deepEqual(harness.polls, [800]);
  assert.match(harness.notices[0], /Continue with safer frames.*Reserved maximum.*\$5\.00/u);
  assert.doesNotMatch(harness.notices[0], /no second paid|without another provider|free|no charge/iu);
  assert.equal(await harness.continueDocumentStoryboardWithSaferFrames("owner-storyboard-job"), false);
  assert.equal(harness.requests.length, 1, "a deliberate continuation cannot be submitted a second time");
});

test("cross-document, replacement-job, and unconfirmed reservation responses never enter the owner queue", async () => {
  for (const overrides of [
    { continuedWithSaferFrames: false },
    { reusedReservations: false },
    { job: { ...failedStoryboard(), status: "queued", jobId: "replacement-job" } },
    { job: { ...failedStoryboard(), status: "queued", documentId: "another-document" } },
    { job: { ...failedStoryboard(), status: "running" } },
  ]) {
    const harness = new StoryboardContinuationHarness();
    harness.jobs = [failedStoryboard()];
    harness.responseOverrides = overrides;
    assert.equal(await harness.continueDocumentStoryboardWithSaferFrames("owner-storyboard-job"), false);
    assert.equal(harness.jobs[0].status, "failed");
    assert.equal(harness.driven.length, 0);
  }
});

test("the actual failure card discloses preserved work, uncertain rejected charges, new paid images, and the original cap in every language", () => {
  const label = "Continue with safer frames";
  const summary = "{saved} of {total} frames saved. Context and captions stay unchanged. The rejected attempt may have been charged and will not be replayed. Revised frames are new paid image work within the existing {maximum} maximum; no new reservation or planner request.";
  const labelId = formaSystemMessageId(label);
  const summaryId = formaSystemMessageId(summary);

  assert.equal(englishMessages[labelId], label);
  assert.equal(englishMessages[summaryId], summary);
  for (const messages of [frenchMessages, arabicMessages, japaneseMessages]) {
    assert.ok(messages[labelId]);
    assert.ok(messages[summaryId]);
    for (const placeholder of ["{saved}", "{total}", "{maximum}"]) assert.ok(messages[summaryId].includes(placeholder));
  }

  assert.match(componentSource, /saferFramesEligible\?html`<button[^`]+Continue with safer frames/u);
  assert.match(componentSource, /costReservationMicrousd\)\/1_000_000,\{style:"currency",currency:"USD"\}/u);
  assert.match(componentSource, /saferFramesEligible\?html`<button[\s\S]*?:reconciliationEligible\?html`<button/u, "the existing-reservation continuation takes priority over unrelated recovery or fresh paid requests");
});
