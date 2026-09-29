import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { html, noChange, nothing } from "lit";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

// Reuse the retained Audio renderer's actual-source/native-template ports.
// No Audio test suite, Worker fixture or browser is constructed by these controls.
const { VideoTrimEditor } = await ports.loadActual("src/components/video-trim-editor.ts");
const { videoTrimCopy } = await ports.loadActual("src/components/design-system/locales/video-trim-messages.ts");
const selection = (endSample = 3) => ({ startSample: 0, endSample, info: {
  sampleCount: 4, timescale: 1000, durationTicks: 11000, durationSeconds: 11,
  width: 32, height: 18, sourceSha256: "a".repeat(64), sampleDurationTicks: [1000, 2000, 5000, 3000],
} });

function leafFixture(t, { locale = "en", accept = true } = {}) {
  const inputDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
  // Only supply the missing native input brand/value port. Neither the actual
  // component's selection setter nor its renderer or event handler is replaced.
  class NativeInputPort {
    static [Symbol.hasInstance](node) { return node instanceof ports.ElementPort && node.tag === "input"; }
  }
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: NativeInputPort });
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false,
    tick: async () => true, frames: new Map(), timers: new Map(), resizeTargets: new Map(), storage: new Map(), locale };
  f.i18n = { locale, direction: locale === "ar" ? "rtl" : "ltr",
    number(value, options) { return new Intl.NumberFormat(locale, { useGrouping: false, ...options }).format(value); } };
  ports.bindFixture(f);
  f.host = new VideoTrimEditor(); f.host.tag = "forma-video-trim-editor"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, {});
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start).filter(node => node.tag === "input")) {
      Object.defineProperty(node, "valueAsNumber", { configurable: true,
        get() { return String(this.value).trim() === "" ? NaN : Number(this.value); } });
    }
  };
  const events = [];
  f.host.eventBindings = {
    "video-trim-change"(event) {
      events.push(event);
      if (accept && f.host.selection) f.host.selection = { ...f.host.selection, ...event.detail };
    },
    "video-trim-invalid"(event) { events.push(event); },
  };
  const draw = () => { ports.bindFixture(f); f.renderer.draw(f.host); return fullPageTree(f); };
  const input = className => f.renderer.nodes.find(node => node.tag === "input" && node.classList.contains(className));
  const enter = (className, value) => {
    const node = input(className); assert.ok(node, className); node.value = String(value);
    node.handlers.input({ type: "input", target: node, currentTarget: node });
    return node;
  };
  f.host.selection = selection();
  t.after(() => {
    f.host.isConnected = false; f.host.disconnectedCallback(); ports.bindFixture(null);
    if (inputDescriptor) Object.defineProperty(globalThis, "HTMLInputElement", inputDescriptor);
    else delete globalThis.HTMLInputElement;
  });
  return { f, host: f.host, events, draw, input, enter };
}

test("Video editor renders the exact nonuniform prefix clock and no private media or playback controls", t => {
  const f = leafFixture(t), tree = f.draw();
  assert.match(tree.root.text, /Selected duration: approximately 8 s/);
  assert.match(tree.root.text, /Original duration: approximately 11 s/);
  assert.equal(tree.visible("bdi")[0].text, "8000 ÷ 1000");
  assert.equal(tree.visible("bdi")[0].attributes.dir, "ltr");
  assert.match(tree.root.text, /Keep samples 0 through 3, excluding 3, from 4 samples/);
  assert.match(tree.root.text, /32 × 18/);
  assert.equal(tree.nodes.filter(node => ["audio", "video", "img", "canvas", "button"].includes(node.tag)).length, 0);
  assert.equal(f.events.length, 0);
  assert.equal(Object.hasOwn(f.host.selection, "bytes"), false);
});

test("Video editor owns a frozen named-field snapshot and refuses obsolete rendered handlers", t => {
  const f = leafFixture(t), original = selection();
  const privateBytes = new Uint8Array([1, 2, 3]); original.info.bytes = privateBytes;
  original.info.unrelated = { privateBytes }; f.host.selection = original; f.draw();
  const captured = f.host.selection, oldInput = f.input("video-trim-end"), oldHandler = oldInput.handlers.input;
  assert.notEqual(captured, original); assert.notEqual(captured.info, original.info);
  assert.notEqual(captured.info.sampleDurationTicks, original.info.sampleDurationTicks);
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.info) && Object.isFrozen(captured.info.sampleDurationTicks));
  assert.deepEqual(Object.keys(captured.info).sort(), ["sampleCount", "timescale", "durationTicks", "durationSeconds", "width", "height", "sourceSha256", "sampleDurationTicks"].sort());
  original.info.sampleDurationTicks[0] = 9000; original.info.width = 1; original.endSample = 1;
  assert.equal(captured.info.sampleDurationTicks[0], 1000); assert.equal(captured.info.width, 32); assert.equal(captured.endSample, 3);
  f.host.selection = selection(2); oldInput.value = "1";
  oldHandler({ type: "input", currentTarget: oldInput, target: oldInput });
  assert.equal(f.events.length, 0); assert.equal(f.host.selection.endSample, 2);
  assert.equal(f.draw().visible("bdi")[0].text, "3000 ÷ 1000");
});

test("Video editor rejects malformed inspection facts without retaining or coercing their duration values", async t => {
  const cases = [
    ["nonzero start", value => { value.startSample = 1; }],
    ["fractional endpoint", value => { value.endSample = 1.5; }],
    ["missing sample duration", value => { value.info.sampleDurationTicks.pop(); }],
    ["different total clock", value => { value.info.durationTicks += 1; }],
    ["different seconds", value => { value.info.durationSeconds = NaN; }],
    ["malformed source identity", value => { value.info.sourceSha256 = "A".repeat(64); }],
    ["BigInt duration", value => { value.info.sampleDurationTicks[1] = 2n; }],
    ["Symbol duration", value => { value.info.sampleDurationTicks[1] = Symbol("duration"); }],
    ["coercible duration", value => { value.info.sampleDurationTicks[1] = { valueOf() { throw Error("Must not coerce a sample duration"); } }; }],
  ];
  for (const [name, change] of cases) await t.test(name, child => {
    const f = leafFixture(child), value = selection(); f.draw(); change(value);
    assert.doesNotThrow(() => { f.host.selection = value; });
    assert.equal(f.host.selection, null); assert.equal(f.draw().nodes.length, 0); assert.equal(f.events.length, 0);
  });
});

test("Video input emits synchronous exact exclusive boundaries and only accepted assignments reconcile both controls", t => {
  const f = leafFixture(t); f.draw();
  const number = f.input("video-trim-end"), range = f.input("video-trim-end-range");
  number.value = ""; f.enter("video-trim-end", "");
  assert.equal(f.events[0].type, "video-trim-invalid");
  assert.equal(f.events[0].bubbles, true); assert.equal(f.events[0].composed, true);
  assert.equal(f.host.selection.endSample, 3);
  f.enter("video-trim-end-range", 2);
  const event = f.events[1];
  assert.equal(event.type, "video-trim-change"); assert.deepEqual(event.detail, { startSample: 0, endSample: 2 });
  assert.equal(event.bubbles, true); assert.equal(event.composed, true);
  assert.equal(f.host.selection.endSample, 2, "host acceptance occurred before dispatch returned");
  assert.equal(number.value, "2"); assert.equal(range.value, "2");
  const tree = f.draw(); assert.equal(tree.visible("p").filter(node => node.attributes.role === "status").length, 0);
  assert.equal(f.input("video-trim-end").attributes["aria-invalid"], "false");
});

test("rejected host assignments cannot silently clear invalid numeric input or claim another endpoint", t => {
  const f = leafFixture(t, { accept: false }); f.draw();
  for (const value of ["", "1.5", "0", "5"]) {
    f.enter("video-trim-end", value); const tree = f.draw();
    assert.equal(f.host.selection.endSample, 3);
    assert.equal(f.input("video-trim-end").value, value);
    assert.equal(tree.visible("p").filter(node => node.attributes.role === "status").length, 1);
  }
  f.enter("video-trim-end", 2); f.draw();
  assert.equal(f.events.at(-1).type, "video-trim-change");
  assert.equal(f.host.selection.endSample, 3);
  assert.equal(f.input("video-trim-end").attributes["aria-invalid"], "true");
  f.host.selection = selection(1); f.draw();
  assert.equal(f.input("video-trim-end").value, "1");
  assert.equal(f.input("video-trim-end-range").value, "1");
  assert.equal(f.input("video-trim-end").attributes["aria-invalid"], "false");
});

test("full-range selection reports an unchanged result without initiating Save or inventing playback", t => {
  const f = leafFixture(t); f.host.selection = selection(4); const tree = f.draw();
  assert.equal(tree.visible("bdi")[0].text, "11000 ÷ 1000");
  assert.ok(tree.root.text.includes(videoTrimCopy("en").status.unchanged));
  assert.equal(f.events.length, 0); assert.equal(tree.visible("button").length, 0);
  assert.deepEqual(tree.visible("input").map(node => [node.attributes.min, node.attributes.max, node.attributes.step].map(Number)), [[1, 4, 1], [1, 4, 1]]);
});

test("disabled, detached and retired Video fields cannot publish a trim selection", t => {
  const f = leafFixture(t); f.draw(); const input = f.input("video-trim-end"), handler = input.handlers.input;
  input.value = "2"; f.host.disabled = true; handler({ currentTarget: input });
  f.host.disabled = false; input.isConnected = false; handler({ currentTarget: input });
  input.isConnected = true; f.host.isConnected = false; handler({ currentTarget: input });
  f.host.isConnected = true; f.host.selection = null; handler({ currentTarget: input });
  assert.equal(f.events.length, 0);
  f.host.selection = selection(); f.draw(); f.host.isConnected = false; f.host.disconnectedCallback();
  assert.equal(f.host.selection, null); assert.equal(f.draw().nodes.length, 0);
});

test("four localized editor controls keep a fixed LTR time axis and remain unassociated with surrounding dirty forms", async t => {
  const forms = [];
  for (const locale of ["en", "fr", "ar", "ja"]) await t.test(locale, child => {
    const f = leafFixture(child, { locale }), tree = f.draw(), fields = tree.visible("input");
    assert.equal(tree.visible("section")[0].attributes.dir, locale === "ar" ? "rtl" : "ltr");
    assert.equal(fields.length, 2); assert.equal(fields[0].attributes.form, fields[1].attributes.form);
    assert.ok(fields[0].attributes.form); forms.push(fields[0].attributes.form);
    assert.equal(tree.nodes.some(node => node.attributes.id === fields[0].attributes.form), false);
    for (const node of fields) assert.equal(node.attributes.dir, "ltr");
    assert.equal(tree.visible("bdi")[0].attributes.dir, "ltr");
    assert.match(fields[1].attributes["aria-valuetext"], /\u2066.+\u2069/u);
    assert.doesNotMatch(tree.root.text, /\{(?:fraction|ticks|timescale|seconds|end|count)\}/u);
    assert.equal(fields.some(node => Object.hasOwn(node.attributes, "name") || Object.hasOwn(node.attributes, "required")), false);
  });
  assert.equal(new Set(forms).size, 4, "each editor owns a distinct unassociated native form ID");
});

// The host controls below execute five complete current private methods. Native
// focus, the already-verified scope, remux completion and Store replies are finite
// dependency ports; this is neither another remux test nor a Worker/RAM proof.
const hostUrl = new URL("../src/components/document-artifacts.ts", import.meta.url);
const hostText = readFileSync(hostUrl, "utf8");
const hostSyntax = ts.createSourceFile(hostUrl.pathname, hostText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hostOwner = hostSyntax.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "DocumentArtifacts");
assert.ok(hostOwner, "actual DocumentArtifacts owner");
const hostMethods = ["#retireVideoTrim", "#syncVideoTrim", "#changeVideoTrim", "#saveVideoTrim", "#videoTrimTemplate"].map(name => {
  const matches = hostOwner.members.filter(member => ts.isMethodDeclaration(member) && member.name.getText(hostSyntax) === name);
  assert.equal(matches.length, 1, "one actual method: " + name);
  const method = matches[0]; assert.equal(Boolean(method.asteriskToken), false);
  assert.equal(Boolean(method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)), name === "#saveVideoTrim");
  return method.getText(hostSyntax);
});
const hostCode = ts.transpileModule(`class VideoHostControl {
  #videoTrim = null; #videoTrimNotice = null; #editingId = "video-a"; #editRevision = 3;
  #savingEdit = false; #activeId = "video-a"; #viewerCurrent;
  constructor(f) { this.f = f; this.store = f.store; this.ownerDocument = f.document; this.#viewerCurrent = () => f.viewer; }
  #viewDialog() { return this.f.dialog; }
  #privateSourceCurrent() { return () => this.f.source; }
  #cancelArtifactEdit() { this.f.cancelCalls++; this.#retireVideoTrim(); this.#editingId = ""; this.#editRevision = 0; }
  get updateComplete() { return this.f.tick(); }
  requestUpdate() { this.f.updates++; }
  querySelector(selector) { return selector === "forma-video-trim-editor" ? this.f.leaf : null; }
  install(draft) { this.#videoTrim = draft; }
  state() { return { draft: this.#videoTrim, notice: this.#videoTrimNotice, editingId: this.#editingId, saving: this.#savingEdit }; }
  retire() { return this.#retireVideoTrim(); }
  sync() { return this.#syncVideoTrim(); }
  change(event, expected) { return this.#changeVideoTrim(event, expected); }
  template(draft = this.#videoTrim) { return this.#videoTrimTemplate(draft); }
  save(artifact, event, check = false, expected = this.#videoTrim) { return this.#saveVideoTrim(artifact, event, check, expected); }
  ${hostMethods.join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const hostFactory = new Function("trimVideoPrefix", "documentArtifactRevision", "videoArtifactMediaItem",
  "captureOutputNavigationFocus", "HTMLButtonElement", "html", "noChange", "nothing", "videoTrimCopy", hostCode + "\nreturn VideoHostControl;");
function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function hostFixture() {
  const f = { current: true, basis: true, source: true, authorization: true, viewer: true, focusCurrent: true,
    raw: "current raw revision", revision: 3, updates: 0, cancelCalls: 0, focusCalls: 0,
    trimCalls: [], reviseCalls: [], checkCalls: [], tick: async () => true, document: { activeElement: null } };
  class ButtonPort {
    isConnected = true; disabled = false;
    focus() { f.focusCalls++; f.document.activeElement = this; }
  }
  f.origin = new ButtonPort(); f.review = new ButtonPort(); f.document.activeElement = f.origin;
  f.dialog = { contains: node => node === f.origin || node === f.review,
    querySelector: selector => selector === ".artifact-viewer-review-toggle" ? f.review : null };
  f.artifact = { id: "video-a", documentId: "document-a", contentRef: "content-a", mediaUrl: "/api/media/original.mp4",
    item: { id: "item-a" }, settings: { source_media_sha256: "a".repeat(64) } };
  f.leaf = { selection: selection(2) };
  f.trimResult = { changed: true, sourceSha256: "a".repeat(64), sha256: "b".repeat(64) };
  f.revise = async () => ({ status: "unconfirmed", code: "unconfirmed" });
  f.check = async () => ({ status: "unconfirmed", code: "unconfirmed" });
  f.store = {
    events: { get: () => ({ revision: f.revision }) }, content: { get: () => ({ "content-a": f.raw }) },
    projection: { get: () => ({ libraryArtifacts: [f.artifact] }) }, route: { get: () => "/studio?document=document-a" },
    captureAuthorizationScope: () => f.authorization ? { key: "owned-personal" } : null,
    authorizationScopeActive: scope => f.authorization && scope.key === "owned-personal",
    reviseDocumentArtifact: async (id, request) => { f.reviseCalls.push({ id, request }); return f.revise(id, request); },
    checkVideoTrimOperation: async (id, request) => { f.checkCalls.push({ id, request }); return f.check(id, request); },
  };
  const Host = hostFactory(async (bytes, range) => { f.trimCalls.push({ bytes, range }); return f.trimResult; },
    (events, id) => { assert.equal(id, "video-a"); return events.revision; },
    artifact => artifact?.item ?? null,
    () => ({ current: () => f.focusCurrent, run: (target, operation) => f.focusCurrent && operation(), dispose() {} }), ButtonPort, html, noChange, nothing, videoTrimCopy);
  f.host = new Host(f);
  const draft = { artifactId: "video-a", itemId: "item-a", abort: new AbortController(),
    bytes: new Uint8Array([11, 22, 33, 44]), selection: selection(2), expectedRevision: 3,
    expectedContentSha256: "c".repeat(64), loading: false, saving: false, checking: false, request: null, code: null, invalidRangeFromInput: null,
    current: () => f.current && f.host.state().draft === draft,
    basisCurrent: () => draft.current() && f.basis };
  f.draft = draft; f.host.install(draft);
  f.save = (check = false, expected = draft) => f.host.save(f.artifact, { currentTarget: f.origin }, check, expected);
  return f;
}

// Compose the existing native-template ports with the actual host template and
// the actual registered leaf. Only the surrounding host/store lifetime remains
// the same finite port used below; no status predicate or message is replaced.
function combinedTrimFixture(t, { locale = "en" } = {}) {
  const native = leafFixture(t, { locale, accept: false }), f = hostFixture(), originalLeaf = native.host;
  const dispatchPorts = new Map();
  f.host.i18n = native.f.i18n;
  class HostTemplatePort extends ports.ElementPort {
    render() { return f.host.template(); }
    disconnectedCallback() {}
  }
  native.f.host = new HostTemplatePort(); native.f.host.tag = "section"; native.f.host.attributes = {};
  native.f.renderer.registry["forma-video-trim-editor"] = VideoTrimEditor;
  const draw = () => {
    const tree = native.draw(), component = tree.visible("forma-video-trim-editor")[0]?.component;
    if (component) {
      assert.ok(component instanceof VideoTrimEditor); f.leaf = component;
      if (!dispatchPorts.has(component)) {
        const descriptor = Object.getOwnPropertyDescriptor(component, "dispatchEvent"), inherited = component.dispatchEvent;
        dispatchPorts.set(component, descriptor);
        // ElementPort invokes the actual bound listener without native dispatch
        // populating currentTarget. Supply only that synchronous Event field;
        // keep the inherited dispatch and restore the Event's own descriptor.
        component.dispatchEvent = function (event) {
          const previous = Object.getOwnPropertyDescriptor(event, "currentTarget");
          Object.defineProperty(event, "currentTarget", { configurable: true, value: this });
          try { return Reflect.apply(inherited, this, [event]); }
          finally {
            if (previous) Object.defineProperty(event, "currentTarget", previous);
            else delete event.currentTarget;
          }
        };
      }
    }
    return tree;
  };
  const statuses = tree => tree.visible("p").filter(node => node.attributes.role === "status");
  t.after(() => {
    for (const [component, descriptor] of dispatchPorts) {
      if (descriptor) Object.defineProperty(component, "dispatchEvent", descriptor);
      else delete component.dispatchEvent;
    }
    f.host.retire(); originalLeaf.disconnectedCallback();
    for (const { instance } of native.f.renderer.instances.values()) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
  });
  return Object.assign(f, { native, draw, statuses });
}

test("owned invalid Video input has one combined localized status and accepted correction clears both owners", async t => {
  for (const locale of ["en", "fr", "ar", "ja"]) await t.test(locale, child => {
    const f = combinedTrimFixture(child, { locale }); f.draw();
    for (const value of ["", "1.5", "0", "5"]) {
      f.native.enter("video-trim-end", value);
      assert.equal(f.draft.code, "invalid_range"); assert.equal(f.draft.invalidRangeFromInput, f.leaf);
      const tree = f.draw(), statuses = f.statuses(tree);
      assert.equal(statuses.length, 1, "host and leaf together announce invalid input once");
      assert.equal(statuses[0].text, videoTrimCopy(locale).status.invalid_range);
      assert.equal(statuses[0].owner === f.leaf, true, "the actual leaf owns numeric input feedback");
      assert.equal(tree.visible("p").some(node => node.attributes.class === "artifact-video-trim-status"), false);
      assert.equal(f.native.input("video-trim-end").value, value);
      assert.deepEqual(tree.visible("input").map(node => node.attributes["aria-invalid"]), ["true", "true"]);
      assert.equal(f.draft.selection.endSample, 2);
    }
    f.native.enter("video-trim-end", 1);
    assert.equal(f.draft.code, null); assert.equal(f.draft.invalidRangeFromInput, null);
    const corrected = f.draw(); assert.equal(f.statuses(corrected).length, 0);
    assert.deepEqual(corrected.visible("input").map(node => node.attributes["aria-invalid"]), ["false", "false"]);
    assert.equal(f.native.input("video-trim-end").value, "1"); assert.equal(f.native.input("video-trim-end-range").value, "1");
    assert.equal(f.trimCalls.length + f.reviseCalls.length + f.checkCalls.length, 0);
  });
});

test("foreign, saving, source-retired and obsolete invalid handlers cannot acquire the current status owner", t => {
  const f = combinedTrimFixture(t); f.draw();
  const invalid = f.leaf.eventBindings["video-trim-invalid"]; assert.equal(typeof invalid, "function");
  invalid({ currentTarget: {} });
  f.draft.saving = true; invalid({ currentTarget: f.leaf }); f.draft.saving = false;
  f.basis = false; invalid({ currentTarget: f.leaf }); f.basis = true;
  assert.equal(f.draft.code, null); assert.equal(f.draft.invalidRangeFromInput, null);
  assert.equal(f.statuses(f.draw()).length, 0);
  const next = { ...f.draft, abort: new AbortController(), bytes: new Uint8Array([9]), code: null, invalidRangeFromInput: null };
  next.current = () => f.current && f.host.state().draft === next; next.basisCurrent = () => next.current() && f.basis;
  f.host.retire(); f.host.install(next); invalid({ currentTarget: f.leaf });
  assert.equal(next.code, null); assert.equal(next.invalidRangeFromInput, null);
  assert.equal(f.statuses(f.draw()).length, 0);
  assert.equal(f.trimCalls.length + f.reviseCalls.length + f.checkCalls.length, 0);
});

test("a recreated Video leaf receives its real selection and leaves one host status until accepted correction", t => {
  const f = combinedTrimFixture(t); f.draw(); f.native.enter("video-trim-end", "");
  const invalidTree = f.draw(), previous = f.leaf, retainedSelection = f.draft.selection;
  assert.equal(f.statuses(invalidTree).length, 1); assert.equal(f.statuses(invalidTree)[0].owner === previous, true);
  assert.equal(f.draft.invalidRangeFromInput, previous);
  const staleInvalid = previous.eventBindings["video-trim-invalid"];
  const entries = [...f.native.f.renderer.instances.entries()].filter(([, row]) => row.instance === previous);
  assert.equal(entries.length, 1, "one current registered leaf instance");
  // Explicitly deliver the old native component's disconnect and remove only
  // that instance from the existing renderer's registration cache. The draft,
  // production template, selection setter and shared renderer remain intact.
  previous.isConnected = false; previous.disconnectedCallback();
  f.native.f.renderer.instances.delete(entries[0][0]); f.leaf = null;
  const replacedTree = f.draw(), replacement = f.leaf;
  assert.notEqual(replacement, previous); assert.equal(replacement.isConnected, true);
  assert.equal(f.draft.selection, retainedSelection); assert.equal(f.draft.invalidRangeFromInput, previous);
  assert.equal(replacement.selection.endSample, retainedSelection.endSample);
  assert.equal(replacement.selection.info.sourceSha256, retainedSelection.info.sourceSha256);
  assert.deepEqual(replacedTree.visible("input").map(node => node.attributes["aria-invalid"]), ["false", "false"]);
  const statuses = f.statuses(replacedTree); assert.equal(statuses.length, 1);
  assert.equal(statuses[0].attributes.class, "artifact-video-trim-status");
  assert.equal(statuses[0].text, videoTrimCopy("en").status.invalid_range);
  staleInvalid({ currentTarget: previous }); assert.equal(f.draft.invalidRangeFromInput, previous);
  f.native.enter("video-trim-end", 1);
  assert.equal(f.draft.invalidRangeFromInput, null); assert.equal(f.draft.code, null);
  assert.equal(f.statuses(f.draw()).length, 0); assert.equal(replacement.selection.endSample, 1);
  assert.equal(f.trimCalls.length + f.reviseCalls.length + f.checkCalls.length, 0);
});

test("remux and Store invalid-range failures retain one host status with valid leaf fields", async t => {
  for (const origin of ["remux", "Store"]) await t.test(origin, async child => {
    const f = combinedTrimFixture(child); f.draw();
    if (origin === "remux") f.trimResult = null;
    else f.revise = async () => ({ status: "refused", code: "invalid_range" });
    await f.save();
    assert.equal(f.draft.code, "invalid_range"); assert.equal(f.draft.invalidRangeFromInput, null);
    const tree = f.draw(), statuses = f.statuses(tree);
    assert.equal(statuses.length, 1); assert.equal(statuses[0].text, videoTrimCopy("en").status.invalid_range);
    assert.equal(statuses[0].attributes.class, "artifact-video-trim-status");
    assert.deepEqual(tree.visible("input").map(node => node.attributes["aria-invalid"]), ["false", "false"]);
    assert.equal(f.trimCalls.length, 1); assert.equal(f.reviseCalls.length, origin === "Store" ? 1 : 0);
    assert.equal(f.checkCalls.length, 0); assert.equal(f.cancelCalls, 0);
  });
});

test("host status suppression is limited to a current leaf input error and keeps other Save failures visible", t => {
  const f = combinedTrimFixture(t); f.draw();
  for (const code of ["source_changed", "unsupported", "unavailable", "access_denied", "unconfirmed"]) {
    f.draft.code = code; f.draft.invalidRangeFromInput = f.leaf;
    const statuses = f.statuses(f.draw()); assert.equal(statuses.length, 1);
    assert.equal(statuses[0].attributes.class, "artifact-video-trim-status");
    assert.equal(statuses[0].text, videoTrimCopy("en").status[code]);
  }
  f.draft.code = "invalid_range"; f.draft.selection = null;
  const missingLeaf = f.draw(); assert.equal(missingLeaf.visible("forma-video-trim-editor").length, 0);
  assert.equal(f.statuses(missingLeaf).length, 1); assert.equal(f.statuses(missingLeaf)[0].text, videoTrimCopy("en").status.invalid_range);
  assert.equal(f.trimCalls.length + f.reviseCalls.length + f.checkCalls.length, 0);
});

test("current host accepts only its captured draft and exact leaf's integer prefix event", () => {
  const f = hostFixture(), original = f.draft.selection;
  const change = (detail, expected = f.draft, leaf = f.leaf) => f.host.change({ currentTarget: leaf, detail }, expected);
  change({ startSample: 0, endSample: 1 }, { ...f.draft });
  change({ startSample: 0, endSample: 1 }, f.draft, {});
  for (const detail of [{ startSample: 1, endSample: 2 }, { startSample: 0, endSample: 1.5 }, { startSample: 0, endSample: 5 }]) change(detail);
  assert.equal(f.draft.selection, original); assert.equal(f.updates, 0);
  f.draft.code = "unconfirmed"; change({ startSample: 0, endSample: 1 }); assert.equal(f.draft.selection, original);
  f.draft.code = "invalid_range"; change({ startSample: 0, endSample: 1 });
  assert.deepEqual(f.draft.selection, { info: original.info, startSample: 0, endSample: 1 });
  assert.equal(f.draft.code, null); assert.equal(f.updates, 1);
});

test("host source retirement erases owned media and leaf state while preserving an unconfirmed operation receipt", () => {
  const f = hostFixture(), bytes = f.draft.bytes, request = { exactOriginalOperation: true };
  f.draft.invalidRangeFromInput = f.leaf;
  f.draft.request = request; f.draft.code = "unconfirmed"; f.basis = false; f.host.sync();
  assert.deepEqual([...bytes], [0, 0, 0, 0]); assert.equal(f.draft.bytes, null);
  assert.equal(f.draft.selection, null); assert.equal(f.leaf.selection, null); assert.equal(f.draft.abort.signal.aborted, true);
  assert.equal(f.draft.invalidRangeFromInput, null);
  assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.draft.request, request);
  f.current = false; f.host.sync();
  assert.equal(f.host.state().draft, null); assert.equal(f.host.state().editingId, "");
  assert.equal(f.reviseCalls.length + f.checkCalls.length, 0);
});

test("source loss during the local remux await prevents Save dispatch and a second activation cannot overlap", async () => {
  const f = hostFixture(), pending = deferred(), bytes = f.draft.bytes; f.trimResult = pending.promise;
  const first = f.save(); assert.equal(f.host.state().saving, true); assert.equal(f.trimCalls.length, 1);
  await f.save(); assert.equal(f.trimCalls.length, 1); assert.equal(f.reviseCalls.length, 0);
  f.basis = false; pending.resolve({ changed: true, sourceSha256: "a".repeat(64), sha256: "b".repeat(64) });
  await first;
  assert.equal(f.reviseCalls.length, 0); assert.equal(f.draft.code, "source_changed");
  assert.deepEqual([...bytes], [0, 0, 0, 0]); assert.equal(f.host.state().saving, false); assert.equal(f.focusCalls, 0);
});

test("unconfirmed Save keeps its exact request and Check never repeats the write or invents an ACK", async () => {
  const f = hostFixture(); f.revise = async () => { throw Error("lost Save response"); };
  await f.save(); const request = f.draft.request;
  assert.deepEqual(request, { expectedRevision: 3, expectedContentSha256: "c".repeat(64), videoTrim: {
    sourceMediaSha256: "a".repeat(64), sourceSampleCount: 4, startSample: 0, endSample: 2, resultMediaSha256: "b".repeat(64) } });
  assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.reviseCalls.length, 1); assert.equal(f.cancelCalls, 0);
  await f.save(); assert.equal(f.reviseCalls.length, 1);
  f.basis = false; f.host.sync(); await f.save(true);
  assert.equal(f.checkCalls.length, 1); assert.equal(f.checkCalls[0].request, request);
  assert.equal(f.trimCalls.length, 1); assert.equal(f.reviseCalls.length, 1); assert.equal(f.draft.code, "unconfirmed");
  await f.save(true, { ...f.draft }); assert.equal(f.checkCalls.length, 1, "obsolete retained Check handler is refused");
});

function committedReply(f, request) {
  f.revision = 4; f.raw = "new exact current revision";
  f.artifact = { ...f.artifact, mediaUrl: "/api/media/trimmed.mp4", settings: { source_media_sha256: request.videoTrim.resultMediaSha256 } };
  return { status: "saved", code: "saved", revision: 4,
    videoRevision: { source: { itemId: "item-a" }, media: { url: "/api/media/trimmed.mp4" } } };
}

test("exact saved current revision retires private bytes and only the still-owned Save origin hands off focus", async t => {
  for (const moved of [false, true]) await t.test(moved ? "focus moved" : "same origin", async () => {
    const f = hostFixture(), bytes = f.draft.bytes;
    f.revise = async (_id, request) => { if (moved) f.document.activeElement = {}; return committedReply(f, request); };
    await f.save();
    assert.equal(f.reviseCalls.length, 1); assert.equal(f.cancelCalls, 1); assert.equal(f.host.state().draft, null);
    assert.deepEqual([...bytes], [0, 0, 0, 0]); assert.equal(f.host.state().notice.code, "saved");
    assert.equal(f.focusCalls, moved ? 0 : 1);
    f.source = false; f.host.sync(); assert.equal(f.host.state().notice, null);
  });
});

test("saved replies cannot close over a different current item, media hash, URL or revision", async t => {
  const mutations = [
    ["item", f => { f.artifact.item = { id: "other-item" }; }],
    ["hash", f => { f.artifact.settings.source_media_sha256 = "d".repeat(64); }],
    ["URL", f => { f.artifact.mediaUrl = "/api/media/other.mp4"; }],
    ["revision", f => { f.revision = 5; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const f = hostFixture(); f.revise = async (_id, request) => { const reply = committedReply(f, request); mutate(f); return reply; };
    await f.save(); assert.equal(f.draft.code, "unconfirmed"); assert.equal(f.cancelCalls, 0);
    assert.equal(f.host.state().notice, null); assert.equal(f.focusCalls, 0);
  });
});

test("whole-prefix no-op waits for authoritative Store unchanged before retiring the editor", async () => {
  const f = hostFixture(), pending = deferred(); f.draft.selection = selection(4);
  f.trimResult = { changed: false, sourceSha256: "a".repeat(64), sha256: "a".repeat(64) };
  f.revise = () => pending.promise;
  const saving = f.save(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.reviseCalls.length, 1); assert.equal(f.cancelCalls, 0); assert.equal(f.host.state().notice, null);
  assert.equal(f.reviseCalls[0].request.videoTrim.endSample, 4);
  assert.equal(f.reviseCalls[0].request.videoTrim.resultMediaSha256, "a".repeat(64));
  pending.resolve({ status: "unchanged", code: "unchanged", revision: 3 }); await saving;
  assert.equal(f.revision, 3); assert.equal(f.cancelCalls, 1); assert.equal(f.host.state().notice.code, "unchanged");
});

test("late Save settlement cannot change or close a newer current editing session", async () => {
  const f = hostFixture(), pending = deferred(); f.revise = () => pending.promise;
  const saving = f.save(); await Promise.resolve(); await Promise.resolve(); assert.equal(f.reviseCalls.length, 1);
  f.host.retire(); const next = { ...f.draft, abort: new AbortController(), bytes: new Uint8Array([9]), code: null };
  f.host.install(next); pending.resolve({ status: "saved", code: "saved", revision: 4,
    videoRevision: { source: { itemId: "item-a" }, media: { url: "/api/media/trimmed.mp4" } } });
  await saving;
  assert.equal(f.host.state().draft, next); assert.equal(next.code, null); assert.equal(f.cancelCalls, 0);
  assert.equal(f.host.state().notice, null); assert.equal(f.focusCalls, 0); assert.deepEqual([...next.bytes], [9]);
});

// This successor exercises current ownership decisions with the production
// namespace/parser helpers. Authorization and I/O remain finite ports; the
// actual typed receipt, Video validator and Check publication branches run.
const artifactModel = await ports.loadActual("src/model/document-artifacts.ts");
const { ownerMediaNamespace } = await ports.loadActual("src/model/media-ownership.ts");
const selectedCurrentMethods = (owner, syntax, names, asynchronous) => names.map(name => {
  const matches = owner.members.filter(member => ts.isMethodDeclaration(member) && member.name.getText(syntax) === name);
  assert.equal(matches.length, 1, "one current method: " + name);
  const method = matches[0]; assert.equal(Boolean(method.asteriskToken), false);
  assert.equal(Boolean(method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)), asynchronous.includes(name));
  return method.getText(syntax);
});
const [eligibilityMethod] = selectedCurrentMethods(hostOwner, hostSyntax, ["#videoTrimMediaOwned"], []);
const eligibilityCode = ts.transpileModule(`class VideoEligibilityControl {
  constructor(store) { this.store = store; }
  owned(artifact) { return this.#videoTrimMediaOwned(artifact); }
  ${eligibilityMethod}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const VideoEligibilityControl = new Function("videoArtifactMediaItem", "ownerMediaNamespace",
  eligibilityCode + "\nreturn VideoEligibilityControl;")(artifactModel.videoArtifactMediaItem, ownerMediaNamespace);
const ownedVideoUrl = (owner, basename) => `/api/media/${encodeURIComponent(`${ownerMediaNamespace(owner)}/generated/${basename}`)}`;

test("actual Host eligibility accepts its canonical encoded owner namespace and refuses the same foreign item", () => {
  const owner = "owner:video", url = ownedVideoUrl(owner, "original.mp4");
  assert.notEqual(ownerMediaNamespace(owner), owner, "fixture cannot accidentally endorse a raw-userId prefix");
  const host = new VideoEligibilityControl({ session: { get: () => ({ user: { userId: owner } }) } });
  const item = { id: "item-a", mediaUrl: url, mediaType: "video/mp4" };
  const artifact = { kind: "video", mediaUrl: url, mediaType: "video/mp4", items: [item] };
  assert.equal(host.owned(artifact), item);
  const foreign = ownedVideoUrl("other:video", "original.mp4");
  const foreignArtifact = { ...artifact, mediaUrl: foreign, items: [{ ...item, mediaUrl: foreign }] };
  assert.ok(artifactModel.videoArtifactMediaItem(foreignArtifact), "only authenticated ownership differs");
  assert.equal(host.owned(foreignArtifact), null);
});

const storeUrl = new URL("../src/state/store.ts", import.meta.url);
const storeSyntax = ts.createSourceFile(storeUrl.pathname, readFileSync(storeUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const storeOwner = storeSyntax.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
assert.ok(storeOwner, "actual FormaStore owner");
const storeMethods = selectedCurrentMethods(storeOwner, storeSyntax, [
  "#requestedEventObserved", "#matchedRequestedWrites", "#validateEventWriteBody", "#videoTrimSourceCurrent",
  "#validatedVideoTrimSave", "checkVideoTrimOperation",
], ["#validatedVideoTrimSave", "checkVideoTrimOperation"]);
const storeCode = ts.transpileModule(`class VideoCheckControl {
  #eventWriteObservations;
  constructor(f) {
    this.f=f; this.#eventWriteObservations=new Map([["observation-a",f.observation]]);
    this.projection={get:()=>f.projection};this.route={get:()=>f.route};this.session={get:()=>f.session};
    this.events={get:()=>f.events};this.content={get:()=>f.content,set:value=>{f.contentSets.push(value);f.content=value;}};
  }
  captureSourceOwnership(){return this.f.source;}
  sourceOwnershipActive(source){return source===this.f.source;}
  #activeAuthorizationScope(){return this.f.authorization;}
  #scopeStillActive(scope){return scope===this.f.authorization;}
  guardedFetch(url,init,_reason,options){
    if(!options.current())throw Error("retired finite source");
    this.f.reads.push({url,init});return Promise.resolve({ok:true,status:200,json:async()=>this.f.body});
  }
  #sourceContent(content){return content;}
  #mergeConfirmed(events,head){this.f.merges.push({events,head});this.f.events=[...this.f.events,...events];}
  #finishEventWrite(observation,patch,events,publication){this.f.finishes.push({observation,patch,events,publication});}
  receipt(body){return this.#validateEventWriteBody(body,[{type:"DocumentArtifactEdited",payload:{artifact_id:this.f.snapshot.artifactId}}],this.f.observation);}
  validate(body){return this.#validatedVideoTrimSave(this.f.snapshot,body,body.appended);}
  ${storeMethods.join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const VideoCheckControl = new Function("parseDocumentArtifactContent", "parseVideoMediaRevision", "parseVideoTrimEditRequest",
  "videoArtifactMediaItem", "documentArtifactRevision", "ownerMediaNamespace", "normalizeOutputRequirementCreation",
  storeCode + "\nreturn VideoCheckControl;")(
  artifactModel.parseDocumentArtifactContent, artifactModel.parseVideoMediaRevision, artifactModel.parseVideoTrimEditRequest,
  artifactModel.videoArtifactMediaItem, artifactModel.documentArtifactRevision, ownerMediaNamespace,
  () => { throw Error("The Video receipt must never request a BlockCreated normalization"); });
const textSha256 = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, "0")).join("");

async function videoCheckFixture() {
  const owner = "owner:video", sourceUrl = ownedVideoUrl(owner, "original.mp4"), contentRef = "content-a";
  const sourceRaw = JSON.stringify({ title: "Owned Video", summary: "", content_markdown: "Exact original script.",
    presentation: null, items: [{ title: "One shot", body: "Exact shot.", notes: "", image_prompt: "", slide: null, context_group_ids: [] }] });
  const request = artifactModel.parseVideoTrimEditRequest({ expectedRevision: 3, expectedContentSha256: await textSha256(sourceRaw),
    videoTrim: { sourceMediaSha256: "a".repeat(64), sourceSampleCount: 4, startSample: 0, endSample: 2, resultMediaSha256: "b".repeat(64) } });
  assert.ok(request);
  const artifact = { id: "video-a", kind: "video", documentId: "document-a", contentRef, sourceEventId: "completion-a",
    mediaUrl: sourceUrl, mediaType: "video/mp4", items: [{ id: "item-a", mediaUrl: sourceUrl, mediaType: "video/mp4" }],
    settings: { source_media_sha256: "a".repeat(64) } };
  const route = "/studio?document=document-a";
  const snapshot = { artifactId: artifact.id, request, contentRef, documentId: artifact.documentId, projectId: "project-a", route,
    ownerUserId: owner, sourceMediaUrl: sourceUrl, sourceMediaType: "video/mp4", sourceItemId: "item-a",
    sourceItemsRaw: JSON.stringify(artifact.items), sourceSettingsRaw: JSON.stringify(artifact.settings), sourceHashPresent: true,
    sourceMediaSha256: "a".repeat(64), sourceEventId: artifact.sourceEventId, sourceRaw, sourceRevision: 3 };
  const video = artifactModel.parseVideoMediaRevision({ schemaVersion: 1, operation: "prefix-trim",
    media: { url: ownedVideoUrl(owner, "video-trim-019ec595-b300-7000-8000-000000000001.mp4"), mediaType: "video/mp4", sha256: "b".repeat(64), byteLength: 256 },
    source: { url: sourceUrl, sha256: "a".repeat(64), revision: 3, contentSha256: request.expectedContentSha256,
      itemId: "item-a", sampleCount: 4, timescale: 1000, durationTicks: 11000, width: 32, height: 18 },
    startSample: 0, endSample: 2, sampleCount: 2, timescale: 1000, durationTicks: 3000, durationSeconds: 3, width: 32, height: 18 });
  assert.ok(video);
  const raw = JSON.stringify({ ...JSON.parse(sourceRaw), video_revision: video });
  const fingerprint = await textSha256(JSON.stringify(request));
  const event = { eventId: "edit-a", streamId: "stream-a", sequence: 4, type: "DocumentArtifactEdited", actor: "user",
    clientId: "web:artifact-editor", correlationId: "correlation-a", schemaVersion: 1,
    occurredAt: "2026-09-10T00:00:00.000Z", recordedAt: "2026-09-10T00:00:00.000Z", compensatesEventId: null,
    payload: { artifact_id: artifact.id, artifact_kind: "video", document_id: artifact.documentId, project_id: snapshot.projectId,
      content_ref: contentRef, revision: 4, changed_fields: ["video_revision"], edited_by_user_id: owner,
      source_surface: "document-artifact-video-trim", video_revision: video, content_sha256: await textSha256(raw), video_trim_request_sha256: fingerprint } };
  const f = { snapshot, request, video, event, fingerprint, artifact, route, source: {}, authorization: {},
    session: { user: { userId: owner } }, projection: { projectId: snapshot.projectId, libraryArtifacts: [artifact] },
    events: [1, 2, 3].map(sequence => ({ type: "DocumentArtifactEdited", sequence, payload: { artifact_id: artifact.id } })),
    content: { [contentRef]: sourceRaw }, reads: [], contentSets: [], merges: [], finishes: [],
    body: { appended: [event], head: 4, revision: 4, content: { [contentRef]: raw } } };
  f.observation = { videoTrim: snapshot, source: f.source, pending: false, paused: false,
    actor: "user", streamId: "stream-a", receipt: { action: "append", observationId: "observation-a", owner: { actorUserId: owner } } };
  f.store = new VideoCheckControl(f);
  return f;
}

test("actual Store Check publishes a valid owned ACK but refuses only a foreign derivative owner before publication", async () => {
  const own = await videoCheckFixture();
  assert.equal(own.store.receipt(own.body).complete, true, "genuine typed stream/actor/request receipt accepts the premise");
  assert.equal((await own.store.validate(own.body))?.status, "saved", "valid exact Video validator positive");
  const saved = await own.store.checkVideoTrimOperation(own.snapshot.artifactId, own.request);
  assert.equal(saved.status, "saved"); assert.equal(own.contentSets.length, 1); assert.equal(own.merges.length, 1);
  assert.equal(own.finishes[0].publication, "published"); assert.equal(own.reads.length, 1); assert.equal(own.reads[0].init.method, "GET");
  assert.equal(own.content[own.snapshot.contentRef], own.body.content[own.snapshot.contentRef]);
  assert.equal(saved.contentSha256, await textSha256(own.body.content[own.snapshot.contentRef]));

  const foreign = await videoCheckFixture(), originalEvents = foreign.events, originalContent = foreign.content;
  const originalRequest = JSON.stringify(foreign.request), originalSource = JSON.stringify(foreign.video.source);
  const video = { ...foreign.video, media: { ...foreign.video.media,
    url: ownedVideoUrl("other:video", "video-trim-019ec595-b300-7000-8000-000000000001.mp4") } };
  assert.ok(artifactModel.parseVideoMediaRevision(video), "foreign URL remains structurally valid media metadata");
  const raw = JSON.stringify({ ...JSON.parse(foreign.snapshot.sourceRaw), video_revision: video });
  const event = { ...foreign.event, payload: { ...foreign.event.payload, video_revision: video, content_sha256: await textSha256(raw) } };
  foreign.body = { ...foreign.body, appended: [event], content: { [foreign.snapshot.contentRef]: raw } };
  assert.equal(JSON.stringify(foreign.request), originalRequest); assert.equal(JSON.stringify(video.source), originalSource);
  assert.equal(event.payload.video_trim_request_sha256, await textSha256(JSON.stringify(foreign.request)));
  assert.equal(foreign.store.receipt(foreign.body).complete, true, "foreign owner does not invalidate the otherwise exact typed ACK");
  assert.equal(await foreign.store.validate(foreign.body), null, "current Video validator refuses the derivative owner");
  const refused = await foreign.store.checkVideoTrimOperation(foreign.snapshot.artifactId, foreign.request);
  assert.deepEqual(refused, { status: "unconfirmed", code: "unconfirmed" });
  assert.equal(foreign.contentSets.length, 0); assert.equal(foreign.merges.length, 0); assert.equal(foreign.finishes.length, 0);
  assert.equal(foreign.content, originalContent); assert.equal(foreign.events, originalEvents);
  assert.equal(foreign.reads.length, 1); assert.equal(foreign.reads[0].init.method, "GET");
});

async function videoCheckWithRetainedRawFields() {
  const f = await videoCheckFixture();
  const source = JSON.parse(f.snapshot.sourceRaw);
  source.retainedProductionNote = { text: "Exact saved note — العربية 日本語\r\n", order: [3, 1] };
  source.items[0].retainedTake = { number: 7, tags: ["wide", "original"] };
  const sourceRaw = JSON.stringify(source);
  f.request.expectedContentSha256 = await textSha256(sourceRaw);
  f.snapshot.sourceRaw = sourceRaw; f.content = { [f.snapshot.contentRef]: sourceRaw };
  f.video = { ...f.video, source: { ...f.video.source, contentSha256: f.request.expectedContentSha256 } };
  const raw = JSON.stringify({ ...source, video_revision: f.video });
  f.fingerprint = await textSha256(JSON.stringify(f.request));
  f.event = { ...f.event, payload: { ...f.event.payload, video_revision: f.video,
    content_sha256: await textSha256(raw), video_trim_request_sha256: f.fingerprint } };
  f.body = { ...f.body, appended: [f.event], content: { [f.snapshot.contentRef]: raw } };
  return f;
}

test("actual Store Check preserves unknown saved root and item data and refuses an otherwise valid ACK that loses or changes it", async () => {
  const own = await videoCheckWithRetainedRawFields();
  assert.equal(own.store.receipt(own.body).complete, true);
  assert.equal((await own.store.validate(own.body))?.status, "saved");
  const saved = await own.store.checkVideoTrimOperation(own.snapshot.artifactId, own.request);
  assert.equal(saved.status, "saved"); assert.equal(own.contentSets.length, 1); assert.equal(own.merges.length, 1);
  assert.equal(own.finishes[0].publication, "published");
  assert.equal(own.content[own.snapshot.contentRef], own.body.content[own.snapshot.contentRef]);
  const original = JSON.parse(own.snapshot.sourceRaw), published = JSON.parse(own.content[own.snapshot.contentRef]);
  assert.deepEqual(published.retainedProductionNote, original.retainedProductionNote);
  assert.deepEqual(published.items[0].retainedTake, original.items[0].retainedTake);

  for (const [name, change] of [
    ["lost root field", value => { delete value.retainedProductionNote; }],
    ["altered nested item field", value => { value.items[0].retainedTake.number = 8; }],
  ]) {
    const f = await videoCheckWithRetainedRawFields(), originalEvents = f.events, originalContent = f.content;
    const requestBefore = JSON.stringify(f.request), sourceBefore = f.snapshot.sourceRaw;
    const rawObject = JSON.parse(f.body.content[f.snapshot.contentRef]); change(rawObject);
    const raw = JSON.stringify(rawObject);
    const event = { ...f.event, payload: { ...f.event.payload, content_sha256: await textSha256(raw) } };
    f.body = { ...f.body, appended: [event], content: { [f.snapshot.contentRef]: raw } };
    assert.equal(JSON.stringify(f.request), requestBefore, name);
    assert.equal(f.snapshot.sourceRaw, sourceBefore, name);
    assert.deepEqual(rawObject.video_revision, f.video, "owner/source/range/result identity remains exact: " + name);
    assert.equal(event.payload.video_trim_request_sha256, await textSha256(JSON.stringify(f.request)), name);
    assert.equal(event.payload.content_sha256, await textSha256(raw), name);
    assert.equal(f.store.receipt(f.body).complete, true, "typed ACK remains complete: " + name);
    assert.equal(await f.store.validate(f.body), null, "actual Video validator refuses raw data loss: " + name);
    assert.deepEqual(await f.store.checkVideoTrimOperation(f.snapshot.artifactId, f.request),
      { status: "unconfirmed", code: "unconfirmed" }, name);
    assert.equal(f.contentSets.length, 0, name); assert.equal(f.merges.length, 0, name); assert.equal(f.finishes.length, 0, name);
    assert.equal(f.content, originalContent, name); assert.equal(f.events, originalEvents, name);
    assert.equal(f.reads.length, 1, name); assert.equal(f.reads[0].init.method, "GET", name);
  }
});
