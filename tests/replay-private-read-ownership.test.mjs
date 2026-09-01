import test from "node:test";
import assert from "node:assert/strict";
import { confirmationFixture, deferred, until } from "./helpers/themed-confirmation-native.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

// Complete current Replay and platform session; native events and Replay HTTP
// are finite ports. Only the existing local /api/session bootstrap reaches the
// in-memory Worker. No Replay/impersonation mutation, provider, real permission
// change or financial operation is exercised. The original six desired
// assertions from the pinned root-run standalone baseline are preserved.
const PRIVATE = {
  title: "B3 private original Replay title",
  summary: "B3 private original Replay summary",
  error: "B3 private unfinished diagnostic",
  timeline: "B3_PRIVATE_TIMELINE_EVENT",
  phrase: "B3_PRIVATE_REPLAY_PHRASE",
  lateTimeline: "B3_PRIVATE_LATE_ORIGINAL_TIMELINE_EVENT",
};
const denialBody = { error: "insufficient_role", required: "admin", role: "creator" };

function readVisible(f) {
  const markup = f.draw();
  const buttons = f.renderer.ownNodes(f.host, "button");
  const inputs = f.renderer.ownNodes(f.host, "input");
  return {
    title: markup.includes(PRIVATE.title),
    summary: markup.includes(PRIVATE.summary),
    diagnostic: markup.includes(PRIVATE.error),
    timeline: markup.includes(PRIVATE.timeline),
    // RendererPort stores dynamic attributes as __bound_N__ in markup, then
    // resolves them into the collected native control attributes. Observe the
    // actual private configuration-derived input, not its intermediate token.
    configuration: inputs.some((node) => node.attributes.name === "phrase" && node.attributes.placeholder === PRIVATE.phrase),
    enabledArchive: buttons.filter((node) => node.handlers.click?.toString().includes("#archive") && !node.disabled).length,
  };
}
const retained = { title: true, summary: true, diagnostic: true, timeline: true, configuration: true, enabledArchive: 1 };
const withdrawn = { title: false, summary: false, diagnostic: false, timeline: false, configuration: false, enabledArchive: 0 };

async function replay(t, { locale = "en", liveLocale = false } = {}) {
  const f = await confirmationFixture(t, { application: true, locale });
  if (liveLocale) {
    // Same actual locale controller, with a finite provider publication port.
    // This does not replace its translation method or the Replay renderer.
    f.i18n.hostDisconnected(); let publish;
    const snapshot = () => ({ locale: f.locale, formatLocale: f.locale, direction: f.locale === "ar" ? "rtl" : "ltr",
      timeZone: "UTC", messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[f.locale] }, revision: 1 });
    f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.host?.requestUpdate(); }, dispatchEvent(event) {
      publish = event.callback; publish(snapshot(), () => {}); return true;
    } });
    f.i18n.hostConnected();
    f.publishLocale = next => { f.locale = next; publish(snapshot()); };
  }
  f.store.route.set("/product/evaluation/actual");
  const row = { sessionId: "failed-owned-A", status: "failed", title: PRIVATE.title, summary: PRIVATE.summary,
    eventCount: 12, imageCount: 2, createdAt: "2026-08-27T00:00:00.000Z", error: PRIVATE.error, persona: null, usage: {} };
  const configuration = { enabled: true, configured: true, approvalPhrase: PRIVATE.phrase, confirmationVersion: "fixture-only-unused",
    cost: { estimate: { authorizationMicrousd: 1_000_000, estimatedMicrousd: 500_000, operations: 1 },
      fitsReplayStructure: true, fitsWorkspace: true, requiresUserOverride: false } };
  f.replay = { gets: [], onGet: null, timelines: [], onTimeline: null,
    healthyBody: () => structuredClone({ sessions: [row], liveGeneration: configuration }) };
  f.transport.handler = async (request) => {
    assert.equal(request.method, "GET", "the baseline admits no archive, approval, persona, retry or generation request");
    if (request.url === "/api/session?audience=product") return f.storeHost.worker.request(request.url);
    if (request.url === "/api/replay-sessions") {
      f.replay.gets.push(request);
      return f.replay.onGet ? f.replay.onGet(request) : Response.json({ sessions: [row], liveGeneration: configuration });
    }
    if (request.url === "/api/replay-sessions/failed-owned-A?cursor=0&limit=40") {
      f.replay.timelines.push(request);
      return f.replay.onTimeline ? f.replay.onTimeline(request) : Response.json({ events: [{ sequence: 1, type: PRIVATE.timeline }] });
    }
    assert.fail("Unexpected finite Replay read: " + request.url);
  };
  const session = await f.platform.platformSession.load("product");
  assert.equal(session.audience, "product");
  assert.equal(session.user.role, "admin");
  await f.mount("src/apps/product/actual-replay.ts", "FormaActualReplay", "forma-actual-replay");
  await until(() => f.draw().includes(PRIVATE.title), "the actual Replay class adopts its exact finite list response");
  await f.click(f.control("#inspect"));
  assert.deepEqual(readVisible(f), retained, "the healthy prerequisite includes private title, summary, diagnostic, timeline, configuration and reachable archive control");
  await f.storeHost.worker.drainBackground();
  const writes = f.storeHost.worker.controls.writes.length;
  t.after(() => {
    assert.equal(f.transport.requests.filter((request) => request.method !== "GET").length, 0);
    assert.deepEqual(f.transport.external, []);
    assert.equal(f.storeHost.worker.controls.writes.length, writes, "no additional fixture DB writes after the genuine bootstrap/read prerequisite");
  });
  f.refresh = () => f.click(f.control("#load"));
  return f;
}

test("B3 Replay healthy current Refresh keeps the exact authorized private view", async (t) => {
  const f = await replay(t);
  await f.refresh();
  const visible = readVisible(f); t.diagnostic(JSON.stringify({ outcome: "healthy-200", visible }));
  assert.deepEqual(visible, retained);
  assert.equal(f.replay.gets.length, 2);
  assert.equal(f.dialog(), null);
});

test("B3 Replay a current completed-body 403 withdraws the former private view and archive reach", async (t) => {
  const f = await replay(t);
  f.replay.onGet = () => Response.json(denialBody, { status: 403 });
  await f.refresh();
  const visible = readVisible(f); t.diagnostic(JSON.stringify({ outcome: "known-403-completed-body", visible }));
  assert.equal(f.replay.gets.length, 2);
  assert.equal(f.dialog(), null);
  assert.deepEqual(visible, withdrawn, "known current denial must retire the old private view, not only add an error beside it");
});

test("B3 Replay a known current 403 withdraws private view before its held JSON body resolves", async (t) => {
  const f = await replay(t), body = deferred(); let parsing = false, completed = false;
  f.replay.onGet = () => {
    const response = Response.json(denialBody, { status: 403 });
    response.json = () => { parsing = true; return body.promise; };
    return response;
  };
  const pending = f.refresh().then(() => { completed = true; });
  try {
    await until(() => parsing || completed, "the actual current load received the finite HTTP 403; a safe early refusal need not parse its body");
    const visible = readVisible(f); t.diagnostic(JSON.stringify({ outcome: "known-403-body-pending", visible }));
    assert.equal(f.replay.gets.length, 2);
    assert.equal(f.dialog(), null);
    assert.deepEqual(visible, withdrawn, "HTTP denial must not depend on delayed error text to withdraw private data");
  } finally {
    body.resolve(denialBody); await pending;
  }
});

test("B3 Replay temporary 503 is lookup uncertainty, not a revocation certificate", async (t) => {
  const f = await replay(t);
  f.replay.onGet = () => Response.json({ error: "fixture_temporary_lookup_failure" }, { status: 503 });
  await f.refresh();
  const visible = readVisible(f); t.diagnostic(JSON.stringify({ outcome: "temporary-503-not-revocation", visible }));
  assert.deepEqual(visible, retained, "the control does not turn temporary lookup uncertainty into proven access revocation");
  assert.ok(f.draw().includes("fixture_temporary_lookup_failure"));
  assert.ok(!f.draw().includes("insufficient_role"));
  assert.equal(f.replay.gets.length, 2);
  assert.equal(f.dialog(), null);
});

for (const denied of [false, true]) test("B3 Replay pending exact timeline " + (denied
  ? "cannot republish old private data after a newer known 403"
  : "still publishes under uninterrupted current ownership"), async (t) => {
  const f = await replay(t), response = deferred();
  f.replay.onTimeline = () => response.promise;
  const pending = f.click(f.control("#inspect"));
  try {
    await until(() => f.replay.timelines.length === 2, "the second actual timeline GET has been dispatched and is held");
    if (denied) {
      f.replay.onGet = () => Response.json(denialBody, { status: 403 });
      await f.refresh();
      // Observe this earlier boundary without stopping before the separate
      // late-publication assertion. The two standalone 403 cases own it.
      t.diagnostic(JSON.stringify({ outcome: "known-403-before-old-timeline", visible: readVisible(f) }));
    }
    response.resolve(Response.json({ events: [{ sequence: 2, type: PRIVATE.lateTimeline }] }));
    await pending;
    const markup = f.draw(), lateTimelinePublished = markup.includes(PRIVATE.lateTimeline);
    t.diagnostic(JSON.stringify({ outcome: denied ? "old-timeline-after-newer-403" : "healthy-current-timeline",
      lateTimelinePublished, visible: readVisible(f) }));
    assert.equal(f.replay.timelines.length, 2);
    assert.equal(f.replay.gets.length, denied ? 2 : 1);
    assert.equal(f.dialog(), null);
    assert.equal(lateTimelinePublished, !denied, denied
      ? "an older successful timeline response cannot restore private evidence after the newer current denial"
      : "the complete current inspection remains functional, without a denial or ownership interruption");
    if (denied) assert.deepEqual(readVisible(f), withdrawn);
    else {
      const current = readVisible(f);
      assert.equal(current.timeline, false, "the new exact timeline replaces the prior timeline");
      assert.deepEqual({ ...current, timeline: true }, retained);
    }
  } finally {
    response.resolve(Response.json({ events: [{ sequence: 2, type: PRIVATE.lateTimeline }] }));
    await pending;
  }
});


test("B3 Replay known denial permits a later explicit current list and exact timeline recovery", async (t) => {
  const f = await replay(t);
  f.replay.onGet = () => Response.json(denialBody, { status: 403 });
  await f.refresh();
  assert.deepEqual(readVisible(f), withdrawn);
  assert.equal(f.replay.gets.length, 2, "denial does not start an automatic recovery request");
  f.replay.onGet = null;
  await f.refresh();
  const fresh = readVisible(f);
  assert.equal(fresh.timeline, false, "a fresh list does not fabricate a fresh private timeline");
  assert.deepEqual({ ...fresh, timeline: true }, retained);
  await f.click(f.control("#inspect"));
  assert.deepEqual(readVisible(f), retained);
  assert.equal(f.replay.gets.length, 3);
  assert.equal(f.replay.timelines.length, 2);
});

test("B3 Replay a denied refresh retires an unsent native archive confirmation without dispatch", async (t) => {
  const f = await replay(t), response = deferred();
  f.replay.onGet = () => response.promise;
  const refresh = f.refresh();
  await until(() => f.replay.gets.length === 2, "the ordinary Refresh GET starts before any modal makes the background inert");
  const pending = f.click(f.control("#archive")), originalDialog = f.dialog();
  try {
    assert.ok(originalDialog);
    response.resolve(Response.json(denialBody, { status: 403 })); await refresh;
    assert.equal(f.dialog(), null);
    await pending;
    assert.equal(originalDialog.isConnected, false);
    assert.deepEqual(readVisible(f), withdrawn);
    assert.equal(f.transport.requests.some(request => request.method !== "GET"), false);
  } finally {
    response.resolve(Response.json(denialBody, { status: 403 })); await refresh;
    // A failed old-runtime assertion leaves the real confirmation pending;
    // dismiss only during cleanup, never to satisfy the retirement assertion.
    if (f.dialog()) f.cancel();
    await pending;
  }
});

for (const later of ["temporary-503", "malformed-200"]) test("B3 Replay an older denial remains effective while a newer pending read ends " + later, async (t) => {
  const f = await replay(t), old = deferred(), newer = deferred(); let dispatched = 0;
  f.replay.onGet = () => ++dispatched === 1 ? old.promise : newer.promise;
  const first = f.refresh(), second = f.refresh();
  try {
    await until(() => f.replay.gets.length === 3, "both actual list requests started");
    old.resolve(Response.json(denialBody, { status: 403 })); await first;
    assert.deepEqual(readVisible(f), withdrawn, "starting a newer read does not certify the old private view");
    newer.resolve(later === "temporary-503"
      ? Response.json({ error: "fixture_later_read_failed" }, { status: 503 })
      : Response.json({ sessions: [{}], liveGeneration: f.replay.healthyBody().liveGeneration }));
    await second;
    assert.deepEqual(readVisible(f), withdrawn, "a failed or malformed later read cannot restore withdrawn private state");
    assert.equal(f.replay.gets.length, 3);
  } finally {
    old.resolve(Response.json(denialBody, { status: 403 }));
    newer.resolve(Response.json({ error: "fixture_cleanup" }, { status: 503 }));
    await Promise.all([first, second]);
  }
});

test("B3 Replay an accepted denial retires an already pending valid list until a fresh explicit read", async (t) => {
  const f = await replay(t), old = deferred(), body = deferred(); let dispatched = 0, parsing = false;
  f.replay.onGet = () => {
    if (++dispatched === 1) return old.promise;
    const response = Response.json(f.replay.healthyBody());
    response.json = () => { parsing = true; return body.promise; };
    return response;
  };
  const first = f.refresh(), second = f.refresh();
  try {
    await until(() => parsing, "the current newer response is waiting on its body");
    old.resolve(Response.json(denialBody, { status: 403 })); await first;
    assert.deepEqual(readVisible(f), withdrawn, "pending body is not an access certificate");
    body.resolve(f.replay.healthyBody()); await second;
    assert.deepEqual(readVisible(f), withdrawn, "a successful body from an already pending read cannot recertify after accepted withdrawal");
    assert.equal(f.replay.gets.length, 3, "withdrawal and old completion do not issue a recovery request");
    f.replay.onGet = null; await f.refresh();
    const fresh = readVisible(f);
    assert.equal(fresh.timeline, false);
    assert.deepEqual({ ...fresh, timeline: true }, retained, "a new deliberate read started after withdrawal may restore its private list/configuration");
    assert.equal(f.replay.gets.length, 4);
  } finally {
    old.resolve(Response.json(denialBody, { status: 403 }));
    body.resolve(f.replay.healthyBody()); await Promise.all([first, second]);
  }
});

test("B3 Replay a completed newer valid list protects its private bytes from an older denial", async (t) => {
  const f = await replay(t), old = deferred();
  f.replay.onGet = () => old.promise;
  const first = f.refresh();
  try {
    await until(() => f.replay.gets.length === 2, "the older list request is pending");
    f.replay.onGet = null; await f.refresh();
    assert.deepEqual(readVisible(f), retained);
    old.resolve(Response.json(denialBody, { status: 403 })); await first;
    assert.deepEqual(readVisible(f), retained, "a successful newer proof, unlike a pending request, fences an older refusal");
    assert.equal(f.replay.gets.length, 3);
  } finally {
    old.resolve(Response.json(denialBody, { status: 403 })); await first;
  }
});

for (const deniedResource of ["list", "timeline"]) test("B3 Replay a newer completed " + (deniedResource === "list" ? "timeline" : "list")
  + " does not certify an older denied " + deniedResource + " resource", async (t) => {
  const f = await replay(t), old = deferred();
  if (deniedResource === "list") f.replay.onGet = () => old.promise;
  else f.replay.onTimeline = () => old.promise;
  const pending = deniedResource === "list" ? f.refresh() : f.click(f.control("#inspect"));
  try {
    await until(() => deniedResource === "list" ? f.replay.gets.length === 2 : f.replay.timelines.length === 2,
      "the exact older resource read is pending");
    if (deniedResource === "list") await f.click(f.control("#inspect"));
    else await f.refresh();
    assert.deepEqual(readVisible(f), retained, "the independent newer resource read completes healthily first");
    old.resolve(Response.json(denialBody, { status: 403 })); await pending;
    assert.deepEqual(readVisible(f), withdrawn, "a timeline proves only its exact timeline, and a list proves only its own collection/configuration");
  } finally { old.resolve(Response.json(denialBody, { status: 403 })); await pending; }
});

for (const completed of [false, true]) test("B3 Replay a newer same-original timeline " + (completed
  ? "completed before an older denial preserves its exact view"
  : "still pending at an older denial is retired until a fresh read"), async (t) => {
  const f = await replay(t), old = deferred(), body = deferred(); let dispatched = 0, parsing = false;
  const newerBody = { events: [{ sequence: 2, type: PRIVATE.lateTimeline }] };
  f.replay.onTimeline = () => {
    if (++dispatched === 1) return old.promise;
    const response = Response.json(newerBody);
    response.json = () => { parsing = true; return body.promise; };
    return response;
  };
  const first = f.click(f.control("#inspect")), second = f.click(f.control("#inspect"));
  try {
    await until(() => parsing, "the newer exact timeline response has arrived, but its body is not yet proof");
    if (completed) { body.resolve(newerBody); await second; assert.ok(f.draw().includes(PRIVATE.lateTimeline)); }
    old.resolve(Response.json(denialBody, { status: 403 })); await first;
    if (completed) {
      assert.deepEqual(readVisible(f), { ...retained, timeline: false });
      assert.ok(f.draw().includes(PRIVATE.lateTimeline), "the completed newer exact resource proof fences the older refusal");
    } else {
      assert.deepEqual(readVisible(f), withdrawn);
      body.resolve(newerBody); await second;
      assert.deepEqual(readVisible(f), withdrawn);
      assert.ok(!f.draw().includes(PRIVATE.lateTimeline));
      assert.equal(f.replay.timelines.length, 3, "accepted denial and late body cause no automatic timeline request");
      f.replay.onTimeline = null; await f.refresh(); await f.click(f.control("#inspect"));
      assert.deepEqual(readVisible(f), retained, "fresh explicit authorized collection and original timeline reads remain functional");
    }
  } finally {
    old.resolve(Response.json(denialBody, { status: 403 })); body.resolve(newerBody); await Promise.all([first, second]);
  }
});

test("B3 Replay a retained denial notice follows the current FR to JA locale without a new private request", async (t) => {
  const f = await replay(t, { locale: "fr", liveLocale: true });
  f.replay.onGet = () => Response.json(denialBody, { status: 403 }); await f.refresh();
  const french = f.i18n.t("shell.accessUnavailable", "Workspace unavailable"), requests = f.transport.requests.length;
  assert.ok(f.draw().includes(french)); assert.deepEqual(readVisible(f), withdrawn);
  assert.equal(f.host.i18n, f.i18n, "the mounted actual Replay uses the same actual subscribed locale controller");
  f.publishLocale("ja");
  const japanese = f.i18n.t("shell.accessUnavailable", "Workspace unavailable");
  assert.notEqual(japanese, french); assert.equal(f.host.i18n.locale, "ja");
  assert.ok(f.draw().includes(japanese)); assert.ok(!f.draw().includes(french));
  assert.deepEqual(readVisible(f), withdrawn);
  assert.equal(f.transport.requests.length, requests, "locale publication neither retries nor recertifies private access");
});
