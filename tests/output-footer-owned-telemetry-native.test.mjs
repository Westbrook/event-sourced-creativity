import test from "node:test";
import assert from "node:assert/strict";
import { reconcileNativeTelemetry } from "./browser/helpers/owned-telemetry-native.mjs";

// SOURCE-ONLY tests. These declarations exercise a pure reconciler, not browser
// capture, CDP availability, route aborts, real telemetry or application acceptance.
// Integration target: tests/output-footer-owned-telemetry-native.test.mjs.
// This flat packet is not executable in place; the owner must compose it first.
const origin = "http://127.0.0.1:4186";
const blocked = "net::ERR_BLOCKED_BY_CLIENT";
const noticeText = `Failed to load resource: ${blocked}`;
const copy = value => structuredClone(value);

function completeSnapshot() {
  const rows = [
    { path: "/api/events/hot", bytes: 91, sha: "1".repeat(64) },
    { path: "/api/events/hot", bytes: 103, sha: "2".repeat(64) },
    { path: "/api/performance", bytes: 79, sha: "3".repeat(64) },
  ];
  return {
    mainFrameId: "synthetic-main-frame", ready: true, recordLoss: false, runtimeConsoleErrors: 0,
    requests: rows.map((row, index) => ({ id: index + 1, url: origin + row.path,
      method: "POST", resourceType: "fetch", mainFrameOwned: true,
      bodyBytes: row.bytes, bodySha256: row.sha, owned: true,
      // The first two aborts overlap: body signatures, not FIFO, separate them.
      abortStartedOrdinal: 10 + index, abortCompleted: true, abortSettled: true,
      failedOrdinal: 20 + index, failureText: blocked, finishedOrdinal: null })),
    nativeRequests: rows.map((row, index) => ({ id: `network-${index + 1}`, url: origin + row.path,
      method: "POST", resourceType: "fetch", frameId: "synthetic-main-frame",
      bodyBytes: row.bytes, bodySha256: row.sha, redirected: false, requestCount: 1,
      failedCount: 1, failureText: blocked, finishedCount: 0, responseCount: 0 })),
    nativeLogs: rows.map((row, index) => ({ id: index + 1, source: "network", level: "error",
      text: noticeText, url: origin + row.path, lineNumber: 0,
      timestamp: 1800000000000.25 + index, networkRequestId: `network-${index + 1}`, workerId: null })),
    console: rows.map((row, index) => ({ id: index + 1, text: noticeText,
      url: origin + row.path, lineNumber: 0, columnNumber: 0, timestamp: 1800000000000.25 + index })),
  };
}

function consoleEntry(result, id) {
  const entry = result.console.find(value => value.id === id);
  assert.ok(entry, `Retain a classification for raw console ${id}`);
  return entry;
}

function assertRefused(snapshot, ids = [1], { fatal = false } = {}) {
  const result = reconcileNativeTelemetry(snapshot);
  for (const id of ids) assert.ok(["unexpected", "ambiguous", "pending"].includes(consoleEntry(result, id).classification), id);
  // Malformed log/public evidence can be refused in its verdict rather than
  // issues[]. The caller gates both streams and pendingNative, not issues alone.
  if (fatal) assert.ok(result.issues.length > 0
    || result.nativeLog.some(value => ["unexpected", "ambiguous"].includes(value.classification))
    || ids.some(id => ["unexpected", "ambiguous"].includes(consoleEntry(result, id).classification)), "Retain a refusal indicator");
  return result;
}

function assertComplete(result) {
  assert.deepEqual(result.issues, []);
  assert.equal(result.pendingNative, 0);
  assert.equal(result.console.length, 3);
  assert.equal(result.nativeLog.length, 3);
  for (let index = 1; index <= 3; index++) {
    const entry = consoleEntry(result, index);
    assert.equal(entry.classification, "expected");
    assert.equal(entry.requestId, index);
    assert.equal(entry.networkRequestId, `network-${index}`);
    const native = result.nativeLog.find(value => value.id === index);
    assert.ok(native);
    assert.equal(native.classification, "expected");
  }
}

test("distinct bodies resolve concurrent same-URL native notices to exact owned Request identities", () => {
  const snapshot = completeSnapshot(), before = copy(snapshot);
  assertComplete(reconcileNativeTelemetry(snapshot));
  assert.deepEqual(snapshot, before, "The reconciler must not mutate captured evidence");
});

test("consistent Inspector suffix is retained through both failure and console streams", () => {
  const snapshot = completeSnapshot();
  const inspectorFailure = `${blocked}.Inspector`;
  const inspectorNotice = `Failed to load resource: ${inspectorFailure}`;
  for (const request of snapshot.requests) request.failureText = inspectorFailure;
  for (const request of snapshot.nativeRequests) request.failureText = inspectorFailure;
  for (const log of snapshot.nativeLogs) log.text = inspectorNotice;
  for (const message of snapshot.console) message.text = inspectorNotice;
  assertComplete(reconcileNativeTelemetry(snapshot));
});

test("registration and notice array order cannot select the owner", () => {
  const snapshot = completeSnapshot();
  snapshot.requests.reverse();
  snapshot.nativeRequests = [snapshot.nativeRequests[1], snapshot.nativeRequests[2], snapshot.nativeRequests[0]];
  snapshot.nativeLogs.reverse();
  snapshot.console = [snapshot.console[2], snapshot.console[0], snapshot.console[1]];
  assertComplete(reconcileNativeTelemetry(snapshot));
});

const fatalCases = [
  ["foreign Playwright Request cannot inherit an owned abort", snapshot => { snapshot.requests[0].owned = false; }],
  ["Playwright request must belong to the main frame", snapshot => { snapshot.requests[0].mainFrameOwned = false; }],
  ["native request must belong to the captured main frame", snapshot => { snapshot.nativeRequests[0].frameId = "foreign-frame"; }],
  ["missing native frame is not main-frame evidence", snapshot => { delete snapshot.nativeRequests[0].frameId; }],
  ["native URL fragment cannot be discarded when joining request identities", snapshot => { snapshot.nativeRequests[0].urlFragment = "#unowned"; }],
  ["missing captured main frame revokes frame ownership", snapshot => { snapshot.mainFrameId = ""; }],
  ["missing Playwright identity cannot become an undefined bridge owner", snapshot => { delete snapshot.requests[0].id; }],
  ["empty Playwright identity cannot become a bridge owner", snapshot => { snapshot.requests[0].id = ""; }],
  ["redirected native request cannot reuse the signature", snapshot => { snapshot.nativeRequests[0].redirected = true; }],
  ["repeated native request ID/hop cannot overwrite history", snapshot => { snapshot.nativeRequests[0].requestCount = 2; }],
  ["duplicate native failure event is not one terminal witness", snapshot => { snapshot.nativeRequests[0].failedCount = 2; }],
  ["missing native failure count is not a completed failure", snapshot => { delete snapshot.nativeRequests[0].failedCount; }],
  ["negative native failure count is not a completed failure", snapshot => { snapshot.nativeRequests[0].failedCount = -1; }],
  ["non-finite native failure count is not a completed failure", snapshot => { snapshot.nativeRequests[0].failedCount = Number.NaN; }],
  ["native completion contradicts the owned pre-response abort", snapshot => { snapshot.nativeRequests[0].finishedCount = 1; }],
  ["native response contradicts the owned pre-response abort", snapshot => { snapshot.nativeRequests[0].responseCount = 1; }],
  ["Playwright success contradicts its abort failure", snapshot => { snapshot.requests[0].finishedOrdinal = 25; }],
  ["failure before ownership cannot qualify", snapshot => { snapshot.requests[0].failedOrdinal = 9; }],
  ["equal abort/failure ordinal cannot establish after-ownership failure", snapshot => { snapshot.requests[0].failedOrdinal = 10; }],
  ["settled unsuccessful abort is fatal, not an expected failure", snapshot => { snapshot.requests[0].abortCompleted = false; }],
  ["wrong Playwright failure code cannot be suppressed", snapshot => { snapshot.requests[0].failureText = "net::ERR_FAILED"; }],
  ["wrong native failure code cannot be suppressed", snapshot => { snapshot.nativeRequests[0].failureText = "net::ERR_CONNECTION_RESET"; }],
  ["missing Playwright body is not an empty-body identity", snapshot => {
    snapshot.requests[0].bodyBytes = null; snapshot.requests[0].bodySha256 = null;
  }],
  ["missing native body is not copied from Playwright", snapshot => {
    snapshot.nativeRequests[0].bodyBytes = null; snapshot.nativeRequests[0].bodySha256 = null;
  }],
  ["malformed native body hash is not a signature", snapshot => { snapshot.nativeRequests[0].bodySha256 = "missing"; }],
  ["non-finite native body length is invalid", snapshot => { snapshot.nativeRequests[0].bodyBytes = Number.NaN; }],
  ["native JavaScript log cannot impersonate a network notice", snapshot => { snapshot.nativeLogs[0].source = "javascript"; }],
  ["worker log cannot impersonate the admitted page", snapshot => { snapshot.nativeLogs[0].workerId = "foreign-worker"; }],
  ["non-error native log is not the expected resource error", snapshot => { snapshot.nativeLogs[0].level = "warning"; }],
  ["native log without network ID cannot use URL fallback", snapshot => { delete snapshot.nativeLogs[0].networkRequestId; }],
  ["wrong native resource error remains unexpected", snapshot => { snapshot.nativeLogs[0].text = "Failed to load resource: net::ERR_FAILED"; }],
  ["non-finite native timestamp cannot conserve a public notice", snapshot => { snapshot.nativeLogs[0].timestamp = Number.NaN; }],
];

for (const [name, mutate] of fatalCases) {
  test(name, () => {
    const snapshot = completeSnapshot(); mutate(snapshot);
    assertRefused(snapshot, [1], { fatal: true });
  });
}

test("duplicate Playwright signatures refuse even when their observed ordinals differ", () => {
  const snapshot = completeSnapshot();
  snapshot.requests[1].bodyBytes = snapshot.requests[0].bodyBytes;
  snapshot.requests[1].bodySha256 = snapshot.requests[0].bodySha256;
  snapshot.requests[1].abortStartedOrdinal = 30; snapshot.requests[1].failedOrdinal = 40;
  assertRefused(snapshot, [1, 2], { fatal: true });
});

test("duplicate native signatures cannot select the first matching native ID", () => {
  const snapshot = completeSnapshot();
  snapshot.nativeRequests[1].bodyBytes = snapshot.nativeRequests[0].bodyBytes;
  snapshot.nativeRequests[1].bodySha256 = snapshot.nativeRequests[0].bodySha256;
  assertRefused(snapshot, [1, 2], { fatal: true });
});

test("a foreign duplicate participates in Playwright signature ambiguity", () => {
  const snapshot = completeSnapshot();
  snapshot.requests.push({ ...snapshot.requests[0], id: 4, owned: false,
    abortStartedOrdinal: null, abortCompleted: false, abortSettled: false, failedOrdinal: 40 });
  assertRefused(snapshot, [1], { fatal: true });
});

for (const side of ["requests", "nativeRequests", "nativeLogs"]) {
  test(`duplicate ${side} IDs do not collapse two observations`, () => {
    const snapshot = completeSnapshot(); snapshot[side][1].id = snapshot[side][0].id;
    assertRefused(snapshot, [1, 2], { fatal: true });
  });
}

test("duplicate public console IDs do not overwrite raw notices", () => {
  const snapshot = completeSnapshot(); snapshot.console[1].id = snapshot.console[0].id;
  const result = reconcileNativeTelemetry(snapshot);
  assert.ok(result.issues.length > 0);
  assert.ok(result.console.every(value => value.classification !== "expected"));
});

test("equal timestamp/location/text native and public keys remain ambiguous", () => {
  const snapshot = completeSnapshot();
  snapshot.nativeLogs[1].timestamp = snapshot.nativeLogs[0].timestamp;
  snapshot.console[1].timestamp = snapshot.console[0].timestamp;
  assertRefused(snapshot, [1, 2], { fatal: true });
});

test("a duplicated raw public notice cannot consume one native log twice", () => {
  const snapshot = completeSnapshot();
  snapshot.console.push({ ...snapshot.console[0], id: 4 });
  assertRefused(snapshot, [1, 4], { fatal: true });
});

test("two native logs cannot consume one Request failure", () => {
  const snapshot = completeSnapshot();
  snapshot.nativeLogs.push({ ...snapshot.nativeLogs[0], id: 4, timestamp: 1800000000010.25 });
  snapshot.console.push({ ...snapshot.console[0], id: 4, timestamp: 1800000000010.25 });
  assertRefused(snapshot, [1, 4], { fatal: true });
});

test("native ID, not same-URL notice position, determines the request", () => {
  const snapshot = completeSnapshot(); snapshot.nativeLogs[0].networkRequestId = "network-2";
  assertRefused(snapshot, [1, 2], { fatal: true });
});

const incompleteCases = [
  ["native request registration has not arrived", snapshot => { snapshot.nativeRequests.shift(); }],
  ["native failure has not arrived", snapshot => {
    snapshot.nativeRequests[0].failedCount = 0; snapshot.nativeRequests[0].failureText = null;
  }],
  ["owned abort promise has not settled", snapshot => {
    snapshot.requests[0].abortCompleted = false; snapshot.requests[0].abortSettled = false;
  }],
  ["owned Playwright failure has not arrived", snapshot => {
    snapshot.requests[0].failedOrdinal = null; snapshot.requests[0].failureText = null;
  }],
  ["native log has not arrived", snapshot => { snapshot.nativeLogs.shift(); }],
];

for (const [name, mutate] of incompleteCases) {
  test(`pending evidence: ${name}`, () => {
    const snapshot = completeSnapshot(); mutate(snapshot);
    const result = assertRefused(snapshot);
    assert.ok(result.pendingNative > 0, "Missing joins must remain pending rather than become expected");
  });
}

test("a native log awaits its exact public console notice", () => {
  const snapshot = completeSnapshot(); snapshot.console.shift();
  const result = reconcileNativeTelemetry(snapshot);
  assert.ok(result.pendingNative > 0);
  const native = result.nativeLog.find(value => value.id === 1);
  assert.ok(native); assert.notEqual(native.classification, "expected");
});

for (const [name, change] of [
  ["timestamp", message => { message.timestamp += 0.5; }],
  ["URL", message => { message.url += "?unowned=1"; }],
  ["line", message => { message.lineNumber = 7; }],
  ["column", message => { message.columnNumber = 1; }],
  ["text", message => { message.text += " unrelated"; }],
]) {
  test(`public console ${name} mismatch never receives a URL-only exemption`, () => {
    const snapshot = completeSnapshot(); change(snapshot.console[0]);
    assertRefused(snapshot);
  });
}

for (const [name, mutate] of [
  ["record loss or overflow", snapshot => { snapshot.recordLoss = true; }],
  ["Runtime console.error/assert, even if its text imitates a resource notice", snapshot => { snapshot.runtimeConsoleErrors = 1; }],
  ["native capture not ready or an enable/API failure", snapshot => { snapshot.ready = false; }],
]) {
  test(`${name} revokes every apparent console match`, () => {
    const snapshot = completeSnapshot(); mutate(snapshot);
    const result = assertRefused(snapshot, snapshot.console.map(value => value.id));
    assert.ok(result.issues.length > 0 || result.pendingNative > 0);
    assert.ok(result.nativeLog.every(value => value.classification !== "expected"));
  });
}

for (const [side, limit] of [["requests", 64], ["nativeRequests", 64], ["nativeLogs", 32], ["console", 32]]) {
  test(`${side} record-bound overflow revokes retained apparent matches`, () => {
    const snapshot = completeSnapshot();
    while (snapshot[side].length <= limit) snapshot[side].push({ ...snapshot[side][0],
      id: side === "nativeRequests" ? `overflow-${snapshot[side].length + 1}` : snapshot[side].length + 1 });
    const result = assertRefused(snapshot, [1], { fatal: true });
    assert.ok(result.issues.length > 0);
    assert.ok(result.console.every(value => value.classification !== "expected"));
    assert.ok(result.nativeLog.every(value => value.classification !== "expected"));
  });
}


// Appended r4 adapter controls. EventEmitter doubles call the real installed
// callback and route handler; they are not CDP/browser or application proof.
// Keep the preceding 15,631-byte, 64-case canonical pure-test prefix unchanged.
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { installOwnedTelemetryDiagnostics } from "./browser/helpers/output-footer-observation.mjs";

const adapterFrameId = "adapter-main-frame";
const adapterTelemetryBody = JSON.stringify({ action: "hot", events: [{ type: "ApplicationViewVisited" }] });

function telemetryEventDouble() {
  const context = new EventEmitter(), page = new EventEmitter(), session = new EventEmitter();
  const frame = { page: () => page };
  const calls = { routes: [], removed: [], sends: [], aborted: [], fallback: [], detached: 0 };
  page.context = () => context;
  page.url = () => "about:blank";
  page.mainFrame = () => frame;
  page.frames = () => [frame];
  page.workers = () => [];
  context.newCDPSession = async actualPage => { assert.equal(actualPage, page); return session; };
  context.route = async (pattern, callback) => { calls.routes.push({ pattern, callback }); };
  context.unroute = async (pattern, callback) => {
    const index = calls.routes.findIndex(row => row.pattern === pattern && row.callback === callback);
    assert.notEqual(index, -1, "Remove only the installed route handler");
    calls.removed.push(calls.routes.splice(index, 1)[0]);
  };
  session.send = async (method, params) => {
    calls.sends.push({ method, params });
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: adapterFrameId } } };
    assert.ok(["Page.enable", "Network.enable", "Log.enable", "Runtime.enable"].includes(method), method);
    return {};
  };
  session.detach = async () => { calls.detached++; };

  const makeRequest = ({ url = origin + "/api/events/hot", method = "POST", type = "fetch", body = adapterTelemetryBody } = {}) => {
    let failureText = null;
    const request = { url: () => url, method: () => method, resourceType: () => type,
      postData: () => body, postDataBuffer: () => body === null ? null : Buffer.from(body, "utf8"),
      frame: () => frame, failure: () => failureText === null ? null : { errorText: failureText } };
    return { request, fail(errorText) { failureText = errorText; context.emit("requestfailed", request); } };
  };
  const nativeStart = (id, { url = origin + "/assets/missing.css", method = "GET", type = "Stylesheet",
    frameId = adapterFrameId, body, requestExtras = {} } = {}) => {
    session.emit("Network.requestWillBeSent", { requestId: id, frameId, type,
      request: { url, method, ...(body === undefined ? {} : { postData: body }), ...requestExtras } });
  };
  const nativeFail = (id, extra = {}) => session.emit("Network.loadingFailed", {
    requestId: id, type: "Stylesheet", errorText: "net::ERR_ABORTED", canceled: true, ...extra,
  });
  const recordPair = (api, { id, url = origin + "/api/events/hot", text = noticeText, timestamp = 1800000000090.25 }) => {
    session.emit("Log.entryAdded", { entry: { source: "network", level: "error", text, url,
      lineNumber: 0, timestamp, networkRequestId: id } });
    api.recordConsoleError({ type: () => "error", page: () => page, worker: () => null,
      text: () => text, timestamp: () => timestamp,
      location: () => ({ url, lineNumber: 0, columnNumber: 0 }) });
  };
  const routeRequest = async (request, abort) => {
    assert.equal(calls.routes.length, 1, "Use the real installed overlay callback");
    await calls.routes[0].callback({ request: () => request,
      abort: async code => { calls.aborted.push({ request, code }); await abort?.(code); },
      fallback: async () => { calls.fallback.push(request); } });
  };
  const joinedTelemetry = async (api, id, { nativeResponse = false } = {}) => {
    const item = makeRequest();
    context.emit("request", item.request);
    nativeStart(id, { url: item.request.url(), method: "POST", type: "Fetch", body: adapterTelemetryBody });
    await routeRequest(item.request, code => {
      assert.equal(code, "blockedbyclient");
      if (nativeResponse) session.emit("Network.responseReceived", { requestId: id });
      item.fail(blocked);
      nativeFail(id, { type: "Fetch", errorText: blocked, canceled: false });
    });
    if (calls.aborted.some(row => row.request === item.request)) recordPair(api, { id });
    return item;
  };
  return { context, page, session, calls, makeRequest, nativeStart, nativeFail, recordPair, routeRequest, joinedTelemetry };
}

async function withTelemetryEventDouble(run) {
  const rig = telemetryEventDouble();
  const previous = process.env.FORMA_A11Y_SYNTHETIC_NETWORK;
  let api;
  try {
    process.env.FORMA_A11Y_SYNTHETIC_NETWORK = "1";
    api = await installOwnedTelemetryDiagnostics(rig.context, rig.page, origin);
  } finally {
    if (previous === undefined) delete process.env.FORMA_A11Y_SYNTHETIC_NETWORK;
    else process.env.FORMA_A11Y_SYNTHETIC_NETWORK = previous;
  }
  let primary, hadPrimary = false;
  try { await run({ ...rig, api }); }
  catch (error) { primary = error; hadPrimary = true; }
  try {
    await api.dispose();
    assert.equal(rig.calls.detached, 1, "Detach only the installed diagnostic session");
    assert.equal(rig.calls.routes.length, 0);
    assert.equal(rig.calls.removed.length, 1);
    assert.equal(rig.context.eventNames().length, 0);
    assert.equal(rig.page.eventNames().length, 0);
    assert.equal(rig.session.eventNames().length, 0);
  } catch (cleanup) {
    if (hadPrimary) throw new AggregateError([primary, cleanup], "Adapter control and diagnostic cleanup failed");
    throw cleanup;
  }
  if (hadPrimary) throw primary;
}

test("adapter: unrelated native failure stays fatal without preventing later owned telemetry", { concurrency: false }, async () => {
  await withTelemetryEventDouble(async rig => {
    rig.nativeStart("unrelated-before-telemetry");
    rig.nativeFail("unrelated-before-telemetry");
    const first = rig.api.evidence();
    assert.equal(first.halted, false, "A retained non-target fault alone does not seal telemetry ownership");
    assert.equal(first.counts.handlerErrors, 1);
    assert.equal(first.native.nonTargetFailureCount, 1);
    assert.equal(first.native.nonTargetFailures.length, 1);
    assert.equal(first.firstError.reason, "native_failure_not_owned_telemetry");
    await rig.joinedTelemetry(rig.api, "owned-after-unrelated");
    const value = rig.api.evidence();
    assert.equal(value.counts.ownedAbortRequests, 1);
    assert.equal(value.counts.ownedExpectedFailures, 1);
    assert.equal(value.counts.expectedConsoleErrors, 1);
    assert.equal(value.counts.expectedNativeLogErrors, 1);
    assert.equal(value.counts.pendingTelemetry, 0);
    assert.equal(value.counts.pendingNativeAssociations, 0);
    assert.equal(value.halted, false);
    assert.ok(value.counts.nativeIssues > 0, "A joined telemetry notice does not make the whole case pass");
    assert.equal(value.counts.handlerErrors, 1);
    assert.deepEqual(value.firstError, first.firstError);
    assert.ok(value.native.issues.includes("native_failure_not_owned_telemetry"));
    assert.equal(value.native.nonTargetFailures[0].errorOrdinal, value.firstError.ordinal);
    assert.equal(rig.calls.fallback.length, 0);
  });
});

test("adapter: corresponding unowned Playwright failure receives no exemption", { concurrency: false }, async () => {
  await withTelemetryEventDouble(async rig => {
    const item = rig.makeRequest({ url: origin + "/assets/missing.css", method: "GET", type: "stylesheet", body: null });
    rig.context.emit("request", item.request);
    rig.nativeStart("unowned-failure");
    rig.nativeFail("unowned-failure");
    item.fail("net::ERR_ABORTED");
    const value = rig.api.evidence();
    assert.equal(value.counts.requestFailures, 1);
    assert.equal(value.counts.unexpectedRequestFailures, 1);
    assert.equal(value.counts.ownedExpectedFailures, 0);
    assert.equal(value.counts.ownedAbortRequests, 0);
    assert.ok(value.counts.nativeIssues > 0);
    assert.equal(value.failures[0].owned, false);
  });
});

test("adapter: non-target native and public resource notices remain unexpected", { concurrency: false }, async () => {
  await withTelemetryEventDouble(async rig => {
    const url = origin + "/assets/missing.css";
    rig.nativeStart("unmatched-native-log", { url });
    rig.nativeFail("unmatched-native-log", { errorText: blocked });
    rig.recordPair(rig.api, { id: "unmatched-native-log", url });
    const value = rig.api.evidence();
    assert.equal(value.counts.consoleErrors, 1);
    assert.equal(value.counts.nativeLogErrors, 1);
    assert.equal(value.counts.unexpectedConsoleErrors, 1);
    assert.equal(value.counts.unexpectedNativeLogErrors, 1);
    assert.equal(value.counts.expectedConsoleErrors, 0);
    assert.equal(value.counts.expectedNativeLogErrors, 0);
    assert.equal(value.counts.ownedAbortRequests, 0);
  });
});

for (const [name, emitFault, reason] of [
  ["missing native request ID", rig => rig.nativeStart(undefined), "native_request"],
  ["native failure without an observed request row", rig => rig.nativeFail("never-observed"), "native_failure_without_observed_request"],
]) {
  test(`adapter: ${name} still halts ownership`, { concurrency: false }, async () => {
    await withTelemetryEventDouble(async rig => {
      emitFault(rig);
      const value = rig.api.evidence();
      assert.equal(value.halted, true);
      assert.ok(value.counts.handlerErrors > 0);
      assert.ok(value.native.issues.includes(reason));
      assert.equal(value.native.nonTargetFailureCount, 0);
      assert.deepEqual(value.native.nonTargetFailures, []);
    });
  });
}

test("adapter: seventeenth non-target failure exceeds the witness cap and seals ownership", { concurrency: false }, async () => {
  await withTelemetryEventDouble(async rig => {
    for (let index = 1; index <= 17; index++) {
      rig.nativeStart(`non-target-${index}`);
      rig.nativeFail(`non-target-${index}`);
    }
    const before = rig.api.evidence();
    assert.equal(before.native.nonTargetFailureCount, 17);
    assert.equal(before.native.nonTargetFailures.length, 16);
    assert.equal(before.halted, true);
    assert.ok(before.counts.capErrors > 0);
    assert.ok(before.counts.recordsDropped > 0);
    assert.ok(before.counts.errorsDropped > 0);
    assert.equal(before.firstError.reason, "native_failure_not_owned_telemetry");
    assert.equal(before.lastError.reason, "native_non_target_failure_records");
    const item = rig.makeRequest();
    rig.context.emit("request", item.request);
    await rig.routeRequest(item.request);
    const value = rig.api.evidence();
    assert.equal(value.counts.ownedAbortRequests, 0);
    assert.equal(rig.calls.aborted.length, 0);
    assert.equal(rig.calls.fallback.length, 1, "A mocked fallback records delegation; it makes no network request");
  });
});

test("adapter: a target response contradicting its abort still refuses the native join", { concurrency: false }, async () => {
  await withTelemetryEventDouble(async rig => {
    await rig.joinedTelemetry(rig.api, "target-response-then-failure", { nativeResponse: true });
    const value = rig.api.evidence();
    assert.equal(value.counts.ownedAbortRequests, 1);
    assert.equal(value.native.requests[0].responseCount, 1);
    assert.equal(value.native.requests[0].failedCount, 1);
    assert.equal(value.counts.expectedConsoleErrors, 0);
    assert.equal(value.counts.expectedNativeLogErrors, 0);
    assert.ok(value.counts.nativeIssues > 0);
    assert.notEqual(value.console[0].classification, "expected");
    assert.notEqual(value.native.logs[0].classification, "expected");
  });
});

test("adapter: non-target witness retains bounded hashes and classifications, not injected source", { concurrency: false }, async () => {
  await withTelemetryEventDouble(async rig => {
    const marker = { username: "PRIVATE_USERNAME", password: "PRIVATE_PASSWORD", path: "PRIVATE_PATH",
      query: "PRIVATE_QUERY", fragment: "PRIVATE_FRAGMENT", body: "PRIVATE_BODY", header: "PRIVATE_HEADER",
      method: "PRIVATE_METHOD", type: "PRIVATE_TYPE", frame: "PRIVATE FRAME", error: "PRIVATE_ERROR_TEXT", blocked: "PRIVATE_BLOCK_REASON" };
    const url = `https://${marker.username}:${marker.password}@example.invalid/${marker.path}?token=${marker.query}`;
    rig.nativeStart("private-witness", { url, method: marker.method, type: marker.type, frameId: marker.frame,
      body: marker.body, requestExtras: { urlFragment: `#${marker.fragment}`, headers: { authorization: marker.header } } });
    rig.nativeFail("private-witness", { type: marker.type, errorText: marker.error, canceled: false, blockedReason: marker.blocked });
    const value = rig.api.evidence(), witness = value.native.nonTargetFailures[0];
    const digest = text => createHash("sha256").update(text).digest("hex");
    assert.equal(value.native.nonTargetFailureCount, 1);
    assert.deepEqual(Object.keys(witness).sort(), ["errorOrdinal", "requestId", "method", "requestType", "failureType", "frameId",
      "mainFrameMatch", "url", "errorTextCode", "errorTextSha256", "canceled", "blockedReasonSha256", "requestCount", "failedCount",
      "responseCount", "finishedCount"].sort());
    assert.deepEqual(witness.url, { sha256: digest(new URL(url).href), bytes: Buffer.byteLength(new URL(url).href, "utf8"),
      scheme: "https:", originRelation: "other-origin", queryPresent: true, fragmentPresent: true, credentialsPresent: true });
    assert.equal(witness.method, "other");
    assert.equal(witness.requestType, "unknown");
    assert.equal(witness.failureType, "unknown");
    assert.equal(witness.frameId, null);
    assert.equal(witness.mainFrameMatch, false);
    assert.equal(witness.errorTextCode, null);
    assert.equal(witness.errorTextSha256, digest(marker.error));
    assert.equal(witness.blockedReasonSha256, digest(marker.blocked));
    assert.equal(witness.canceled, false);
    assert.equal(witness.requestCount, 1);
    assert.equal(witness.failedCount, 1);
    assert.equal(witness.responseCount, 0);
    assert.equal(witness.finishedCount, 0);
    for (const secret of Object.values(marker)) assert.equal(JSON.stringify(value).includes(secret), false, "Do not retain injected source fields");
    assert.ok(value.counts.nativeIssues > 0, "Redaction does not exempt the unrelated failure");
  });
});

test("adapter: oversized non-target witness fields halt without losing the original fault", { concurrency: false }, async () => {
  for (const [name, start, failure] of [
    ["URL exceeds 8192 UTF8 bytes", { url: origin + "/" + "x".repeat(8193) }, {}],
    ["errorText exceeds 1200 characters", {}, { errorText: "x".repeat(1201) }],
    ["blockedReason exceeds 200 characters", {}, { blockedReason: "x".repeat(201) }],
  ]) {
    await withTelemetryEventDouble(async rig => {
      rig.nativeStart("oversized-witness", start);
      rig.nativeFail("oversized-witness", failure);
      const value = rig.api.evidence();
      assert.equal(value.halted, true, name);
      assert.equal(value.native.nonTargetFailureCount, 1, name);
      assert.deepEqual(value.native.nonTargetFailures, [], name);
      assert.equal(value.firstError.reason, "native_failure_not_owned_telemetry", name);
      assert.equal(value.lastError.reason, "native_loading_failed", name);
      assert.equal(value.counts.handlerErrors, 2, name);
      assert.ok(value.native.issues.includes("native_failure_not_owned_telemetry"), name);
      assert.ok(value.native.issues.includes("native_loading_failed"), name);
    });
  }
});
