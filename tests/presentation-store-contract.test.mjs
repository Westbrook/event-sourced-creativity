import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const store = syntax.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === "FormaStore");
assert.ok(store, "the actual FormaStore class remains available for contract verification");

function actualMethod(name) {
  const method = store.members.find((member) => ts.isMethodDeclaration(member) && member.body && member.name.getText(syntax) === name);
  assert.ok(method, `the actual ${name} store method remains available`);
  return method.getText(syntax);
}


// Exact source-ownership implementation and initializers, not a truthy facade.
// The fixture's existing activeScope, budget and transport ports are SIMULATED;
// they do not certify server authority, a paid submission, or a billing receipt.
function actualSourceMember(name) {
  const member=store.members.find(entry=>entry.name?.getText(syntax)===name);
  assert.ok(member,"the actual source ownership dependency "+name+" remains available");
  return member.getText(syntax);
}
const sourceOwnershipMembers=["#projectContextCookieGeneration","#projectContextSessionGeneration","#sourceGeneration","#sourceRetired","#sourceOwners","#sourcePausedJobs","captureAuthorizationScope","authorizationScopeActive","captureSourceOwnership","sourceOwnershipScopeActive","#sourceExpiryValid","#sourceDeadlineCurrent","sourceOwnershipActive","#assertSourceOwnership"].map(actualSourceMember).join("\n");

const harnessSource = `
import { resolvePresentationCountRequest } from ${JSON.stringify(new URL("../src/model/presentation-count-policy.ts", import.meta.url).href)};
import { isDocumentArtifactKind } from ${JSON.stringify(new URL("../src/model/document-artifacts.ts", import.meta.url).href)};
const MAX_MANAGED_PRESENTATION_SLIDES = 100;
const generationRevisionFor = (value) => {
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return "rev-" + (hash >>> 0).toString(36);
};

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
  #planningRecoveryIdentities = new Map();
  #planningRecoverySequence = 0;
  #planningLocaleRevision = 0;
  #adaptiveStructureJobIds = new Map();
  planningConsent = { get: () => null };
  adaptiveSuggestionSets = { get: () => ({}) };
  planningRecoveryEntries() { return []; }
  #rememberPlanningRecovery() { throw new Error("Adaptive planning is covered by its actual-store harness, not this media fixture."); }
  #observeAdaptivePlanningJob() { throw new Error("Adaptive planning is covered by its actual-store harness, not this media fixture."); }
  #clearAdaptivePrivatePresentation() { throw new Error("Adaptive planning is covered by its actual-store harness, not this media fixture."); }
  #appendPipeline = Promise.resolve();
  #navigationCommit = null;
  #readinessAcknowledgements = new Set();
  ${sourceOwnershipMembers}
  ${actualMethod("#privateJobReference")}

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
  ${actualMethod("#referencedPlanningJobIds")}
  ${actualMethod("#trimDocumentJobDetails")}
  ${actualMethod("#withdrawAdaptiveRead")}
  ${actualMethod("#publicDocumentJobDetail")}
  ${actualMethod("#adaptiveProposalOriginalMatches")}
  ${actualMethod("#cacheDocumentJobDetail")}
  ${actualMethod("loadDocumentJobDetail")}
  ${actualMethod("loadActorDocumentGenerationReceipt")}
  ${actualMethod("loadPreservedPresentationCandidateJobs")}
  ${actualMethod("loadPresentationCandidates")}
  ${actualMethod("loadPresentationCandidate")}
  ${actualMethod("preservePresentationCandidate")}
  ${actualMethod("#assertPresentationCandidatePayload")}
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

test("keeps soundtrack, transfer, and image selections distinct without changing ordinary request identities", async () => {
  const harness = new PresentationStoreHarness();
  const base = { productionMode: "managed", itemCount: 12 };

  assert.equal(await harness.renderDocumentArtifact("slides", base), true);
  assert.doesNotMatch(harness.requests[0].body.payload.requestKey, /:soundtracks:|:transfer:|:image:/);

  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, soundtrackBlockIds: ["PRIVATE_SOUNDTRACK_A_481"] }), true);
  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, soundtrackBlockIds: ["PRIVATE_SOUNDTRACK_B_792"] }), true);
  assert.equal(harness.requests.length, 3);
  assert.match(harness.requests[1].body.payload.requestKey, /:audio:rev-[a-z0-9]+$/);
  assert.match(harness.requests[2].body.payload.requestKey, /:audio:rev-[a-z0-9]+$/);
  assert.notEqual(harness.requests[1].body.payload.requestKey, harness.requests[2].body.payload.requestKey);
  assert.deepEqual(harness.requests[1].body.payload.soundtrackBlockIds, ["PRIVATE_SOUNDTRACK_A_481"]);
  assert.equal(await harness.renderDocumentArtifact("slides", { ...base, soundtrackBlockIds: ["PRIVATE_SOUNDTRACK_A_481"] }), true);
  assert.equal(harness.requests.length, 3, "the same approved soundtrack reuses its own active request");

  assert.equal(await harness.renderDocumentArtifact("video", { soundtrackBlockIds: ["PRIVATE_SOUNDTRACK_A_481"] }), true);
  const descriptionOnlyKey = harness.requests.at(-1).body.payload.requestKey;
  assert.equal(await harness.renderDocumentArtifact("video", { soundtrackBlockIds: ["PRIVATE_SOUNDTRACK_A_481"], sendSoundtrackToVideoProvider: true }), true);
  assert.notEqual(harness.requests.at(-1).body.payload.requestKey, descriptionOnlyKey);
  assert.equal(harness.requests.at(-1).body.payload.sendSoundtrackToVideoProvider, true);

  assert.equal(await harness.renderDocumentArtifact("audio", { audioImageBlockId: "PRIVATE_IMAGE_REFERENCE_792" }), true);
  assert.match(harness.requests.at(-1).body.payload.requestKey, /:audio:rev-[a-z0-9]+$/);
  assert.equal(harness.requests.at(-1).body.payload.audioImageBlockId, "PRIVATE_IMAGE_REFERENCE_792");

  for (const request of harness.requests) assert.doesNotMatch(request.body.payload.requestKey, /PRIVATE_/);
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

test("stores flexible acceptance separately from the attempt aim without an implicit exact slide count", async () => {
  const harness = new PresentationStoreHarness();
  const slideCountPolicy = { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 };
  assert.equal(await harness.renderDocumentArtifact("slides", { productionMode: "manual", itemCount: 8, slideCountPolicy }), true);
  const payload = harness.requests[0].body.payload;
  assert.deepEqual(payload.slideCountPolicy, slideCountPolicy);
  assert.equal(payload.itemCount, 8);
  assert.equal(Object.hasOwn(payload, "requestedSlideCount"), false);
  assert.equal(harness.budgetChecks.length, 1);
});

test("rejects conflicting and unsupported counts before budget authorization or provider submission", async () => {
  const harness = new PresentationStoreHarness();
  const invalid = [
    { itemCount: 12, requestedSlideCount: 23, productionMode: "managed" },
    { requestedSlideCount: 16, productionMode: "manual" },
    { requestedSlideCount: 101, productionMode: "managed" },
    { requestedSlideCount: 0, productionMode: "managed" },
    { requestedSlideCount: 1.5, productionMode: "managed" },
    { requestedSlideCount: Number.POSITIVE_INFINITY, productionMode: "managed" },
  ];

  for (const options of invalid) assert.equal(await harness.renderDocumentArtifact("slides", options), false);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.budgetChecks.length, 0);
  assert.ok(harness.messages.some((message) => /does not match/.test(message)));
  assert.ok(harness.messages.some((message) => /Manual presentations support between 1 and 15 slides/.test(message)));
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
    assert.equal(url, `/api/document-jobs/${listed.jobId}?inspection=1`);
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

test("presentation draft review stays actor-private, uncached, and bound to its exact authorized job",async(context)=>{
  const harness=new PresentationStoreHarness();
  const listed={jobId:"job-private-presentation",documentId:"authorized-document",updatedAt:"2026-08-24T00:00:00.000Z",result:null};
  harness.jobs=[listed];
  const candidate={responseId:"private-response",jobId:listed.jobId,documentId:listed.documentId,retentionClass:"transient-private",stage:"initial",issues:[],slides:[{title:"Authorized visible draft",body:"Source-safe actor-private evidence."}]};
  const requests=[];
  context.mock.method(globalThis,"fetch",async(url)=>{requests.push(url);return{ok:true,json:async()=>url.endsWith("/presentation-candidates")?{jobId:listed.jobId,documentId:listed.documentId,candidates:[candidate]}:{jobId:listed.jobId,documentId:listed.documentId,candidate}};});

  const candidates=await harness.loadPresentationCandidates(listed.jobId);
  const detail=await harness.loadPresentationCandidate(listed.jobId,candidate.responseId);
  assert.equal(candidates.candidates.length,1);
  assert.equal(detail.slides[0].title,"Authorized visible draft");
  assert.deepEqual(requests,[`/api/document-jobs/${listed.jobId}/presentation-candidates`,`/api/document-jobs/${listed.jobId}/presentation-candidates/${candidate.responseId}`]);
  assert.deepEqual(harness.jobs,[listed],"rejected drafts never enter shared document-job state");
  assert.deepEqual(harness.contentValues,{},"rejected drafts never enter private-content hydration state");
  assert.deepEqual(harness.hydrations,[],"reviewing rejected drafts never hydrates raw provider evidence");
});

test("actor-private presentation draft review rejects mismatched identity, forbidden source fields, and revoked scope",async(context)=>{
  const listed={jobId:"job-private-presentation",documentId:"authorized-document",updatedAt:"2026-08-24T00:00:00.000Z",result:null};
  const invalidBodies=[
    {jobId:"another-job",documentId:listed.documentId,candidates:[]},
    {jobId:listed.jobId,documentId:"another-document",candidates:[]},
    {jobId:listed.jobId,documentId:listed.documentId,candidate:{jobId:listed.jobId,documentId:listed.documentId,responseId:"another-response"}},
    {jobId:listed.jobId,documentId:listed.documentId,candidate:{jobId:listed.jobId,documentId:listed.documentId,responseId:"private-response",slides:[{source_ids:["blk_999"]}]}},
  ];
  context.mock.method(globalThis,"fetch",async()=>({ok:true,json:async()=>invalidBodies.shift()}));
  for(let index=0;index<4;index+=1){
    const harness=new PresentationStoreHarness();harness.jobs=[listed];
    const operation=index<2?harness.loadPresentationCandidates(listed.jobId):harness.loadPresentationCandidate(listed.jobId,"private-response");
    await assert.rejects(operation,/could not be verified|disallowed source or provider data/u);
    assert.deepEqual(harness.jobs,[listed]);
    assert.deepEqual(harness.contentValues,{});
  }
});

test("resolved citation checks stay in the authorized private detail without broadening store caches",async(context)=>{
  const harness=new PresentationStoreHarness();
  const listed={jobId:"job-private-citation",documentId:"authorized-document",result:null};
  harness.jobs=[listed];
  const candidate={jobId:listed.jobId,documentId:listed.documentId,responseId:"private-citation-response",reviewOnlyReason:"historical-validation-rejection",
    citationChecks:[{slideIndex:0,citationIndex:0,sourceLabel:"Synthetic research",excerpt:"Synthetic quoted evidence.",excerptTruncated:false,
      sourceStatus:"authorized",excerptStatus:"ungrounded",anchorStatus:"valid",passages:[{content:"Synthetic frozen source passage.",truncated:false}]}]};
  context.mock.method(globalThis,"fetch",async(url)=>{
    assert.equal(url,`/api/document-jobs/${listed.jobId}/presentation-candidates/${candidate.responseId}`);
    return{ok:true,json:async()=>({jobId:listed.jobId,documentId:listed.documentId,candidate})};
  });
  const detail=await harness.loadPresentationCandidate(listed.jobId,candidate.responseId);
  assert.equal(detail.citationChecks[0].sourceStatus,"authorized");
  assert.equal(detail.citationChecks[0].excerptStatus,"ungrounded");
  assert.deepEqual(harness.jobs,[listed]);
  assert.deepEqual(harness.contentValues,{});
  assert.deepEqual(harness.hydrations,[]);
});

test("preserved actor-private drafts remain discoverable after their transient job leaves ordinary application state",async(context)=>{
  const harness=new PresentationStoreHarness();
  const jobId="expired-private-presentation-job";
  const candidate={responseId:"preserved-private-response",jobId,documentId:"authorized-document",retentionClass:"governed-evidence",stage:"initial",issues:[],slides:[{title:"Preserved authorized slide"}]};
  const requests=[];
  context.mock.method(globalThis,"fetch",async(url)=>{
    requests.push(url);
    if(url.startsWith("/api/document-jobs/presentation-candidates?"))return{ok:true,json:async()=>({documentId:"authorized-document",jobs:[{jobId,documentId:"authorized-document",candidates:[candidate]}]})};
    return{ok:true,json:async()=>url.endsWith("/presentation-candidates")?{jobId,documentId:"authorized-document",candidates:[candidate]}:{jobId,documentId:"authorized-document",candidate}};
  });

  const discovered=await harness.loadPreservedPresentationCandidateJobs("authorized-document");
  assert.equal(discovered.jobs[0].jobId,jobId);
  assert.equal((await harness.loadPresentationCandidates(jobId,"authorized-document")).candidates[0].retentionClass,"governed-evidence");
  assert.equal((await harness.loadPresentationCandidate(jobId,candidate.responseId,"authorized-document")).slides[0].title,"Preserved authorized slide");
  await assert.rejects(harness.loadPresentationCandidates(jobId,"another-document"),/do not belong/u);
  assert.deepEqual(harness.jobs,[],"expired jobs must not be recreated in ordinary shared application state");
  assert.deepEqual(harness.contentValues,{},"preserved draft discovery must not hydrate raw provider content");
  assert.deepEqual(requests,[`/api/document-jobs/presentation-candidates?document=authorized-document`,`/api/document-jobs/${jobId}/presentation-candidates`,`/api/document-jobs/${jobId}/presentation-candidates/${candidate.responseId}`]);
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

test("presentation Store source ownership uses exact branded tokens and denies expired reads before dispatch",async t=>{
  const now=Date.parse("2026-08-28T15:00:00Z");t.mock.method(Date,"now",()=>now);
  const harness=new PresentationStoreHarness(),source=harness.captureSourceOwnership();
  assert.equal(harness.sourceOwnershipActive(source),true);
  assert.equal(harness.sourceOwnershipActive(structuredClone(source)),false);
  assert.equal(new PresentationStoreHarness().sourceOwnershipActive(source),false);
  const session={actor:"authorized-user",projectContext:{expiresAt:new Date(now).toISOString()}};
  harness.session={get:()=>session};
  await assert.rejects(harness.loadPresentationCandidates("private-job","authorized-document"),/current source is unavailable/u);
  assert.equal(await harness.renderDocumentArtifact("slides",{itemCount:12}),false);
  assert.deepEqual(harness.requests,[]);assert.deepEqual(harness.budgetChecks,[]);assert.deepEqual(harness.contentValues,{});
});

for(const operation of["list","detail"])for(const stage of["headers","body"])for(const expired of[false,true])test("presentation Store "+operation+" "+stage+" "+(expired?"expiry withholds":"current ownership preserves")+" an exact private response",async t=>{
  let now=Date.parse("2026-08-28T15:00:00Z");t.mock.method(Date,"now",()=>now);
  const harness=new PresentationStoreHarness(),session={actor:"authorized-user",projectContext:{expiresAt:new Date(now+60_000).toISOString()}};
  harness.session={get:()=>session};
  const listed={jobId:"private-job",documentId:"authorized-document",result:null};
  harness.jobs=[listed];
  const candidate={jobId:listed.jobId,documentId:listed.documentId,responseId:"private-response",title:"PRIVATE SELECTED DRAFT",slides:[]};
  const body=operation==="list"?{jobId:listed.jobId,documentId:listed.documentId,candidates:[candidate]}:{jobId:listed.jobId,documentId:listed.documentId,candidate};
  const gate=Promise.withResolvers(),reached=Promise.withResolvers(),calls=[];
  t.mock.method(globalThis,"fetch",async url=>{
    calls.push(url);if(stage==="headers"){reached.resolve();await gate.promise;}
    return{ok:true,status:200,json:async()=>{if(stage==="body"){reached.resolve();await gate.promise;}return body;}};
  });
  const pending=operation==="list"?harness.loadPresentationCandidates(listed.jobId):harness.loadPresentationCandidate(listed.jobId,candidate.responseId);
  const source=harness.captureSourceOwnership();await reached.promise;
  if(expired)now+=60_000;
  assert.equal(harness.sourceOwnershipScopeActive(source),true);
  assert.equal(harness.sourceOwnershipActive(source),!expired);
  const observed=expired?assert.rejects(pending,/current source is unavailable/u):pending;
  gate.resolve();const result=await observed;
  if(!expired)assert.deepEqual(result,operation==="list"?body:candidate);
  assert.deepEqual(calls,["/api/document-jobs/private-job/presentation-candidates"+(operation==="detail"?"/private-response":"")]);
  assert.deepEqual(harness.jobs,[listed]);assert.deepEqual(harness.contentValues,{});assert.deepEqual(harness.hydrations,[]);
  assert.deepEqual(harness.requests,[]);assert.deepEqual(harness.budgetChecks,[]);
});
