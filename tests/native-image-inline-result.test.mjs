import assert from "node:assert/strict";
import test from "node:test";
import { nothing } from "lit";
import { PartType } from "lit/directive.js";
import { getDirectiveClass, isDirectiveResult } from "lit/directive-helpers.js";
import { createNativeImageInlineResult } from "../src/components/native-image-inline-result.ts";

// NEW safe controls. Reuses the surviving launcher's public Directive/ref seam.
// Plain native-shaped elements/events do not certify browser trust or pixels.
function commit(value) {
  for (let n = 0; isDirectiveResult(value); n++) {
    assert(n < 8);
    const C = getDirectiveClass(value);
    value = new C({ type: PartType.CHILD }).render(...value.values);
  }
  return value;
}
function element(tagName, document) {
  const attrs = new Map(), listeners = new Map(), children = new Set();
  return { tagName, ownerDocument: document, isConnected: true, hidden: false,
    disabled: false, textContent: "", src: "", currentSrc: "", complete: false,
    naturalWidth: 0, naturalHeight: 0, children,
    contains(node) { return children.has(node); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, value); if (name === "src") this.src = this.currentSrc = value; },
    removeAttribute(name) { attrs.delete(name); if (name === "src") this.src = ""; },
    addEventListener(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    listener(name) { const list = [...(listeners.get(name) ?? [])]; assert.equal(list.length, 1); return list[0]; },
    listenerCount(name) { return listeners.get(name)?.size ?? 0; },
    remove() { this.isConnected = false; },
  };
}
const event = node => ({ currentTarget: node, isTrusted: true });
function fixture(options = {}) {
  const selected = Object.freeze({ openingId: 1, submissionId: 2, readId: 3,
    documentId: "document-a", jobId: "job-a", outputId: "output-a", sourceEventId: "event-a",
    generationId: "generation-a", mediaUrl: "/api/media/u-757365722d31%2Fgenerated%2Fgeneration-a.png" });
  const input = { title: "Original <script>title</script>", alt: "Original image", caption: "Authored caption",
    width: 1536, height: 1024, editTarget: selected, labels: { loading: "Loading", unavailable: "Unavailable", edit: "Edit in Forma" } };
  const observations = [], edits = [];
  let current = selected, owner, calls = 0;
  owner = createNativeImageInlineResult(input, {
    currentTarget() { calls++; return options.current ? options.current(owner, current) : current; },
    changed(next) { observations.push(next); options.changed?.(next, owner); },
    edit(target, e, live) { edits.push({ target, event: e, current: live }); options.edit?.(target, e, live, owner); },
  });
  return { owner, input, selected, observations, edits, calls: () => calls,
    current(value) { current = value; },
    mount() {
      const template = commit(owner.render());
      const refs = template.values.filter(x => isDirectiveResult(x) && typeof x.values[0] === "function").map(x => x.values[0]);
      assert.equal(refs.length, 4);
      const document = { URL: "https://forma.example.test/document/document-a" };
      const [region, image, status, action] = ["SECTION", "IMG", "P", "BUTTON"].map(tag => element(tag, document));
      [image, status, action].forEach(node => region.children.add(node));
      [region, image, status, action].forEach((node, index) => refs[index](node));
      const clickIndex = template.strings.findIndex(s => s.endsWith("@click="));
      const loaded = image.listener("load"), failed = image.listener("error");
      return { region, image, status, action, refs, template, loaded, failed, activate: template.values[clickIndex],
        load() { image.complete = true; image.naturalWidth = 1536; image.naturalHeight = 1024; loaded(event(image)); } };
    },
  };
}
function cleared(m) {
  assert.equal(m.action.disabled, true); assert.equal(m.region.hidden, true);
  for (const node of [m.region, m.image, m.status, m.action]) assert.equal(node.isConnected, false);
  assert.equal(m.image.getAttribute("src"), null);
  assert.equal(m.image.listenerCount("load"), 0); assert.equal(m.image.listenerCount("error"), 0);
}

test("construction is inert until the launcher can install the exact binding", () => {
  const f = fixture(); assert.equal(f.calls(), 0); assert.deepEqual(f.observations, []);
  assert.equal(f.owner.state.status, "loading"); assert.equal(f.owner.state.ready, false);
  assert(Object.isFrozen(f.owner.state)); assert(Object.isFrozen(f.owner.state.binding));
});

test("one exact native load enables Edit; repeated rendering retains refs, key and listeners", () => {
  const f = fixture(), key = f.owner.render().values[0], m = f.mount(), loading = f.owner.state;
  assert.equal(m.action.disabled, true); assert.equal(m.status.textContent, "Loading");
  assert.equal(m.image.getAttribute("src"), f.selected.mediaUrl);
  m.load(); assert.equal(f.owner.state.status, "ready"); assert.equal(f.owner.state.ready, true);
  assert.equal(loading.status, "loading"); assert.equal(m.action.disabled, false);
  const ready = f.owner.state, template = commit(f.owner.render());
  assert.equal(f.owner.render().values[0], key);
  assert.deepEqual(template.values.filter(x => isDirectiveResult(x) && typeof x.values[0] === "function").map(x => x.values[0]), m.refs);
  [m.region, m.image, m.status, m.action].forEach((node, index) => m.refs[index](node));
  assert.equal(m.image.listener("load"), m.loaded); assert.equal(m.image.listener("error"), m.failed);
  m.load(); assert.equal(f.owner.state, ready); assert.equal(f.observations.length, 1);
  const e = event(m.action); m.activate(e);
  assert.equal(f.edits.length, 1); assert.equal(f.edits[0].event, e);
  assert.equal(f.edits[0].target, ready.editTarget); assert.equal(f.edits[0].current(), true);
  f.owner.retire(); cleared(m); assert.equal(f.edits[0].current(), false);
});

test("equivalent controller target snapshots preserve the owned loaded image", () => {
  const f = fixture(), m = f.mount(); f.current({ ...f.selected }); m.load();
  assert.equal(f.owner.state.ready, true); m.activate(event(m.action)); assert.equal(f.edits.length, 1);
});

for (const key of ["openingId", "submissionId", "readId", "documentId", "jobId", "outputId", "sourceEventId", "generationId", "mediaUrl"])
  test(`replacement ${key} retires before stale load or Edit`, () => {
    const f = fixture(), m = f.mount();
    f.current({ ...f.selected, [key]: typeof f.selected[key] === "number" ? f.selected[key] + 1 : f.selected[key] + "-other" });
    m.load(); assert.equal(f.owner.state.status, "retired"); cleared(m);
    m.activate(event(m.action)); assert.equal(f.edits.length, 0);
  });

for (const [name, change] of [
  ["wrong natural width", m => { m.image.naturalWidth = 10; }],
  ["wrong natural height", m => { m.image.naturalHeight = 10; }],
  ["incomplete image", m => { m.image.complete = false; }],
  ["wrong current URL", m => { m.image.currentSrc = "https://forma.example.test/api/media/other.png"; }],
  ["empty current URL", m => { m.image.currentSrc = ""; }],
  ["changed src attribute", m => { m.image.setAttribute("src", "/api/media/other.png"); }],
  ["disconnected image", m => { m.image.isConnected = false; }],
  ["foreign image placement", m => { m.region.children.delete(m.image); }],
  ["hidden region", m => { m.region.hidden = true; }],
]) test(name + " cannot grant readiness", () => {
  const f = fixture(), m = f.mount();
  m.image.complete = true; m.image.naturalWidth = 1536; m.image.naturalHeight = 1024; change(m);
  m.loaded(event(m.image)); assert.equal(f.owner.state.ready, false); assert.equal(f.owner.state.status, "unavailable");
  cleared(m); m.activate(event(m.action)); assert.equal(f.edits.length, 0);
});

test("untrusted or foreign load and Edit events grant no action", () => {
  const f = fixture(), m = f.mount();
  m.image.complete = true; m.image.naturalWidth = 1536; m.image.naturalHeight = 1024;
  m.loaded({ ...event(m.image), isTrusted: false }); m.loaded(event(m.action));
  assert.equal(f.owner.state.status, "loading"); m.load();
  m.activate({ ...event(m.action), isTrusted: false }); m.activate(event(m.image));
  assert.equal(f.edits.length, 0);
});

test("native error cleans all held nodes before unavailable publication and never heals", () => {
  let m; const f = fixture({ changed(next) { if (next.status === "unavailable") cleared(m); } });
  m = f.mount(); m.failed(event(m.image));
  assert.equal(f.owner.state.status, "unavailable"); assert.equal(f.observations.length, 1);
  m.load(); m.failed(event(m.image)); m.activate(event(m.action)); commit(f.owner.render());
  assert.equal(f.observations.length, 1); assert.equal(f.edits.length, 0);
});

test("retired refs and callbacks never remount the old source", () => {
  const f = fixture(), m = f.mount(); m.load(); f.owner.retire(); const retired = f.owner.state;
  [m.region, m.image, m.status, m.action].forEach((node, index) => m.refs[index](node));
  m.load(); m.failed(event(m.image)); m.activate(event(m.action)); f.owner.retire();
  assert.equal(f.owner.state, retired); assert.equal(commit(f.owner.render()), nothing); cleared(m);
});

test("currentness callback retirement wins over old load readiness", () => {
  let retire = false;
  const f = fixture({ current(owner, current) { if (retire) owner.retire(); return current; } }), m = f.mount();
  retire = true; m.load(); assert.equal(f.owner.state.status, "retired"); cleared(m);
  assert(!f.observations.some(x => x.status === "ready"));
});

test("readiness-current passed through Edit withdraws when the source changes during handoff", () => {
  let f; f = fixture({ edit(_target, _event, current) { f.current(null); assert.equal(current(), false); } });
  const m = f.mount(); m.load(); m.activate(event(m.action));
  assert.equal(f.edits.length, 1); assert.equal(f.owner.state.status, "retired"); cleared(m);
});

test("falsy publication failure retires and preserves the exact thrown reason", () => {
  const f = fixture({ changed(next) { if (next.status === "ready") throw undefined; } }), m = f.mount();
  let caught = false; try { m.load(); } catch (reason) { caught = true; assert.equal(reason, undefined); }
  assert(caught); assert.equal(f.owner.state.status, "retired"); cleared(m);
});

test("listener installation failure performs independent cleanup and preserves the original error", () => {
  const f = fixture(), template = commit(f.owner.render());
  const refs = template.values.filter(x => isDirectiveResult(x) && typeof x.values[0] === "function").map(x => x.values[0]);
  const doc = { URL: "https://forma.example.test/document/a" };
  const [region, image, status, action] = ["SECTION", "IMG", "P", "BUTTON"].map(tag => element(tag, doc));
  [image, status, action].forEach(node => region.children.add(node));
  const original = image.addEventListener, reason = new Error("native listener failure");
  image.addEventListener = function (name, callback) { original.call(this, name, callback); if (name === "error") throw reason; };
  refs[0](region); refs[1](image); refs[2](status);
  assert.throws(() => refs[3](action), error => error === reason);
  assert.equal(f.owner.state.status, "retired"); cleared({ region, image, status, action });
});

test("a second binding cannot adopt or remove an existing binding's node", () => {
  const original = fixture(), m = original.mount(); m.load();
  const next = fixture(), template = commit(next.owner.render());
  const refs = template.values.filter(x => isDirectiveResult(x) && typeof x.values[0] === "function").map(x => x.values[0]);
  refs[0](m.region);
  assert.equal(next.owner.state.status, "retired"); assert.equal(original.owner.state.status, "ready");
  assert.equal(m.region.hidden, false); assert.equal(m.action.disabled, false);
  assert.equal(m.image.getAttribute("src"), original.selected.mediaUrl);
  for (const node of [m.region, m.image, m.status, m.action]) assert.equal(node.isConnected, true);
  assert.equal(m.image.listener("load"), m.loaded); assert.equal(m.image.listener("error"), m.failed);
  m.activate(event(m.action)); assert.equal(original.edits.length, 1);
});

function detachedMount(f) {
  const template = commit(f.owner.render());
  const refs = template.values.filter(x => isDirectiveResult(x) && typeof x.values[0] === "function").map(x => x.values[0]);
  const document = { URL: "https://forma.example.test/document/a" };
  const [region, image, status, action] = ["SECTION", "IMG", "P", "BUTTON"].map(tag => element(tag, document));
  const nodes = [region, image, status, action]; nodes.forEach(node => { node.isConnected = false; });
  [image, status, action].forEach(node => region.children.add(node));
  nodes.forEach((node, index) => refs[index](node));
  return { region, image, status, action, nodes };
}

test("Lit's initially detached refs start once after their synchronous fragment commit", async () => {
  const f = fixture(), m = detachedMount(f);
  assert.equal(m.image.getAttribute("src"), null); assert.equal(m.image.listenerCount("load"), 0);
  m.nodes.forEach(node => { node.isConnected = true; }); await Promise.resolve();
  assert.equal(m.image.getAttribute("src"), f.selected.mediaUrl);
  assert.equal(m.image.listenerCount("load"), 1); assert.equal(f.owner.state.ready, false);
  m.image.complete = true; m.image.naturalWidth = 1536; m.image.naturalHeight = 1024;
  assert.equal(f.owner.state.ready, false, "cached completeness alone has no native load credit");
  m.image.listener("load")(event(m.image)); assert.equal(f.owner.state.ready, true);
});

for (const disposition of ["still detached", "source replaced", "explicitly retired"])
  test(`initial commit cannot start an image after it is ${disposition}`, async () => {
    const f = fixture(), m = detachedMount(f);
    if (disposition !== "still detached") m.nodes.forEach(node => { node.isConnected = true; });
    if (disposition === "source replaced") f.current(null);
    if (disposition === "explicitly retired") f.owner.retire();
    await Promise.resolve(); assert.equal(f.owner.state.status, "retired"); cleared(m);
    await Promise.resolve(); assert.equal(m.image.getAttribute("src"), null);
  });

test("changed loaded source is rechecked before Edit, not only on initial load", () => {
  const f = fixture(), m = f.mount(); m.load();
  m.image.currentSrc = "https://forma.example.test/api/media/other.png";
  m.activate(event(m.action)); assert.equal(f.edits.length, 0);
  assert.equal(f.owner.state.status, "unavailable"); cleared(m);
});
