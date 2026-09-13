import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Isolated candidates point to existing installed application dependencies.
// No package installation, application bootstrap, DOM shim or network is used.
const appRoot = process.env.FORMA_SCENE_READER_CANONICAL_ROOT ?? fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(appRoot, "package.json"));
const supplier = (relative) => pathToFileURL(path.join(appRoot, relative)).href;
const lit = new Map(["lit", "lit/directives/style-map.js"].map((specifier) => [specifier, pathToFileURL(require.resolve(specifier)).href]));
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "lit" || specifier === "lit/directives/style-map.js") {
      return nextResolve(lit.get(specifier), context);
    }
    if (specifier === "../model/scene-pagination.ts") return nextResolve(supplier("src/model/scene-pagination.ts"), context);
    if (specifier === "./scene-text-measurement.ts") return nextResolve(supplier("src/components/scene-text-measurement.ts"), context);
    if (specifier === "./native-retained-scene.css") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
let renderNativeRetainedScene, sceneReaderPresentation;
try {
  ({ renderNativeRetainedScene, sceneReaderPresentation } = await import("../src/components/native-retained-scene.ts"));
} finally { hook.deregister(); }

const fontSha256 = "55b4c98f123daebb3ed27947ba47b2af00554fc6284d639a540bcef5e6258ad2";
const body = "INT. HARBOR · DUSK\n\n  Action <script>literal</script>.\n\nA · Name\n\nFirst line.\n";
const groups = [
  { role: "heading", sourceIndex: -1, lines: ["INT. HARBOR · DUSK"] },
  { role: "action", sourceIndex: 0, lines: ["  Action <script>literal</script>."] },
  { role: "dialogue", sourceIndex: 1, speaker: "A", cueLines: ["A · Name"], parentheticalLines: [], lines: ["", "First line.", ""] },
];
const measurement = (overrides = {}) => ({
  status: "measured", body, fontSha256, fontFamily: "FormaScene-12345678-1234-1234-1234-123456789abc",
  fontSizePt: 12, lineHeightPt: 16, pageCount: null, ink: { ascentPx: 12, descentPx: 4 }, groups, ...overrides,
});
const templates = (value) => {
  if (Array.isArray(value)) return value.flatMap(templates);
  if (value && Array.isArray(value.strings) && Array.isArray(value.values)) return [value, ...value.values.flatMap(templates)];
  return [];
};
const markup = (result) => templates(result).flatMap((template) => [...template.strings]).join("");
const literals = (result) => templates(result).flatMap((template) => template.values.filter((value) => typeof value === "string"));
const lines = (result) => templates(result).filter((template) => template.strings[0].startsWith('<span class="native-retained-scene-line"'));

test("actual Lit leaf has one literal representation, no interpretation or controls", () => {
  const title = "<img src=x onerror=alert(1)>";
  const result = renderNativeRetainedScene({ title, body }, "Scene", measurement());
  const strings = markup(result);
  assert.match(strings, /native-retained-scene-frame/);
  assert.doesNotMatch(strings, /native-retained-scene-original/);
  assert.doesNotMatch(strings, /<script>|<img|<button|<details|<dialog|<iframe/);
  assert.ok(literals(result).includes(title));
  assert.ok(literals(result).includes("  Action <script>literal</script>."));
  assert.equal(lines(result).length, 6);
  assert.deepEqual(lines(result).map((line) => line.values.at(-1)), groups.flatMap((group) =>
    group.role === "dialogue" ? [...group.cueLines, ...group.parentheticalLines, ...group.lines] : group.lines));
});

test("metadata/body mismatch and overlong packing mount only complete current original body", () => {
  const unqualified = [
    null, { status: "unqualified", reason: "uncovered-glyphs", body },
    measurement({ body: "old source" }), measurement({ fontSha256: "0".repeat(64) }),
    measurement({ fontFamily: 'FormaScene-x";background:url(evil)' }), measurement({ fontSizePt: 11 }),
    measurement({ lineHeightPt: 12 }), measurement({ pageCount: 2 }), measurement({ ink: { ascentPx: 22, descentPx: 4 } }),
    measurement({ groups: [] }),
  ];
  for (const value of unqualified) {
    const result = renderNativeRetainedScene({ title: "Current", body }, "Scene", value);
    assert.match(markup(result), /native-retained-scene-original/);
    assert.doesNotMatch(markup(result), /native-retained-scene-frame/);
    assert.ok(literals(result).includes(body));
    assert.ok(literals(result).some((text) => text.includes("not verified")));
  }
  const long = measurement({ groups: [groups[0], { role: "action", sourceIndex: 0, lines: Array.from({ length: 125 }, (_, index) => "Line " + index) }] });
  assert.deepEqual(sceneReaderPresentation(body, long), { kind: "fallback", reason: "tooLong" });
  const result = renderNativeRetainedScene({ title: "Long", body }, "Scene", long);
  assert.equal(literals(result).filter((text) => text === body).length, 1);
  assert.ok(literals(result).some((text) => text.includes("exceeds two pages")));
});

test("page frames/counts are derived locally, continuations and labels are not authored body", () => {
  const measured = measurement({ pages: [{ pageWidthPt: 9, lines: ["forged"] }], groups: [
    groups[0], groups[1], { ...groups[2], lines: Array.from({ length: 49 }, (_, index) => "Dialogue " + index) },
  ] });
  const presentation = sceneReaderPresentation(body, measured);
  assert.equal(presentation.kind, "pages");
  assert.equal(presentation.packed.pageCount, 2);
  assert.equal(presentation.packed.policy.pageWidthPt, 612);
  const labels = { fixed: "FIXED", reflow: "REFLOW", unqualified: "UNQUALIFIED", tooLong: "TOO_LONG",
    page: (number, total) => "LOCAL_PAGE_" + number + "_" + total, continuation: "DERIVED_MARKER" };
  const result = renderNativeRetainedScene({ title: "Title", body }, "Scene", measured, labels);
  assert.ok(literals(result).includes("LOCAL_PAGE_1_2") && literals(result).includes("LOCAL_PAGE_2_2"));
  assert.ok(literals(result).includes("DERIVED_MARKER"));
  assert.ok(literals(result).includes("(CONT'D)"));
  assert.ok(!literals(result).includes("forged"));
  assert.equal(presentation.packed.pages.flatMap((page) => page.lines).filter((line) => !line.derived && line.role === "dialogue").length, 49);
});

test("accessor metadata or malicious line containers cannot qualify; fresh props replace old text", () => {
  let called = 0;
  const hostile = measurement();
  Object.defineProperty(hostile, "body", { get() { called += 1; throw new Error("must not invoke"); } });
  assert.equal(sceneReaderPresentation(body, hostile).kind, "fallback");
  const maliciousLines = ["literal"];
  maliciousLines[Symbol.iterator] = function* () { called += 1; yield "forged"; };
  assert.equal(sceneReaderPresentation(body, measurement({ groups: [groups[0], { role: "action", sourceIndex: 0, lines: maliciousLines }] })).kind, "fallback");
  assert.equal(called, 0);
  const replacement = renderNativeRetainedScene({ title: "New", body: "NEW\n\nBODY" }, "Scene", measurement());
  assert.ok(literals(replacement).includes("NEW\n\nBODY"));
  assert.ok(!literals(replacement).includes(body));
});

test("container-only CSS keeps readable flow and scoped exact fixed geometry", () => {
  const css = readFileSync(new URL("../src/components/native-retained-scene.css", import.meta.url), "utf8");
  assert.match(css, /container:\s*retained-scene\s*\/\s*inline-size/);
  assert.match(css, /@container retained-scene \(min-width: 612pt\)/);
  assert.match(css, /inline-size: 612pt/);
  assert.match(css, /block-size: 792pt/);
  assert.match(css, /font: 400 12pt\/16pt/);
  assert.match(css, /font: 400 1rem\/1\.65/);
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /min-block-size: 1\.65em/);
  assert.match(css, /\.native-retained-scene-line\[data-scene-role="parenthetical"\] \{ padding-inline-start: 0; \}/);
  assert.doesNotMatch(css, /@media|transform\s*:|zoom\s*:|overflow(?:-x|-y)?\s*:\s*(?:auto|scroll)/);
  const source = readFileSync(new URL("../src/components/native-retained-scene.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /unsafeHTML|unsafeSVG|innerHTML|customElements\.define|fetch\(|\.focus\(/);
});

test("reader notice and page-label directions follow their own localized text", () => {
  const fixed = markup(renderNativeRetainedScene({ title: "Title", body }, "Scene", measurement()));
  const fallback = markup(renderNativeRetainedScene({ title: "Title", body }, "Scene"));
  assert.match(fixed, /native-retained-scene-notice--reflow" dir="auto"/);
  assert.match(fixed, /native-retained-scene-notice--fixed" dir="auto"/);
  assert.match(fixed, /native-retained-scene-page-label" dir="auto"/);
  assert.match(fallback, /native-retained-scene-notice" dir="auto"/);
});
