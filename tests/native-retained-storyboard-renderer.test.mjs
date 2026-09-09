import assert from "node:assert/strict";
import test, { after } from "node:test";
import { nothing } from "lit";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw Error("No transport in native Storyboard renderer controls"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(external, 0); });
const { NativeRetainedStoryboard, renderNativeRetainedStoryboard } = await ports.loadActual("src/components/native-retained-storyboard.ts");
const image = name => ({ url: "/api/media/u-owner%2Fgenerated%2F" + name + ".png", mediaType: "image/png", width: 1024, height: 768 });
const storyboard = () => ({ schemaVersion: 1, kind: "native-retained-output", output: "storyboard",
  selection: { documentId: "document-a", artifactId: "storyboard-a", revision: 0, contentSha256: "a".repeat(64) },
  title: "Threshold sequence · عتبة", expiresAt: "2099-01-01T00:00:00.000Z", content: { frames: [
    { id: "frame-z", title: "First — البداية", body: "Literal <script>not executable</script> & copy.\nSecond line.", notes: "Keep  two spaces.\nملاحظة", imagePrompt: "A quiet doorway.\nضوء الفجر", image: image("frame-z") },
    { id: "frame-a", title: "Second", body: "The keeper checks the chart.", notes: "", imagePrompt: "Blue light.", image: image("frame-a") },
    { id: "frame-m", title: "Third without a retained image", body: "This authored frame stays present.", notes: "Still part of the sequence.", imagePrompt: "Unrendered dawn.", image: null },
  ] } });

function fixture(t) {
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false,
    tick: async () => true, frames: new Map(), timers: new Map(), resizeTargets: new Map(), storage: new Map() };
  ports.bindFixture(f);
  const state = { result: storyboard(), mounted: true }, labels = [];
  const locale = { system(value) { labels.push(value); return "UI:" + value; } };
  class Parent extends ports.ElementPort {
    render() { return state.mounted ? renderNativeRetainedStoryboard(state.result, locale) : nothing; }
  }
  f.host = new Parent(); f.host.tag = "fixture-storyboard-owner"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, { "forma-native-retained-storyboard": NativeRetainedStoryboard });
  const draw = () => { ports.bindFixture(f); f.renderer.draw(f.host); return f.host.querySelector("forma-native-retained-storyboard"); };
  const tree = () => fullPageTree(f);
  t.after(() => { state.mounted = false; draw(); ports.bindFixture(null); });
  return { f, state, labels, draw, tree };
}
const classed = (tree, name) => tree.nodes.filter(node => node.attributes.class === name);
const rawText = node => node.children.map(child => typeof child === "string" ? child : rawText(child)).join("");
const frameIds = tree => tree.visible("li").map(node => node.attributes["data-frame-id"]);

// Actual component/template/handler controls using existing finite native ports.
// These do not certify browser image decoding, layout, source or read authority.
test("native Storyboard preserves exact ordered frame identity and literal copy, including a missing image", t => {
  const f = fixture(t); f.draw(); const tree = f.tree(), frames = f.state.result.content.frames;
  assert.deepEqual(frameIds(tree), ["frame-z", "frame-a", "frame-m"]);
  assert.deepEqual(classed(tree, "native-retained-storyboard-body").map(rawText), frames.map(frame => frame.body));
  assert.deepEqual(classed(tree, "native-retained-storyboard-frame-title").map(rawText), frames.map(frame => frame.title));
  assert.deepEqual(tree.visible("dd").map(rawText), frames.flatMap(frame => [frame.notes, frame.imagePrompt].filter(Boolean)));
  assert.equal(tree.visible("script").length, 0);
  assert.equal(tree.visible("img").length, 2);
  assert.deepEqual(tree.visible("img").map(node => node.attributes.src), frames.slice(0, 2).map(frame => frame.image.url));
  assert.equal(classed(tree, "native-retained-storyboard-unavailable").length, 1);
  assert.equal(rawText(classed(tree, "native-retained-storyboard-unavailable")[0]), "UI:Image unavailable");
  assert.equal(tree.visible("button").length + tree.visible("a").length, 0);
  assert.ok(f.labels.every(label => ["Storyboard", "Image unavailable", "Notes", "Image prompt input"].includes(label)), "authored content never enters system localization");
});

test("native image failure changes only that frame's image and preserves the complete authored sequence", async t => {
  const f = fixture(t), child = f.draw(), before = f.tree();
  f.f.requested = false;
  await f.f.renderer.handler(child, "img", node => node.attributes.src.endsWith("frame-z.png"), "error")({ type: "error" });
  assert.equal(f.f.requested, true);
  assert.equal(f.draw(), child); const after = f.tree();
  assert.deepEqual(frameIds(after), frameIds(before));
  for (const name of ["native-retained-storyboard-body", "native-retained-storyboard-frame-title", "native-retained-storyboard-details"])
    assert.deepEqual(classed(after, name).map(rawText), classed(before, name).map(rawText));
  assert.deepEqual(after.visible("img").map(node => node.attributes.src), [f.state.result.content.frames[1].image.url]);
  assert.equal(classed(after, "native-retained-storyboard-unavailable").length, 2);
});

test("a retired result or detached image cannot mark the current Storyboard unavailable; unsafe image URLs are never emitted", t => {
  const f = fixture(t), child = f.draw();
  const oldImage = f.f.renderer.ownNodes(child, "img")[0], oldHandler = oldImage.handlers.error;
  f.state.result = storyboard(); f.state.result.selection = { ...f.state.result.selection, artifactId: "storyboard-b" };
  f.draw(); assert.equal(oldImage.isConnected, false); f.f.requested = false;
  oldHandler({ type: "error", target: oldImage, currentTarget: oldImage });
  assert.equal(f.f.requested, false); assert.equal(f.tree().visible("img").length, 2);
  const currentImage = f.f.renderer.ownNodes(child, "img")[0], currentHandler = currentImage.handlers.error;
  f.state.mounted = false; f.draw(); f.f.requested = false;
  currentHandler({ type: "error", target: currentImage, currentTarget: currentImage });
  assert.equal(f.f.requested, false); assert.equal(f.tree().visible("img").length, 0);
  f.state.mounted = true; f.state.result = storyboard();
  f.state.result.content.frames[0].image.url = "https://outside.invalid/image.png";
  f.state.result.content.frames[1].image.url = "data:image/png;base64,AAAA";
  f.draw(); assert.equal(f.tree().visible("img").length, 0);
  assert.deepEqual(frameIds(f.tree()), ["frame-z", "frame-a", "frame-m"]);
  assert.equal(classed(f.tree(), "native-retained-storyboard-unavailable").length, 3);
});


const { FormaRetainedShortStory } = await ports.loadActual("src/components/forma-retained-short-story.ts",
  new Map([["./native-retained-storyboard.ts", { renderNativeRetainedStoryboard }]]));

// The actual Host and decoder run against the existing finite ports. Observe
// its public toolbar template without invoking updated() or Lit's DOM mount.
function retainedHostFixture(t, initialFragment = "") {
  const result = storyboard(), selected = result.selection, listeners = new Set();
  const route = `/make/storyboard?document=${selected.documentId}&artifact=${selected.artifactId}&revision=0&sha256=${selected.contentSha256}`;
  const cell = value => ({ get: () => value, set(next) { value = next; } });
  const authorization = { key: "synthetic-retained-reader", shared: false }, source = { generation: 1 };
  const authority = { active: true, sourceActive: true };
  const requests = [];
  const store = {
    route: cell(route + initialFragment), loading: cell(false), events: cell([]),
    session: cell({ user: { userId: "synthetic-reader", role: "creator" } }),
    projection: cell({ documentId: selected.documentId, projectId: "project-a", libraryArtifacts: [{
      id: selected.artifactId, documentId: selected.documentId, kind: "storyboard", sourceEventId: "completion-a",
      contentRef: "private-content-a", sequence: 2,
    }] }),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    captureAuthorizationScope: () => authorization,
    authorizationScopeActive: captured => captured === authorization && authority.active,
    captureSourceOwnership: () => source,
    sourceOwnershipActive: captured => captured === source && authority.sourceActive,
    guardedFetch(path, init, operation, controls) {
      let resolve;
      const promise = new Promise(complete => { resolve = complete; });
      const request = { path, init, operation, current: controls.current, aborts: 0, settled: false,
        fulfill(value = result) {
          assert.equal(this.settled, false); this.settled = true;
          const response = new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
          Object.defineProperty(response, "url", { value: new URL(path, "https://fixture.invalid").href });
          resolve(response);
        } };
      init.signal.addEventListener("abort", () => { request.aborts++; }, { once: true });
      requests.push(request);
      return promise;
    },
  };
  const f = { store, trace: [], listeners: new Map(), changed: new Map(), requested: false,
    i18n: { t: (_key, fallback) => fallback, system: value => value }, tick: async () => true,
    frames: new Map(), timers: new Map(), timerSequence: 0, resizeTargets: new Map(), storage: new Map() };
  ports.bindFixture(f);
  f.host = new FormaRetainedShortStory(); f.host.tag = "forma-retained-short-story"; f.host.attributes = {};
  Object.defineProperty(f.host, "ownerDocument", { value: { location: { origin: "https://fixture.invalid" } } });
  f.renderer = new ports.RendererPort(f, {});
  const notify = () => { ports.bindFixture(f); for (const callback of [...listeners]) callback(); };
  const tree = () => { ports.bindFixture(f); return fullPageTree(f, f.renderer.value(f.host.render(), f.host, "retained-host")); };
  const changeRoute = next => { store.route.set(next); notify(); };
  const retire = event => {
    if (event === "forma-authorization-changed") authority.active = false;
    else authority.sourceActive = false;
    ports.bindFixture(f);
    for (const callback of [...(f.listeners.get(event) ?? [])]) callback({ type: event });
    notify();
  };
  f.host.isConnected = true;
  f.host.connectedCallback();
  t.after(async () => {
    ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback();
    for (const request of requests) if (!request.settled) request.fulfill();
    await new Promise(resolve => setImmediate(resolve));
    ports.bindFixture(null);
  });
  return { f, route, store, requests, tree, changeRoute, retire };
}

test("native retained Host preserves one owner through initial, pending and ready URL fragments", async t => {
  for (const initialFragment of ["", "#main-content"]) await t.test(initialFragment || "without initial fragment", async child => {
    const f = retainedHostFixture(child, initialFragment);
    assert.equal(f.requests.length, 1, "an initial fragment still starts the exact retained read");
    const request = f.requests[0];
    assert.equal(request.current(), true); assert.equal(request.init.signal.aborted, false);
    assert.equal(request.init.method, "GET"); assert.equal(request.init.cache, "no-store");
    assert.equal(request.path.includes("#"), false, "the actual decoder receives the literal fragment-free API path");
    assert.equal(f.tree().visible("a").length, 0);
    f.changeRoute(f.route + "#pending-reader");
    assert.equal(f.requests.length, 1); assert.equal(request.current(), true); assert.equal(request.aborts, 0);
    request.fulfill();
    await new Promise(resolve => setImmediate(resolve));
    const ready = f.tree(), handoff = ready.visible("a");
    assert.equal(handoff.length, 1, "the original response reaches the ready Host through the actual decoder");
    assert.equal(rawText(handoff[0]), "Edit in Forma");
    const href = handoff[0].attributes.href;
    assert.equal(rawText(classed(ready, "retained-story-status")[0]), "");
    for (const fragment of ["#main-content", "#other-section", ""]) {
      f.changeRoute(f.route + fragment);
      const current = f.tree();
      assert.equal(f.requests.length, 1); assert.equal(request.current(), true);
      assert.equal(request.init.signal.aborted, false); assert.equal(request.aborts, 0);
      assert.equal(current.visible("a")[0]?.attributes.href, href);
      assert.equal(rawText(classed(current, "retained-story-status")[0]), "");
    }
  });
});

test("native retained Host still withdraws ready output for changed selection, authorization or source retirement", async t => {
  for (const cause of ["selection", "forma-authorization-changed", "forma-event-source-retired"]) await t.test(cause, async child => {
    const f = retainedHostFixture(child, "#main-content"), request = f.requests[0];
    assert.ok(request); request.fulfill();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.tree().visible("a").length, 1);
    if (cause === "selection") f.changeRoute(f.route.replace("artifact=storyboard-a", "artifact=storyboard-b") + "#main-content");
    else f.retire(cause);
    assert.equal(request.init.signal.aborted, true); assert.equal(request.current(), false); assert.equal(request.aborts, 1);
    assert.equal(f.tree().visible("a").length, 0);
    assert.equal(rawText(classed(f.tree(), "retained-story-status")[0]), "Unavailable");
    assert.equal(f.requests.length, 1, "the withdrawn owner never requests a replacement result");
  });
});
