import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { createOutputControllerFixture, OUTPUT_CONTROLLER_SCENARIOS, FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import * as requirements from "../src/model/output-requirements.ts";
import * as plans from "../src/model/output-plan.ts";
import * as assets from "../src/model/output-asset-inspection.ts";
import { outputOperationSupportReceipt } from "../src/components/output-operation-support-receipt.ts";

// Reuse the actual SQLite/Store and complete registered-controller/card renderer.
// Only existing fixture test registration is omitted; no production method is replaced.
// Deterministic HTTP/DOM ports are not browser or assistive-technology certification.
async function declarations(file, names) {
  const url = new URL(file, import.meta.url), raw = fs.readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && (ts.isCallExpression(node.expression) && node.expression.expression.getText(tree).startsWith("assert.")
      || ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken))
    .map(node => node.getText(tree)).join("\n") + "\nexport { " + names.join(",") + " };";
  url.search = "?output-snapshot-admission-r3-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === url.href ? { format: "module", source, shortCircuit: true } : next(request, context);
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}
const { sourceFixture, workers, outputPath, authoredState } = await declarations("./output-source-refresh.test.mjs", ["sourceFixture", "workers", "outputPath", "authoredState"]);
const synthetic = await createOutputControllerFixture({ domain: { ...requirements, ...plans, ...assets } });
const tick = () => new Promise(setImmediate), documentId = workers.doc;
const absent = (object, key) => { delete object[key]; };
const captureDraw = f => { try { f.draw(); return null; } catch (error) { return String(error); } };

async function fixture(t, options = {}) {
  const f = await sourceFixture(t, { retained: true, ...options });
  await f.refresh(); await f.flush();
  assert.equal(f.store.outputRequirements.resource(documentId).state, "ready");
  assert.ok(f.visible().includes(f.store.outputRequirements.resource(documentId).snapshot.requirements[0].spec.original_text));
  return f;
}
function modelSnapshot(f, scenario) {
  const snapshot = structuredClone(synthetic.seed(FIXTURE_DOCUMENT_IDS[0], scenario));
  const current = f.store.outputRequirements.resource(documentId).snapshot;
  // Rebind only the fixture's public route envelope to this actual Store's current
  // actor/document. The synthetic scenario remains explicitly synthetic evidence.
  snapshot.documentId = current.documentId; snapshot.projectId = current.projectId;
  snapshot.scope = structuredClone(current.scope);
  if (snapshot.confirmedPlan) snapshot.confirmedPlan.plan.document_id = current.documentId;
  return snapshot;
}
async function publish(f, snapshot) {
  let reads = 0;
  f.storeHost.intercept = request => outputPath(request) ? (reads++, Response.json(snapshot)) : undefined;
  const result = await f.store.outputRequirements.ensure(documentId, { force: true });
  assert.equal(reads, 1);
  return result;
}
async function richFixture(t, options = {}) {
  const f = await fixture(t, options), snapshot = modelSnapshot(f, "accepted-file");
  snapshot.grants = modelSnapshot(f, "native-timeout-unknown").grants;
  snapshot.scopeAmendments = [{ eventId: "amendment-original", previousPlanRevisionId: "prior-plan", planRevisionId: snapshot.confirmedPlan.revisionId,
    actorUserId: snapshot.scope.actorUserId, occurredAt: "2026-08-27T12:00:00.000Z", reason: "Retained scope history",
    withdrawnTargetIds: ["previous-target"], withdrawnObligationIds: ["previous-obligation"] }];
  assert.equal((await publish(f, snapshot)).state, "ready"); assert.equal(captureDraw(f), null);
  assert.ok(f.visible().includes(snapshot.requirements[0].spec.original_text));
  return f;
}
async function deniedAfterCandidate(f, { status, change, pendingBody = false, valid = false, operation = "read" }) {
  const saved = structuredClone(f.store.outputRequirements.resource(documentId).snapshot);
  const secret = saved.requirements[0].spec?.original_text ?? saved.requirements[0].content;
  const candidate = structuredClone(saved); candidate.revision = "snapshot-newer";
  change(candidate);
  const marker = "REJECTED_PRIVATE_CANDIDATE_DO_NOT_RETAIN";
  if (!valid) {
    candidate.rejectedPrivateCandidate = { text: marker };
    candidate.message = marker; candidate.errorValues = { secret: marker };
  }
  const oldHeaders = sceneDeferred(), body = sceneDeferred();
  let reads = 0, writes = 0;
  const identity = { clientMutationId: "original-snapshot-mutation", action: operation === "upload" ? "adopt" : "save" };
  f.storeHost.intercept = request => {
    if (outputPath(request)) return ++reads === 1 ? oldHeaders.promise : { status: 200, ok: true, json: () => body.promise };
    if (request.url === "/api/output-requirements" || request.url.startsWith("/api/output-requirements/assets?")) {
      writes++; return { status: 200, ok: true, json: () => body.promise };
    }
    return undefined;
  };
  const a = f.store.outputRequirements.ensure(documentId, { force: true });
  const b = operation === "read" ? f.store.outputRequirements.ensure(documentId, { force: true })
    : operation === "upload" ? f.store.outputRequirements.upload(documentId, new Blob(["owned bytes"]), { "x-output-client-mutation-id": identity.clientMutationId })
      : f.store.outputRequirements.command(documentId, { action: identity.action, clientMutationId: identity.clientMutationId, expectedRevision: saved.revision }, "save authored Output");
  await tick();
  const reply = operation === "read" ? candidate : { ok: true, replayed: false,
    command: { action: identity.action, eventId: "original-event" }, appended: [], snapshot: candidate };
  let beforeDraw = null, before = null, beforeMetadata = null, mutationResult = null;
  if (!pendingBody) {
    body.resolve(reply); mutationResult = await b;
    // A malformed successful command retains only its original receipt, with its
    // usual invalidation; do not invoke an unrelated automatic refresh here.
    if (operation === "read") beforeDraw = captureDraw(f);
    before = f.store.outputRequirements.resource(documentId);
    beforeMetadata = JSON.stringify(before.errorValues ?? {});
  }
  oldHeaders.resolve(new Response("{", { status })); await a;
  const afterDenialDraw = captureDraw(f);
  if (pendingBody) { body.resolve(reply); await b; }
  const after = f.store.outputRequirements.resource(documentId), finalDraw = captureDraw(f);
  assert.equal(beforeDraw, null, "No rejected candidate reaches willUpdate/render and strands old DOM");
  assert.equal(afterDenialDraw, null); assert.equal(finalDraw, null);
  if (valid && !pendingBody) {
    assert.equal(after.state, "ready"); assert.equal(after.snapshot.revision, "snapshot-newer");
    assert.notEqual(after.privateUnavailable, true); assert.ok(f.visible().includes(secret));
  } else {
    if (!pendingBody && operation === "read") {
      assert.equal(before.state, "unavailable"); assert.equal(before.snapshot.revision, saved.revision);
      assert.doesNotMatch(beforeMetadata, new RegExp(marker), "Rejected private JSON is not errorValues");
    }
    assert.equal(after.snapshot, null); assert.equal(after.privateUnavailable, true); assert.equal(after.accessLost, status !== 410);
    assert.equal(f.visible().includes(secret), false, "Current initialized full controller replaces all old private markup");
    assert.equal(JSON.stringify(after).includes(marker), false);
  }
  assert.equal(reads, operation === "read" ? 2 : 1); assert.equal(writes, operation === "read" ? 0 : 1);
  f.storeHost.intercept = undefined;
  if (operation === "read") f.noAuthoring();
  else {
    assert.equal(mutationResult.status, "unavailable"); assert.equal(mutationResult.body, null);
    assert.equal(mutationResult.receipt, undefined, "A malformed snapshot cannot manufacture a canonical acknowledgment");
    const request = f.newRequests().find(entry => entry.init.method === "POST");
    assert.ok(request);
    assert.equal(operation === "upload" ? new Headers(request.init.headers).get("x-output-client-mutation-id") : request.body.clientMutationId, identity.clientMutationId);
    assert.deepEqual(authoredState(f.db), f.before, "Mocked wire result changes no jobs, commitments, original receipts, holds, or cost counters");
    assert.equal(f.store.events.get(), f.initialEvents); assert.equal(f.store.content.get(), f.initialContent); assert.equal(f.store.head.get(), f.initialHead);
  }
  return { saved };
}

const shallow = {
  "missing permissions": v => absent(v, "permissions"),
  "missing grants": v => absent(v, "grants"),
  "shallow envelope only": v => { for (const key of Object.keys(v)) if (!["schemaVersion", "documentId", "projectId", "revision", "requirements", "scope"].includes(key)) delete v[key]; },
};
for (const locale of ["en", "fr", "ar", "ja"]) for (const status of [403, 410]) for (const [name, change] of Object.entries(shallow))
  test("actual full Output rejects " + name + " before older " + status + " / " + locale, async t => {
    const f = await fixture(t, { locale }); await deniedAfterCandidate(f, { status, change });
  });
for (const status of [403, 410]) for (const [name, change] of Object.entries(shallow))
  test("body-pending " + name + " cannot restore private Output after " + status, async t => {
    const f = await fixture(t); await deniedAfterCandidate(f, { status, change, pendingBody: true });
  });
for (const status of [403, 410]) for (const pendingBody of [false, true])
  test("valid whole Output proof / body pending " + pendingBody + " / older " + status, async t => {
    const f = await fixture(t); await deniedAfterCandidate(f, { status, change() {}, pendingBody, valid: true });
  });

const nested = {
  "missing summary": v => absent(v, "summary"),
  "permissions array": v => { v.permissions = []; },
  "permission string": v => { v.permissions.canRequest = "yes"; },
  "null requirement row": v => { v.requirements = [null]; },
  "nonarray spec deliverables": v => { v.requirements[0].spec.deliverables = {}; },
  "null spec quantity": v => { v.requirements[0].spec.deliverables[0].quantity = null; },
  "missing target states": v => absent(v, "targetStates"),
  "null target state": v => { v.targetStates = [null]; },
  "missing capabilities": v => absent(v, "capabilities"),
  "object file extension": v => { v.capabilities.supportedFileExtensions = [{}]; },
  "object limitation code": v => { v.capabilities.limitationCodes = [{}]; },
  "null confirmed plan body": v => { v.confirmedPlan.plan = null; },
  "null plan target": v => { v.confirmedPlan.plan.targets = [null]; },
  "missing blocking issues": v => absent(v.confirmedPlan.plan.targets[0], "blocking_issues"),
  "blocks scope without list": v => { v.confirmedPlan.plan.targets[0].source_scope = { kind: "blocks" }; },
  "topics coverage without list": v => { v.confirmedPlan.plan.targets[0].coverage = { kind: "topics" }; },
  "null obligation quantity": v => { v.confirmedPlan.plan.obligations[0].quantity = null; },
  "nonarray plan unresolved groups": v => { v.confirmedPlan.plan.unresolved_groups = {}; },
  "null asset": v => { v.assets = [null]; },
  "null asset inspection": v => { v.assets[0].inspection = null; },
  "null inspection facts": v => { v.assets[0].inspection.facts = null; },
  "object inspection width": v => { v.assets[0].inspection.facts.width = {}; },
  "null result": v => { v.results = [null]; },
  "missing result problems": v => absent(v.results[0], "problems"),
  "missing grant operations": v => absent(v.grants[0], "operations"),
  "null operation": v => { v.grants[0].operations = [null]; },
  "nonarray disclosure targets": v => { v.grants[0].disclosure.targets = {}; },
  "null disclosed target": v => { v.grants[0].disclosure.targets = [null]; },
  "nonarray summary actions": v => { v.summary.next_actions = {}; },
  "null summary action": v => { v.summary.next_actions = [null]; },
  "malformed per-requirement summary": v => { v.requirementSummaries = { [v.requirements[0].blockId]: "not-a-summary" }; },
  "malformed scope history": v => { v.scopeAmendments = {}; },
  "missing withdrawn target list": v => absent(v.scopeAmendments[0], "withdrawnTargetIds"),
  "nonobject confirmation options": v => { v.confirmedPlan.confirmationOptions = "not-options"; },
  "nonarray selected targets": v => { v.confirmedPlan.confirmationOptions.selected_target_ids = {}; },
  "malformed count policy": v => { v.requirements[0].planSuggestions = { count_policies: { count: [] } }; },
};
for (const [name, change] of Object.entries(nested))
  test("actual controller rejects nested mandatory shape: " + name, async t => {
    const f = await richFixture(t); await deniedAfterCandidate(f, { status: 410, change });
  });

for (const scenario of Object.keys(OUTPUT_CONTROLLER_SCENARIOS))
  test("actual Store admission and full controller preserve supported synthetic " + scenario, async t => {
    const f = await fixture(t), snapshot = modelSnapshot(f, scenario), before = structuredClone(snapshot);
    const resource = await publish(f, snapshot);
    assert.equal(resource.state, "ready", scenario); assert.equal(captureDraw(f), null, scenario);
    assert.deepEqual(resource.snapshot, before, "Admission never rewrites targets, source, private details, financial values, or acceptance");
    if (scenario === "large-target-plan") assert.equal(resource.snapshot.confirmedPlan.plan.targets.length, 1000);
    if (scenario === "partial") assert.deepEqual(resource.snapshot.targetStates, []);
    if (scenario === "source-unknown") assert.equal(resource.snapshot.sourceVerification, undefined);
    f.noAuthoring();
  });

const supportedMissing = {
  "legacy planning proposals": v => { delete v.requirements[0].planSuggestions; delete v.confirmedPlan.confirmationOptions; },
  "partial target contracts": v => { delete v.confirmedPlan.targetContractDigests; },
  "partial one target digest": v => { delete v.confirmedPlan.targetContractDigests[v.confirmedPlan.plan.targets[0].id]; },
  "unknown source metadata": v => { delete v.sourceVerification; },
  "unknown source capacity": v => { delete v.sourceVerification.capacity; },
  "unknown capacity and governance shapes": v => { v.sourceVerification.capacity = null; v.sourceVerification.governance = { sources: [null], captureBatchLimit: "unknown" }; },
  "unknown source status": v => { v.sourceVerification = { reasonCodes: [] }; },
  "missing legacy review eligibility": v => { delete v.results[0].reviewAllowed; delete v.results[0].independentReviewBlocked; },
  "missing optional summaries and history": v => { delete v.requirementSummaries; delete v.requirementFileCounts; delete v.scopeAmendments; },
  "missing optional limitation codes": v => { delete v.capabilities.limitationCodes; delete v.assets[0].inspection.limitationCodes; },
  "null unavailable summary": v => { v.summary = null; v.targetStates = []; },
  "unsupported preserved requirement": v => { const row = v.requirements[0]; row.status = "unsupported"; row.preserved = { schema_version: 2, unrecognized: { text: row.content } }; row.spec = null; },
  "invalid preserved requirement": v => { const row = v.requirements[0]; row.status = "invalid"; row.preserved = { schema_version: 1, deliverables: "unparsed authored content" }; row.spec = null; },
  "editable label-only draft": v => { v.requirements[0].status = "draft"; v.requirements[0].spec.label = ""; },
  "unknown primitive financial values": v => { const grant = v.grants[0], operation = grant.operations[0]; delete operation.usedMicrousd; operation.exposedMicrousd = null; operation.pendingCalls = null;
    grant.usedMicrousd = null; grant.exposedMicrousd = -1; grant.pendingCalls = undefined; },
};
for (const [name, change] of Object.entries(supportedMissing))
  test("actual full controller preserves " + name, async t => {
    const f = await richFixture(t), snapshot = structuredClone(f.store.outputRequirements.resource(documentId).snapshot);
    change(snapshot);
    const wire = JSON.parse(JSON.stringify(snapshot)), resource = await publish(f, wire);
    assert.equal(resource.state, "ready"); assert.equal(captureDraw(f), null);
    assert.deepEqual(resource.snapshot, wire);
    if (name === "unknown primitive financial values") {
      const grant = wire.grants[0], operation = grant.operations[0];
      const receipt = JSON.parse(outputOperationSupportReceipt(resource.snapshot, grant.id, operation.id, []));
      assert.equal(receipt.operation.accounting.recordedSpend, null);
      assert.equal(receipt.operation.accounting.unresolvedExposure, null);
      assert.equal(receipt.operation.accounting.unresolvedCalls, null);
      assert.equal(receipt.grant.accounting.recordedSpend, null);
      assert.equal(receipt.grant.accounting.unresolvedExposure, null);
    }
    f.noAuthoring();
  });

for (const operation of ["command", "upload"]) for (const status of [403, 410])
  test("malformed " + operation + " snapshot never certifies over old " + status + " and keeps original mutation identity", async t => {
    const f = await fixture(t); await deniedAfterCandidate(f, { status, operation, change: v => absent(v, "permissions") });
  });

test("invalid snapshot error metadata projects a code only, never the rejected private candidate", async t => {
  const f = await fixture(t), snapshot = structuredClone(f.store.outputRequirements.resource(documentId).snapshot);
  delete snapshot.grants; snapshot.error = "output_client_load_failed"; snapshot.message = "REJECTED_PRIVATE_ERROR_MESSAGE";
  snapshot.errorValues = { secret: "REJECTED_PRIVATE_ERROR_VALUES" }; snapshot.requirements[0].content = "REJECTED_PRIVATE_REQUIREMENT";
  const resource = await publish(f, snapshot);
  assert.equal(resource.state, "unavailable"); assert.equal(captureDraw(f), null);
  assert.deepEqual(resource.errorValues, { error: "output_client_load_failed" });
  assert.doesNotMatch(JSON.stringify(resource), /REJECTED_PRIVATE_/u);
  f.noAuthoring();
});

for (const status of [403, 410]) test("a deliberate valid exact read restores only after malformed proof and " + status + " withdrawal", async t => {
  const f = await richFixture(t), { saved } = await deniedAfterCandidate(f, { status, change: v => absent(v, "permissions") });
  const restored = await publish(f, saved);
  assert.equal(restored.state, "ready"); assert.notEqual(restored.privateUnavailable, true); assert.notEqual(restored.accessLost, true);
  assert.equal(captureDraw(f), null); assert.ok(f.visible().includes(saved.requirements[0].spec.original_text));
  assert.deepEqual(restored.snapshot, saved); f.noAuthoring();
});

for (const operation of ["command", "upload"]) for (const status of [401, 403, 410])
  test("actual initialized Store keeps exact content-free " + operation + " committed receipt on " + status, async t => {
    const f = await fixture(t), snapshot = f.store.outputRequirements.resource(documentId).snapshot;
    const clientMutationId = "original-committed-ack", action = operation === "upload" ? "adopt" : "save", eventId = "original-committed-event";
    const code = status === 410 ? "output_private_evidence_unavailable" : "output_execution_authority_revoked";
    const receipt = { committed: true, clientMutationId, action, eventId };
    const body = { ok: true, replayed: true, command: { action, eventId }, appended: [], snapshot: null, privateUnavailable: true, receipt, errorCode: code, error: code };
    let calls = 0;
    f.storeHost.intercept = request => request.init.method === "POST" ? (calls++, Response.json(body, { status })) : undefined;
    const result = operation === "upload"
      ? await f.store.outputRequirements.upload(documentId, new Blob(["owned bytes"]), { "x-output-client-mutation-id": clientMutationId })
      : await f.store.outputRequirements.command(documentId, { action, clientMutationId, expectedRevision: snapshot.revision }, "save authored Output");
    assert.equal(calls, 1); assert.deepEqual(result.receipt, receipt); assert.equal(result.body, null);
    assert.equal(result.status, status === 410 ? "saved" : "forbidden"); assert.equal(result.privateUnavailable, true);
    assert.equal(f.store.outputRequirements.resource(documentId).snapshot, null); assert.equal(captureDraw(f), null);
    assert.equal(f.visible().includes(snapshot.requirements[0].spec.original_text), false);
    assert.deepEqual(authoredState(f.db), f.before, "Acknowledgment neither replays the original mutation nor alters accounting");
  });
