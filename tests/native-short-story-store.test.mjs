import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";

// UNEXECUTED SOURCE PROPOSAL. Integrate beside the existing, unchanged Store host;
// that helper is deliberately not copied into this source-only proposal. It loads
// the complete production Store, not extracted or replacement Store methods.
// Supplying workerFixture avoids constructing its default SQL fixture, but the
// helper still transitively imports Worker modules. Composition and execution need
// separate authorization. These synthetic HTTP bodies establish no Worker,
// provider, financial-admission, consent, durable-custody or end-to-end proof.
const OPTIONS = { concurrency: false, timeout: 20_000 };
const OWNER = "native-story-store-owner";
const PROJECT = "native-story-store-project";
const DOCUMENT = "native-story-store-document";
const AT = "2026-09-03T00:00:00.000Z";
const SETUP = Object.freeze({ documentId: DOCUMENT, audience: "General readers", tone: "Hopeful", locale: "en" });
const notDispatched = { disposition: "not-dispatched", handle: null, reason: "unavailable" };
const acknowledged = reused => ({ disposition: "acknowledged", handle: { documentId: DOCUMENT, jobId: "native-story-job" }, reused });

function fixtureTransport() {
  const inputs = [
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "Native story fixtures" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "Native story fixture" } },
    { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: "story-direction", type: "direction",
      handle: "direction/story", position: "a", properties: { text: "A keeper returns a lost compass.", weight: 1 } } },
  ];
  const events = inputs.map((input, index) => ({ ...input, eventId: `native-story-event-${index + 1}`, sequence: index + 1,
    streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "user", clientId: "store-fixture",
    correlationId: `native-story-correlation-${index + 1}`, causationId: null, compensatesEventId: null, schemaVersion: 1 }));
  const session = { user: { userId: OWNER, email: "native-story@example.test", displayName: "Story author", role: "creator" },
    impersonation: null, policy: { version: "fixture-policy", accepted: true }, permissionEpoch: "fixture-epoch",
    capabilities: ["project.read", "project.author", "project.output.request"], provider: {} };
  const request = async (url, init = {}) => {
    if (url === "/api/session") return Response.json(session);
    if (url.startsWith("/api/events?") && (!init.method || init.method === "GET")) return Response.json({ events, head: events.length, content: {} });
    assert.fail(`Unexpected fixture HTTP request ${init.method ?? "GET"} ${url}`);
  };
  return { owner: OWNER, projectId: PROJECT, documentId: DOCUMENT, requestId: "unused-scene-request", payload: {}, events, request, close() {} };
}

function exactJob(body) {
  return { jobId: "native-story-job", documentId: body.documentId, kind: body.kind, status: "queued", sourceSurface: body.sourceSurface,
    productionMode: body.payload.productionMode, documentRevision: body.payload.documentRevision, requestKey: body.payload.requestKey,
    requestedSequence: 3, requestedAt: AT, updatedAt: AT, members: [],
    result: { artifactKind: "short_story", artifactId: "private-artifact", content: "Private result body" },
    error: "Private error", errorDetail: "Private diagnostic", moderationPromptRef: "private-prompt", debugRaw: "Private wire extra" };
}

async function host(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external transport is permitted in native Store tests"));
  const h = await createSceneStoreHost({ workerFixture: fixtureTransport(), exposeSceneTestAccessors: true });
  t.after(() => h.close());
  h.store.route.set(withDocumentInRoute("/", DOCUMENT, "Native story fixture"));
  h.store.loading.set(false);
  h.jobRequests = () => h.requests.filter(row => row.url === "/api/document-jobs" && row.init.method === "POST");
  return h;
}

test("native Store retains a genuine late acknowledgment after source withdrawal, then reuses that exact local active job", OPTIONS, async t => {
  const h = await host(t), entered = sceneDeferred(), body = sceneDeferred();
  let denySource = false, original;
  h.intercept = async request => {
    if (request.url.startsWith("/api/events?") && denySource) return Response.json({ error: "source_withdrawn" }, { status: 403 });
    if (request.url === "/api/document-jobs" && request.init.method === "POST") {
      original = exactJob(request.body);
      return { ok: true, status: 202, json() { entered.resolve(); return body.promise; } };
    }
  };
  const source = h.store.captureSourceOwnership();
  const pending = h.store.submitNativeShortStory(SETUP, { current: () => true });
  await entered.promise;
  assert.equal(h.jobRequests().length, 1);
  denySource = true;
  await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
  assert.equal(h.store.sourceOwnershipActive(source), false, "the real source-read denial retires the captured source");
  body.resolve({ job: original, reused: false });
  assert.deepEqual(await pending, acknowledged(false), "a received acknowledgment remains an identity, not display permission");
  const retained = h.store.documentJobs.get();
  assert.equal(retained.length, 1);
  assert.deepEqual(retained[0].result, { artifactKind: "short_story" }, "privateJobReference retains the kind needed to validate the exact native handle");
  assert.equal(retained[0].debugRaw, undefined);
  assert.equal(retained[0].error, null);
  assert.equal(retained[0].errorDetail, null);
  assert.equal(retained[0].moderationPromptRef, null);
  assert.equal(h.requests.some(row => /\/api\/document-jobs\/[^/]+\/run$/u.test(row.url)), false);

  denySource = false;
  await h.store.refreshEvents({ fromStart: true });
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
  // The local active-job lookup uses the request key. Its returned job must still
  // pass the published exact revision check before the adapter exposes a handle.
  const exactReference = h.store.documentJobs.get()[0];
  h.store.documentJobs.set([{ ...exactReference, documentRevision: "another-revision" }]);
  assert.deepEqual(await h.store.submitNativeShortStory(SETUP, { current: () => true }), notDispatched);
  assert.equal(h.jobRequests().length, 1, "invalid cached identity is unavailable, not a new dispatch or an acknowledgment");
  assert.deepEqual(runnerRequests(h), []);
  h.store.documentJobs.set([exactReference]);
  assert.deepEqual(await h.store.submitNativeShortStory(SETUP, { current: () => true }), acknowledged(true));
  assert.equal(h.jobRequests().length, 1, "the exact queued local reference is reused without another submission");
});

test("native Store invalid setup and withdrawn current ownership never dispatch", OPTIONS, async t => {
  const h = await host(t);
  assert.deepEqual(await h.store.submitNativeShortStory({ ...SETUP, productionMode: "managed" }, { current: () => true }), notDispatched);
  assert.deepEqual(await h.store.submitNativeShortStory(SETUP, { current: () => false }), notDispatched);
  const gate = sceneDeferred();
  h.store.sceneGateForTest("append", gate.promise);
  let current = true, checks = 0;
  const pending = h.store.submitNativeShortStory(SETUP, { current: () => { checks++; return current; } });
  await untilScene(() => checks > 0, "native submission reaches its existing append wait");
  current = false;
  gate.resolve();
  assert.deepEqual(await pending, notDispatched);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.store.documentJobs.get(), []);
});

test("native Store lost response is dispatched-unconfirmed and never automatically resends", OPTIONS, async t => {
  const h = await host(t);
  h.intercept = async request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST") throw new Error("Lost submission response");
  };
  assert.deepEqual(await h.store.submitNativeShortStory(SETUP, { current: () => true }), { disposition: "dispatched-unconfirmed", handle: null });
  assert.equal(h.jobRequests().length, 1);
  assert.deepEqual(h.store.documentJobs.get(), [], "transport failure cannot manufacture an acknowledged job identity");
  await h.store.refreshEvents({ fromStart: true });
  // One bounded scheduler turn exercises already-registered host timers; it is not
  // an explicit second submission and makes no assertion about unbounded time.
  for (const [id, timer] of [...h.timers]) { h.timers.delete(id); timer.callback(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.jobRequests().length, 1, "neither a normal source refresh nor queued local work resubmits the lost request");
  assert.equal(h.requests.some(row => /\/api\/document-jobs\/[^/]+\/run$/u.test(row.url)), false);
  assert.deepEqual(h.store.documentJobs.get(), []);
});

// Correction-only source additions. All calls below target the actual Store and
// unchanged host ports; synthetic HTTP and session budgets do not establish
// server admission, accounting, provider execution, or durable no-resend.
const LEGACY_SETTINGS = Object.freeze({ ...SETUP, itemCount: 1, productionMode: "manual", sourceSurface: "document" });
const QUEUED_NOTICE = "short story queued. You can keep working while it is prepared.";
const BLOCKED_NOTICE = "This generation exceeds the remaining personal monthly budget.";
const CANCELED_NOTICE = "Generation canceled before any provider work was started.";
const runnerRequests = h => h.requests.filter(row => /^\/api\/document-jobs\/[^/]+\/run$/u.test(row.url));
function monthlyBudget(usedMicrousd) {
  const budget = { usedMicrousd, reservedMicrousd: 0, limitMicrousd: 100_000_000, remainingMicrousd: 100_000_000 - usedMicrousd };
  return { period: new Date().toISOString().slice(0, 7), currency: "USD", user: { ...budget }, workspace: { ...budget } };
}

test("native Store healthy current-owner acknowledgment retains the exact job and queues its existing driver", OPTIONS, async t => {
  const h = await host(t);
  let original;
  h.intercept = async request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST") {
      original = { ...exactJob(request.body), error: null, errorDetail: null, moderationPromptRef: null };
      return Response.json({ job: original, reused: false }, { status: 202 });
    }
  };
  const source = h.store.captureSourceOwnership();
  assert.equal(h.store.sourceOwnershipActive(source), true);
  assert.deepEqual(await h.store.submitNativeShortStory(SETUP, { current: () => true }), acknowledged(false));
  assert.equal(h.store.sourceOwnershipActive(source), true);
  assert.deepEqual(h.store.documentJobs.get(), [original]);
  assert.equal(h.jobRequests().length, 1);
  const sent = h.jobRequests()[0].body;
  assert.equal(sent.documentId, DOCUMENT);
  assert.equal(sent.sourceSurface, "document");
  assert.equal(sent.payload.artifactKind, "short_story");
  assert.equal(sent.payload.productionMode, "manual");
  assert.equal(sent.payload.itemCount, 1);
  assert.equal(sent.payload.current, undefined);
  assert.equal(sent.payload.onDispatch, undefined);
  await untilScene(() => runnerRequests(h).length === 1, "existing foreground driver reaches its synthetic transport");
  assert.deepEqual(runnerRequests(h).map(row => [row.url, row.init.method]), [["/api/document-jobs/native-story-job/run", "POST"]]);
  assert.ok([...h.timers.values()].some(timer => timer.delay === 350 || timer.delay === 800), "the inherited start/driver path queues a status poll without executing it here");
  assert.equal(h.store.ui.toast, "", "native presentation consumes the functional acknowledgment without a legacy success notice");
});

test("native Store malformed acknowledgment stays dispatched-unconfirmed without retaining or driving a job", OPTIONS, async t => {
  for (const [field, value] of [["documentId", "another-document"], ["jobId", "bad/job"], ["kind", "generate"],
    ["status", "unknown"], ["sourceSurface", "experience"], ["productionMode", "managed"],
    ["documentRevision", "another-revision"], ["requestKey", "another-request"], ["result", { artifactKind: "slides" }]]) {
    await t.test(field, async child => {
      const h = await host(child);
      h.intercept = async request => {
        if (request.url === "/api/document-jobs" && request.init.method === "POST") {
          return Response.json({ job: { ...exactJob(request.body), [field]: value }, reused: false }, { status: 202 });
        }
      };
      assert.deepEqual(await h.store.submitNativeShortStory(SETUP, { current: () => true }), { disposition: "dispatched-unconfirmed", handle: null });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.jobRequests().length, 1, "an attempted POST with an invalid acknowledgment is not resent");
      assert.deepEqual(h.store.documentJobs.get(), []);
      assert.deepEqual(runnerRequests(h), []);
      assert.equal(h.store.ui.toast, "");
    });
  }
});

test("legacy Short Story renderer keeps success and start-error notices while native outcomes stay functional", OPTIONS, async t => {
  for (const surface of ["legacy", "native"]) {
    for (const outcome of ["queued", "start-error"]) {
      await t.test(`${surface} ${outcome}`, async child => {
        const h = await host(child), gate = sceneDeferred();
        h.intercept = async request => {
          if (request.url === "/api/document-jobs" && request.init.method === "POST") {
            return Response.json({ job: exactJob(request.body), reused: false }, { status: 202 });
          }
        };
        if (outcome === "start-error") h.store.sceneGateForTest("append", gate.promise);
        const pending = surface === "legacy"
          ? h.store.renderDocumentArtifact("short_story", LEGACY_SETTINGS)
          : h.store.submitNativeShortStory(SETUP, { current: () => true });
        // The real append-wait path throws an ordinary Error with budget-looking
        // prose. Only the typed budget gate may classify a budget-blocked reason.
        if (outcome === "start-error") gate.reject(new Error(BLOCKED_NOTICE));
        const result = await pending;
        if (surface === "legacy") {
          assert.equal(result, outcome === "queued");
          assert.equal(h.store.ui.toast, outcome === "queued" ? QUEUED_NOTICE : BLOCKED_NOTICE);
        } else {
          assert.deepEqual(result, outcome === "queued" ? acknowledged(false) : notDispatched);
          assert.equal(h.store.ui.toast, "");
        }
        assert.equal(h.jobRequests().length, outcome === "queued" ? 1 : 0);
        assert.equal(runnerRequests(h).length, outcome === "queued" ? 1 : 0);
        if (outcome === "start-error") assert.deepEqual(h.store.documentJobs.get(), []);
      });
    }
  }
});

test("native Short Story budget blocked, canceled and continued paths preserve the legacy gate and dialog", OPTIONS, async t => {
  for (const surface of ["legacy", "native"]) {
    for (const outcome of ["blocked", "canceled", "continued"]) {
      await t.test(`${surface} ${outcome}`, async child => {
        const h = await host(child), costBudgets = monthlyBudget(outcome === "blocked" ? 99_500_000 : 61_000_000);
        h.setSession({ costBudgets });
        const budgetSnapshot = structuredClone(costBudgets), preferencesBefore = [...h.storage];
        h.intercept = async request => {
          if (request.url === "/api/document-jobs" && request.init.method === "POST") {
            return Response.json({ job: exactJob(request.body), reused: false }, { status: 202 });
          }
        };
        const pending = surface === "legacy"
          ? h.store.renderDocumentArtifact("short_story", LEGACY_SETTINGS)
          : h.store.submitNativeShortStory(SETUP, { current: () => true });
        if (outcome !== "blocked") {
          await untilScene(() => h.dialog()?.open, "actual Short Story budget dialog");
          assert.equal(h.jobRequests().length, 0, "the budget dialog precedes submission");
          const message = h.dialog().children[0].children.find(element => element.tag === "p").textContent;
          assert.match(message, /\$1\.00/u, "the unchanged manual Short Story estimate is used by the actual gate");
          h.clickBudget(outcome === "continued");
        }
        const result = await pending;
        if (surface === "legacy") {
          assert.equal(result, outcome === "continued");
          assert.equal(h.store.ui.toast, outcome === "blocked" ? BLOCKED_NOTICE : outcome === "canceled" ? CANCELED_NOTICE : QUEUED_NOTICE);
        } else {
          assert.deepEqual(result, outcome === "continued" ? acknowledged(false) : {
            disposition: "not-dispatched", handle: null, reason: outcome === "blocked" ? "budget-blocked" : "user-canceled",
          });
          assert.equal(h.store.ui.toast, "", "native callers receive a reason instead of suppressed legacy prose");
        }
        assert.equal(h.dialog(), null);
        assert.deepEqual(h.store.session.get().costBudgets, budgetSnapshot, "no local budget reset or accounting rewrite");
        assert.equal(h.jobRequests().length, outcome === "continued" ? 1 : 0);
        assert.equal(runnerRequests(h).length, outcome === "continued" ? 1 : 0);
        if (outcome === "continued") {
          assert.equal(h.jobRequests()[0].body.payload.budgetAcknowledged, true);
          assert.equal(h.jobRequests()[0].body.payload.budgetWarningSuppressed, false);
        } else {
          assert.deepEqual(h.store.documentJobs.get(), []);
          assert.deepEqual([...h.storage], preferencesBefore, "blocking or cancellation does not silently acknowledge the warning");
        }
      });
    }
  }
});

test("native Short Story dialog withdrawal reports unavailable rather than user-canceled", OPTIONS, async t => {
  for (const withdrawal of ["current", "source", "authority"]) {
    await t.test(withdrawal, async child => {
      const h = await host(child), costBudgets = monthlyBudget(61_000_000);
      h.setSession({ costBudgets });
      let current = true, denySource = false;
      h.intercept = async request => {
        if (request.url.startsWith("/api/events?") && denySource) return Response.json({ error: "source_withdrawn" }, { status: 403 });
      };
      const source = h.store.captureSourceOwnership();
      const pending = h.store.submitNativeShortStory(SETUP, { current: () => current });
      await untilScene(() => h.dialog()?.open, "actual native budget dialog before withdrawal");
      assert.equal(h.jobRequests().length, 0);
      if (withdrawal === "current") current = false;
      else if (withdrawal === "authority") h.setSession({ permissionEpoch: "withdrawn-during-budget" });
      else {
        denySource = true;
        await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
        assert.equal(h.store.sourceOwnershipActive(source), false, "a real source denial retires the dialog's captured source");
      }
      // Source/authority retirement may close the dialog itself. If still open,
      // choose Continue, never Cancel: loss of ownership is not user cancellation.
      if (h.dialog()?.open) h.clickBudget(true);
      assert.deepEqual(await pending, notDispatched);
      assert.equal(h.dialog(), null);
      assert.equal(h.jobRequests().length, 0);
      assert.deepEqual(runnerRequests(h), []);
      assert.deepEqual(h.store.documentJobs.get(), []);
      // Source retirement can emit the inherited device-storage warning when this host has no IndexedDB.
      if (withdrawal !== "source") assert.equal(h.store.ui.toast, "");
    });
  }
});

// Release188 G1 source-only additions. These extend the same full-Store supplier
// and unchanged host; they have not been executed on this rebased Store.
test("native Store response decoding distinguishes caller withdrawal from authorization retirement", OPTIONS, async t => {
  for (const withdrawal of ["current", "authority"]) {
    await t.test(withdrawal, async child => {
      const h = await host(child), entered = sceneDeferred(), body = sceneDeferred();
      let current = true, original;
      h.intercept = async request => {
        if (request.url === "/api/document-jobs" && request.init.method === "POST") {
          original = exactJob(request.body);
          return { ok: true, status: 202, json() { entered.resolve(); return body.promise; } };
        }
      };
      const source = h.store.captureSourceOwnership();
      const pending = h.store.submitNativeShortStory(SETUP, { current: () => current });
      await entered.promise;
      assert.equal(h.jobRequests().length, 1, "the request was dispatched before withdrawal");
      if (withdrawal === "current") current = false;
      else h.setSession({ permissionEpoch: "retired-during-native-story-response" });
      body.resolve({ job: original, reused: false });
      if (withdrawal === "current") {
        assert.equal(h.store.sourceOwnershipActive(source), true, "caller withdrawal does not change source authorization");
        assert.deepEqual(await pending, acknowledged(false), "a received handle survives local withdrawal without granting display authority");
        const retained = h.store.documentJobs.get();
        assert.equal(retained.length, 1);
        assert.deepEqual(retained[0].result, { artifactKind: "short_story" });
        assert.equal(retained[0].debugRaw, undefined);
        assert.equal(retained[0].error, null);
        assert.equal(retained[0].errorDetail, null);
        assert.equal(retained[0].moderationPromptRef, null);
      } else {
        assert.deepEqual(await pending, { disposition: "dispatched-unconfirmed", handle: null }, "authorization loss cannot convert a sent request into safe retry eligibility");
        assert.deepEqual(h.store.documentJobs.get(), [], "old-authority response data is not retained in the new session");
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.jobRequests().length, 1);
      assert.deepEqual(runnerRequests(h), [], "neither withdrawal starts the foreground driver");
      assert.equal(h.store.ui.toast, "");
    });
  }
});

// Append-only extension of tests/native-short-story-store.test.mjs.
// SOURCE ONLY / UNRUN. This is a joined contract prerequisite, not browser,
// real Save, provider generation, rendered-result or Edit in Forma acceptance.
import { NativeShortStoryController } from "../src/components/native-short-story-controller.ts";
import { readRetainedShortStory } from "../src/model/retained-short-story-client.ts";
import { parseRetainedStoryRoute, retainedStoryRequestPath } from "../src/model/retained-short-story.ts";

function joinedStoryReceipt() {
  return {
    schemaVersion: 1, kind: "native-short-story-completion",
    handle: { documentId: DOCUMENT, jobId: "native-story-job" },
    selection: { documentId: DOCUMENT, artifactId: "joined-story-artifact", revision: 0, contentSha256: "b".repeat(64) },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
const joinedCompletionPath = "/api/retained-story/jobs/" + DOCUMENT + "/native-story-job";
const joinedCompletionRequests = h => h.requests.filter(row => row.url === joinedCompletionPath);

function joinedJson(h, path, value) {
  // Same constructed-response convention as retained-short-story-client.test.mjs.
  // Setting the fixture URL models a received response; it is not a real network witness.
  const body = new TextEncoder().encode(JSON.stringify(value));
  const response = new Response(body, { status: 200,
    headers: { "content-type": "application/json", "content-length": String(body.length) } });
  Object.defineProperty(response, "url", { value: new URL(path, h.location.origin).href });
  return response;
}

function joinedController(t, h) {
  const store = h.store, ownership = store.captureSourceOwnership();
  const current = () => store.sourceOwnershipActive(ownership);
  const states = [];
  const request = (path, init) => store.guardedFetch(path, init, "Read story", {
    current: () => current() && !init.signal?.aborted,
  });
  const controller = new NativeShortStoryController({
    submit: (setup, controls) => store.submitNativeShortStory(setup, controls),
    origin: h.location.origin, request, changed: value => states.push(value),
    // Deliberately omit readCompletion: exercise the real bounded client.
  });
  const opening = controller.open({ documentId: DOCUMENT, current });
  t.after(() => controller.retire(opening));
  return { controller, opening, states, current, request };
}

test("joined native Story keeps admission explicit and carries the acknowledged identity into the real retained clients", OPTIONS, async t => {
  const h = await host(t), admission = sceneDeferred();
  const receipt = joinedStoryReceipt();
  const retained = { schemaVersion: 1, kind: "native-retained-short-story", selection: receipt.selection,
    title: "  A literal Story  ", contentMarkdown: "First line.\n\n  <script>literal</script>\nمرحبا\n", expiresAt: receipt.expiresAt };
  let original;
  h.intercept = async request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST") {
      original = exactJob(request.body);
      return admission.promise;
    }
    if (request.url === joinedCompletionPath) return joinedJson(h, request.url, receipt);
    if (request.url === retainedStoryRequestPath(receipt.selection)) return joinedJson(h, request.url, retained);
  };
  const { controller, opening, current, request } = joinedController(t, h);
  const savedEvent = h.store.events.get().find(event => event.type === "DocumentCreated" && event.payload.document_id === DOCUMENT);
  assert.ok(savedEvent, "fixture supplies an existing saved Document, not a browser Save witness");
  assert.equal(current(), true);
  assert.equal(controller.state.status, "ready");
  assert.equal(h.jobRequests().length, 0, "opening a saved Document cannot dispatch generation");
  assert.equal(joinedCompletionRequests(h).length, 0);
  const create = controller.create(opening, SETUP);
  t.after(async () => { admission.resolve(Response.json({ job: original, reused: false }, { status: 202 })); await create; });
  await untilScene(() => original !== undefined, "explicit native Story admission reaches its synthetic transport");
  await controller.create(opening, SETUP);
  assert.equal(h.jobRequests().length, 1, "a second activation cannot make a second admission while the first is unsettled");
  assert.equal(controller.state.status, "submitting");
  admission.resolve(Response.json({ job: original, reused: false }, { status: 202 }));
  await create;
  assert.equal(controller.state.status, "submitted");
  assert.deepEqual(controller.state.handle, receipt.handle);
  assert.equal(Object.isFrozen(controller.state), true);
  assert.equal(Object.isFrozen(controller.state.handle), true);
  assert.equal(joinedCompletionRequests(h).length, 0, "acknowledgment is not an automatic completion read");
  assert.equal(controller.openStory(opening), null);
  await controller.check(opening);
  assert.equal(controller.state.status, "available");
  assert.deepEqual(controller.state.completion, receipt);
  const check = joinedCompletionRequests(h);
  assert.equal(check.length, 1);
  assert.equal(check[0].init.method, "GET");
  assert.equal(check[0].init.cache, "no-store");
  assert.equal(check[0].init.redirect, "error");
  const route = controller.openStory(opening);
  const selection = parseRetainedStoryRoute(route);
  assert.deepEqual(selection, receipt.selection, "the acknowledged completion, not the newest artifact, supplies the retained route");
  const read = new AbortController();
  t.after(() => read.abort());
  const value = await readRetainedShortStory(selection, { origin: h.location.origin, signal: read.signal, current, request });
  assert.deepEqual(value, retained);
  assert.deepEqual(value.selection, receipt.selection);
  assert.equal(h.jobRequests().length, 1, "completion and retained reads do not admit another job");
  assert.equal(h.requests.filter(row => row.url === retainedStoryRequestPath(receipt.selection)).length, 1);
  // The unchanged Store host may call its synthetic foreground /run transport.
  // Neither that call nor this literal response proves provider execution,
  // content hashing by a server, rendering, native navigation or Edit in Forma.
});

test("joined native Story rejects a foreign completion without selecting or resubmitting an output", OPTIONS, async t => {
  const h = await host(t), receipt = joinedStoryReceipt();
  receipt.handle.jobId = "another-story-job";
  h.intercept = async request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST")
      return Response.json({ job: exactJob(request.body), reused: false }, { status: 202 });
    if (request.url === joinedCompletionPath) return joinedJson(h, request.url, receipt);
  };
  const { controller, opening } = joinedController(t, h);
  await controller.create(opening, SETUP);
  assert.equal(controller.state.status, "submitted");
  await controller.check(opening);
  assert.equal(controller.state.status, "unavailable");
  assert.equal(controller.state.completion, null);
  assert.equal(controller.openStory(opening), null);
  assert.equal(joinedCompletionRequests(h).length, 1);
  assert.equal(h.jobRequests().length, 1);
  assert.equal(h.requests.some(row => row.url.startsWith("/api/retained-story/") && row.url !== joinedCompletionPath), false);
});

test("joined native Story retirement cannot publish a held completion into a replacement opening", OPTIONS, async t => {
  const h = await host(t), response = sceneDeferred(), receipt = joinedStoryReceipt();
  h.intercept = async request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST")
      return Response.json({ job: exactJob(request.body), reused: false }, { status: 202 });
    if (request.url === joinedCompletionPath) return response.promise;
  };
  const { controller, opening, current, states } = joinedController(t, h);
  await controller.create(opening, SETUP);
  const checking = controller.check(opening);
  t.after(async () => {
    response.resolve(joinedJson(h, joinedCompletionPath, receipt));
    await checking;
    await untilScene(() => !controller.completionReadPending, "held completion settles during teardown");
  });
  await untilScene(() => joinedCompletionRequests(h).length === 1, "explicit completion reaches its held synthetic transport");
  assert.equal(controller.completionReadPending, true);
  controller.retire(opening);
  await checking;
  assert.equal(controller.state.status, "retired");
  assert.equal(controller.completionReadPending, true, "retiring the UI does not claim settlement of the held transport");
  const replacement = controller.open({ documentId: DOCUMENT, current });
  t.after(() => controller.retire(replacement));
  const replacementState = controller.state;
  assert.equal(replacementState.status, "uncertain", "the invoked attempt is not reset into retry eligibility");
  await controller.create(replacement, SETUP);
  assert.equal(h.jobRequests().length, 1);
  response.resolve(joinedJson(h, joinedCompletionPath, receipt));
  await untilScene(() => !controller.completionReadPending, "original completion transport settles");
  assert.equal(controller.state, replacementState);
  assert.equal(controller.openStory(opening), null);
  assert.equal(controller.openStory(replacement), null);
  assert.equal(states.some(state => state.status === "available"), false);
  assert.equal(joinedCompletionRequests(h).length, 1);
  assert.equal(h.jobRequests().length, 1);
});


// Real Store refresh boundary used by native Story Open after completion.
// Synthetic read responses only; no provider, focal calculation or timer runs.
function storyProjectionRefresh(h) {
  const sequence = h.store.head.get() + 1, artifactId = "refreshed-native-story", contentRef = "refreshed-native-story-content";
  const title = "The returned compass", body = "A keeper returns the compass.\n";
  const content = JSON.stringify({ kind: "short_story", title, items: [{ id: "refreshed-story-part", title, body }] });
  const event = { ...h.worker.events.at(-1), eventId: "refreshed-native-story-event", sequence,
    actor: "worker:renderer", type: "DocumentRenderCompleted", payload: {
      project_id: PROJECT, document_id: DOCUMENT, artifact_id: artifactId, artifact_kind: "short_story",
      title, content_ref: contentRef, item_count: 1, source_surface: "document",
      items: [{ id: "refreshed-story-part", title, body }],
    } };
  const eventPath = `/api/events?after=${sequence - 1}&limit=5000&content=0`;
  const contentPath = `/api/events?after=${sequence}&limit=1&content=1`;
  const page = { events: [event], head: sequence, nextAfter: sequence, hasMore: false };
  return { event, sequence, artifactId, contentRef, content, title, body, eventPath, contentPath, page };
}

test("native Story completion refresh admits the absent artifact quietly while ordinary refresh preserves maintenance", OPTIONS, async t => {
  for (const readOnly of [true, false]) {
    await t.test(readOnly ? "read-only Open refresh" : "ordinary refresh", async child => {
      const h = await host(child), value = storyProjectionRefresh(h), appended = [];
      const timersBefore = new Set(h.timers.keys());
      h.window.addEventListener("forma-events-appended", event => appended.push(event.detail.events));
      const invalidation = child.mock.method(h.store.outputRequirements, "invalidate"); // Calls the original method.
      h.intercept = async request => {
        if (request.url === value.eventPath) return Response.json(value.page);
        if (request.url === value.contentPath) return Response.json({ content: { [value.contentRef]: value.content } });
      };
      assert.equal(h.store.projection.get().libraryArtifacts.some(item => item.id === value.artifactId), false,
        "a completed server artifact has not yet entered the local projection");
      assert.equal(h.store.content.get()[value.contentRef], undefined);
      await h.store.refreshEvents(readOnly ? { readOnly: true, current: () => true } : {});
      const artifact = h.store.projection.get().libraryArtifacts.find(item => item.id === value.artifactId);
      assert.ok(artifact, "the real event fold makes the exact completed Story selectable");
      assert.deepEqual([artifact.id, artifact.documentId, artifact.kind, artifact.title, artifact.contentRef, artifact.sourceEventId, artifact.sequence],
        [value.artifactId, DOCUMENT, "short_story", value.title, value.contentRef, value.event.eventId, value.sequence]);
      assert.equal(artifact.items[0].body, value.body);
      assert.equal(h.store.content.get()[value.contentRef], value.content);
      assert.equal(h.store.head.get(), value.sequence);
      assert.deepEqual(h.store.events.get().filter(event => event.eventId === value.event.eventId), [value.event]);
      assert.equal(invalidation.mock.callCount(), 1, "local output caches are invalidated in both refresh modes");
      assert.deepEqual(h.requests.map(request => [request.url, request.init.method ?? "GET"]),
        [[value.eventPath, "GET"], [value.contentPath, "GET"]], "refresh issues only its event and private-content reads");
      const newTimers = [...h.timers].filter(([id]) => !timersBefore.has(id)).map(([, timer]) => timer);
      assert.equal(newTimers.filter(timer => timer.delay === 3_000).length, readOnly ? 0 : 1,
        "the same completed event schedules focal maintenance only during ordinary refresh");
      assert.deepEqual(appended, readOnly ? [] : [[value.event]],
        "read-only Open cannot publish the action-triggering appended event");
      assert.equal(h.jobRequests().length, 0);
      assert.deepEqual(runnerRequests(h), []);
      assert.equal(h.requests.some(request => request.body?.action === "calculate_focal_point"), false);
    });
  }
});

test("native Story read-only refresh cannot publish after caller withdrawal", OPTIONS, async t => {
  const h = await host(t), value = storyProjectionRefresh(h), entered = sceneDeferred(), release = sceneDeferred();
  const eventsBefore = h.store.events.get(), contentBefore = h.store.content.get(), headBefore = h.store.head.get();
  const timersBefore = [...h.timers], appended = [];
  let current = false, holdContent = false, notifications = 0;
  const unsubscribe = h.store.subscribe(() => notifications++);
  t.after(unsubscribe);
  h.window.addEventListener("forma-events-appended", event => appended.push(event.detail.events));
  const invalidation = t.mock.method(h.store.outputRequirements, "invalidate"); // Calls the original method.
  h.intercept = async request => {
    if (request.url === value.eventPath) return Response.json(value.page);
    if (request.url === value.contentPath) {
      const response = Response.json({ content: { [value.contentRef]: value.content } });
      if (!holdContent) return response;
      const json = response.json.bind(response);
      response.json = async () => { entered.resolve(); await release.promise; return json(); };
      return response;
    }
  };
  await h.store.refreshEvents({ readOnly: true, current: () => current });
  assert.deepEqual(h.requests, [], "an already withdrawn Open cannot begin an event read");
  current = true; holdContent = true;
  const source = h.store.captureSourceOwnership();
  const pending = h.store.refreshEvents({ readOnly: true, current: () => current });
  t.after(async () => { release.resolve(); await pending; });
  await entered.promise;
  current = false;
  release.resolve();
  assert.equal(await pending, undefined, "withdrawal fulfills without publishing the stale read");
  assert.equal(h.store.sourceOwnershipActive(source), true, "only caller ownership changed, not source authorization");
  assert.equal(h.store.events.get(), eventsBefore);
  assert.equal(h.store.content.get(), contentBefore);
  assert.equal(h.store.head.get(), headBefore);
  assert.equal(h.store.projection.get().libraryArtifacts.some(item => item.id === value.artifactId), false);
  assert.deepEqual([...h.timers], timersBefore);
  assert.deepEqual(appended, []);
  assert.equal(notifications, 0);
  assert.equal(invalidation.mock.callCount(), 0);
  assert.deepEqual(h.requests.map(request => [request.url, request.init.method ?? "GET"]),
    [[value.eventPath, "GET"], [value.contentPath, "GET"]]);
  assert.equal(h.jobRequests().length, 0);
  assert.deepEqual(runnerRequests(h), []);
});
