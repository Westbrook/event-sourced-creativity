import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceView } from "../src/experiences/view.ts";
import { experienceNavigationAdapter } from "../src/experiences/navigation-adapter.ts";
import { parseExperienceHostRoute } from "../src/experiences/host-route.ts";
import { registeredExperience, initialValues } from "../src/experiences/intake.ts";

// Actual complete ExperienceView, navigation adapter, route/settings helpers and
// retained reference component. DOM and already-saved runtime are explicit ports;
// this does not qualify browser layout/touch, intake persistence or generation.
class Element extends EventTarget {
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.parentElement = null; this.hidden = false; this.className = ""; this.attributes = new Map(); this.text = ""; }
  get classList() { return { add: name => { this.className = [...new Set([...this.className.split(" "), name])].join(" "); }, remove: name => { this.className = this.className.split(" ").filter(x => x !== name).join(" "); } }; }
  set textContent(value) { this.replaceChildren(); this.text = value; }
  get textContent() { return this.text + this.children.map(x => x.textContent).join(""); }
  append(...children) { for (const child of children) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(x => x !== child); child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.all().find(x => selector.startsWith(".") ? x.className.split(" ").includes(selector.slice(1)) : x.tagName === selector.toUpperCase()) ?? null; }
  all() { return this.children.flatMap(x => [x, ...x.all()]); }
  focus() { this.ownerDocument.activeElement = this; }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const referenceSelection = { version: 1, sourceProjectId: "original-project", sourceDocumentId: "original-document", sourceBlockId: "original-block", referenceId: "original-reference", sha256: "f".repeat(64), permissionAttestation: "i-own-or-have-permission" };
const reference = { version: 1, selection: referenceSelection, sourceDigest: "e".repeat(64), properties: { label: "Owned still", reference_id: referenceSelection.referenceId, source_content_hash: referenceSelection.sha256, media_url: "/api/media/u-766964656f2d6f776e65642d74657374/still.png", media_type: "image/png", rights_class: "owned", pixel_reference_mode: "inspiration", weight: 1 } };
async function fixture(t, { output = "video", adapter = experienceNavigationAdapter("/experiences/video?progress-report") } = {}) {
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch, requests = [];
  const document = { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  globalThis.document = document;
  globalThis.fetch = async (path, init) => { requests.push({ path, init }); throw new Error("offline_preview"); };
  const root = document.createElement("main"), release = await registeredExperience(output === "short_story" ? "short-story" : output);
  const plan = { release, draftId: "experience-draft-" + "a".repeat(64), ...(output === "video" ? { reference } : {}) };
  const receipt = { documentRoute: "/document/saved-document", documentId: "saved-document", draftId: plan.draftId };
  let listener, unsubscribed = 0;
  const runtime = { release, committedPlan: plan, preparedPlan: plan, receipt, referenceReady: true,
    state: { phase: "complete", issues: [], draft: { values: initialValues(release), reference: referenceSelection } },
    subscribe(fn) { listener = fn; return () => { unsubscribed++; }; },
    prepare() { assert.fail("saved navigation must not prepare"); }, submit() { assert.fail("saved navigation must not submit"); }, recover() { assert.fail("saved navigation must not recover"); } };
  const view = new ExperienceView(root, runtime, adapter);
  t.after(() => { view.dispose(); globalThis.document = oldDocument; globalThis.fetch = oldFetch; });
  await settle();
  return { root, document, view, plan, receipt, runtime, requests, notify: () => listener(), unsubscribed: () => unsubscribed };
}
const link = (root, label) => root.all().find(x => x.tagName === "A" && x.textContent === label);
function visible(element) { for (let node = element; node; node = node.parentElement) if (node.hidden) return false; return true; }

test("saved Video mounts the actual Continue adapter without losing preview/settings or generating", async t => {
  const f = await fixture(t), next = link(f.root, "Continue");
  assert.ok(next, "saved Video must reach its navigation adapter"); assert.equal(visible(next), true);
  assert.deepEqual(parseExperienceHostRoute(next.href), { output: "video", draftId: f.plan.draftId, documentId: f.receipt.documentId, documentRoute: "/document/saved-document?progress-report=" });
  const preview = f.root.querySelector(".experience-video-retained-image"), details = f.root.querySelector(".experience-saved-details");
  assert.ok(preview); assert.match(preview.textContent, /Owned still/); assert.match(preview.textContent, new RegExp(referenceSelection.sha256));
  assert.match(details.textContent, /Saved settings/); assert.match(f.root.textContent, /No video generated/);
  assert.equal(link(f.root, "Edit in Forma").href, f.receipt.documentRoute);
  assert.equal(link(f.root, "Edit in Forma").className, "experience-button"); assert.equal(next.className, "experience-button primary");
  assert.equal(f.document.activeElement.textContent, "Document saved");
  next.focus();
  f.notify(); await settle();
  assert.equal(f.document.activeElement, next, "refresh must not steal Continue focus");
  assert.equal(link(f.root, "Continue"), next); assert.equal(f.root.querySelector(".experience-video-retained-image"), preview); assert.equal(f.root.querySelector(".experience-saved-details"), details);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].path, reference.properties.media_url); assert.equal(f.requests[0].init.method ?? "GET", "GET");
  f.view.dispose(); assert.equal(f.root.children.length, 0); assert.equal(next.parentElement, null); assert.equal(f.unsubscribed(), 1);
});

test("saved Video retains its honest no-adapter fallback", async t => {
  const f = await fixture(t, { adapter: null });
  assert.equal(link(f.root, "Continue"), undefined); assert.ok(link(f.root, "Edit in Forma"));
  assert.equal(link(f.root, "Edit in Forma").className, "experience-button primary");
  assert.match(f.root.textContent, /No video generated/); assert.ok(f.root.querySelector(".experience-video-retained-image"));
});

test("Video adapter failure is visible without replacing the saved preview", async t => {
  const f = await fixture(t, { adapter: { async mount() { throw new Error("unavailable"); } } });
  const target = f.root.querySelector(".experience-native-host"); assert.ok(target); assert.equal(visible(target), true);
  assert.equal(target.textContent, "Generation unavailable"); assert.ok(f.root.querySelector(".experience-video-retained-image")); assert.match(f.root.textContent, /No video generated/);
});

test("disposing saved Video aborts a pending mount and disposes its late session", async t => {
  let resolve, context, signal, disposed = 0;
  const f = await fixture(t, { adapter: { mount(_target, selected, abort) { context = selected; signal = abort; return new Promise(done => { resolve = done; }); } } });
  assert.equal(context.plan, f.plan); assert.equal(context.receipt, f.receipt);
  assert.deepEqual(context.settings, { output: "video", kind: "render_document", productionMode: "manual", artifactKind: "video", itemCount: 1, videoSeconds: 4, videoResolution: "480p", videoAudioMode: "silent" });
  assert.equal(Object.isFrozen(context), true); assert.equal(signal.aborted, false);
  f.view.dispose(); assert.equal(signal.aborted, true); resolve({ dispose() { disposed++; } }); await settle();
  assert.equal(disposed, 1); assert.equal(f.root.children.length, 0);
});

for (const output of ["image", "slides", "short_story", "scene", "storyboard", "audio", "model3d"]) test(`${output}: saved navigation still mounts its exact Continue route`, async t => {
  const f = await fixture(t, { output }), next = link(f.root, "Continue");
  assert.ok(next); assert.equal(visible(next), true); assert.equal(parseExperienceHostRoute(next.href).output, output);
  assert.equal(link(f.root, "Open in Forma").href, f.receipt.documentRoute); assert.equal(f.requests.length, 0);
});
