import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createRequire, registerHooks } from "node:module";
import { exportProjectArchive } from "../src/model/archive.ts";

// CSS contract plus complete current Library renderer/handlers with the existing
// context-control native/template/Store ports. No picker/browser geometry,
// backend mutation, network/provider or accessibility certification is implied.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const css = postcss.parse(fs.readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8"));
const base = postcss.parse(fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"));
const rows = ":is(.page-header-actions,.family-actions,.generation-failure-actions,.forma-activity-header-actions)";
const formSelector = rows + ' > form:has(> label.button.file-button:only-child > input[type="file"])';
const declarations = (sheet, selector) => {
  const found = [];
  sheet.walkRules(rule => { if (rule.parent.type === "root" && rule.selectors.includes(selector)) found.push(rule); });
  assert.ok(found.length, "current owned rule: " + selector);
  return Object.assign({}, ...found.map(rule => Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]))));
};
test("single-file native form wrappers share action height without selecting arbitrary forms or metadata", () => {
  const form = declarations(css, formSelector), label = declarations(css, formSelector + " > label.button.file-button");
  assert.equal(form.display, "flex"); assert.equal(form["align-self"], "stretch");
  assert.equal(form["min-inline-size"], "0"); assert.equal(form["max-inline-size"], "100%");
  assert.equal(form.flex, undefined, "existing mobile header flex allocation remains the owner");
  assert.equal(label.flex, "1 1 auto"); assert.equal(label["align-self"], "stretch");
  assert.equal(label["white-space"], "normal"); assert.equal(label["overflow-wrap"], "anywhere");
  assert.equal(form.height, undefined); assert.equal(label.height, undefined);
  assert.equal(form.overflow, undefined); assert.equal(label.overflow, undefined);
  assert.equal(declarations(base, ".page-header-actions")["align-items"], "center", "status/health metadata is still centered");
  assert.equal(declarations(base, ".file-button").position, "relative");
  assert.equal(declarations(base, ".file-button input").position, "absolute", "the original native file-input mechanism is unchanged");
  assert.equal(declarations(base, ".file-button input").opacity, "0");
  const focusSelector = '.file-button:has(> input[type="file"]:focus-visible)';
  assert.equal(declarations(css, focusSelector).outline,
    "var(--forma-focus-ring-width, 3px) solid var(--forma-focus-ring-color, var(--orange))",
    "the visible file-picker label, not only its transparent one-pixel input, receives keyboard focus indication");
  assert.equal(declarations(css, focusSelector)["outline-offset"], "3px");
  const forced = [];
  css.walkRules(rule => { if (rule.selectors.includes(focusSelector) && rule.parent.type === "atrule"
    && rule.parent.name === "media" && rule.parent.params === "(forced-colors: active)") forced.push(rule); });
  assert.equal(forced.length, 1);
  assert.ok(forced[0].nodes.some(node => node.prop === "outline-color" && node.value === "Highlight"));
  const library = fs.readFileSync(new URL("../src/components/forma-library.ts", import.meta.url), "utf8");
  assert.match(library, /<form @submit=[\s\S]*?<label class="button secondary file-button">[\s\S]*?<input type="file" accept="application\/json" @change=/u);
  assert.equal(declarations(base, ".file-button").cursor, "pointer");
});

const fixtureUrl = new URL("./context-controls-host.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstTest = fixtureTree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(fixtureTree) === "test");
assert.ok(firstTest, "reuse declarations and actual loader, never register the previous test suite");
const fixtureBody = fixtureSource.slice(0, firstTest.getFullStart())
  + "\nexport { fixture, FormaLibrary };\nexport function mountLibrary(f) { activeFixture=f; f.host=new FormaLibrary(); f.host.connectedCallback(); f.draw(); return f; }\n";
const moduleUrl = new URL(fixtureUrl); moduleUrl.search = "?single-file-action-wrapper";
const hook = registerHooks({ load(url, context, next) { return url === moduleUrl.href ? { format: "module", source: fixtureBody, shortCircuit: true } : next(url, context); } });
let ports;
try { ports = await import(moduleUrl.href); } finally { hook.deregister(); }
const own = (f, tag) => f.renderer.ownNodes(f.host, tag);
const fileInput = f => own(f, "input").find(node => node.attributes.type === "file");
const preview = f => own(f, "dialog").find(node => String(node.attributes.class ?? "").includes("library-import-dialog"));
const mount = (t, locale = "en", viewer = false, sharedAuthor = false) => {
  const f = ports.fixture(locale, viewer);
  f.state.route = "/library";
  if (sharedAuthor) {
    const current = f.store.session.get;
    f.store.session.get = () => ({ ...current(), projectContext: { organizationId: "org", projectAccessId: "access",
      projectId: "project-a", role: "editor", permissions: ["project.read", "project.author"] } });
  }
  t.after(() => f.i18n.hostDisconnected());
  ports.mountLibrary(f); return f;
};
for (const locale of ["en", "fr", "ar", "ja"]) test("full current Library keeps its native single-file preview/cancel/invalid-file path in " + locale, async t => {
  const f = mount(t, locale), before = structuredClone(f.state.events);
  const nativeInput = fileInput(f), form = own(f, "form").find(node => !node.attributes.class && typeof node.handlers.submit === "function");
  assert.ok(nativeInput && form && nativeInput.isConnected && form.isConnected);
  assert.equal(nativeInput.attributes.accept, "application/json");
  const markup = f.renderer.markup;
  assert.match(markup, /<form @submit=__bound_\d+__><label class="button secondary file-button">[\s\S]*?<input type="file" accept="application\/json" @change=__bound_\d+__><\/label><\/form>/u,
    "the actual rendered import is one label-wrapped native input inside the peer form");
  assert.ok(markup.includes(f.i18n.t("projects.importDocument", "Import as document")));
  let prevented = 0;
  await form.handlers.submit.call(f.host, { target: form, currentTarget: form, preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(preview(f), undefined);
  nativeInput.files = [];
  await nativeInput.handlers.change.call(f.host, { target: nativeInput, currentTarget: nativeInput });
  assert.equal(preview(f), undefined, "canceling the native file chooser performs no import");
  let reads = 0;
  const archive = exportProjectArchive(f.state.events, "project-a"), encoded = JSON.stringify(archive);
  nativeInput.files = [{ name: "reused-project.json", type: "application/json", async text() { reads++; return encoded; } }];
  await nativeInput.handlers.change.call(f.host, { target: nativeInput, currentTarget: nativeInput }); f.draw();
  assert.equal(reads, 1); assert.ok(preview(f), "the original import handler still opens the exact archive review");
  assert.deepEqual(f.state.events, before, "preview never creates a document or imports automatically");
  assert.equal(f.state.requests.length, 0);
  const currentPreview = preview(f);
  await currentPreview.handlers.cancel.call(f.host, { target: currentPreview, currentTarget: currentPreview, preventDefault() { prevented++; } });
  f.draw(); assert.equal(preview(f), undefined); assert.equal(prevented, 2);
  const currentInput = fileInput(f); assert.ok(currentInput?.isConnected);
  currentInput.files = [{ async text() { reads++; return "{"; } }];
  await currentInput.handlers.change.call(f.host, { target: currentInput, currentTarget: currentInput }); f.draw();
  assert.equal(reads, 2); assert.equal(preview(f), undefined);
  assert.ok(f.trace.some(entry => entry.startsWith("toast:")), "the original invalid-file feedback remains available");
  assert.deepEqual(f.state.events, before); assert.equal(f.state.requests.length, 0); assert.equal(f.state.route, "/library");
});
test("current shared author keeps New but never gains personal archive import from the wrapper style", t => {
  const f = mount(t, "en", false, true);
  assert.equal(fileInput(f), undefined);
  assert.ok(own(f, "button").some(node => node.attributes["data-context-controls-id"] === "__new__"));
  assert.equal(f.state.requests.length, 0);
});
test("current reader keeps Library inspection without the author-only import or New action", t => {
  const f = mount(t, "ja", true);
  assert.equal(fileInput(f), undefined);
  assert.ok(!own(f, "button").some(node => node.attributes["data-context-controls-id"] === "__new__"));
  assert.equal(f.state.requests.length, 0);
});
