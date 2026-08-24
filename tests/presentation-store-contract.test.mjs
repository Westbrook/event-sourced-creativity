import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const store = syntax.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === "FormaStore");
assert.ok(store, "the actual FormaStore class remains available for contract verification");

function actualMethod(name) {
  const method = store.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(syntax) === name);
  assert.ok(method, `the actual ${name} store method remains available`);
  return method.getText(syntax);
}

const harnessSource = `
const MAX_MANAGED_PRESENTATION_SLIDES = 100;

export class PresentationStoreHarness {
  requests = [];
  budgetChecks = [];
  messages = [];
  jobs = [];
  hydrations = [];
  privateContents = {};
  contentValues = {};
  activeScope = "actor-private-authorized-project";
  projection = { get: () => ({ documentId: "authorized-document" }) };
  session = { get: () => ({ actor: "authorized-user" }) };
  documentJobs = { get: () => this.jobs, set: (jobs) => { this.jobs = jobs; } };
  generationReadiness = { get: () => ({}), set: () => {} };
  content = { get: () => this.contentValues, set: (values) => { this.contentValues = values; } };
  #jobStarts = new Set();
  #jobDetails = new Map();
  #appendPipeline = Promise.resolve();
  #navigationCommit = null;
  #readinessAcknowledgements = new Set();

  #generationContext(documentId) {
    return {
      documentId,
      documentRevision: "rev-authorized-outline",
      snapshot: {
        facts: [{ block_id: "PRIVATE_SOURCE_BLOCK_481", properties: { text: "Slide 1 — Authored executive evidence" } }],
        relationships: [],
      },
      sourceBlockVersions: [{ block_id: "PRIVATE_SOURCE_BLOCK_481", version: 1 }],
    };
  }

  #activeAuthorizationScope() { return this.activeScope; }
  #authorizationScope() { return this.activeScope; }
  #scopeStillActive(scope) { return scope === this.activeScope; }
  #assertAuthorizationScope(scope) { if (!this.#scopeStillActive(scope)) throw new Error("authorization_changed"); }
  #canRequestProjectOutputs() { return true; }
  async #authorizeGenerationBudget(kind, payload) { this.budgetChecks.push({ kind, payload }); }
  #driveDocumentJobs() {}
  #scheduleJobPoll() {}
  notify() {}
  #systemNotice(source, values = {}) { return Object.entries(values).reduce((message, [name, value]) => message.replace("{" + name + "}", String(value)), source); }
  toast(message) { this.messages.push(message); }
  async ensurePrivateContent(reference, options = {}) {
    this.hydrations.push(reference);
    const retained = this.privateContents[reference];
    if (typeof retained === "string" && options.validate && !options.validate(retained)) return null;
    if (typeof retained === "string") this.contentValues[reference] = retained;
    return retained ?? null;
  }

  async guardedFetch(input, init, action) {
    const body = JSON.parse(init.body);
    this.requests.push({ input, body, action });
    const job = {
      jobId: "job-" + this.requests.length,
      documentId: body.documentId,
      kind: body.kind,
      requestKey: body.payload.requestKey,
      status: "queued",
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    return { ok: true, json: async () => ({ job, reused: false }) };
  }

  ${actualMethod("#startDocumentJob")}
  ${actualMethod("#hydrateDocumentJobGenerationReceipt")}
  ${actualMethod("loadDocumentJobDetail")}
  ${actualMethod("loadActorDocumentGenerationReceipt")}
  ${actualMethod("renderDocumentArtifact")}
}
`;

const { outputText } = ts.transpileModule(harnessSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: "presentation-store-contract.ts",
});
const { PresentationStoreHarness } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

test("carries intentional presentation settings and the authorized source snapshot into the durable job", async () => {
  const harness = new PresentationStoreHarness();

  assert.equal(await harness.renderDocumentArtifact("slides", {
    productionMode: "managed",
    itemCount: 23,
    requestedSlideCount: 23,
    authoredSlideCount: 12,
    presentationStyle: "nocturne",
    presentationFidelity: "faithful",
    locale: "ja-JP",
    sourceSurface: "presentation-authoring",
  }), true);

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.budgetChecks.length, 1);
  const { body } = harness.requests[0];
  assert.equal(body.documentId, "authorized-document");
  assert.equal(body.sourceSurface, "presentation-authoring");
  assert.equal(body.payload.itemCount, 23);
  assert.equal(body.payload.requestedSlideCount, 23);
  assert.equal(body.payload.authoredSlideCount, 12);
  assert.equal(body.payload.presentationStyle, "nocturne");
  assert.equal(body.payload.presentationFidelity, "faithful");
  assert.equal(body.payload.locale, "ja-JP");
  assert.equal(body.payload.snapshot.facts[0].block_id, "PRIVATE_SOURCE_BLOCK_481");
  assert.match(body.payload.requestKey, /:style:nocturne:fidelity:faithful:slides:23$/);
  assert.doesNotMatch(body.payload.requestKey, /PRIVATE_SOURCE_BLOCK_481/);
  assert.equal(Object.hasOwn(body.payload, "sourceAliases"), false);
  assert.equal(Object.hasOwn(body.payload, "source_aliases"), false);
  assert.equal(Object.hasOwn(body.payload, "protectedLedger"), false);
});

test("deduplicates only matching active requests while preserving intentional styles and deliberate regeneration", async () => {
  const harness = new PresentationStoreHarness();
  const base = { productionMode: "managed", itemCount: 12 };

  assert.equal(await harness.renderDocumentArtifact("slides", base), true);
  assert.doesNotMatch(harness.requests[0].body.payload.requestKey, /:style:|:fidelity:/);
  assert.equal(await harness.renderDocumentArtifact("slides", base), true);
  assert.equal(harness.requests.length, 1, "an exact queued request does not reserve or submit twice");
  assert.equal(harness.budgetChecks.length, 1);

  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, presentationStyle: "gallery" }), true);
  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, presentationStyle: "editorial" }), true);
  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, presentationStyle: "editorial", presentationFidelity: "creative" }), true);
  assert.equal(harness.requests.length, 4, "different intentional style and fidelity choices remain distinct");
  assert.equal(new Set(harness.requests.map((request) => request.body.payload.requestKey)).size, 4);

  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, presentationStyle: "editorial", presentationFidelity: "creative", locale: "ja-JP" }), true);
  assert.equal(harness.requests.length, 5, "a different selected language cannot reuse an existing English generation");
  assert.equal(harness.requests.at(-1).body.payload.locale, "ja-JP");

  harness.jobs = harness.jobs.map((job) => ({ ...job, status: "completed" }));
  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, presentationStyle: "editorial", presentationFidelity: "creative" }), true);
  assert.equal(harness.requests.length, 6, "a completed request does not block deliberate regeneration");
  assert.equal(harness.budgetChecks.length, 6);
});

test("normalizes both count aliases without leaking slideshow-only settings into other artifact formats", async () => {
  const managed = new PresentationStoreHarness();
  assert.equal(await managed.renderDocumentArtifact("slides", { productionMode: "managed", requestedSlideCount: 23 }), true);
  assert.equal(managed.requests[0].body.payload.itemCount, 23);
  assert.equal(managed.requests[0].body.payload.requestedSlideCount, 23);

  const manual = new PresentationStoreHarness();
  assert.equal(await manual.renderDocumentArtifact("slides", { itemCount: 12 }), true);
  assert.equal(manual.requests[0].body.payload.itemCount, 12);
  assert.equal(manual.requests[0].body.payload.requestedSlideCount, 12);

  const unrelated = new PresentationStoreHarness();
  assert.equal(await unrelated.renderDocumentArtifact("storyboard", {
    itemCount: 6,
    requestedSlideCount: 23,
    authoredSlideCount: 12,
    presentationStyle: "nocturne",
    presentationFidelity: "creative",
  }), true);
  const payload = unrelated.requests[0].body.payload;
  assert.equal(payload.itemCount, 6);
  for (const key of ["requestedSlideCount", "authoredSlideCount", "presentationStyle", "presentationFidelity"]) {
    assert.equal(Object.hasOwn(payload, key), false, `${key} cannot leak into a non-presentation request`);
  }
});

test("rejects conflicting and unsupported counts before budget authorization or provider submission", async () => {
  const harness = new PresentationStoreHarness();
  const invalid = [
    { itemCount: 12, requestedSlideCount: 23, productionMode: "managed" },
    { requestedSlideCount: 13, productionMode: "manual" },
    { requestedSlideCount: 101, productionMode: "managed" },
    { requestedSlideCount: 0, productionMode: "managed" },
    { requestedSlideCount: 1.5, productionMode: "managed" },
    { requestedSlideCount: Number.POSITIVE_INFINITY, productionMode: "managed" },
  ];

  for (const options of invalid) assert.equal(await harness.renderDocumentArtifact("slides", options), false);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.budgetChecks.length, 0);
  assert.ok(harness.messages.some((message) => /does not match/.test(message)));
  assert.ok(harness.messages.some((message) => /Manual presentations support between 1 and 12 slides/.test(message)));
  assert.ok(harness.messages.some((message) => /Managed presentations support between 1 and 100 slides/.test(message)));

  assert.equal(await harness.renderDocumentArtifact("slides", { requestedSlideCount: 12, productionMode: "manual" }), true);
  assert.equal(await harness.renderDocumentArtifact("slides", { requestedSlideCount: 100, productionMode: "managed" }), true);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.budgetChecks.length, 2);
});

test("hydrates governed input receipts only from an authorized matching job-detail response", async (context) => {
  const harness = new PresentationStoreHarness();
  const reference = "opaque-actor-private-receipt";
  const listed = {
    jobId: "job-private",
    documentId: "authorized-document",
    updatedAt: "2026-08-24T00:00:00.000Z",
    result: null,
  };
  const detail = {
    ...listed,
    result: { generationReceipt: { input_ref: reference, provider: "openai" } },
  };
  harness.jobs = [listed];
  harness.privateContents[reference] = JSON.stringify({
    job_id: listed.jobId,
    document_id: listed.documentId,
    document_snapshot: { facts: [{ properties: { text: "Actor-private source decision" } }] },
  });

  const fetch = context.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, `/api/document-jobs/${listed.jobId}`);
    return { ok: true, json: async () => ({ job: detail }) };
  });

  assert.deepEqual(harness.hydrations, [], "the ordinary list response never hydrates a private receipt");
  assert.deepEqual(await harness.loadDocumentJobDetail(listed.jobId), detail);
  assert.deepEqual(harness.hydrations, [reference]);
  assert.match(harness.contentValues[reference], /Actor-private source decision/);
  assert.equal(fetch.mock.callCount(), 1);

  delete harness.contentValues[reference];
  assert.deepEqual(await harness.loadDocumentJobDetail(listed.jobId), detail);
  assert.deepEqual(harness.hydrations, [reference, reference], "cached authorized details can retry a missing governed receipt");
  assert.equal(fetch.mock.callCount(), 1, "cached details do not request another job response");
  assert.doesNotMatch(actualMethod("syncDocumentJobs"), /input_ref|ensurePrivateContent|hydrateDocumentJobGenerationReceipt/);
});

test("does not hydrate receipts from sanitized collaborator views, unrelated jobs, or mismatched documents", async (context) => {
  const reference = "opaque-actor-private-receipt";
  const listed = {
    jobId: "job-private",
    documentId: "authorized-document",
    updatedAt: "2026-08-24T00:00:00.000Z",
    result: null,
  };
  const responses = [
    { job: { ...listed, result: {} } },
    { job: { ...listed, jobId: "another-actors-job", result: { generationReceipt: { input_ref: reference } } } },
    { job: { ...listed, documentId: "another-project-document", result: { generationReceipt: { input_ref: reference } } } },
    { job: { ...listed, result: { generationReceipt: { input_ref: reference, provider: "openai" } } } },
  ];
  context.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => responses.shift() }));

  const sanitized = new PresentationStoreHarness();
  sanitized.session = { get: () => ({ actor: "project-collaborator", projectContext: { projectId: "shared-project" } }) };
  sanitized.jobs = [listed];
  assert.equal((await sanitized.loadDocumentJobDetail(listed.jobId)).result.generationReceipt, undefined);
  assert.deepEqual(sanitized.hydrations, [], "sanitized collaborator responses never recover another actor's reference");

  const wrongActor = new PresentationStoreHarness();
  wrongActor.jobs = [listed];
  await assert.rejects(wrongActor.loadDocumentJobDetail(listed.jobId), /do not belong to this authorized job/);
  assert.deepEqual(wrongActor.hydrations, [], "a different job cannot trigger private-content hydration");

  const wrongProject = new PresentationStoreHarness();
  wrongProject.jobs = [listed];
  await assert.rejects(wrongProject.loadDocumentJobDetail(listed.jobId), /do not belong to this authorized job/);
  assert.deepEqual(wrongProject.hydrations, [], "a different project document cannot trigger private-content hydration");

  const leakedProjectReceipt = new PresentationStoreHarness();
  leakedProjectReceipt.session = { get: () => ({ actor: "submitting-project-user", projectContext: { projectId: "shared-project" } }) };
  leakedProjectReceipt.jobs = [listed];
  await assert.rejects(leakedProjectReceipt.loadDocumentJobDetail(listed.jobId), /unavailable in shared project views/);
  assert.deepEqual(leakedProjectReceipt.hydrations, [], "even the submitting actor cannot hydrate a receipt from a shared-project response");
  assert.equal(leakedProjectReceipt.jobs[0].result, null, "an accidentally exposed receipt cannot enter shared job state");
});

test("loads actor-private project generation receipts without entering shared job or private-content caches",async(context)=>{
  const harness=new PresentationStoreHarness();
  harness.session={get:()=>({actor:"submitting-project-user",projectContext:{projectId:"shared-project"}})};
  const listed={jobId:"job-project-private",documentId:"authorized-document",updatedAt:"2026-08-24T00:00:00.000Z",result:null};
  harness.jobs=[listed];
  const reference="actor-private-project-input";
  const detail={...listed,result:{generationReceipt:{input_ref:reference,provider:"openai"}}};
  const retained=JSON.stringify({job_id:listed.jobId,document_id:listed.documentId,document_snapshot:{facts:[{text:"Actor-only project evidence"}]}});
  context.mock.method(globalThis,"fetch",async(url)=>{assert.equal(url,`/api/document-jobs/${listed.jobId}/private-receipt`);return{ok:true,json:async()=>({job:detail,content:{[reference]:retained}})};});

  assert.deepEqual(await harness.loadActorDocumentGenerationReceipt(listed.jobId),{job:detail,content:{[reference]:retained}});
  assert.deepEqual(harness.jobs,[listed],"the ordinary project job list remains fully redacted");
  assert.deepEqual(harness.contentValues,{},"project-private source text never enters the shared content cache");
  assert.deepEqual(harness.hydrations,[],"actor-only receipt inspection never broadens project event hydration");
});

test("rejects another job's private receipt before it enters the authorized local content cache",async(context)=>{
  const harness=new PresentationStoreHarness();
  const reference="opaque-wrong-job-receipt";
  const listed={jobId:"job-authorized",documentId:"authorized-document",updatedAt:"2026-08-24T00:00:00.000Z",result:null};
  harness.jobs=[listed];
  harness.privateContents[reference]=JSON.stringify({job_id:"different-private-job",document_id:listed.documentId,document_snapshot:{facts:[{properties:{text:"UNRELATED PRIVATE SOURCE"}}]}});
  context.mock.method(globalThis,"fetch",async()=>({ok:true,json:async()=>({job:{...listed,result:{generationReceipt:{input_ref:reference}}}})}));

  await assert.rejects(harness.loadDocumentJobDetail(listed.jobId),/does not belong to this authorized job/);
  assert.equal(Object.hasOwn(harness.contentValues,reference),false,"mismatched content must never become transiently visible to subscribers");
});

test("rejects actor-private receipt content bound to a different job or document", async (context) => {
  const harness = new PresentationStoreHarness();
  const reference = "opaque-mismatched-receipt";
  const listed = {
    jobId: "job-private",
    documentId: "authorized-document",
    updatedAt: "2026-08-24T00:00:00.000Z",
    result: null,
  };
  harness.jobs = [listed];
  harness.privateContents[reference] = JSON.stringify({
    job_id: "another-actors-job",
    document_id: "authorized-document",
    document_snapshot: { facts: [{ properties: { text: "Do not inspect this source" } }] },
  });
  context.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ job: { ...listed, result: { generationReceipt: { input_ref: reference } } } }),
  }));

  await assert.rejects(harness.loadDocumentJobDetail(listed.jobId), /private generation receipt does not belong/);
  assert.equal(harness.jobs[0].result, null, "an invalid receipt never becomes an inspectable job detail");
});
