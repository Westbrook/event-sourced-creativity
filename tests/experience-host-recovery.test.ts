import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceHostSourceLifetime } from "../src/experiences/host-source-lifetime.ts";
import { withExperienceReportFlag } from "../src/experiences/host-route.ts";
import { ExperienceOutputBindingClient, unavailableBinding, type ExperienceBindingIdentity } from "../src/experiences/output-binding-client.ts";
import type { ExperienceNativeState } from "../src/experiences/output-binding-contract.ts";

// Pure notification/transport simulation, not an executed host, Store projection or browser.
const origin = "https://forma.test";
const identity: ExperienceBindingIdentity = {
  draftId: "experience-draft-" + "d".repeat(64), draftHash: "e".repeat(64), releaseHash: "f".repeat(64),
  documentId: "document-original", projectId: "project-original", output: "slides", actorUserId: "user-original",
};
const basePath = `/api/experiences/drafts/${identity.draftId}/output`;

function originalState(status: "authorized" | "queued" | "succeeded"): ExperienceNativeState {
  const authorized = status === "authorized";
  const plan = { revisionId: "plan-original", targetId: "target-original", targetContractDigest: "contract-original",
    sourceDigest: "source-original", requirementsDigest: "requirements-original" };
  const preflight: NonNullable<ExperienceNativeState["preflight"]> = {
    id: "preflight-original", planRevisionId: plan.revisionId, termsDigest: "terms-original", sourceDigest: plan.sourceDigest,
    requirementsDigest: plan.requirementsDigest, maximumMicrousd: 42000, maximumCalls: 1,
    createdAt: "2026-09-12T12:00:00.000Z", expiresAt: "2026-09-12T12:30:00.000Z",
    targets: [{ targetId: plan.targetId, available: true, reason: "available", provider: "synthetic-provider", model: "synthetic-model",
      route: "synthetic-route", maximumMicrousd: 42000, maximumCalls: 1, maximumTokens: 1024, settings: { count: 5 }, transferDescription: "Synthetic source" }],
    operationAttempts: { "target-original": { ordinal: 1, previousSlotId: null } },
  };
  const original: NonNullable<ExperienceNativeState["original"]> = {
    authorization: { key: "authorize-original", eventId: "event-authorize-original" },
    run: authorized ? null : { key: "run-original", eventId: "event-run-original" },
    grantId: "grant-original", grantStatus: authorized ? "authorized" : "active",
    slotId: "slot-original", slotStatus: authorized ? "authorized" : status, jobId: "job-original", jobStatus: authorized ? "queued" : status,
    targetId: plan.targetId, targetContractDigest: plan.targetContractDigest, routeDigest: "route-original", planRevisionId: plan.revisionId,
    sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest, correlationId: "correlation-original",
    expiresAt: "2026-09-12T13:00:00.000Z", jobExpiresAt: "2026-09-12T13:00:00.000Z",
  };
  return {
    version: 1, ...identity, sourceSurface: "outputs", status, disposition: authorized ? "original_authorized" : "original_run_recorded",
    stage: authorized ? "authorize" : "run", current: { custody: "verified", source: "verified", sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest },
    plan, preflight, original, permitted: { prepare: false, authorize: false, run: authorized, resumeRun: false },
    grant: { id: original.grantId, planRevisionId: plan.revisionId, actorUserId: identity.actorUserId, payerUserId: identity.actorUserId,
      status: authorized ? "authorized" : "active", maximumMicrousd: 42000, maximumCalls: 1,
      usedMicrousd: 0, exposedMicrousd: authorized ? 0 : 42000, usedCalls: 0, pendingCalls: authorized ? 0 : 1,
      expiresAt: original.expiresAt, disclosure: structuredClone(preflight),
      operations: [{ id: original.slotId, targetId: plan.targetId, targetLabel: "Slides", jobId: original.jobId, status: original.slotStatus,
        maximumMicrousd: 42000, maximumCalls: 1, usedMicrousd: 0, exposedMicrousd: authorized ? 0 : 42000, usedCalls: 0, pendingCalls: authorized ? 0 : 1 }] },
  };
}

function response(value: ExperienceNativeState, path = basePath) {
  const result = new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  Object.defineProperty(result, "url", { value: new URL(path, origin).href });
  return result;
}

test("source lifetime closes paid controls on revision drift without destroying passive original recovery", () => {
  const lifetime = new ExperienceHostSourceLifetime();
  const initial = lifetime.observe(true, true);
  assert.deepEqual(initial, { retired: false, readable: true, paidSourceCurrent: true }); assert.ok(Object.isFrozen(initial));
  const drifted = lifetime.observe(true, false);
  assert.deepEqual(drifted, { retired: false, readable: true, paidSourceCurrent: false }); assert.ok(Object.isFrozen(drifted));
  assert.deepEqual(lifetime.observe(true, false), drifted);
  assert.deepEqual(lifetime.observe(true, true), initial);
});

test("base custody loss or explicit retirement irreversibly retires a source lifetime", () => {
  const lost = new ExperienceHostSourceLifetime();
  assert.deepEqual(lost.observe(false, true), { retired: true, readable: false, paidSourceCurrent: false });
  assert.deepEqual(lost.observe(true, true), { retired: true, readable: false, paidSourceCurrent: false });
  assert.deepEqual(lost.observe(true, false), { retired: true, readable: false, paidSourceCurrent: false });
  const retired = new ExperienceHostSourceLifetime(); retired.retire();
  assert.deepEqual(retired.observe(true, true), { retired: true, readable: false, paidSourceCurrent: false });
});

test("output-block revision notification can abort pending acknowledgment and recover the exact original with GET only", { timeout: 1000 }, async () => {
  const lifetime = new ExperienceHostSourceLifetime();
  let observed = lifetime.observe(true, true), sourceRevision = 1, requestRevision = 1;
  let finishOriginal!: (value: Response) => void;
  const pendingOriginal = new Promise<Response>(resolve => { finishOriginal = resolve; });
  const replies: Array<Response | Promise<Response>> = [response(originalState("authorized")), pendingOriginal, response(originalState("queued"))];
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const request: typeof fetch = async (path, init = {}) => {
    calls.push({ path: String(path), init }); const reply = replies.shift(); assert.ok(reply); return reply;
  };
  const client = new ExperienceOutputBindingClient(identity, {
    origin, current: () => observed.readable && requestRevision === sourceRevision, request, timeoutMs: 20000,
  });
  await client.read(); assert.ok("original" in client.state && client.state.original);
  const authorized = client.state;
  assert.equal(observed.paidSourceCurrent, true); assert.equal(authorized.permitted.run, true);
  const operation = client.command("run", authorized); assert.equal(client.pending, true);

  // Simulates the expected deterministic Output block publishing a new source revision
  // while native POST acknowledgment is still in flight. No real projection is executed.
  sourceRevision = 2; observed = lifetime.observe(true, false);
  assert.equal(observed.paidSourceCurrent, false); assert.equal(observed.readable, true); assert.equal(observed.retired, false);
  client.dispose(); await operation;
  assert.equal(calls[1].init.signal!.aborted, true); assert.equal(client.pending, false);
  assert.deepEqual(client.state, unavailableBinding("withdrawn"));

  // Explicit passive recovery captures the now-stable revision. It does not reopen
  // paid controls or create a replacement submission/identity.
  requestRevision = sourceRevision; await client.read();
  assert.ok("original" in client.state && client.state.original);
  const recovered = client.state;
  assert.ok(recovered.original);
  assert.equal(recovered.status, "queued"); assert.deepEqual(recovered.permitted, { prepare: false, authorize: false, run: false, resumeRun: false });
  for (const key of ["grantId", "slotId", "jobId", "correlationId"] as const) assert.equal(recovered.original[key], authorized.original![key]);
  assert.equal(observed.paidSourceCurrent, false);
  await client.command("run", authorized); await client.command("run", recovered); await client.command("resumeRun", recovered);
  assert.deepEqual(calls.map(call => call.init.method), ["GET", "POST", "GET"]);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { draftHash: identity.draftHash, grantId: "grant-original", explicitRun: true });
  assert.deepEqual(calls.map(call => call.path), [basePath, basePath + "/run", basePath]);
  finishOriginal(response(originalState("succeeded"), basePath + "/run"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(client.state, recovered); assert.equal(client.pending, false);
});

test("base custody retirement blocks even an explicit subsequent original lookup", async () => {
  const lifetime = new ExperienceHostSourceLifetime(); let observed = lifetime.observe(true, true), requests = 0;
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => observed.readable,
    request: async () => { requests++; return response(originalState("authorized")); } });
  await client.read(); assert.equal(requests, 1);
  observed = lifetime.observe(false, false); client.dispose();
  observed = lifetime.observe(true, true); await client.read();
  assert.equal(requests, 1); assert.deepEqual(client.state, unavailableBinding("withdrawn"));
});

test("report flag forwards presence only while preserving exact artifact revision, hash and Document scope", () => {
  const hash = "a".repeat(64);
  const destination = `/library/artifact/artifact-original?document=document-original&revision=0&intent=inspect&sha256=${hash}#artifact`;
  const source = `/document/document-original?experience=slides&experience-draft=${identity.draftId}&progress-report=https%3A%2F%2Fother.test%2Freturn&returnUrl=https%3A%2F%2Fother.test&arbitrary=extra`;
  const result = new URL(withExperienceReportFlag(destination, source), origin);
  assert.equal(result.pathname, "/library/artifact/artifact-original"); assert.equal(result.hash, "#artifact");
  assert.equal(result.searchParams.get("document"), "document-original"); assert.equal(result.searchParams.get("revision"), "0");
  assert.equal(result.searchParams.get("sha256"), hash); assert.equal(result.searchParams.get("intent"), "inspect");
  assert.equal(result.searchParams.has("progress-report"), true); assert.equal(result.searchParams.get("progress-report"), "");
  assert.deepEqual([...result.searchParams.keys()].sort(), ["document", "intent", "progress-report", "revision", "sha256"]);
});

test("report flag keeps invalid output selection fallback on /experiences without copying selectors", () => {
  const source = "/document/document-original?experience=unsupported&experience-draft=invalid&progress-report=arbitrary&returnUrl=%2Fadvanced";
  assert.equal(withExperienceReportFlag("/experiences", source), "/experiences?progress-report=");
  assert.equal(withExperienceReportFlag("/experiences", "/document/document-original?experience=unsupported"), "/experiences");
  assert.equal(withExperienceReportFlag("/experiences", "https://other.test/?progress-report"), "/experiences");
  assert.equal(withExperienceReportFlag("/experiences", "/document/document-original#?progress-report"), "/experiences");
});

test("report flag rejects nonlocal destinations and never uses a source return URL as the destination", () => {
  for (const destination of ["https://other.test/", "https://forma.local/experiences", "//other.test/path", "javascript:alert(1)",
    "relative/path", "/\\other.test/path", "/experiences\n", "/" + "x".repeat(4096)]) {
    assert.throws(() => withExperienceReportFlag(destination, "/document/document-original?progress-report"), TypeError, destination);
  }
  const source = "/document/document-original?progress-report=%2Fadvanced&returnUrl=https%3A%2F%2Fother.test";
  assert.equal(withExperienceReportFlag("/document/document-original", source), "/document/document-original?progress-report=");
});
