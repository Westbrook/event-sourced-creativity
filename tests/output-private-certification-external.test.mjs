import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// The existing fixtures execute complete Store/controller/Worker code against
// in-memory SQLite. Their provider setup is mocked; all recovery is read-only.
async function declarations(file, names) {
  const url = new URL(file, import.meta.url), raw = fs.readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && (ts.isCallExpression(node.expression) && node.expression.expression.getText(tree).startsWith("assert.")
      || ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken))
    .map(node => node.getText(tree)).join("\n") + "\nexport { " + names.join(",") + " };";
  url.search = "?output-private-certification-r3-external-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === url.href ? { format: "module", source, shortCircuit: true } : next(request, context);
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}
const native = await declarations("./output-native-recovery.test.mjs", ["recoveryFixture"]);
const source = await declarations("./output-source-refresh.test.mjs", ["sourceFixture", "workers", "sourcePath", "outputPath"]);
const receipt = await declarations("./output-operation-receipt-privacy.test.mjs", ["fullFixture", "receiptFixture", "bodyGate", "hidden", "tick"]);
const gateBody = receipt.bodyGate;
const tick = receipt.tick;
function hidden(store, documentId, accessLost) {
  const resource = store.outputRequirements.resource(documentId);
  assert.equal(resource.snapshot, null); assert.equal(resource.privateUnavailable, true); assert.equal(resource.accessLost, accessLost);
}
function settle(gate, completion, snapshot) {
  gate.finish(completion === "malformed" ? "{" : completion === "http-error" ? { error: "service_unavailable" } : snapshot);
}
function ordinaryRefresh(f) {
  f.ui.draw();
  const button = f.ui.renderer.ownNodes(f.ui.host, "button").find(node => node.handlers.click?.toString().includes("#refresh(true)"));
  assert.ok(button, "Actual Refresh outputs remains available while exact inspection is pending");
  return button.handlers.click.call(f.ui.host, { currentTarget: button, preventDefault() {} });
}

for (const status of [401, 403, 404, 410]) for (const headers of ["before-denial", "after-denial"])
  for (const completion of ["valid", "http-error", "malformed"])
    test("native exact inspection " + status + " / Output refresh headers " + headers + " / " + completion, async t => {
      const f = await native.recoveryFixture(t, { shared: true }), before = f.business(), saved = structuredClone(f.fresh());
      const oldHeaders = sceneDeferred(), nextHeaders = sceneDeferred(), body = gateBody(completion === "http-error" ? 500 : 200);
      let inspections = 0, reads = 0;
      f.host.intercept = request => request.url.endsWith("?inspection=1") ? (inspections++, oldHeaders.promise)
        : request.url.startsWith("/api/output-requirements?") ? (reads++, headers === "before-denial" ? body.response : nextHeaders.promise) : undefined;
      const a = f.clickInspect(); await untilScene(() => inspections === 1);
      const b = ordinaryRefresh(f); await untilScene(() => reads === 1); await tick();
      oldHeaders.resolve(new Response("{", { status })); await a; f.ui.draw();
      hidden(f.host.store, f.worker.documentId, status === 401 || status === 403); assert.equal(f.form(), undefined);
      const duplicate = f.host.store.outputRequirements.ensure(f.worker.documentId); assert.equal(reads, 1);
      if (headers === "after-denial") { nextHeaders.resolve(body.response); await tick(); }
      settle(body, completion, saved); await Promise.all([b, duplicate]); f.ui.draw();
      if (completion === "valid" && headers === "after-denial") {
        assert.equal(f.fresh().revision, saved.revision); assert.notEqual(f.host.store.outputRequirements.resource(f.worker.documentId).privateUnavailable, true);
      } else hidden(f.host.store, f.worker.documentId, status === 401 || status === 403);
      assert.equal(f.form(), undefined, "Restoring Output does not silently repeat the original job read");
      assert.equal(inspections, 1); assert.equal(reads, 1); assert.deepEqual(f.business(), before); f.noNewWork();
    });

for (const status of [401, 403, 404, 410]) for (const headers of ["before-denial", "after-denial"])
  for (const completion of ["valid", "http-error", "malformed"])
    test("source-index recovery " + status + " / pending Output headers " + headers + " / " + completion, async t => {
      const f = await source.sourceFixture(t, { retained: true }), documentId = source.workers.doc, saved = structuredClone(f.store.outputRequirements.resource(documentId).snapshot);
      const oldHeaders = sceneDeferred(), nextHeaders = sceneDeferred(), body = gateBody(completion === "http-error" ? 500 : 200);
      let sourceReads = 0, outputReads = 0;
      f.storeHost.intercept = request => source.sourcePath(request) ? (sourceReads++, oldHeaders.promise)
        : source.outputPath(request) ? (outputReads++, headers === "before-denial" ? body.response : nextHeaders.promise) : undefined;
      const a = f.refresh(); await untilScene(() => sourceReads === 1);
      const b = f.store.outputRequirements.ensure(documentId, { force: true }); await untilScene(() => outputReads === 1); await tick();
      oldHeaders.resolve(new Response("{", { status })); await a; f.draw();
      hidden(f.store, documentId, status !== 410);
      const duplicate = f.store.outputRequirements.ensure(documentId); assert.equal(outputReads, 1);
      if (headers === "after-denial") { nextHeaders.resolve(body.response); await tick(); }
      settle(body, completion, saved); await Promise.all([b, duplicate]); f.draw();
      if (completion === "valid" && headers === "after-denial") {
        assert.equal(f.store.outputRequirements.resource(documentId).snapshot.revision, saved.revision);
        assert.notEqual(f.store.outputRequirements.resource(documentId).privateUnavailable, true);
      } else hidden(f.store, documentId, status !== 410);
      assert.equal(sourceReads, 1); assert.equal(outputReads, 1); f.noAuthoring();
    });

for (const headers of ["before-denial", "after-denial"]) test("a pending newer receipt keeps its handle but cannot publish pre-withdrawal job bytes / " + headers, async () => {
  const f = await receipt.fullFixture(), a = f.start(), body = gateBody(), bHeaders = sceneDeferred();
  f.enqueueReceipt(headers === "before-denial" ? body.response : bHeaders.promise);
  const b = f.start(); await tick();
  f.request.resolve(Response.json({ error: "denied" }, { status: 410 })); await a; receipt.hidden(f, 410);
  const reads = f.effects.reads.length;
  if (headers === "after-denial") {
    f.enqueueRead(Response.json({ ...structuredClone(f.privateSnapshot), revision: "receipt-owned-later" }));
    bHeaders.resolve(body.response); await tick();
  }
  body.finish(receipt.receiptFixture.body()); const result = await b;
  if (headers === "before-denial") {
    receipt.hidden(f, 410); assert.equal(result.status, "unavailable"); assert.equal(f.effects.reads.length, reads);
  } else {
    assert.equal(result.status, "known"); assert.equal(result.refreshed, true);
    assert.equal(f.client.resource("doc").snapshot.revision, "receipt-owned-later");
    assert.equal(f.effects.reads.length, reads + 1, "only the original receipt's existing follow-up Output read");
  }
  assert.equal(f.effects.requests.length, 2, "two deliberately started original checks, never a retry");
});

for (const headers of ["before-denial", "after-denial"]) test("newer exact job headers " + headers + " never recertify the whole Output resource", async t => {
  const f = await native.recoveryFixture(t), oldHeaders = sceneDeferred(), newHeaders = sceneDeferred(), body = gateBody();
  const saved = structuredClone(f.fresh()); let outputReads = 0, inspections = 0;
  f.host.intercept = request => request.url.startsWith("/api/output-requirements?") ? (outputReads++, oldHeaders.promise)
    : request.url.endsWith("?inspection=1") ? (inspections++, headers === "before-denial" ? body.response : newHeaders.promise) : undefined;
  const a = f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true }); await untilScene(() => outputReads === 1);
  const b = f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true); await untilScene(() => inspections === 1); await tick();
  oldHeaders.resolve(Response.json({ error: "output_private_evidence_unavailable" }, { status: 410 })); await a;
  hidden(f.host.store, f.worker.documentId, false);
  if (headers === "after-denial") { newHeaders.resolve(body.response); await tick(); }
  body.finish({ job: f.job }); const result = await b;
  if (headers === "before-denial") assert.equal(result.job, null);
  else { assert.equal(result.status, "found"); assert.equal(result.job.jobId, f.job.jobId); }
  hidden(f.host.store, f.worker.documentId, false);
  assert.equal(saved.documentId, f.worker.documentId);
  f.noNewWork();
});

for (const shared of [false, true]) test("actual Worker job 200 cannot override older Output 410 after the plan body is erased / " + shared, async t => {
  const f = await native.recoveryFixture(t, { shared }), before = f.business(), headers = sceneDeferred();
  let outputReads = 0;
  f.host.intercept = request => request.url.startsWith("/api/output-requirements?") ? (outputReads++, headers.promise) : undefined;
  const a = f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true }); await untilScene(() => outputReads === 1);
  const event = f.worker.sqlite.prepare("SELECT confirmed_event_id FROM output_plan_revisions WHERE plan_revision_id=?").get(f.plan.planId);
  assert.ok(event);
  const removed = f.worker.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.confirmed_event_id);
  assert.equal(removed.changes, 1, "erase only the original Output plan private body in this in-memory fixture");
  const denial = await f.applicationRequest("/api/output-requirements?documentId=" + encodeURIComponent(f.worker.documentId));
  assert.equal(denial.status, 410, await denial.clone().text());
  const b = await f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true);
  assert.equal(b.status, "found"); assert.equal(b.job.jobId, f.job.jobId, "the exact existing job is still independently readable");
  headers.resolve(denial); await a;
  hidden(f.host.store, f.worker.documentId, false); f.ui.draw(); assert.equal(f.form(), undefined);
  assert.equal(f.worker.sqlite.prepare("SELECT job_id FROM document_jobs").get().job_id, f.job.jobId);
  assert.deepEqual(f.business(), before, "job, reservation, usage and ledger evidence is untouched");
  f.noNewWork();
});


for (const status of [403, 404]) test("a completed proof for a different actual job cannot neutralize this original job's " + status, async t => {
  const f = await native.recoveryFixture(t, { medium: "image" });
  const nextTarget = f.plan.targetIds.find(id => id !== f.targetId); assert.ok(nextTarget);
  const preflight = await f.worker.ok(await f.worker.send({ action: "preflight", planRevisionId: f.plan.planId, targetIds: [nextTarget] }));
  const terms = preflight.command.preflight;
  const grant = await f.worker.ok(await f.worker.send({ action: "authorize", preflightId: terms.id, termsDigest: terms.termsDigest,
    maximumMicrousd: terms.maximumMicrousd, explicitAuthorization: true }, "certification-second-existing-target"));
  await f.worker.ok(await f.worker.startAndDrive({ action: "run", grantId: grant.command.grantId }));
  const second = f.worker.sqlite.prepare("SELECT job_id FROM document_jobs WHERE job_id<>?").get(f.job.jobId);
  assert.ok(second, "the second job is created through ordinary native handlers, not a fabricated feed row");
  await f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true });
  const before = f.business(), paid = f.providerCalls, oldHeaders = sceneDeferred(); let older = false;
  f.host.intercept = request => request.url === "/api/document-jobs/" + f.job.jobId + "?inspection=1" ? (older = true, oldHeaders.promise) : undefined;
  const a = f.host.store.inspectOutputNativeJob(f.worker.documentId, f.job.jobId, () => true); await untilScene(() => older);
  const b = await f.host.store.inspectOutputNativeJob(f.worker.documentId, second.job_id, () => true);
  assert.equal(b.status, "found"); assert.equal(b.job.jobId, second.job_id);
  oldHeaders.resolve(new Response("{", { status })); await a;
  hidden(f.host.store, f.worker.documentId, status === 403);
  assert.equal(b.current(), false, "the transport proof does not preserve an Output view across a distinct private withdrawal");
  assert.deepEqual(f.business(), before); assert.equal(f.providerCalls, paid);
  assert.equal(f.host.requests.some(request => /\/(?:run|retry|recover|reconcile-output)(?:\?|$)/u.test(request.url)), false);
});

for (const headers of ["before-denial", "after-denial"]) test("source metadata 200 is not whole-Output certification while its follow-up body is pending / " + headers, async t => {
  const f = await source.sourceFixture(t, { retained: true }), documentId = source.workers.doc;
  const projection = f.store.projection.get(), context = f.store.session.get().projectContext;
  const target = { authorization: f.store.captureAuthorizationScope(), projectId: projection.projectId, documentId,
    currentDocumentId: projection.documentId, route: f.store.route.get(), organizationId: context.organizationId, projectAccessId: context.projectAccessId };
  const oldHeaders = sceneDeferred(), nextHeaders = sceneDeferred(), body = gateBody(); let outputReads = 0, sourceReads = 0;
  f.storeHost.intercept = request => {
    if (source.sourcePath(request)) { sourceReads++; return undefined; }
    if (source.outputPath(request)) return ++outputReads === 1 ? oldHeaders.promise : headers === "before-denial" ? body.response : nextHeaders.promise;
  };
  const a = f.store.outputRequirements.ensure(documentId, { force: true }); await untilScene(() => outputReads === 1);
  const b = f.store.refreshOutputSource(target); await untilScene(() => outputReads === 2); await tick();
  assert.equal(sourceReads, 1, "the ordinary selected-project GET really completed before the Output follow-up");
  const verified = await f.storeHost.worker.request("/api/output-requirements?documentId=" + encodeURIComponent(documentId));
  assert.equal(verified.status, 200); const snapshot = await verified.json();
  oldHeaders.resolve(Response.json({ error: "output_private_evidence_unavailable" }, { status: 410 })); await a;
  hidden(f.store, documentId, false);
  const duplicate = f.store.outputRequirements.ensure(documentId); assert.equal(outputReads, 2);
  if (headers === "after-denial") { nextHeaders.resolve(body.response); await tick(); }
  body.finish(snapshot); await Promise.all([b, duplicate]); f.draw();
  if (headers === "before-denial") hidden(f.store, documentId, false);
  else { assert.equal(f.store.outputRequirements.resource(documentId).state, "ready"); assert.equal(f.store.outputRequirements.resource(documentId).snapshot.revision, snapshot.revision); }
  assert.equal(sourceReads, 1); assert.equal(outputReads, 2); f.noAuthoring();
});

for (const headers of ["before-denial", "after-denial"]) test("a verified receipt alone cannot certify old Output or copy pre-withdrawal job data after its follow-up / " + headers, async () => {
  const f = await receipt.fullFixture(), a = f.start(), body = gateBody(), response = sceneDeferred();
  f.enqueueReceipt(Response.json(receipt.receiptFixture.body()));
  f.enqueueRead(headers === "before-denial" ? body.response : response.promise);
  const b = f.start(); await untilScene(() => f.effects.reads.length === f.initialReads + 1); await tick();
  f.request.resolve(Response.json({ error: "output_private_evidence_unavailable" }, { status: 410 })); await a; receipt.hidden(f, 410);
  const duplicate = f.client.ensure("doc"); assert.equal(f.effects.reads.length, f.initialReads + 1);
  if (headers === "after-denial") { response.resolve(body.response); await tick(); }
  body.finish({ ...structuredClone(f.privateSnapshot), revision: "current-output-only" }); await Promise.all([b, duplicate]);
  if (headers === "before-denial") receipt.hidden(f, 410);
  else assert.equal(f.client.resource("doc").snapshot.revision, "current-output-only");
  assert.deepEqual(f.effects.jobs, f.heldJob, "the delayed pre-withdrawal job body was never freshly certified by the Output response");
  assert.equal(f.effects.requests.length, 2); assert.equal(f.effects.reads.length, f.initialReads + 1);
});

for (const proof of ["pending-failure", "completed-current-output"]) test("actual shared Worker inspection 403 is only superseded by " + proof, async t => {
  const f = await native.recoveryFixture(t, { shared: true }), before = f.business(), older = sceneDeferred(), waiting = sceneDeferred();
  let inspected = 0, outputReads = 0;
  f.host.intercept = request => request.url.endsWith("?inspection=1") ? (inspected++, older.promise)
    : proof === "pending-failure" && request.url.startsWith("/api/output-requirements?") ? (outputReads++, waiting.promise) : undefined;
  const a = f.clickInspect(); await untilScene(() => inspected === 1);
  f.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.worker.contextId);
  const denied = await f.applicationRequest("/api/document-jobs/" + f.job.jobId + "?inspection=1");
  assert.equal(denied.status, 403, "this denial is produced by the real scoped Worker");
  let b;
  if (proof === "completed-current-output") {
    f.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(f.worker.contextId);
    const result = await f.host.store.outputRequirements.ensure(f.worker.documentId, { force: true });
    assert.equal(result.state, "ready"); b = Promise.resolve();
  } else {
    b = ordinaryRefresh(f); await untilScene(() => outputReads === 1);
  }
  older.resolve(denied); await a; f.ui.draw();
  if (proof === "pending-failure") {
    hidden(f.host.store, f.worker.documentId, true);
    waiting.resolve(new Response("{", { status: 500 })); await b; hidden(f.host.store, f.worker.documentId, true);
  } else {
    assert.equal(f.host.store.outputRequirements.resource(f.worker.documentId).state, "ready");
    assert.notEqual(f.host.store.outputRequirements.resource(f.worker.documentId).privateUnavailable, true);
  }
  assert.equal(f.form(), undefined); assert.deepEqual(f.business(), before); f.noNewWork();
});
