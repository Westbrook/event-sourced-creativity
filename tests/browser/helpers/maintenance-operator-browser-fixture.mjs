import assert from "node:assert/strict";
import { canonicalJson, compileExperience, digest } from "../../../src/experiences/compiler.ts";
import { definitions, fixtureCatalog } from "../../../src/experiences/catalog.ts";
import { describeExperiencePatch } from "../../../src/experiences/patches.ts";
import { readExperienceMaterialInventory, readExperienceMaterialDetail } from "../../../src/experiences/release-contract.ts";
import {
  MAINTENANCE_ADOPTION_PROTOCOL, readMaintenanceAdoptionProposal,
  maintenanceBindingDigest, maintenanceSubjectDigest, maintenanceIntentDigest,
} from "../../../src/experiences/maintenance-adoption-contract.ts";
import {
  readMaintenanceAdoptionNominations, readMaintenanceAdoptionDecision, readMaintenanceAdoptionAcknowledgment,
} from "../../../src/experiences/maintenance-adoption-review-contract.ts";

// Explicitly synthetic FRONTEND data and finite transport only. No source
// capture, registration, Worker, database, real approval, or provider authority.
// The compiler and readers run only when the future browser test installs this
// helper; a reader-valid DTO is not evidence of a build/evaluation/adoption.
const fixture = "synthetic-maintenance-operator-browser-r1";
const timestamp = "2026-09-07T12:00:00.000Z";
const endpoint = "/api/portfolio/product/experiences";
const maximum = Object.freeze({ apiRequests: 40, bodyBytes: 32768, responseBytes: 131072, ledgerEntries: 2048 });
const copy = value => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
  // Teardown observes abandoned gates without creating an unhandled rejection.
  void promise.catch(() => {});
  return { promise, resolve, reject };
};

const queryIs = (url, expected) => {
  const keys = Object.keys(expected);
  return [...url.searchParams].length === keys.length
    && keys.every(key => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === expected[key]);
};

// Pure finite classifier for constructor/spec negative tuples. The live handler
// supplies its own retained state; caller-provided browser data cannot set it.
export function classifyMaintenanceOperatorRequest(request, state) {
  if (!request || !state || !state.selection || !state.binding || typeof state.actor !== "string" || typeof request.method !== "string" || typeof request.path !== "string"
    || typeof request.raw !== "string" || request.path.length > 2048
    || Buffer.byteLength(request.raw) > maximum.bodyBytes) return null;
  let url;
  try { url = new URL(request.path, "http://maintenance-fixture.invalid"); } catch { return null; }
  if (url.origin !== "http://maintenance-fixture.invalid" || url.hash || url.pathname + url.search !== request.path) return null;
  const { method, raw } = request;
  if (method === "GET") {
    if (raw !== "") return null;
    if (url.pathname === "/api/session" && queryIs(url, { audience: "product" })) return "session";
    if (url.pathname === "/api/portfolio/product/delivery" && queryIs(url, {})) return "delivery";
    if (url.pathname === endpoint + "/materials" && queryIs(url, {})) return "inventory";
    if (url.pathname === endpoint + "/materials/detail" && queryIs(url, state.selection)) return "detail";
    if (url.pathname === endpoint + "/heads/model3d" && queryIs(url, { channel: "managed-fixture" })) return "head";
    if (url.pathname === endpoint + "/maintenance/adoption-nominations" && queryIs(url, state.selection)) return "nominations";
    if (state.decisionId && url.pathname === endpoint + "/maintenance/adoption-decisions/" + encodeURIComponent(state.decisionId)
      && queryIs(url, {})) return "decision";
    if (state.requestId && url.pathname === endpoint + "/maintenance/adoption-operations/maintenance-proposal/" + state.requestId
      && queryIs(url, {})) return "original";
    return null;
  }
  if (method !== "POST" || url.pathname !== endpoint + "/maintenance/adoption-proposals" || !queryIs(url, {})
    || request.contentType !== "application/json") return null;
  try {
    const intent = readMaintenanceAdoptionProposal(JSON.parse(raw));
    return intent && intent.ownerUserId === state.actor && intent.dependencyIds.length === 0
      && canonicalJson(intent.binding) === canonicalJson(state.binding)
      && (state.originalRaw === null || raw === state.originalRaw) ? "proposal" : null;
  } catch { return null; }
}

export async function installMaintenanceOperatorFixture(context, baseURL) {
  const base = new URL(baseURL);
  assert.ok(base.origin === "http://127.0.0.1:4186" && base.pathname === "/"
    && !base.username && !base.password && !base.search && !base.hash, "the exact explicit loopback fixture origin/root");
  const actor = "synthetic-maintenance-operator-r1";
  const user = { userId: actor, email: actor + "@example.test", displayName: "Synthetic operator", role: "admin" };
  const session = {
    user, audience: "product",
    capabilities: ["product.delivery.manage", "platform.release.approve", "product.analytics.read"],
    availableApplications: [{ id: "product", href: "/product" }],
    permissionEpoch: "synthetic-maintenance-operator-r1", organizations: [],
  };
  const compiled = await compileExperience(copy(definitions.find(value => value.id === "model3d")), copy(fixtureCatalog));
  assert.equal(compiled.ok, true, "the code-owned model3d definition compiles for this synthetic frontend fixture");
  const release = compiled.release;
  const syntheticHash = kind => digest({ fixture, kind, synthetic: true });
  const selection = {
    releaseHash: release.releaseHash, sourceHash: await syntheticHash("source-not-captured"),
    buildHash: await syntheticHash("build-not-qualified"), evaluationHash: await syntheticHash("evaluation-not-executed"),
  };
  const material = {
    selection, experienceId: "model3d", definitionRevision: release.definition.revision,
    output: "model3d", evaluation: { outcome: "passed", caseCount: 1 },
  };
  const inventory = { version: 1, qualification: "fixture", generationAvailable: false, materials: [material] };
  const detail = {
    version: 1, qualification: "fixture", generationAvailable: false,
    material, release, descriptor: describeExperiencePatch(release),
  };
  assert.ok(readExperienceMaterialInventory(inventory), "exact synthetic material inventory");
  assert.ok(await readExperienceMaterialDetail(detail), "exact compiler-owned material detail");
  const observationHash = await syntheticHash("observation-not-captured");
  const binding = {
    version: 1, operation: "adopt-baseline", channel: "managed-fixture", experienceId: "model3d", material: selection,
    target: {
      observationHash, profileRef: "model3d.code-declarations@1",
      profileHash: await syntheticHash("profile-not-captured"), inventoryHash: await syntheticHash("inventory-not-captured"),
    },
    reviewed: { baselineObservationHash: observationHash, currentObservationHash: observationHash },
    eligibilityHash: await syntheticHash("eligibility-not-qualified"),
    expectedAdoption: { revision: 0, eventId: null, baselineObservationHash: null, profileRef: null, profileHash: null },
  };
  const bindingHash = await maintenanceBindingDigest(binding), subjectHash = await maintenanceSubjectDigest(binding);
  const flags = {
    version: 1, protocol: MAINTENANCE_ADOPTION_PROTOCOL,
    qualification: "fixture", generationAvailable: false, canPublish: false,
  };
  const headState = { status: "absent", head: null };
  const nominations = {
    ...flags, base: selection, experienceId: "model3d", subjectHash, headState,
    nominations: [{ binding, bindingHash }],
  };
  assert.ok(await readMaintenanceAdoptionNominations(nominations, { base: selection, experienceId: "model3d" }),
    "the explicitly synthetic nomination passes the real frontend reader");

  const requests = [], commandRows = [], originalRows = [], ledger = [], failures = [], seenFailures = new Set();
  const pending = new Set();
  let apiRequests = 0, armed = null, original = null, decision = null, decisionRead = null;
  let originalBuild = null, originalRaw = null;
  let closing = false, closed = false, closePromise = null;
  const log = record => {
    if (ledger.length >= maximum.ledgerEntries) throw new Error("Synthetic Maintenance ledger limit exceeded");
    ledger.push(copy(record));
  };
  const remember = error => {
    if (!seenFailures.has(error)) { seenFailures.add(error); failures.push(error); }
  };
  const responseRecord = (status, body) => {
    const raw = JSON.stringify(body);
    assert.ok(Buffer.byteLength(raw) <= maximum.responseBytes, "bounded complete synthetic response");
    return { status, raw, body: JSON.parse(raw) };
  };
  const reply = async (route, record, gateOperation = null, request = null) => {
    const gate = gateOperation && armed?.operation === gateOperation ? armed : null;
    if (gate) {
      assert.equal(gate.matched, false, "an armed operation accepts only one request");
      gate.matched = true;
      gate.reached.resolve(copy(request));
      gate.response.resolve(copy(record));
      log({ kind: "gate-reached", operation: gateOperation, path: request.path });
      await gate.released.promise;
    }
    try {
      if (gate?.drop) {
        log({ kind: "delivery-dropped", operation: gateOperation, path: request.path });
        await route.abort("failed");
      } else {
        await route.fulfill({
          status: record.status, contentType: "application/json",
          headers: { "Cache-Control": "no-store" }, body: record.raw,
        });
        log({ kind: "response", status: record.status, path: request?.path ?? "", bytes: Buffer.byteLength(record.raw) });
      }
    } finally {
      if (gate && armed === gate) armed = null;
    }
  };
  const makeOriginal = request => {
    if (originalBuild) {
      assert.equal(request.raw, originalRaw, "no concurrent or later replacement original");
      return originalBuild;
    }
    originalRaw = request.raw;
    originalBuild = (async () => {
    const intent = readMaintenanceAdoptionProposal(request.body);
    assert.ok(intent, "one exact proposal intent");
    assert.equal(intent.ownerUserId, actor, "the synthetic fixture owner remains exact");
    assert.equal(await maintenanceBindingDigest(intent.binding), bindingHash, "only the retained synthetic nomination");
    assert.deepEqual(intent.dependencyIds, [], "the finite operator has no dependencies");
    const row = {
      decisionId: "experience-maintenance:v1:" + intent.requestId,
      title: intent.title, audience: "product", status: "planned", ownerUserId: actor, owner: user.displayName,
      evidence: intent.evidence, dependencyIds: [], createdAt: timestamp, updatedAt: timestamp,
    };
    const result = { ...flags, decision: row, binding, bindingHash };
    const envelope = {
      receipt: {
        version: 1, protocol: MAINTENANCE_ADOPTION_PROTOCOL, operation: "maintenance-proposal",
        requestId: intent.requestId, actorUserId: actor,
        intentDigest: await maintenanceIntentDigest("maintenance-proposal", actor, intent),
        eventId: "fixture-maintenance-proposal:" + intent.requestId, sequence: 1,
        acknowledgmentDigest: await digest(result),
      },
      result,
    };
    assert.ok(await readMaintenanceAdoptionAcknowledgment(envelope, { operation: "maintenance-proposal", actorUserId: actor, intent }),
      "the exact synthetic accepted-command response passes the real acknowledgment reader");
    const read = {
      ...flags, base: selection, experienceId: "model3d", subjectHash,
      decision: row, binding, bindingHash, approvalEventId: null, eligible: false, headState,
    };
    assert.ok(await readMaintenanceAdoptionDecision(read, row.decisionId), "the created synthetic decision is readable");
    const record = responseRecord(201, envelope);
    // This is a simulated accepted command, not a database commit. Retain exact
    // bytes before any optional loss of delivery; GET never reconstructs an ACK.
    original = { request: copy(request), response: copy(record) };
    decision = copy(row); decisionRead = copy(read);
    originalRows.push(copy(original));
    log({ kind: "original-retained", requestId: intent.requestId, eventId: envelope.receipt.eventId });
    return record;
    })();
    return originalBuild;
  };
  const classifierState = () => ({
    selection, binding, actor, decisionId: decision?.decisionId ?? null,
    requestId: original?.request.body.requestId ?? null, originalRaw,
  });
  const exampleIntent = {
    version: 1, requestId: "00000000-0000-4000-8000-000000000000", title: "Synthetic operator intent",
    ownerUserId: actor, evidence: "", dependencyIds: [], binding,
  };
  const negativeTuples = [
    ["unknown path", { method: "GET", path: endpoint + "/unknown", raw: "" }],
    ["wrong method", { method: "DELETE", path: endpoint + "/materials", raw: "" }],
    ["GET body", { method: "GET", path: endpoint + "/materials", raw: "{}" }],
    ["extra query", { method: "GET", path: endpoint + "/materials?extra=1", raw: "" }],
    ["unretained original", { method: "GET", path: endpoint + "/maintenance/adoption-operations/maintenance-proposal/00000000-0000-4000-8000-000000000000", raw: "" }],
    ["transition mutation", { method: "PATCH", path: "/api/portfolio/product/delivery", raw: "{}", contentType: "application/json" }],
    ["adoption mutation", { method: "POST", path: endpoint + "/maintenance/adoptions", raw: "{}", contentType: "application/json" }],
    ["malformed proposal", { method: "POST", path: endpoint + "/maintenance/adoption-proposals", raw: "{", contentType: "application/json" }],
    ["incomplete proposal", { method: "POST", path: endpoint + "/maintenance/adoption-proposals", raw: "{}", contentType: "application/json" }],
    ["wrong proposal owner", { method: "POST", path: endpoint + "/maintenance/adoption-proposals", raw: JSON.stringify({ ...exampleIntent, ownerUserId: "another-synthetic-owner" }), contentType: "application/json" }],
    ["wrong proposal content type", { method: "POST", path: endpoint + "/maintenance/adoption-proposals", raw: JSON.stringify(exampleIntent), contentType: "text/plain" }],
    ["oversized proposal", { method: "POST", path: endpoint + "/maintenance/adoption-proposals", raw: "x".repeat(maximum.bodyBytes + 1), contentType: "application/json" }],
    ["foreign absolute URL", { method: "GET", path: "https://example.invalid/api/session?audience=product", raw: "" }],
  ];
  for (const [name, request] of negativeTuples) {
    assert.equal(classifyMaintenanceOperatorRequest(request, classifierState()), null, name);
    log({ kind: "classifier-refusal", name });
  }
  const handle = async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    // The ONLY real-document exception: the existing global synthetic guard does
    // not admit this new route. Continue precisely this loopback GET so the real
    // app HTML/modules render; every other URL falls back to the existing guards.
    if (url.origin === base.origin && url.pathname === "/product/delivery" && !url.search && !url.hash && !url.username && !url.password
      && method === "GET" && request.resourceType() === "document") {
      assert.equal(closing, false, "no navigation after fixture retirement");
      log({ kind: "loopback-document", path: "/product/delivery" });
      await route.continue();
      return;
    }
    if (url.origin !== base.origin || !url.pathname.startsWith("/api/")) return route.fallback();
    apiRequests++;
    assert.ok(apiRequests <= maximum.apiRequests, "bounded API requests");
    const owned = url.pathname === "/api/session" || url.pathname === "/api/portfolio/product/delivery"
      || url.pathname === endpoint || url.pathname.startsWith(endpoint + "/");
    if (!owned) return route.fallback();
    assert.equal(closing, false, "no owned API request after fixture retirement");
    assert.equal(url.username, "", "no username in the finite API");
    assert.equal(url.password, "", "no password in the finite API");
    assert.equal(url.hash, "", "no fragment in the finite API");
    const bytes = request.postDataBuffer();
    assert.ok(!bytes || bytes.byteLength <= maximum.bodyBytes, "bounded original request body before decoding");
    const raw = bytes ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) : "";
    const path = url.pathname + url.search;
    assert.ok(path.length <= 2048, "bounded owned request path");
    const captured = { method, path, raw, body: raw ? JSON.parse(raw) : null };
    requests.push(copy(captured)); log({ kind: "request", method, path: captured.path, bytes: bytes?.byteLength ?? 0 });
    if (method !== "GET") commandRows.push(copy(captured));
    const kind = classifyMaintenanceOperatorRequest({ ...captured, contentType: request.headers()["content-type"] }, classifierState());
    switch (kind) {
      case "session": return reply(route, responseRecord(200, session), null, captured);
      case "delivery": return reply(route, responseRecord(200, { report: {
        id: "synthetic-maintenance-operator", scope: "Explicitly synthetic frontend operator fixture",
        refreshedAt: timestamp, synthetic: true, metrics: [], evidence: [], decisions: decision ? [decision] : [],
        owners: [{ userId: actor, displayName: user.displayName }], approvalAuthority: true,
      } }), null, captured);
      case "inventory": return reply(route, responseRecord(200, inventory), null, captured);
      case "detail": return reply(route, responseRecord(200, detail), null, captured);
      case "head": return reply(route, responseRecord(200, { head: null, eligible: false, qualification: "fixture", generationAvailable: false }), null, captured);
      case "nominations": return reply(route, responseRecord(200, nominations), null, captured);
      case "decision": return reply(route, responseRecord(200, decisionRead), null, captured);
      case "proposal": return reply(route, await makeOriginal(captured), "proposal", captured);
      case "original": {
        const saved = original.response;
        return reply(route, { status: 200, raw: saved.raw, body: copy(saved.body) }, "original", captured);
      }
    }
    throw new Error("Unexpected owned synthetic Maintenance request: " + method + " " + captured.path.slice(0, 2048));
  };
  const handler = route => {
    let work;
    work = handle(route).catch(async error => {
      remember(error);
      if (armed) {
        armed.reached.reject(error); armed.response.reject(error); armed.released.resolve(); armed = null;
      }
      try { await route.abort("failed"); } catch (abortError) { remember(abortError); }
    }).finally(() => pending.delete(work));
    pending.add(work);
    return work;
  };
  await context.route("**/*", handler);

  const arm = (operation, { drop = false } = {}) => {
    assert.ok(operation === "proposal" || operation === "original", "one named finite operation gate");
    assert.equal(typeof drop, "boolean");
    assert.ok(!closing && !closed && armed === null, "only one pending live gate");
    const gate = { operation, drop, matched: false, explicitlyReleased: false, reached: deferred(), response: deferred(), released: deferred() };
    armed = gate;
    return Object.freeze({
      reached: gate.reached.promise, response: gate.response.promise,
      release() {
        gate.released.resolve();
        if (!gate.explicitlyReleased) {
          gate.explicitlyReleased = true;
          log({ kind: "gate-release", operation: gate.operation, matched: gate.matched });
        }
      },
    });
  };
  const snapshot = () => copy({
    synthetic: true, apiRequests, calls: requests, commands: commandRows, originals: originalRows, ledger,
    pending: pending.size, gate: armed ? { operation: armed.operation, matched: armed.matched, drop: armed.drop, explicitlyReleased: armed.explicitlyReleased } : null,
    closed, errors: failures.map(error => error instanceof Error ? error.message.slice(0, 2048) : "Non-Error fixture failure"),
  });
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const gate = armed;
      if (gate) {
        if (!gate.matched || !gate.explicitlyReleased) {
          const error = new Error(!gate.matched
            ? "An armed synthetic Maintenance operation was never reached"
            : "A reached synthetic Maintenance operation was not explicitly released");
          remember(error); gate.reached.reject(error); gate.response.reject(error);
        }
        gate.released.resolve();
        try { log({ kind: "gate-cleanup-release", operation: gate.operation, matched: gate.matched, explicitlyReleased: gate.explicitlyReleased }); }
        catch (error) { remember(error); }
      }
      // Remove only this handler; existing global synthetic guards remain owned
      // by their original fixture. Already-running handlers are explicitly drained.
      try { await context.unroute("**/*", handler); } catch (error) { remember(error); }
      while (pending.size) await Promise.allSettled([...pending]);
      armed = null; closed = true;
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError([...failures], "Synthetic Maintenance fixture failed");
    })();
    return closePromise;
  };
  return Object.freeze({
    actor, bindingHash, get material() { return copy(material); },
    get calls() { return copy(requests); }, get commands() { return copy(commandRows); }, get originals() { return copy(originalRows); },
    arm, snapshot, close,
  });
}


// Observe only the already-loaded page's one native proposal response retirement.
// This does not read/clone/replace a Request, Response, body, JSON value or promise.
export async function installMaintenanceRetirementObserver(page, baseURL) {
  const base = new URL(baseURL);
  assert.ok(base.origin === "http://127.0.0.1:4186" && base.pathname === "/"
    && !base.username && !base.password && !base.search && !base.hash, "the exact observer origin/root");
  const key = "__formaMaintenanceRetirementObserverR1";
  let lastLedger = await page.evaluate(({ key, origin, path }) => {
    if (location.origin !== origin || location.pathname !== "/product/delivery"
      || location.search || location.hash || Object.hasOwn(window, key)) {
      throw new Error("Install once in the already-loaded exact delivery document");
    }
    const native = [
      { target: window, name: "fetch" },
      { target: Response.prototype, name: "json" },
      { target: ReadableStream.prototype, name: "cancel" },
    ].map(entry => ({ ...entry, descriptor: Object.getOwnPropertyDescriptor(entry.target, entry.name) }));
    for (const entry of native) {
      if (!entry.descriptor || typeof entry.descriptor.value !== "function"
        || !entry.descriptor.configurable && !entry.descriptor.writable) {
        throw new Error("Native Maintenance observation method unavailable: " + entry.name);
      }
    }
    const [fetchEntry, jsonEntry, cancelEntry] = native;
    const responseOwners = new WeakMap(), bodyOwners = new WeakMap();
    const events = [], errors = [];
    let captured = null, matched = 0, fetchReturned = 0, cancelCalled = 0, cancelCompleted = 0, jsonCalled = 0;
    let pending = 0, overflow = 0, sequence = 0, restored = false;
    const record = (kind, fields = {}) => {
      if (events.length < 64) events.push({ sequence: ++sequence, kind, ...fields });
      else overflow++;
    };
    const fail = error => {
      try {
        if (errors.length < 64) errors.push(typeof error === "string" ? error.slice(0, 512) : "Non-string observation failure");
        else overflow++;
      } catch { overflow++; }
    };
    const read = () => ({
      captured: captured && { ...captured }, matched, fetchReturned, cancelCalled, cancelCompleted, jsonCalled,
      pending, overflow, errors: [...errors], events: events.map(row => ({ ...row })), restored,
    });
    // Read data descriptors only; do not re-invoke fetch init accessors or coerce
    // arbitrary inputs. Other native request forms pass through unobserved.
    const dataProperty = (object, name) => {
      for (let depth = 0; object != null && depth < 16; depth++, object = Object.getPrototypeOf(object)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor : null;
      }
      return null;
    };
    const select = args => {
      if (typeof args[0] !== "string" || args[1] == null) return null;
      const url = new URL(args[0], location.href);
      if (url.origin !== origin || url.username || url.password || url.hash || url.search || url.pathname !== path) return null;
      const method = dataProperty(args[1], "method"), body = dataProperty(args[1], "body");
      if (method?.value !== "POST" || typeof body?.value !== "string" || body.value.length > 32768
        || new TextEncoder().encode(body.value).byteLength > 32768) return null;
      return { method: "POST", path, raw: body.value };
    };
    fetchEntry.wrapper = function (...args) {
      // Native work receives unchanged arguments and this value, and the caller
      // receives the exact original promise, not an observation-chain promise.
      const promise = Reflect.apply(fetchEntry.descriptor.value, this, args);
      let owner = null;
      try { owner = select(args); } catch { /* Unobservable inputs pass through unchanged. */ }
      if (!owner) return promise;
      matched++;
      if (matched !== 1) {
        record("unexpected-duplicate-proposal");
        fail(new Error("More than one exact proposal reached the retirement observer"));
        return promise;
      }
      captured = owner;
      record("fetch-called");
      pending++;
      promise.then(response => {
        try {
          responseOwners.set(response, owner);
          const body = response.body;
          if (body) bodyOwners.set(body, owner);
          fetchReturned++;
          record("fetch-returned", { status: response.status, sameNativeResponse: true, sameNativeBody: body !== null });
        } catch (error) { fail(error); }
        finally { pending--; }
      }, error => {
        pending--; fail(error); record("fetch-rejected");
      }).catch(error => fail(error));
      return promise;
    };
    jsonEntry.wrapper = function (...args) {
      const owner = responseOwners.get(this);
      if (owner) { jsonCalled++; record("response-json-called"); }
      let promise;
      try { promise = Reflect.apply(jsonEntry.descriptor.value, this, args); }
      catch (error) { if (owner) { fail(error); record("response-json-threw"); } throw error; }
      if (owner) {
        pending++;
        promise.then(() => { pending--; record("response-json-resolved", { sameNativePromise: true }); },
          error => { pending--; fail(error); record("response-json-rejected"); }).catch(error => fail(error));
      }
      return promise;
    };
    cancelEntry.wrapper = function (...args) {
      const owner = bodyOwners.get(this);
      if (owner) { cancelCalled++; record("body-cancel-called"); }
      let promise;
      try { promise = Reflect.apply(cancelEntry.descriptor.value, this, args); }
      catch (error) { if (owner) { fail(error); record("body-cancel-threw"); } throw error; }
      if (owner) {
        pending++;
        promise.then(() => {
          pending--; cancelCompleted++; record("body-cancel-resolved", { sameNativePromise: true, nativeResult: true });
        }, error => { pending--; fail(error); record("body-cancel-rejected"); }).catch(error => fail(error));
      }
      return promise;
    };
    const restore = () => {
      const failed = [];
      // Attempt every original descriptor even when an earlier restoration fails.
      for (const entry of [...native].reverse()) {
        try {
          const expected = { ...entry.descriptor, value: entry.wrapper };
          const current = Object.getOwnPropertyDescriptor(entry.target, entry.name);
          if (!current || Reflect.ownKeys(current).length !== Reflect.ownKeys(expected).length
            || Reflect.ownKeys(expected).some(name => current[name] !== expected[name])) {
            throw new Error("Observer descriptor ownership changed: " + entry.name);
          }
        } catch (error) { fail(error); }
        try {
          Object.defineProperty(entry.target, entry.name, entry.descriptor);
          const actual = Object.getOwnPropertyDescriptor(entry.target, entry.name);
          if (!actual || Reflect.ownKeys(actual).length !== Reflect.ownKeys(entry.descriptor).length
            || Reflect.ownKeys(entry.descriptor).some(name => actual[name] !== entry.descriptor[name])) {
            throw new Error("Descriptor mismatch: " + entry.name);
          }
        } catch (error) { failed.push(entry.name); fail(error); }
      }
      restored = failed.length === 0;
      record("methods-restored", { exactDescriptors: restored, pending });
      try {
        if (Object.getOwnPropertyDescriptor(window, key)?.value !== api || !Reflect.deleteProperty(window, key)) {
          throw new Error("Retirement observer property changed or could not be removed");
        }
      } catch (error) { fail(error); }
      return read();
    };
    const api = { read, restore };
    try {
      for (const entry of native) Object.defineProperty(entry.target, entry.name, { ...entry.descriptor, value: entry.wrapper });
      Object.defineProperty(window, key, { value: api, configurable: true });
      record("observer-installed");
    } catch (error) {
      const rollbackErrors = [];
      for (const entry of [...native].reverse()) {
        try { Object.defineProperty(entry.target, entry.name, entry.descriptor); }
        catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "Retirement observer installation/rollback failed");
      throw error;
    }
    return read();
  }, { key, origin: base.origin, path: endpoint + "/maintenance/adoption-proposals" });
  let closePromise = null;
  const snapshot = async () => {
    if (closePromise) { await closePromise.catch(() => {}); return copy(lastLedger); }
    lastLedger = await page.evaluate(key => {
      const observer = window[key];
      if (!observer) throw new Error("Retirement observer is missing from this document");
      return observer.read();
    }, key);
    return copy(lastLedger);
  };
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      lastLedger = await page.evaluate(key => {
        const observer = window[key];
        if (!observer) throw new Error("Retirement observer is missing from this document");
        return observer.restore();
      }, key);
      // All three descriptors have already been restored before any assertion.
      assert.equal(lastLedger.restored, true, "all original native descriptors restored");
      assert.equal(lastLedger.pending, 0, "native observation work drained");
      assert.equal(lastLedger.overflow, 0, "bounded retirement observation ledger");
      assert.deepEqual(lastLedger.errors, [], "no retirement observation errors");
      assert.equal(lastLedger.matched, 1, "one exact original proposal observed");
      assert.equal(lastLedger.fetchReturned, 1, "the native response returned once");
      assert.equal(lastLedger.cancelCalled, 1, "the original response body was cancelled once");
      assert.equal(lastLedger.cancelCompleted, 1, "native cancellation completed");
      assert.equal(lastLedger.jsonCalled, 0, "retirement cancelled before JSON parsing");
      return copy(lastLedger);
    })();
    return closePromise;
  };
  return Object.freeze({ snapshot, close });
}
