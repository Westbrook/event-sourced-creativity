import test from "node:test";
import assert from "node:assert/strict";
import { OutputRequirementsClient } from "../src/state/output-requirements-client.ts";
import { outputRequirementEditableDraft } from "../src/model/output-requirements.ts";
import { compileOutputPlan, summarizeOutputPlan } from "../src/model/output-plan.ts";
import { snapshot as outputSnapshot } from "./output-ui-source-harness.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(process.env.FORMA_OUTPUT_RECEIPT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const projectRequire = createRequire(resolve(process.env.FORMA_OUTPUT_DEPENDENCY_ROOT || sourceRoot, "package.json"));
const ts = projectRequire("typescript");
const source = await readFile(resolve(sourceRoot, "src/state/store.ts"), "utf8");
const parsed = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
const method = declaration?.members.find((node) => ts.isMethodDeclaration(node) && node.name?.getText(parsed) === "reconcileOutputOperationReceipt");
assert.ok(method, "the real source must contain the receipt method under test");
const clientField = declaration?.members.find((node) => ts.isPropertyDeclaration(node) && node.name?.getText(parsed) === "outputRequirements");
assert.ok(clientField, "the actual Store transport client options must exist");
const snapshotGuard = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "outputSnapshotRenderable");
assert.ok(snapshotGuard, "the actual Store snapshot-admission helper must exist");
const compiled = ts.transpileModule(`${snapshotGuard.getText(parsed)}\nclass ReceiptStore { #jobDetails = new Map(); ${clientField.getText(parsed)} ${method.getText(parsed)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const ReceiptStore = new Function("OutputRequirementsClient", "outputRequirementEditableDraft", `${compiled}; return ReceiptStore;`)(OutputRequirementsClient, outputRequirementEditableDraft);
const deferred = () => { let resolvePromise; const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; }); return { promise, resolve: resolvePromise }; };

const job = () => ({ jobId: "job", documentId: "doc", kind: "render_document", status: "failed", result: { artifactKind: "slides" } });
const body = (status = "known", reconciled = true) => ({ job: job(), reconciliation: { documentId: "doc", grantId: "grant", slotId: "slot", jobId: "job", status, reconciled } });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

/** Complete only the synthetic receipt wire projection; retain the original test identities and accounting. */
function completeReceiptSnapshot(snapshot) {
  snapshot.scope = { kind: "personal", organizationId: null, ...snapshot.scope };
  snapshot.capabilities = { nativeGeneration: false, ...snapshot.capabilities };
  const originalTargets = snapshot.confirmedPlan.plan.targets;
  const plan = compileOutputPlan(snapshot.requirements.flatMap(row => row.spec ? [row.spec] : []), {
    document_id: snapshot.documentId, source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision,
  });
  const targetIds = new Map(plan.targets.map((target, index) => [target.id, originalTargets[index].id]));
  plan.targets = plan.targets.map((target, index) => ({ ...target, ...originalTargets[index] }));
  plan.obligations = plan.obligations.map(obligation => ({ ...obligation, target_ids: obligation.target_ids.map(id => targetIds.get(id) ?? id) }));
  const occurredAt = "2026-08-27T12:00:00.000Z";
  snapshot.confirmedPlan = { id: snapshot.confirmedPlan.revisionId, revision: 1, confirmedAt: occurredAt, ...snapshot.confirmedPlan, plan };
  snapshot.summary = { ...summarizeOutputPlan(plan, snapshot.targetStates), ...snapshot.summary };
  snapshot.requirementSummaries = Object.fromEntries(snapshot.requirements.map(row => [row.blockId, snapshot.summary]));
  snapshot.requirementFileCounts = Object.fromEntries(snapshot.requirements.map(row => [row.blockId, null]));
  snapshot.scopeAmendments = [];
  // Existing synthetic inspected/result states are transport data, not a new
  // byte inspection, human review, rights assertion, or acceptance certificate.
  snapshot.assets = snapshot.assets.map(asset => ({
    sourceDigest: snapshot.sourceRevision, createdByUserId: "fixture-producer", createdAt: occurredAt, ...asset,
    inspection: { kind: "image", mimeType: asset.mimeType, extension: "png", byteLength: asset.byteLength, sha256: asset.sha256, errors: [], ...asset.inspection },
  }));
  snapshot.results = snapshot.results.map(result => ({
    targetContractDigest: snapshot.confirmedPlan.targetContractDigests[result.targetId], sourceDigest: snapshot.sourceRevision,
    sha256: snapshot.assets.find(asset => asset.id === result.assetId).sha256, createdAt: occurredAt, checks: [], acceptanceId: null, ...result,
  }));
  return snapshot;
}

async function fixture() {
  const request = deferred();
  const state = { scope: "scope-a", projectId: "project", userId: "actor", readResponse: null, onNotify: null };
  const snapshot = completeReceiptSnapshot(outputSnapshot("doc"));
  snapshot.projectId = "project"; snapshot.scope.actorUserId = "actor";
  snapshot.sourceVerification = { ...snapshot.sourceVerification, status: "unavailable", reasonCodes: ["private_source_expired"] };
  snapshot.grants = [{ id: "grant", actorUserId: "actor", status: "uncertain", planRevisionId: snapshot.confirmedPlan.revisionId, maximumMicrousd: 500000, maximumCalls: 1, operations: [{ id: "slot", jobId: "job", targetId: "target-doc", status: "uncertain", reservedMicrousd: 500000, usedMicrousd: null, calls: [] }] }];
  const effects = { requests: [], refreshes: [], reads: [], jobs: [], notifications: 0 };
  const receiptReplies = [request.promise], readReplies = [Response.json(snapshot)];
  const store = new ReceiptStore();
  Object.assign(store, {
    captureAuthorizationScope: () => state.scope ? ({ key: state.scope, shared: false }) : null,
    authorizationScopeActive: (captured) => Boolean(captured && captured.key === state.scope),
    projection: { get: () => ({ projectId: state.projectId, libraryBlocks: [] }) },
    session: { get: () => state.scope ? ({ user: { userId: state.userId }, projectContext: null, impersonation: null }) : null },
    guardedFetch: async (...args) => {
      if (args[1]?.method === "POST") {
        effects.requests.push(args);
        assert.ok(receiptReplies.length, "no automatic receipt retry is allowed");
        return receiptReplies.shift();
      }
      effects.reads.push(args);
      if (state.readResponse) return state.readResponse(...args);
      if (readReplies.length) return readReplies.shift();
      return Response.json(store.outputRequirements.resource("doc").snapshot);
    },
    documentJobs: { get: () => effects.jobs, set: (jobs) => { effects.jobs = jobs; } },
    notify: () => { effects.notifications += 1; state.onNotify?.(); },
    syncDocumentJobs: () => { throw new Error("receipt inspection must never drive queued jobs"); },
    refreshSession: () => { throw new Error("receipt inspection must never accept terms or mutate an unrelated route"); },
  });
  const resource = await store.outputRequirements.ensure("doc");
  const ensure = store.outputRequirements.ensure.bind(store.outputRequirements);
  store.outputRequirements.ensure = (...args) => { effects.refreshes.push(args); return ensure(...args); };
  return { store, state, resource, request, effects, enqueueReceipt: (...values) => receiptReplies.push(...values), enqueueRead: (...values) => readReplies.push(...values), start: () => store.reconcileOutputOperationReceipt("doc", "grant", "slot", "job") };
}

test("actual store method checks existing receipt and refreshes only Output data, even when source content expired", async () => {
  const f = await fixture(); const pending = f.start();
  assert.equal(f.effects.requests.length, 1);
  assert.equal(f.effects.requests[0][0], "/api/document-jobs/job/reconcile-output");
  assert.deepEqual(f.effects.requests[0][1], { method: "POST" });
  f.request.resolve(response(body()));
  assert.deepEqual(await pending, { status: "known", reconciled: true, refreshed: true });
  assert.deepEqual(f.effects.refreshes, [["doc", { force: true }]]);
  assert.equal(f.effects.jobs[0].jobId, "job");
});

test("unknown provider acceptance remains uncertain; the wrapper never submits a replacement", async () => {
  const f = await fixture(); const pending = f.start();
  f.request.resolve(response(body("uncertain", false)));
  assert.deepEqual(await pending, { status: "uncertain", reconciled: false, refreshed: true });
  assert.equal(f.effects.requests.length, 1);
});

test("wrong actor, job binding or Document never dispatches", async () => {
  for (const mutate of [(f) => { f.state.userId = "other"; }, (f) => { f.resource.snapshot.grants[0].operations[0].jobId = "other"; }, (f) => { f.resource.snapshot.documentId = "other"; }]) {
    const f = await fixture(); mutate(f);
    assert.equal((await f.start()).status, "forbidden");
    assert.equal(f.effects.requests.length, 0);
  }
});

test("scope changes before response JSON prevent reading or publishing the old result", async () => {
  const f = await fixture(); let reads = 0; const pending = f.start();
  f.state.scope = "scope-b";
  f.request.resolve({ ok: true, status: 200, json: async () => { reads++; return body(); } });
  assert.equal((await pending).status, "forbidden");
  assert.equal(reads, 0); assert.equal(f.effects.refreshes.length, 0); assert.equal(f.effects.jobs.length, 0);
});

test("personal project changes while JSON is pending are also scope changes", async () => {
  const f = await fixture(); const json = deferred(); const startedJson = deferred(); const pending = f.start();
  f.request.resolve({ ok: true, status: 200, json: async () => { startedJson.resolve(); return json.promise; } });
  await startedJson.promise; f.state.projectId = "other-project"; json.resolve(body());
  assert.equal((await pending).status, "forbidden");
  assert.equal(f.effects.refreshes.length, 0); assert.equal(f.effects.jobs.length, 0);
});

test("scope changes during the final Output refresh cannot publish a recovered job", async () => {
  const f = await fixture(); const refresh = deferred(); const startedRefresh = deferred();
  f.state.readResponse = async () => { startedRefresh.resolve(); return Response.json((await refresh.promise).snapshot); };
  const pending = f.start(); f.request.resolve(response(body()));
  await startedRefresh.promise; f.state.scope = "scope-b"; refresh.resolve(f.resource);
  assert.equal((await pending).status, "forbidden"); assert.equal(f.effects.jobs.length, 0);
});

test("wrong job, Document, grant or slot in the acknowledgment fails closed", async () => {
  for (const mutate of [(value) => { value.job.jobId = "other"; }, (value) => { value.job.documentId = "other"; }, (value) => { value.reconciliation.grantId = "other"; }, (value) => { value.reconciliation.slotId = "other"; }, (value) => { value.reconciliation.jobId = "other"; }, (value) => { value.reconciliation.documentId = "other"; }]) {
    const f = await fixture(); const value = body(); mutate(value); const pending = f.start(); f.request.resolve(response(value));
    assert.equal((await pending).status, "invalid"); assert.equal(f.effects.refreshes.length, 0); assert.equal(f.effects.jobs.length, 0);
  }
});

test("a committed check with unavailable refresh is not reported as a current delivery state", async () => {
  const f = await fixture(); f.state.readResponse = async () => Response.json({ error: "offline" }, { status: 503 });
  const pending = f.start(); f.request.resolve(response(body()));
  assert.deepEqual(await pending, { status: "known", reconciled: true, refreshed: false });
  assert.equal(f.effects.jobs.length, 0);
});

test("a nonterminal response cannot enqueue work through the free receipt check", async () => {
  for (const status of ["queued", "running", "committing"]) {
    const f = await fixture(); const value = body(); value.job.status = status;
    const pending = f.start(); f.request.resolve(response(value));
    assert.equal((await pending).status, "invalid");
    assert.equal(f.effects.jobs.length, 0); assert.equal(f.effects.refreshes.length, 0);
  }
});

test("loss of access during refresh discards the response even when the local session key is unchanged", async () => {
  const f = await fixture(); f.state.readResponse = async () => Response.json({ error: "forbidden" }, { status: 403 });
  const pending = f.start(); f.request.resolve(response(body()));
  assert.equal((await pending).status, "forbidden"); assert.equal(f.effects.jobs.length, 0);
});

test("free recovery method contains no queue-driving, legacy reconcile-provider, session POST or provider-fetch hook", () => {
  assert.doesNotMatch(method.getText(parsed), /syncDocumentJobs|#driveDocumentJobs|reconcile-provider|\/api\/session|\/api\/budgets|providerStatusUrl/u);
});
