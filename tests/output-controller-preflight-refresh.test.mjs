// Independent unit-boundary review regression. The controller AST, FormaStore public
// command wrapper, OutputRequirementsClient, and readiness helpers are actual source.
// The observer explicitly invokes real willUpdate on each actual client notification.
// Lit scheduling/DOM, server JSON, authorization, provider, and native input are fake.
// This is NOT a browser, server-authority, paid-provider, or AT qualification.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const { controllerFixture, deferred, eventHandlers, loadStoreMethods, startPreflight, templates } =
  await import(pathToFileURL(resolve(root, "tests/output-ui-source-harness.mjs")));
const { OutputRequirementsClient } =
  await import(pathToFileURL(resolve(root, "src/state/output-requirements-client.ts")));
const { OUTPUT_NATIVE_EXECUTION_POLICY } =
  await import(pathToFileURL(resolve(root, "src/model/output-execution-policy.ts")));

function currentOffer(snapshot, alternative) {
  const targetId = snapshot.confirmedPlan.plan.targets[0].id;
  return {
    id: "synthetic-current-preflight", planRevisionId: snapshot.confirmedPlan.revisionId,
    sourceDigest: snapshot.sourceRevision, requirementsDigest: snapshot.requirementRevision,
    termsDigest: "synthetic-terms", maximumMicrousd: 100_000, maximumCalls: 2,
    createdAt: "2026-08-27T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    operationAttempts: { [targetId]: { ordinal: alternative ? 2 : 1, previousSlotId: alternative ? "failed-slot" : null } },
    targets: [{ targetId, available: true, provider: "SYNTHETIC", model: "fixture",
      reason: "Synthetic availability only", reasonCode: "output_native_image_ready", reasonValues: {},
      transferCode: "output_transfer_document_after_authorization", transferDescription: "No real transfer",
      route: "fixture", maximumTokens: 0, maximumMicrousd: 100_000, maximumCalls: 2,
      settings: { executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY } }],
  };
}
function renderedOffer(controller) {
  return templates(controller.render()).some((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"')));
}

async function actualTransportFixture(alternative, { malformedCommit = false } = {}) {
  const f = await controllerFixture();
  let serverSnapshot = structuredClone(f.snapshots.get("doc-a"));
  if (alternative) {
    const accounting = { maximumMicrousd: 100_000, maximumCalls: 2, usedMicrousd: 50_000,
      usedCalls: 1, exposedMicrousd: 0, pendingCalls: 0 };
    serverSnapshot.grants = [{ id: "failed-grant", planRevisionId: serverSnapshot.confirmedPlan.revisionId,
      actorUserId: serverSnapshot.scope.actorUserId, payerUserId: serverSnapshot.scope.actorUserId,
      status: "completed", expiresAt: "2099-01-01T00:00:00.000Z", disclosure: currentOffer(serverSnapshot, false),
      ...accounting, operations: [{ id: "failed-slot", targetId: serverSnapshot.confirmedPlan.plan.targets[0].id,
        jobId: "failed-job", status: "failed", ...accounting }] }];
    f.store.documentJobs.get = () => [{ jobId: "failed-job", documentId: "doc-a", kind: "generate", status: "failed" }];
  }
  const offer = currentOffer(serverSnapshot, alternative);
  const refreshResponse = deferred(), refreshEntered = deferred();
  const network = [], states = [], notifications = [];
  let lastPublishedResource;
  let readCount = 0, eventRefreshCount = 0;
  const scope = { key: f.store.captureAuthorizationScope().key, projectId: "fixture-project" };
  const client = new OutputRequirementsClient({
    captureScope: () => scope,
    scopeActive: (captured) => captured.key === scope.key && captured.projectId === scope.projectId,
    // Structural fixture admission is a test double; it does not establish server authority.
    isSnapshot: (value, documentId, captured) => value?.documentId === documentId
      && value.projectId === captured.projectId && typeof value.revision === "string",
    fetch: async (path, init) => {
      network.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
      if (init?.method === "POST") {
        // Real preflight saves a receipt; only the row/head revision advances here.
        serverSnapshot = { ...serverSnapshot, revision: "2" };
        if (malformedCommit) return Response.json({ snapshot: serverSnapshot, command: { preflight: offer } });
        // SIMULATED canonical envelope; identities come from this exact request.
        // The old incomplete envelope remains a separate unknown-owner negative.
        const command = JSON.parse(init.body);
        assert.equal(command.action, "preflight"); assert.equal(command.documentId, serverSnapshot.documentId);
        return Response.json({ ok: true, replayed: false, appended: [], snapshot: serverSnapshot,
          command: { action: command.action, eventId: "simulated-preflight-event", preflight: offer } });
      }
      readCount += 1;
      if (readCount === 1) return Response.json(serverSnapshot);
      assert.equal(readCount, 2, "the real wrapper should force exactly one post-commit GET");
      refreshEntered.resolve();
      return refreshResponse.promise;
    },
    notify: () => {
      const resource = client.resource("doc-a");
      notifications.push(resource.state);
      // Write-owner notifications are not resource publications. Still invoke
      // the actual observer on every notification, including those extra signals.
      if (resource !== lastPublishedResource) { states.push(resource.state); lastPublishedResource = resource; }
      // Simulate the observer consuming each real scoped-client publication.
      f.controller.willUpdate(new Map());
    },
  });
  f.store.outputRequirements = client;
  f.store.refreshEvents = async () => { eventRefreshCount += 1; };
  const actualStore = await loadStoreMethods();
  f.store.outputRequirementCommand = actualStore.outputRequirementCommand.bind(f.store);
  await client.ensure("doc-a");
  f.controller.willUpdate(new Map());
  states.length = 0; notifications.length = 0;
  const start = () => {
    if (!alternative) return startPreflight(f);
    const callback = eventHandlers(f.controller.render(), "click").find((candidate) => candidate.toString().includes("#alternative("));
    assert.ok(callback, "the actual failed-attempt alternative action must be rendered");
    return callback.call(f.controller);
  };
  return { ...f, client, network, states, notifications, refreshEntered, offer, start,
    completeRefresh: (mutate) => {
      const next = structuredClone(serverSnapshot);
      mutate?.(next);
      refreshResponse.resolve(Response.json(next));
    },
    get eventRefreshCount() { return eventRefreshCount; },
  };
}

for (const alternative of [false, true]) {
  for (const scenario of ["unchanged", "source-replaced", "source-proof-lost"]) {
    test(`actual ${alternative ? "alternative" : "initial"} preflight survives its own forced GET only with ${scenario} current authority`, async () => {
      const f = await actualTransportFixture(alternative);
      const pending = f.start();
      await f.refreshEntered.promise;
      assert.equal(f.client.resource("doc-a").state, "refreshing");
      assert.equal(renderedOffer(f.controller), false, "a reply cannot enable authorization while refreshed authority is pending");
      f.completeRefresh((next) => {
        if (scenario === "source-replaced") {
          next.sourceRevision = "source-2";
          next.confirmedPlan.sourceDigest = "source-2";
          next.confirmedPlan.revisionId = "new-confirmed-plan";
        } else if (scenario === "source-proof-lost") {
          next.sourceVerification.status = "unavailable";
          next.sourceVerification.reasonCodes = ["context_source_evidence_unavailable"];
        }
      });
      await pending;
      assert.deepEqual(f.states, ["ready", "refreshing", "ready"],
        "these phases must come from the actual client/store path, not a handwritten state transition");
      assert.equal(f.eventRefreshCount, 1);
      assert.deepEqual(f.network.map((request) => request.method), ["GET", "POST", "GET"]);
      assert.equal(f.network[1].body.action, "preflight");
      if (alternative) assert.equal(f.network[1].body.alternativeOfSlotId, "failed-slot");
      assert.equal(renderedOffer(f.controller), scenario === "unchanged",
        "ordinary same-identity refresh must preserve its valid offer; changed current source or evidence must reject it");
      assert.equal(f.network.filter((request) => ["authorize", "run"].includes(request.body?.action)).length, 0);
    });
  }
}


test("the original malformed preflight success terminates without a forced read or invented receipt", async () => {
  const f = await actualTransportFixture(false, { malformedCommit: true }), pending = f.start();
  const boundary = await Promise.race([f.refreshEntered.promise.then(() => "refresh-entered"), pending.then(() => "original-terminal")]);
  assert.equal(boundary, "original-terminal"); assert.equal(f.eventRefreshCount, 0);
  assert.deepEqual(f.network.map(request => request.method), ["GET", "POST"]);
  const owner = f.client.retainedWrite("doc-a");
  assert.equal(owner.clientMutationId, f.network[1].body.clientMutationId);
  assert.equal(owner.action, "preflight"); assert.equal(owner.status, "unknown");
  assert.equal(renderedOffer(f.controller), false);
  await f.start();
  assert.deepEqual(f.network.map(request => request.method), ["GET", "POST"]);
  assert.deepEqual(f.client.retainedWrite("doc-a"), owner);
});
test("actual write notifications stay observable but do not masquerade as extra resource-publication states", async () => {
  const f = await actualTransportFixture(false), pending = f.start();
  await Promise.race([f.refreshEntered.promise, pending]);
  assert.equal(f.client.resource("doc-a").state, "refreshing");
  f.completeRefresh(); await pending;
  assert.deepEqual(f.states, ["ready", "refreshing", "ready"]);
  assert.ok(f.notifications.length > f.states.length);
  assert.equal(renderedOffer(f.controller), true);
  assert.deepEqual(f.network.map(request => request.method), ["GET", "POST", "GET"]);
});
