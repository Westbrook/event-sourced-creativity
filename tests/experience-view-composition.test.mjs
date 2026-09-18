import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceView } from "../src/experiences/view.ts";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";
import { ExperienceDisplay } from "../src/experiences/display-locale.ts";
import { registeredExperience } from "../src/experiences/intake.ts";

// Complete production view, runtime, registry and display modules. This finite
// DOM port exposes assignments, detach/focus and selection loss; it does not
// qualify a browser's text editing, OS IME, layout or assistive technology.
class Element extends EventTarget {
  children = []; parentElement = null; attributes = new Map(); dataset = {};
  className = ""; hidden = false; text = ""; valueWrites = 0;
  selectionStart = 0; selectionEnd = 0; selectionDirection = "none";
  #value = "";
  constructor(tag, ownerDocument) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument;
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  get value() { return this.#value; }
  set value(value) {
    this.valueWrites++; this.#value = String(value);
    // Programmatic text assignment is deliberately observable and disruptive.
    this.selectionStart = this.selectionEnd = this.#value.length;
    this.selectionDirection = "none";
  }
  get classList() { return {
    add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/u).filter(Boolean), ...names])].join(" "); },
    remove: (...names) => { this.className = this.className.split(/\s+/u).filter(name => !names.includes(name)).join(" "); },
  }; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  append(...children) {
    for (const child of children) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) {
      if (child.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
      child.parentElement = null;
    }
    this.children = []; this.text = ""; this.append(...children);
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  matches(selector) {
    if (selector === "*") return true;
    if (selector.startsWith(".")) return this.className.split(/\s+/u).includes(selector.slice(1));
    const data = /^\[data-([a-z-]+)="([^"]+)"\]$/u.exec(selector);
    if (data) return this.dataset[data[1].replace(/-([a-z])/gu, (_, c) => c.toUpperCase())] === data[2];
    assert.match(selector, /^[a-z0-9-]+$/u, "Fixture must explicitly support selectors used by the actual view");
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) { return this.all().filter(node => selector.split(",").some(part => node.matches(part.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { if (this.isConnected) this.ownerDocument.activeElement = this; }
  scrollIntoView(options) {
    // Retain the reading context at reveal time, not a simulated browser layout.
    this.ownerDocument.readingContext = {
      element: this, options, active: this.ownerDocument.activeElement,
      labels: this.querySelectorAll("label").map(label => ({ for: label.htmlFor, text: label.textContent })),
      errors: this.querySelectorAll("small").map(error => ({ id: error.id, text: error.textContent })),
    };
  }
  setSelectionRange(start, end, direction = "none") {
    this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
  }
}
class Input extends Event {
  constructor(type, { isComposing = false, data = null } = {}) {
    super(type); this.isComposing = isComposing; this.data = data;
  }
}
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
const selection = input => [input.selectionStart, input.selectionEnd, input.selectionDirection];
const field = (root, name) => root.all().find(node => node.tagName === "TEXTAREA" && node.name === name);
const click = node => { assert.ok(node, "Expected actual view control"); node.dispatchEvent(new Event("click")); };
const input = (node, value, composing = false) => { node.value = value; node.dispatchEvent(new Input("input", { isComposing: composing, data: value })); };
async function fixture(t, output) {
  const previous = { document: globalThis.document, fetch: globalThis.fetch, InputEvent: globalThis.InputEvent };
  const document = { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  document.body = document.createElement("body"); document.activeElement = document.body;
  globalThis.document = document; globalThis.InputEvent = Input;
  const requests = [];
  const noNetwork = async (url, init) => { requests.push({ url: String(url), method: init?.method ?? "GET" }); throw new Error("Unexpected network: composition fixture is local only"); };
  globalThis.fetch = noNetwork;
  const release = await registeredExperience(output), runtime = new ExperienceIntakeRuntime(release, noNetwork);
  const display = new ExperienceDisplay("en"), root = document.createElement("main"); document.body.append(root);
  let prepared = 0, changed = 0;
  const prepare = runtime.prepare.bind(runtime), change = runtime.change.bind(runtime);
  runtime.prepare = (...args) => { prepared++; return prepare(...args); };
  runtime.change = (...args) => { changed++; return change(...args); };
  const view = new ExperienceView(root, runtime, undefined, display);
  t.after(() => {
    view.dispose(); runtime.dispose();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    assert.deepEqual(requests, [], "No draft storage, provider, file or other HTTP request is allowed");
  });
  await settle();
  return { root, document, runtime, display, requests, counts: () => ({ prepared, changed }) };
}

test("actual standalone Image keeps composition and selection across preview and locale changes, and blocks Review until composition ends", async t => {
  const f = await fixture(t, "image"), subject = field(f.root, "subject");
  input(subject, "Committed reference");
  subject.focus(); subject.dispatchEvent(new Event("compositionstart"));
  input(subject, "Teapot 日本語 مرحبا\nsecond line", true); subject.setSelectionRange(7, 10, "backward");
  const writes = subject.valueWrites, caret = selection(subject), before = f.counts();
  const preview = f.root.querySelector(".experience-stage"), previousPreview = preview.children[0];
  click(f.root.all().find(node => node.tagName === "BUTTON" && node.textContent === "Left"));
  assert.notEqual(preview.children[0], previousPreview, "Actual runtime notification must replace the direction preview");
  assert.equal(f.runtime.state.draft.values.composition.value, "left");
  assert.equal(f.runtime.state.draft.values.subject.value, "Committed reference", "Uncommitted composition stays local to the control");
  assert.equal(f.counts().changed, before.changed + 1, "Only the separate composition choice changed canonical draft values");
  for (const locale of ["ja", "ar"]) {
    assert.equal(f.display.setLocale(locale), true);
    assert.equal(field(f.root, "subject"), subject); assert.equal(subject.isConnected, true);
    assert.equal(f.document.activeElement, subject); assert.equal(subject.value, "Teapot 日本語 مرحبا\nsecond line");
    assert.equal(subject.valueWrites, writes); assert.deepEqual(selection(subject), caret);
  }
  const review = f.root.querySelector(".experience-footer").querySelector("button");
  click(review); await settle();
  assert.equal(f.counts().prepared, 0, "Actual Review callback must not enter preparation during composition");
  assert.equal(f.runtime.state.phase, "setup"); assert.deepEqual(f.requests, []);
  const changes = f.counts().changed;
  subject.dispatchEvent(new Event("compositionend"));
  assert.equal(f.counts().changed, changes + 1); assert.equal(f.runtime.state.draft.values.subject.value, subject.value);
  assert.equal(field(f.root, "subject"), subject); assert.equal(subject.valueWrites, writes);
  assert.equal(f.document.activeElement, subject); assert.deepEqual(selection(subject), caret);
  assert.ok(preview.textContent.includes(subject.value));
  click(review); await settle();
  assert.equal(f.counts().prepared, 1, "Review works again after composition ends");
  assert.ok(f.runtime.state.issues.some(issue => issue.path === "ratio"), "The actual runtime supplies unpaid required-ratio validation");
  assert.deepEqual(f.requests, []);
});

test("actual standalone input isComposing guard excludes an input event even without compositionstart", async t => {
  const f = await fixture(t, "image"), subject = field(f.root, "subject");
  subject.focus(); const before = f.counts().changed;
  input(subject, "日本語 intermediate", true); subject.setSelectionRange(2, 2);
  assert.equal(f.counts().changed, before); assert.equal(f.runtime.state.draft.values.subject.value, "");
  assert.equal(f.display.setLocale("fr"), true);
  assert.equal(field(f.root, "subject"), subject); assert.equal(subject.value, "日本語 intermediate"); assert.deepEqual(selection(subject), [2, 2, "none"]);
  input(subject, "日本語 final\nline", false); subject.setSelectionRange(3, 7, "forward");
  assert.equal(f.counts().changed, before + 1); assert.equal(f.runtime.state.draft.values.subject.value, "日本語 final\nline");
  const writes = subject.valueWrites;
  f.runtime.change("lighting", "soft");
  assert.equal(subject.valueWrites, writes); assert.deepEqual(selection(subject), [3, 7, "forward"]); assert.equal(f.document.activeElement, subject);
});

test("actual Slides keeps the composed evidence node and blocks reorder until composition ends", async t => {
  const f = await fixture(t, "slides"), list = f.root.querySelector(".experience-evidence");
  const order = f.runtime.state.draft.values.evidence.value.map(item => item.id), originalRow = list.children[0];
  assert.ok(order.length >= 2); const evidence = originalRow.querySelector("textarea"), down = originalRow.querySelector('[data-move="down"]');
  evidence.focus(); evidence.dispatchEvent(new Event("compositionstart"));
  input(evidence, "証拠 مرحبا\n{number}", true); evidence.setSelectionRange(3, 8, "backward");
  const writes = evidence.valueWrites, caret = selection(evidence);
  f.runtime.change("claim", "Independent preview change"); f.display.setLocale("ar");
  assert.equal(list.children[0], originalRow); assert.equal(originalRow.querySelector("textarea"), evidence);
  assert.equal(evidence.valueWrites, writes); assert.deepEqual(selection(evidence), caret); assert.equal(f.document.activeElement, evidence);
  const before = f.counts().changed; click(down);
  assert.equal(f.counts().changed, before); assert.deepEqual(f.runtime.state.draft.values.evidence.value.map(item => item.id), order);
  evidence.dispatchEvent(new Event("compositionend"));
  assert.equal(f.runtime.state.draft.values.evidence.value[0].text, evidence.value); assert.equal(f.counts().changed, before + 1);
  click(down);
  assert.deepEqual(f.runtime.state.draft.values.evidence.value.map(item => item.id), [order[1], order[0], ...order.slice(2)]);
  assert.equal(list.children[1], originalRow); assert.equal(originalRow.querySelector("textarea"), evidence);
  assert.equal(evidence.valueWrites, writes); assert.deepEqual(selection(evidence), caret);
  assert.equal(f.document.activeElement, down, "Completed tap reorder intentionally focuses the same move control");
  assert.equal(f.counts().prepared, 0); assert.deepEqual(f.requests, []);
});

for (const output of ["model3d", "image"]) {
  test(`actual ${output} invalid Review reveals its associated label and ready error while preserving the editable value and selection`, async t => {
    const f = await fixture(t, output), subject = field(f.root, "subject");
    // Whitespace is still a required-field error, but gives selection retention a
    // nontrivial range. This uses the actual compiler/runtime, never an API stub.
    input(subject, " \n "); subject.setSelectionRange(1, 2, "backward");
    const retainedValue = subject.value, retainedSelection = selection(subject), writes = subject.valueWrites;
    const review = f.root.querySelector(".experience-footer").querySelector("button");
    review.focus(); click(review); await settle();
    assert.equal(f.counts().prepared, 1); assert.equal(f.runtime.state.phase, "setup");
    assert.deepEqual(f.runtime.state.issues[0], { code: "required", path: "subject" });
    assert.equal(field(f.root, "subject"), subject, "Validation keeps the same native editing control mounted");
    assert.equal(f.document.activeElement, subject, "The user can correct the invalid field immediately");
    assert.equal(subject.value, retainedValue); assert.equal(subject.valueWrites, writes);
    assert.deepEqual(selection(subject), retainedSelection);
    assert.equal(subject.getAttribute("aria-invalid"), "true");
    const context = f.document.readingContext;
    assert.ok(context, "Invalid focus must reveal reading context as well as the editing control");
    assert.equal(context.active, subject); assert.equal(context.element.contains(subject), true);
    assert.deepEqual(context.labels, [{ for: subject.id, text: output === "model3d" ? "Object description" : "Subject" }]);
    assert.deepEqual(context.errors, [{ id: subject.getAttribute("aria-describedby"), text: "Required" }],
      "The associated error is already published when its reading group is revealed");
    assert.equal(context.element, subject.parentElement, "Only the field's own label/control/error group is revealed");
    assert.deepEqual(f.requests, [], "Invalid Review cannot reach draft storage, a provider, or a reference API");
  });
}
