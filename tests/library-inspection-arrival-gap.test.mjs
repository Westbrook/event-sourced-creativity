import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

// Execute only the actual exported function. Native geometry/style/ownership
// are finite ports; this does not mount Assistant, simulate paint, or grant focus.
const sourceUrl = new URL("../src/components/design-system/assistant-panel.ts", import.meta.url);
const source = fs.readFileSync(sourceUrl, "utf8");
const tree = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = tree.statements.filter(node => ts.isFunctionDeclaration(node)
  && node.name?.text === "captureLibraryInspectionArrivalGap"
  && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
assert.equal(declarations.length, 1, "one exact actual exported gap function");
const code = ts.transpileModule(declarations[0].getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const captureGap = new Function("exports", code + "\nreturn exports.captureLibraryInspectionArrivalGap;")({});
assert.equal(typeof captureGap, "function");

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const candidate = () => rect(254, 826, 56, 56);
const style = () => ({
  display: "block", position: "static", visibility: "visible", opacity: "1", outlineStyle: "none", outlineWidth: "0px",
  outlineOffset: "0px", outlineColor: "rgb(0, 0, 0)", boxShadow: "none", textShadow: "none",
  transform: "none", translate: "none", rotate: "none", scale: "none", perspective: "none",
  filter: "none", backdropFilter: "none", clipPath: "none", maskImage: "none", zoom: "1", clip: "auto",
  borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomLeftRadius: "0px", borderBottomRightRadius: "0px",
  animationName: "none", transitionDuration: "0s", overflowX: "visible", overflowY: "visible", overflowClipMargin: "0px",
});

function nativePage() {
  const document = { defaultView: null, activeElement: null };
  const calls = [];
  const element = (tag, box, parentElement = null) => {
    const node = {
      tagName: tag.toUpperCase(), ownerDocument: document, isConnected: true, parentElement,
      box, attributes: {}, computed: style(), pseudos: { "::before": { content: "none" }, "::after": { content: "none" } },
      shadowRoot: null, focusVisible: false, clientLeft: 0, clientTop: 0,
      clientWidth: Math.round(box.width), clientHeight: Math.round(box.height), fragments: null,
      getAttribute(name) { return this.attributes[name] ?? null; },
      getBoundingClientRect() { calls.push(["rect", this]); return { ...this.box }; },
      getClientRects() { return this.fragments ?? [{ ...this.box }]; },
      matches(selector) {
        if (selector === 'main#main-content[tabindex="-1"]') return this.tagName === "MAIN"
          && this.attributes.id === "main-content" && this.attributes.tabindex === "-1";
        assert.equal(selector, ":focus-visible", "only the declared native focus-visible query");
        return this.focusVisible;
      },
      closest(selector) {
        assert.equal(selector, "[hidden], [inert], [aria-hidden='true']");
        for (let owner = node; owner; owner = owner.parentElement) if (Object.hasOwn(owner.attributes, "hidden")
          || Object.hasOwn(owner.attributes, "inert") || owner.attributes["aria-hidden"] === "true") return owner;
        return null;
      },
      focus() { assert.fail("gap admission must not focus"); },
      scrollIntoView() { assert.fail("gap admission must not scroll"); },
      setAttribute() { assert.fail("gap admission must not mutate attributes"); },
      style: { setProperty() { assert.fail("gap admission must not place the launcher"); } },
    };
    return node;
  };
  const html = element("html", rect(0, 0, 320, 900));
  const body = element("body", rect(0, 0, 320, 900), html);
  const shell = element("div", rect(0, 0, 320, 900), body);
  const main = element("main", rect(0, -326, 320, 1442.15625), shell);
  main.attributes = { id: "main-content", tabindex: "-1" };
  main.focusVisible = true;
  Object.assign(main.computed, { outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px" });
  const view = { innerWidth: 320, innerHeight: 900,
    getComputedStyle(node, pseudo) {
      assert.equal(node.ownerDocument, document, "style belongs to the same finite native document");
      calls.push(["style", node, pseudo]);
      if (pseudo) { assert.ok(Object.hasOwn(node.pseudos, pseudo)); return node.pseudos[pseudo]; }
      return node.computed;
    },
  };
  document.defaultView = view; document.activeElement = main;
  const f = { document, view, html, body, shell, main, calls, element, owned: true, currentReads: 0,
    scope: { owner: {}, route: "/library/blocks/editor/decision", authorization: {}, source: {} } };
  // Explicit finite caller predicate; this does not substitute for or test Store.
  const opening = { ...f.scope };
  f.current = () => { f.currentReads++; return f.owned && Object.keys(opening).every(key => f.scope[key] === opening[key]); };
  f.capture = () => captureGap(main, f.current);
  f.snapshot = () => JSON.stringify([html, body, shell, main].map(node => ({ attributes: node.attributes,
    box: node.box, computed: node.computed, pseudos: node.pseudos, isConnected: node.isConnected })));
  return f;
}

test("the actual function admits the offscreen painted perimeter without acquiring focus or moving anything", () => {
  const f = nativePage(), before = f.snapshot();
  // Independent fixture arithmetic, not the implementation's returned data:
  // top[-332,-329], bottom[1119.15625,1122.15625], left[-6,-3], right[323,326].
  assert.deepEqual([f.main.box.top - 6, f.main.box.top - 3], [-332, -329]);
  assert.deepEqual([f.main.box.bottom + 3, f.main.box.bottom + 6], [1119.15625, 1122.15625]);
  assert.deepEqual([f.main.box.left - 6, f.main.box.left - 3], [-6, -3]);
  assert.deepEqual([f.main.box.right + 3, f.main.box.right + 6], [323, 326]);
  const token = f.capture(); assert.ok(token);
  assert.equal(token.clear(candidate()), true);
  assert.equal(token.clear(rect(0, 0, 320, 900)), true, "viewport edges are valid when no perimeter paints inside");
  assert.equal(f.document.activeElement, f.main);
  assert.equal(f.snapshot(), before);
  assert.ok(f.currentReads >= 3, "capture and every clear consult the caller's current witness");
});

test("any visible outline band refuses capture even when the proposed launcher would miss it", () => {
  for (const [label, box] of [
    ["top", rect(0, 10, 320, 1442.15625)],
    ["bottom", rect(0, -326, 320, 1216)],
    ["left", rect(10, -326, 320, 1442.15625)],
    ["right", rect(-10, -326, 320, 1442.15625)],
  ]) {
    const f = nativePage(); f.main.box = box;
    assert.equal(f.capture(), null, label + " paints inside the viewport");
  }
  const f = nativePage();
  f.main.box = rect(0, 0, 320, 900); f.main.computed.outlineOffset = "0px";
  assert.ok(f.capture(), "zero-area contact with the viewport boundary is not painted interior overlap");
});

test("unsupported paint, radii, clipping, pseudo content and motion fail closed", () => {
  const changes = [
    ["outlineStyle", "auto"], ["outlineStyle", "dashed"], ["outlineWidth", "0px"], ["outlineWidth", "unknown"],
    ["outlineOffset", "-1px"], ["boxShadow", "0 0 2px red"], ["textShadow", "0 0 2px red"],
    ["position", "fixed"], ["position", "absolute"], ["position", "sticky"], ["transform", "matrix(1,0,0,1,0,0)"],
    ["translate", "1px"], ["rotate", "1deg"], ["scale", "2"], ["perspective", "10px"],
    ["filter", "blur(1px)"], ["backdropFilter", "blur(1px)"], ["maskImage", "linear-gradient(black,black)"],
    ["clipPath", "inset(0)"], ["clip", "rect(0px,320px,900px,0px)"], ["zoom", "2"],
    ["borderTopLeftRadius", "1px"], ["borderTopRightRadius", "0px 1px"],
    ["borderBottomLeftRadius", "1%"], ["borderBottomRightRadius", "unknown"],
    ["animationName", "move"], ["transitionDuration", "0s, 20ms"],
    ["overflowX", "unknown"], ["overflowY", "unknown"], ["visibility", "hidden"], ["opacity", ".5"], ["display", "none"],
  ];
  for (const [key, value] of changes) {
    const f = nativePage(); f.main.computed[key] = value;
    assert.equal(f.capture(), null, key + "=" + value);
  }
  for (const pseudo of ["::before", "::after"]) {
    const f = nativePage(); f.shell.pseudos[pseudo].content = '"paint"';
    assert.equal(f.capture(), null, "ancestor " + pseudo + " is not silently ignored");
  }
  const f = nativePage(); delete f.shell.computed.boxShadow;
  assert.equal(f.capture(), null, "an unavailable effect observation is not none");
});

test("capture requires the exact visible active main, one fragment and current ownership", () => {
  const changes = [
    ["not-current", f => { f.owned = false; }],
    ["no-view", f => { f.document.defaultView = null; }],
    ["another-active", f => { f.document.activeElement = f.body; }],
    ["disconnected", f => { f.main.isConnected = false; }],
    ["wrong-id", f => { f.main.attributes.id = "another-main"; }],
    ["wrong-tabindex", f => { f.main.attributes.tabindex = "0"; }],
    ["wrong-tag", f => { f.main.tagName = "DIV"; }],
    ["not-focus-visible", f => { f.main.focusVisible = false; }],
    ["shadow-focus", f => { f.main.shadowRoot = { activeElement: f.body }; }],
    ["hidden-ancestor", f => { f.shell.attributes.hidden = ""; }],
    ["inert-ancestor", f => { f.shell.attributes.inert = ""; }],
    ["busy", f => { f.main.attributes["aria-busy"] = "true"; }],
    ["no-fragment", f => { f.main.fragments = []; }],
    ["two-fragments", f => { f.main.fragments = [f.main.box, f.main.box]; }],
    ["ancestor-multiple-boxes", f => { f.shell.fragments = [f.shell.box, f.shell.box]; }],
    ["ancestor-position-escape", f => { f.shell.computed.position = "fixed"; }],
    ["nonfinite-box", f => { f.main.box.left = Number.NaN; }],
    ["empty-viewport", f => { f.view.innerHeight = 0; }],
  ];
  for (const [label, change] of changes) { const f = nativePage(); change(f); assert.equal(f.capture(), null, label); }
});

test("an issued token rechecks current focus, ancestry, viewport, geometry and supported style", () => {
  const changes = [
    ["current retired", f => { f.owned = false; }],
    ["caller owner changed", f => { f.scope.owner = {}; }],
    ["caller route changed", f => { f.scope.route = "/library"; }],
    ["caller authorization changed", f => { f.scope.authorization = {}; }],
    ["caller source changed", f => { f.scope.source = {}; }],
    ["focus moved", f => { f.document.activeElement = f.body; }],
    ["main detached", f => { f.main.isConnected = false; }],
    ["foreign document", f => { f.main.ownerDocument = {}; }],
    ["ancestor detached", f => { f.shell.isConnected = false; }],
    ["different identical ancestor", f => { f.main.parentElement = f.element("div", { ...f.shell.box }, f.body); }],
    ["viewport changed", f => { f.view.innerHeight = 901; }],
    ["main moved with perimeter still outside", f => { f.main.box = rect(0, -327, 320, 1442.15625); }],
    ["ancestor geometry changed", f => { f.shell.box.top = 1; f.shell.box.height--; }],
    ["client clip changed", f => { f.shell.clientWidth--; }],
    ["outline changed", f => { f.main.computed.outlineWidth = "4px"; }],
    ["outline color changed", f => { f.main.computed.outlineColor = "rgb(255,0,0)"; }],
    ["overflow changed", f => { f.shell.computed.overflowY = "auto"; }],
    ["new shadow", f => { f.shell.computed.boxShadow = "0 0 1px red"; }],
    ["new visible ring", f => { f.main.box = rect(10, -326, 320, 1442.15625); }],
  ];
  for (const [label, change] of changes) {
    const f = nativePage(), token = f.capture(); assert.ok(token); change(f);
    assert.equal(token.clear(candidate()), false, label);
  }
});

test("candidate permission is finite, positive, internally consistent and entirely in the captured viewport", () => {
  const f = nativePage(), token = f.capture(); assert.ok(token);
  const invalid = [
    rect(-1, 826, 56, 56), rect(254, -1, 56, 56), rect(265, 826, 56, 56), rect(254, 850, 56, 56),
    rect(254, 826, 0, 56), rect(254, 826, 56, -1),
    { ...candidate(), left: Number.NaN }, { ...candidate(), bottom: Number.POSITIVE_INFINITY },
    { ...candidate(), width: 55 }, { ...candidate(), height: 55 }, { ...candidate(), right: "310" },
  ];
  for (const box of invalid) assert.equal(token.clear(box), false, JSON.stringify(box));
  assert.equal(token.clear(candidate()), true, "a rejected candidate does not itself fabricate a source change");
});

test("simple clips preserve an already-offscreen perimeter and cannot manufacture eligibility", () => {
  const clippedPage = overflow => {
    const f = nativePage();
    f.main.box = rect(10, 10, 300, 880);
    f.shell.box = { ...f.main.box }; f.shell.clientWidth = 300; f.shell.clientHeight = 880;
    f.shell.computed.overflowX = overflow; f.shell.computed.overflowY = overflow;
    return f;
  };
  for (const overflow of ["hidden", "auto", "scroll", "clip"]) {
    const f = nativePage();
    f.shell.computed.overflowX = overflow; f.shell.computed.overflowY = overflow;
    const token = f.capture();
    assert.ok(token, overflow + " rectangular ancestor clip retains the offscreen-perimeter proof");
    assert.equal(token.clear(candidate()), true);
    assert.equal(clippedPage(overflow).capture(), null, "clipping cannot qualify an otherwise visible " + overflow + " perimeter");
  }
  const own = nativePage(); own.main.box = rect(10, 10, 300, 880);
  own.main.computed.overflowX = "hidden"; own.main.computed.overflowY = "hidden";
  assert.equal(own.capture(), null, "an element's own overflow does not remove its own outline");
  const margin = nativePage(); margin.shell.computed.overflowX = "clip"; margin.shell.computed.overflowClipMargin = "8px";
  assert.equal(margin.capture(), null, "positive clip margin is outside the ordinary client-clip contract");
  const unknown = nativePage(); unknown.shell.computed.overflowX = "clip"; delete unknown.shell.computed.overflowClipMargin;
  assert.equal(unknown.capture(), null, "an unknown clip margin cannot certify absence of painted outline");
});
