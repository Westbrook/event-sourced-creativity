import assert from "node:assert/strict";
import { test, deferred, until, replayCallbacks, PRIVATE, estimateBody } from "./helpers/replay-callback-native.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

// These12 current-component/finite-native cases preserve the corrected root-run
// fragment baseline bodies and ports exactly. The actual Platform is rendered
// only for its Skip anchor, not connected as Replay\'s parent. No physical
// navigation, provider execution, settlement or budget operation is certified.
// The existing helper supplies bounded lifetime, finite HTTP and source/write
// isolation; root must use its mandatory no-provider preload and serial runner.
const BASE = "/product/evaluation/actual";
const TIMELINE = "/api/replay-sessions/callback-owned-A?cursor=0&limit=40";
const TIMELINE_TYPE = "B3_FINITE_ORIGINAL_TIMELINE_ONLY";
const ESTIMATE = "/api/replay-sessions/estimate";

async function fragmentFixture(t, kind = "failed") {
  const f = await replayCallbacks(t, kind);
  // This value initially agrees with the existing lexical Location getters;
  // subsequent native history does not rewrite Creator Store.route or session.
  f.nativeHistoryLocation = new URL(BASE, "https://fixture.invalid");
  f.replay.timelines = [];
  const transport = f.transport.handler;
  f.transport.handler = request => {
    if (request.method === "GET" && request.url === TIMELINE) {
      f.replay.timelines.push(request);
      return Response.json({ events: [{ sequence: 1, type: TIMELINE_TYPE }] });
    }
    return transport(request);
  };
  const { FormaPlatformShell } = await ports.loadActual("src/components/forma-platform-shell.ts");
  const shell = new FormaPlatformShell(), renderer = new ports.RendererPort(f, {});
  shell.tag = "forma-platform-shell"; shell.attributes = {}; shell.children = [];
  renderer.markup = renderer.value(shell.render(), shell, "host");
  renderer.collect(renderer.markup, shell);
  const anchors = renderer.ownNodes(shell, "a").filter(node => node.attributes.class === "skip-link");
  assert.equal(anchors.length, 1); assert.equal(anchors[0].attributes.href, "#main-content");
  assert.equal(anchors[0].handlers.click, undefined, "current actual Platform Skip uses the native default, not an application click callback");
  assert.equal(shell.isConnected, false, "do not mislabel this source-rendered parent control as a mounted full Platform hierarchy");
  f.skipHref = anchors[0].attributes.href;
  f.draw();
  const session = f.platform.platformSession.get(), route = f.store.route.get(), owner = f.host;
  f.assertFragmentBoundaries = () => {
    assert.equal(f.platform.platformSession.get() === session, true, "no synthetic authority or effective-persona change");
    assert.equal(f.store.route.get(), route, "native Location is independent of Creator Store routing");
    assert.equal(f.host === owner, true, "callback controls retain the original complete Replay instance");
    assert.ok(f.replay.posts.every(call => call.url === ESTIMATE), "only explicitly modeled free estimates, never approval/generate/retry/persona");
  };
  return f;
}

function nativeHistory(f, destination) {
  const old = new URL(f.nativeHistoryLocation.href), next = new URL(destination, old);
  const differentResource = old.pathname + old.search !== next.pathname + next.search;
  f.nativeHistoryLocation = next;
  // Model only the browser event relevant to each boundary. The actual mounted
  // Replay's registered listener runs; no production method is called directly.
  if (differentResource) f.emitWindow("popstate", { state: null });
  if (old.hash !== next.hash) f.emitWindow("hashchange", { oldURL: old.href, newURL: next.href });
  f.draw();
  return { from: old.pathname + old.search + old.hash, to: next.pathname + next.search + next.hash,
    differentResource, fullParentMounted: false, physicalHistory: false };
}

for (const operation of ["inspect", "estimate"]) for (const boundary of ["none", "skip", "skip-refresh"])
  test("B3 R2 Replay fragment current " + operation + " " + boundary, async t => {
    const f = await fragmentFixture(t);
    const beforeGets = f.replay.gets.length;
    const transition = boundary === "none" ? null : nativeHistory(f, f.skipHref);
    assert.ok(f.draw().includes(PRIVATE.title), "the original saved row remains visibly available");
    if (boundary === "skip-refresh") await f.refresh();
    const button = f.control(operation === "inspect" ? "#inspect" : "#estimate");
    assert.equal(button.disabled, false, "this is a current visible enabled control, not a retained removed callback");
    await f.click(button);
    const count = operation === "inspect" ? f.replay.timelines.length : f.postCount(ESTIMATE);
    const published = f.draw().includes(operation === "inspect" ? TIMELINE_TYPE : "$987.65");
    t.diagnostic(JSON.stringify({ operation, boundary, transition, currentRequests: count, published, listReads: f.replay.gets.length - beforeGets }));
    f.assertFragmentBoundaries();
    assert.equal(f.replay.gets.length - beforeGets, boundary === "skip-refresh" ? 1 : 0, "Skip never fabricates another private list proof");
    assert.equal(count, 1, "the current exact visible action remains usable without a hidden mandatory Refresh");
    assert.equal(published, true, "the finite exact response is published for the current resource");
    if (operation === "estimate") assert.deepEqual(f.replay.posts[0].body,
      { seed: "", eventCount: 1000, providerCoverage: "automatic", studyTypes: [] });
    else assert.equal(f.replay.posts.length, 0);
  });

for (const boundary of ["none", "skip", "pathname", "query"])
  test("B3 R2 Replay fragment held original estimate " + boundary, async t => {
    const f = await fragmentFixture(t), gate = deferred();
    f.replay.postHandlers.set(ESTIMATE, () => gate.promise);
    const pending = f.click(f.control("#estimate"));
    try {
      await until(() => f.postCount(ESTIMATE) === 1, "the one original finite estimate is already in flight");
      const original = structuredClone(f.replay.posts[0]), gets = f.replay.gets.length;
      const transition = boundary === "none" ? null : nativeHistory(f, boundary === "skip" ? f.skipHref
        : boundary === "pathname" ? "/product/insights" : BASE + "?view=other");
      gate.resolve(Response.json(estimateBody())); await pending;
      const published = f.draw().includes("$987.65"), retainsResource = boundary === "none" || boundary === "skip";
      t.diagnostic(JSON.stringify({ boundary, transition, lateEstimateVisible: published, sameResource: retainsResource }));
      f.assertFragmentBoundaries();
      assert.equal(f.postCount(ESTIMATE), 1, "there is no automatic retry or replacement request");
      assert.deepEqual(f.replay.posts[0], original, "the original request and input stay exact");
      assert.equal(f.replay.gets.length, gets, "history does not silently re-read or certify the original");
      assert.equal(published, retainsResource, "same-resource Skip retains the original continuation; path/query departures retire it");
    } finally { gate.resolve(Response.json(estimateBody())); await pending; }
  });

// Paired repair guard: retaining task ownership across Skip must not revive an
// older opening's focus lease after a newer native focus gesture. This uses the
// same explicit native other-control focus port as the unchanged callback22.
for (const skip of [false, true]) test("B3 R2 Replay fragment held persona opening " + (skip ? "Skip keeps newer focus" : "healthy current field focus"), async t => {
  const f = await fragmentFixture(t, "persona"), gate = deferred();
  f.holdUpdate = gate;
  const pending = f.click(f.control("#requestPersona"));
  try {
    await until(() => f.updateWaits === 1, "actual persona opening awaits its native updateComplete port");
    let other;
    if (skip) {
      nativeHistory(f, f.skipHref);
      other = f.native("button"); f.owner.append(other); other.focus();
    }
    gate.resolve(true); await pending; f.draw();
    f.assertFragmentBoundaries();
    if (skip) {
      assert.equal(f.personaDialog() === null, true, "old continuation cannot present its modal after the newer focus gesture");
      assert.equal(f.doc.activeElement === other, true, "newer native focus remains exact");
      assert.equal(f.replay.shows.length, 0);
    } else {
      assert.ok(f.personaDialog()?.open); assert.equal(f.replay.shows.length, 1);
      assert.equal(f.doc.activeElement?.attributes?.name, "confirmation");
    }
    assert.equal(f.replay.posts.length, 0); assert.deepEqual(f.replay.navigation, []);
  } finally { gate.resolve(true); await pending; }
});
