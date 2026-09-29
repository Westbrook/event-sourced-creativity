import assert from "node:assert/strict";
import test from "node:test";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

const { NativeRetainedModel3d } = await ports.loadActual("src/components/native-retained-model3d.ts");
const { FormaModel3dViewer } = await ports.loadActual("src/components/model3d-viewer.ts");
const result = () => ({ schemaVersion: 1, kind: "native-retained-output", output: "model3d",
  selection: { documentId: "document-a", artifactId: "model-a", revision: 0, contentSha256: "a".repeat(64) },
  title: "Retained <script>literal</script> object", expiresAt: "2099-01-01T00:00:00.000Z",
  content: { availability: "mesh-reference", files: [{ url: "/api/media/owned%2Fmodel.glb", mimeType: "model/gltf-binary", fileName: "model.glb", fileSize: 200, format: "glb", role: "mesh", sha256: "b".repeat(64) },
    { url: "/api/media/owned%2Fposter.png", mimeType: "image/png", fileName: "poster.png", fileSize: 100, format: null, role: "preview", sha256: "c".repeat(64) }] } });

function fixture(t) {
  const original = { fetch: globalThis.fetch, active: ports.documentPort.activeElement, scroll: ports.windowPort.scrollTo };
  globalThis.fetch = () => assert.fail("No transport is permitted in renderer controls");
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false,
    tick: async () => true, pendingNativeComponentTags: new Set(["forma-model3d-viewer"]), frames: new Map(), timers: new Map(), resizeTargets: new Map(), storage: new Map(),
    i18n: { system: value => value, t: (_key, fallback) => fallback, number: value => String(value) } };
  ports.bindFixture(f); f.host = new NativeRetainedModel3d(); f.host.result = result();
  f.renderer = new ports.RendererPort(f, { "forma-model3d-viewer": FormaModel3dViewer }); f.renderer.draw(f.host);
  const origin = f.host.querySelector("button"); origin.scrollTop = origin.scrollLeft = 0;
  f.host.scrollTop = 200; f.host.scrollLeft = 8;
  origin.focus = () => { ports.documentPort.activeElement = origin; f.trace.push("return-focus"); };
  const close = { isConnected: true, focus: () => { ports.documentPort.activeElement = close; f.trace.push("close-focus"); } };
  const dialog = { isConnected: true, open: false, contains: node => node === close,
    querySelector: () => close, showModal() { this.open = true; f.trace.push("show-modal"); },
    close() { this.open = false; f.trace.push("close-modal"); }, remove() { this.isConnected = false; this.open = false; f.trace.push("remove-modal"); } };
  let retired = 0;
  f.host.querySelector = selector => selector === "dialog" ? dialog : null;
  f.host.querySelectorAll = selector => selector === "forma-model3d-viewer" ? [{ remove: () => { retired++; } }] : [];
  ports.windowPort.scrollTo = value => f.trace.push(["window-scroll", value]);
  origin.focus(); f.trace.length = 0;
  const open = () => origin.handlers.click({ currentTarget: origin });
  const template = () => { const markup = f.renderer.value(f.host.render(), f.host, "isolated-current"); return { markup, tree: fullPageTree(f, markup) }; };
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); ports.bindFixture(null); globalThis.fetch = original.fetch; ports.documentPort.activeElement = original.active; ports.windowPort.scrollTo = original.scroll; });
  return { f, origin, close, dialog, open, template, retired: () => retired };
}

// Complete actual class and Lit template, with finite native dialog/focus ports.
// Real modal behavior, geometry, touch and GLB decoding are separate browser checks.
test("retained model is scroll-safe and does not mount media before explicit inspection", t => {
  const f = fixture(t), { tree, markup } = f.template();
  assert.equal(tree.nodes.filter(node => node.tag === "forma-model3d-viewer" || node.tag === "dialog" || node.tag === "img").length, 0);
  assert.equal(tree.visible("button").length, 1);
  assert.equal(markup.includes("/api/media/owned"), false, "neither GLB nor unverified poster is automatically read");
  assert.equal(tree.visible("script").length, 0);
});

test("an inspection binds the exact retained source and closes only its own modal", async t => {
  const f = fixture(t); await f.open(); assert.equal(f.dialog.open, true);
  const first = f.template();
  const viewer = first.tree.nodes.find(node => node.tag === "forma-model3d-viewer");
  assert.equal(viewer.properties.src, f.f.host.result.content.files[0].url);
  assert.equal(viewer.properties.expectedSha256, "b".repeat(64)); assert.equal(viewer.properties.readonly, true);
  const close = first.tree.nodes.find(node => node.tag === "dialog").handlers.close;
  f.f.host.scrollTop = 700; close();
  assert.equal(f.retired(), 1); assert.equal(f.dialog.open, false); assert.equal(ports.documentPort.activeElement, f.origin); assert.equal(f.f.host.scrollTop, 200);
  f.dialog.isConnected = true; await f.open(); assert.equal(f.dialog.open, true);
  close(); assert.equal(f.dialog.open, true, "a queued close from the earlier inspection cannot close a newer one");
  assert.equal(f.retired(), 1);
});

test("source replacement during pending open retires the old viewer without opening or restoring stale focus", async t => {
  const f = fixture(t); let finish; f.f.tick = () => new Promise(resolve => { finish = resolve; });
  const pending = f.open(); f.f.host.result = { ...result(), title: "Different source" };
  const outside = {}; ports.documentPort.activeElement = outside; finish(true); await pending;
  assert.equal(f.retired(), 1); assert.equal(f.dialog.open, false); assert.equal(ports.documentPort.activeElement, outside);
  assert.equal(f.f.trace.includes("show-modal"), false); assert.equal(f.f.trace.includes("return-focus"), false);
  assert.equal(f.template().tree.nodes.some(node => node.tag === "forma-model3d-viewer"), false);
});

test("disconnect and expiry require fresh inspection and never transfer focus", async t => {
  const f = fixture(t); await f.open(); const outside = {}; ports.documentPort.activeElement = outside;
  f.f.host.isConnected = false; f.f.host.disconnectedCallback();
  assert.equal(f.dialog.open, false); assert.equal(ports.documentPort.activeElement, outside);
  f.f.host.isConnected = true; f.f.host.connectedCallback();
  assert.equal(f.template().tree.nodes.some(node => node.tag === "forma-model3d-viewer"), false);
  f.f.host.result = { ...result(), expiresAt: "2000-01-01T00:00:00.000Z" }; f.dialog.isConnected = true;
  await f.open(); assert.equal(f.dialog.open, false);
});
